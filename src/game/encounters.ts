import Phaser from 'phaser';
import { RENDER } from '../config';
import type { EncounterKind } from '../sim/encounters';
import { Cyclist } from './actors/Cyclist';
import { HORIZON_Y, lerpColor, MID_FACTOR } from './atmosphere';
import { encounterAudio, type SoundHandle } from './encounterAudio';
import { groundYAt } from './gapMapping';
import { FONT_SANS } from './theme';

// Los encuentros, dibujados: cada uno vive en una capa del paisaje (cielo,
// horizonte, capa media o junto al asfalto) y se mueve con ella, a la escala
// de esa capa, con una animación propia encima. Todo por código, como el
// resto del juego; el único texto es el de la señal.
//
// La técnica (2026-09-23, segunda pasada): los animales son contornos suaves
// (Catmull-Rom cerrado sobre un puñado de puntos dibujados a mano en un
// espacio propio, con los pies en y = 0), rellenos con la tinta de su capa,
// una banda de sombra por debajo, una de luz por delante donde da el frontal
// y el borde de luna que ya lleva el ciclista. Encima, lo que distingue a cada
// uno: pezuñas, crines, orejas, colmillos, un disco facial, bisagras y
// cristales. La primera pasada eran elipses y palos, y se leía como un dibujo
// infantil. Ninguno toca la simulación: son cosas que pasan mientras pedaleas.

/** Las capas del paisaje en las que dibujan los encuentros, de atrás adelante. */
export interface EncounterLayers {
  sky: Phaser.GameObjects.Graphics;
  horizon: Phaser.GameObjects.Graphics;
  mid: Phaser.GameObjects.Graphics;
  near: Phaser.GameObjects.Graphics;
}

/** Lo que el paisaje sabe ahora mismo y los encuentros necesitan. */
export interface EncounterLook {
  /** 1 en noche cerrada … 0 con el sol fuera: cuánto lucen las luces. */
  night: number;
  sun: number;
  /** Siluetas por capa, un tono más claras que su capa. */
  nearInk: number;
  midInk: number;
  farInk: number;
  skyInk: number;
  /** El color de lo encendido. */
  light: number;
  moonX: number;
  moonY: number;
  /** Pendiente de pantalla ya suavizada. */
  slope: number;
}

export interface EncounterFrame extends EncounterLook {
  dt: number;
  /** Metros pedaleados hoy: lo que está en la carretera se mueve con ellos. */
  distanceM: number;
  /** Tu velocidad ahora: lo que corre a tu lado la compara con la suya. */
  speedMps: number;
  /** Dentro de la zona prescrita: el perro solo corre contigo mientras la aguantes. */
  inZone: boolean;
}

export interface EncounterStart {
  distanceM: number;
  /** Tu velocidad al aparecer: decide si los caballos vienen por detrás o los alcanzas. */
  speedMps?: number;
  /** Para la señal: el próximo refugio y los km que faltan. */
  sign?: { refuge: string; kmLeft: number };
  rnd?: () => number;
}

const PX_M = RENDER.groundPxPerMeter;
const NEAR_F = RENDER.nearFactor;
const FAR_F = 0.12;
/** El arcén lejano, donde apoyan farolas y refugios. */
const FEET_Y = HORIZON_Y + 6;
const FIREFLY = 0xd4ff7a;
const AMBER = 0xffb028;
const FLAME = 0xff8a30;
const EMBER = 0xffd070;
const SKY_INK = 0x14121f;
/** Luz de luna en el borde de las siluetas, la misma que lleva el ciclista. */
const RIM_LIGHT = 0xc4d6ec;
const PAINT = '#c8412f';
const SIGN_PHRASES = ['SIGUE PEDALEANDO', 'NO MIRES ATRÁS', 'AÚN QUEDAMOS', 'NO PARES AHORA', 'EL SOL SALE ALLÍ →'];

type Pt = readonly [number, number];
type Shape = ReadonlyArray<Pt>;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** X en pantalla de algo que estaba a `aheadM` metros cuando apareció, en una capa con ese factor de scroll. */
function worldX(f: EncounterFrame, startM: number, aheadM: number, factor = 1): number {
  return RENDER.playerX + (aheadM - (f.distanceM - startM)) * PX_M * factor;
}

/** Y del pie de algo junto al asfalto, con la carretera inclinada. */
function feetY(x: number, slope: number): number {
  return FEET_Y + groundYAt(x, slope) - RENDER.groundY;
}

/** Cuánto le da el frontal del ciclista a algo en x: el haz cae justo por delante. */
function beam(x: number): number {
  return clamp01(1 - Math.abs(x - 1030) / 200);
}

/**
 * La tinta de lo que está junto al asfalto: la silueta de la capa, y más
 * cálida y clara cuanto más le da el frontal. Sin esto un ciervo sobre el
 * asfalto era una sombra sobre otra sombra.
 */
function nearTone(f: EncounterFrame, x: number): number {
  const lit = 0.16 + 0.5 * beam(x) * (0.35 + 0.65 * f.night);
  return lerpColor(f.nearInk, 0xe0b98a, lit);
}

/** Los tonos con que se pinta un cuerpo: base, sombra por debajo, luz por delante y borde de luna. */
interface Tones {
  base: number;
  shade: number;
  lit: number;
  rim: number;
  rimA: number;
  light: number;
  night: number;
}

function tonesAt(f: EncounterFrame, x: number): Tones {
  const base = nearTone(f, x);
  return {
    base,
    shade: lerpColor(base, 0x000000, 0.38),
    lit: lerpColor(base, 0xf0dcb8, 0.35 + 0.3 * beam(x)),
    rim: RIM_LIGHT,
    rimA: 0.45 * f.night,
    light: f.light,
    night: f.night,
  };
}

function tonesMid(f: EncounterFrame): Tones {
  const base = f.midInk;
  return { base, shade: lerpColor(base, 0x000000, 0.35), lit: lerpColor(base, 0xffc080, 0.45), rim: RIM_LIGHT, rimA: 0.25 * f.night, light: f.light, night: f.night };
}

// ---- formas: contornos suaves --------------------------------------------------------

/** Catmull-Rom cerrado: de un puñado de puntos, un contorno suave. */
function loop(pts: Shape, per = 6): Phaser.Types.Math.Vector2Like[] {
  const n = pts.length;
  const out: Phaser.Types.Math.Vector2Like[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        y: 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      });
    }
  }
  return out;
}

/** Lleva un contorno del espacio propio (pies en 0, mirando a la derecha) a la pantalla. */
function place(pts: readonly Phaser.Types.Math.Vector2Like[], x: number, y: number, s: number, dir: 1 | -1): Phaser.Types.Math.Vector2Like[] {
  return pts.map((p) => ({ x: x + (p.x ?? 0) * s * dir, y: y + (p.y ?? 0) * s }));
}

/** Rellena un contorno suave. */
function blob(g: Phaser.GameObjects.Graphics, pts: Shape, x: number, y: number, s: number, dir: 1 | -1, color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillPoints(place(loop(pts), x, y, s, dir), true);
}

/** Un polígono tal cual (para lo fabricado: chapa, cristal, madera). */
function poly(g: Phaser.GameObjects.Graphics, pts: Shape, x: number, y: number, s: number, dir: 1 | -1, color: number, alpha = 1): void {
  g.fillStyle(color, alpha);
  g.fillPoints(
    pts.map(([px, py]) => ({ x: x + px * s * dir, y: y + py * s })),
    true,
  );
}

/** El borde de luna sobre un contorno suave. */
function rimOf(g: Phaser.GameObjects.Graphics, pts: Shape, x: number, y: number, s: number, dir: 1 | -1, t: Tones): void {
  if (t.rimA <= 0.02) return;
  g.lineStyle(1.4, t.rim, t.rimA);
  g.strokePoints(place(loop(pts), x, y, s, dir), true);
}

/** Una pata de dos huesos con articulación, en el espacio propio. */
function limb(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, dir: 1 | -1, hip: Pt, knee: Pt, foot: Pt, wUpper: number, wLower: number, color: number): void {
  const P = (p: Pt): [number, number] => [x + p[0] * s * dir, y + p[1] * s];
  const [hx, hy] = P(hip);
  const [kx, ky] = P(knee);
  const [fx, fy] = P(foot);
  g.lineStyle(wUpper * s, color, 1);
  g.lineBetween(hx, hy, kx, ky);
  g.fillStyle(color, 1);
  g.fillCircle(kx, ky, (wUpper * s) / 2);
  g.lineStyle(wLower * s, color, 1);
  g.lineBetween(kx, ky, fx, fy);
}

function hoof(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, dir: 1 | -1, foot: Pt, w: number, color: number): void {
  g.fillStyle(color, 1);
  g.fillEllipse(x + foot[0] * s * dir, y + foot[1] * s - 1.5 * s, w * s, 3.5 * s);
}

function drawEyes(g: Phaser.GameObjects.Graphics, x: number, y: number, gap: number, r: number, light: number, a: number): void {
  if (a <= 0.01) return;
  g.fillStyle(light, a * 0.35);
  g.fillCircle(x - gap / 2, y, r * 2.2);
  g.fillCircle(x + gap / 2, y, r * 2.2);
  g.fillStyle(0xfff4d0, a);
  g.fillCircle(x - gap / 2, y, r);
  g.fillCircle(x + gap / 2, y, r);
}

abstract class Active {
  protected t = 0;
  constructor(
    protected readonly startM: number,
    protected readonly rnd: () => number,
  ) {}

  /** Un fotograma más; false cuando ya pasó. */
  update(f: EncounterFrame, L: EncounterLayers): boolean {
    this.t += f.dt;
    return this.draw(f, L);
  }

  protected abstract draw(f: EncounterFrame, L: EncounterLayers): boolean;

  destroy(): void {
    /* nada que soltar por defecto */
  }
}

// ---- el ciervo -----------------------------------------------------------------------

const DEER_BODY: Shape = [
  [-30, -46],
  [-18, -54],
  [0, -56],
  [16, -56],
  [26, -58],
  [36, -70],
  [44, -82],
  [52, -86],
  [64, -82],
  [72, -74],
  [76, -68],
  [70, -62],
  [58, -60],
  [46, -62],
  [40, -52],
  [32, -42],
  [22, -35],
  [4, -33],
  [-14, -35],
  [-26, -39],
  [-36, -44],
];
const DEER_BELLY: Shape = [
  [32, -42],
  [22, -35],
  [4, -33],
  [-14, -35],
  [-26, -39],
  [-36, -44],
  [-28, -46],
  [-14, -42],
  [4, -40],
  [20, -42],
];
const DEER_THROAT: Shape = [
  [46, -62],
  [36, -50],
  [30, -40],
  [34, -36],
  [42, -46],
  [52, -58],
];

/** El ciervo, mirando hacia +x; `leap` −1…1 es la fase del salto (patas recogidas o estiradas). */
function drawDeer(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, dir: 1 | -1, t: Tones, leap: number): void {
  const stretch = Math.max(0, leap);
  const tuck = Math.max(0, -leap);
  // Patas de atrás (la lejana en sombra), el cuerpo, las de delante.
  limb(g, x, y, s, dir, [-22, -38], [-30 - 8 * stretch, -20 + 6 * tuck], [-26 - 22 * stretch + 8 * tuck, -8 * stretch - 4 * tuck], 5, 3, t.shade);
  limb(g, x, y, s, dir, [-18, -38], [-24 - 8 * stretch, -18 + 6 * tuck], [-18 - 20 * stretch + 8 * tuck, -8 * stretch - 2 * tuck], 5.5, 3.2, t.base);
  blob(g, DEER_BODY, x, y, s, dir, t.base);
  blob(g, DEER_BELLY, x, y, s, dir, t.shade, 0.85);
  blob(g, DEER_THROAT, x, y, s, dir, t.lit, 0.55);
  limb(g, x, y, s, dir, [30, -38], [34 + 8 * stretch, -20 + 6 * tuck], [30 + 22 * stretch - 8 * tuck, -8 * stretch - 4 * tuck], 5, 3, t.shade);
  limb(g, x, y, s, dir, [26, -38], [30 + 8 * stretch, -18 + 6 * tuck], [24 + 20 * stretch - 8 * tuck, -8 * stretch - 2 * tuck], 5.5, 3.2, t.base);
  for (const foot of [
    [-18 - 20 * stretch + 8 * tuck, -8 * stretch - 2 * tuck],
    [24 + 20 * stretch - 8 * tuck, -8 * stretch - 2 * tuck],
  ] as const) {
    hoof(g, x, y, s, dir, foot, 6, t.shade);
  }
  // La cola con el envés claro, la oreja, la cornamenta (dos, la de atrás más corta) y el ojo.
  g.fillStyle(t.lit, 0.9);
  g.fillEllipse(x - 34 * s * dir, y - 48 * s, 6 * s, 10 * s);
  poly(g, [[46, -84], [38, -82], [34, -98]], x, y, s, dir, t.base);
  poly(g, [[44, -84], [40, -83], [37, -94]], x, y, s, dir, t.shade, 0.8);
  for (const [ox, k, w] of [
    [3, 0.85, 2.2],
    [0, 1, 2.8],
  ] as const) {
    g.lineStyle(w * s, k === 1 ? t.base : t.shade, 1);
    const bx = x + (52 + ox) * s * dir;
    const by = y - 88 * s;
    const pts: Pt[] = [
      [0, 0],
      [-2 * k, -12 * k],
      [-6 * k, -24 * k],
      [-12 * k, -34 * k],
    ];
    for (let i = 1; i < pts.length; i++) g.lineBetween(bx + pts[i - 1]![0] * s * dir, by + pts[i - 1]![1] * s, bx + pts[i]![0] * s * dir, by + pts[i]![1] * s);
    g.lineBetween(bx - 4 * k * s * dir, by - 16 * k * s, bx + 6 * k * s * dir, by - 26 * k * s);
    g.lineBetween(bx - 8 * k * s * dir, by - 28 * k * s, bx + 2 * k * s * dir, by - 40 * k * s);
    g.lineBetween(bx, by, bx + 8 * k * s * dir, by - 10 * k * s);
  }
  g.fillStyle(t.shade, 1);
  g.fillCircle(x + 75 * s * dir, y - 69 * s, 2 * s);
  rimOf(g, DEER_BODY, x, y, s, dir, t);
  drawEyes(g, x + 62 * s * dir, y - 77 * s, 0, 1.8 * s, t.light, 0.9 * t.night);
}

class Deer extends Active {
  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    // Tres saltos hasta el borde de acá, y sigue hacia el primer plano hasta salir por abajo.
    const run = this.t / 1.7;
    const k = Math.min(1, run);
    const x = worldX(f, this.startM, 9) - run * 40;
    const yTop = feetY(x, f.slope) - 6;
    const hop = Math.sin(k * Math.PI * 3);
    const y = yTop + run * 150 - Math.abs(hop) * 30;
    const s = 0.95 + k * 0.55;
    if (y - 110 * s > RENDER.height || x < -100) return false;
    drawDeer(L.near, x, y, s, -1, tonesAt(f, x), hop);
    return true;
  }
}

// ---- los jabalíes --------------------------------------------------------------------

const BOAR_BODY: Shape = [
  [-34, -30],
  [-32, -42],
  [-16, -50],
  [0, -54],
  [14, -52],
  [26, -46],
  [38, -40],
  [48, -30],
  [54, -24],
  [52, -18],
  [42, -16],
  [30, -14],
  [16, -16],
  [0, -14],
  [-18, -16],
  [-30, -20],
];
const BOAR_BELLY: Shape = [
  [42, -16],
  [30, -14],
  [16, -16],
  [0, -14],
  [-18, -16],
  [-30, -20],
  [-30, -26],
  [-16, -24],
  [0, -22],
  [16, -24],
  [32, -22],
];

function drawBoar(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, dir: 1 | -1, t: Tones, trot: number, striped: boolean): void {
  const k = Math.sin(trot);
  limb(g, x, y, s, dir, [-20, -20], [-24 - 5 * k, -10], [-26 - 8 * k, 0], 4.5, 3, t.shade);
  limb(g, x, y, s, dir, [26, -20], [28 + 5 * k, -10], [30 + 8 * k, 0], 4.5, 3, t.shade);
  blob(g, BOAR_BODY, x, y, s, dir, t.base);
  blob(g, BOAR_BELLY, x, y, s, dir, t.shade, 0.85);
  limb(g, x, y, s, dir, [-14, -20], [-16 + 5 * k, -10], [-14 + 8 * k, 0], 5, 3.2, t.base);
  limb(g, x, y, s, dir, [30, -20], [32 - 5 * k, -10], [34 - 8 * k, 0], 5, 3.2, t.base);
  for (const foot of [
    [-14 + 8 * k, 0],
    [34 - 8 * k, 0],
  ] as const) {
    hoof(g, x, y, s, dir, foot, 5, t.shade);
  }
  // Las cerdas del lomo, la oreja, el colmillo, el rabo y el ojo.
  g.fillStyle(t.shade, 1);
  for (let i = 0; i < 7; i++) {
    const bx = -14 + i * 5;
    const by = -50 - Math.sin(i * 1.3) * 2 + (i > 4 ? (i - 4) * 2 : 0);
    poly(g, [[bx - 2, by + 2], [bx + 2, by + 2], [bx + 1, by - 6]], x, y, s, dir, t.shade);
  }
  poly(g, [[24, -48], [18, -44], [20, -58]], x, y, s, dir, t.base);
  if (striped) {
    g.lineStyle(2 * s, t.lit, 0.35);
    for (let i = 0; i < 4; i++) g.lineBetween(x + (-26 + i * 14) * s * dir, y - 46 * s, x + (-30 + i * 14) * s * dir, y - 18 * s);
  }
  g.lineStyle(1.6 * s, 0xf2ead8, 0.9);
  g.lineBetween(x + 47 * s * dir, y - 20 * s, x + 44 * s * dir, y - 13 * s);
  g.lineStyle(2 * s, t.base, 1);
  g.lineBetween(x - 33 * s * dir, y - 38 * s, x - 42 * s * dir, y - 28 * s - Math.sin(trot * 0.5) * 3 * s);
  rimOf(g, BOAR_BODY, x, y, s, dir, t);
  drawEyes(g, x + 36 * s * dir, y - 34 * s, 0, 1.4 * s, t.light, 0.8 * t.night);
}

class Boars extends Active {
  private readonly members = [
    { scale: 1, delay: 0, speed: 1, striped: false },
    { scale: 0.5, delay: 0.9, speed: 1, striped: true },
    { scale: 0.5, delay: 1.5, speed: 1, striped: true },
    // El último se despista y corre a alcanzarlos.
    { scale: 0.5, delay: 2.6, speed: 1.6, striped: true },
  ];
  private grunted = 0;

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    if (this.grunted < 2 && this.t > 0.3 + this.grunted * 1.3) {
      this.grunted++;
      encounterAudio.grunt();
    }
    let alive = false;
    this.members.forEach((m, i) => {
      const k = Math.min(1, Math.max(0, (this.t - m.delay) * m.speed) / 2.4);
      if (k >= 1) return;
      const x = worldX(f, this.startM, 10) - i * 26 - k * 24;
      if (x < -80) return;
      const y = feetY(x, f.slope) - 4 + k * 150 - Math.abs(Math.sin(k * Math.PI * 7)) * 4 * m.scale;
      alive = true;
      drawBoar(L.near, x, y, m.scale * (1 + k * 0.6), -1, tonesAt(f, x), k * Math.PI * 14, m.striped);
    });
    return alive || this.t < 0.5;
  }
}

// ---- la lechuza ----------------------------------------------------------------------

const OWL_BODY: Shape = [
  [-14, -10],
  [-17, -30],
  [-13, -48],
  [-6, -56],
  [6, -56],
  [13, -48],
  [17, -30],
  [14, -10],
  [6, -4],
  [-6, -4],
];
const OWL_WING: Shape = [
  [-16, -26],
  [-19, -40],
  [-15, -52],
  [-8, -44],
  [-9, -28],
  [-11, -14],
];

function drawOwl(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, t: Tones, turn: number): void {
  blob(g, OWL_BODY, x, y, s, 1, t.base);
  // El pecho moteado, las alas plegadas a los lados, las garras en el travesaño.
  g.fillStyle(t.lit, 0.5);
  g.fillEllipse(x, y - 30 * s, 18 * s, 34 * s);
  g.fillStyle(t.shade, 0.7);
  for (let i = 0; i < 9; i++) g.fillEllipse(x + ((i % 3) - 1) * 5 * s, y - (16 + Math.floor(i / 3) * 9) * s, 2.6 * s, 4 * s);
  blob(g, OWL_WING, x, y, s, 1, t.shade, 0.9);
  blob(g, OWL_WING, x, y, s, -1, t.shade, 0.9);
  g.lineStyle(2 * s, t.shade, 1);
  for (const dx of [-6, -3, 3, 6]) g.lineBetween(x + dx * s, y - 4 * s, x + dx * 1.4 * s, y + 2 * s);
  // La cabeza redonda con las orejas, el disco facial, el pico y los ojos que te siguen.
  const hx = x + turn * 2 * s;
  g.fillStyle(t.base, 1);
  g.fillCircle(hx, y - 63 * s, 14 * s);
  poly(g, [[-10, -72], [-15, -88], [-3, -75]], hx, y, s, 1, t.base);
  poly(g, [[10, -72], [15, -88], [3, -75]], hx, y, s, 1, t.base);
  g.fillStyle(t.lit, 0.45);
  g.fillCircle(hx - 5.5 * s + turn * 2 * s, y - 64 * s, 7 * s);
  g.fillCircle(hx + 5.5 * s + turn * 2 * s, y - 64 * s, 7 * s);
  g.fillStyle(t.shade, 1);
  poly(g, [[-2, -60], [2, -60], [0, -54]], hx + turn * 2 * s, y, s, 1, t.shade);
  g.lineStyle(1.4, t.rim, t.rimA);
  g.strokeCircle(hx, y - 63 * s, 14 * s);
  rimOf(g, OWL_BODY, x, y, s, 1, t);
  drawEyes(g, hx + turn * 3 * s, y - 64 * s, 11 * s, 2.6 * s, t.light, 0.9 * t.night);
}

class Owl extends Active {
  private hooted = false;

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 12);
    if (x < -40) return false;
    const y0 = feetY(x, f.slope);
    const g = L.near;
    const t = tonesAt(f, x);
    // Un poste de madera con el travesaño, vetas y el alambre caído.
    g.fillStyle(t.base, 1);
    g.fillRect(x - 4, y0 - 126, 8, 126);
    g.fillStyle(t.shade, 0.6);
    g.fillRect(x - 1, y0 - 120, 2, 118);
    g.fillRect(x - 24, y0 - 128, 48, 5);
    g.fillStyle(t.base, 1);
    g.fillRect(x - 22, y0 - 130, 44, 4);
    g.lineStyle(1, t.shade, 0.8);
    g.lineBetween(x - 22, y0 - 128, x - 60, y0 - 96);
    drawOwl(g, x, y0 - 128, 0.55, t, Math.max(-1, Math.min(1, (RENDER.playerX - x) / 400)));
    if (!this.hooted && x < 1080) {
      this.hooted = true;
      encounterAudio.hoot();
    }
    return true;
  }
}

// ---- el gato -------------------------------------------------------------------------

const CAT_BODY: Shape = [
  [-22, -4],
  [-28, -18],
  [-26, -34],
  [-18, -44],
  [-6, -48],
  [4, -46],
  [10, -52],
  [10, -62],
  [16, -68],
  [26, -68],
  [32, -62],
  [32, -52],
  [26, -46],
  [18, -42],
  [16, -30],
  [14, -14],
  [12, -2],
  [-6, 0],
];
const CAT_CHEST: Shape = [
  [18, -42],
  [16, -30],
  [14, -14],
  [12, -2],
  [4, -2],
  [6, -16],
  [8, -30],
  [10, -40],
];

function drawCat(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, dir: 1 | -1, t: Tones, a: number, sway: number): void {
  if (a > 0) {
    // La cola envolviendo las patas, el cuerpo sentado, el pecho claro, la pata delantera marcada.
    g.lineStyle(4 * s, t.base, a);
    const tail: Pt[] = [
      [-22, -6],
      [-34, -2],
      [-42, -8 + sway],
      [-40, -18 + sway * 1.5],
    ];
    for (let i = 1; i < tail.length; i++) g.lineBetween(x + tail[i - 1]![0] * s * dir, y + tail[i - 1]![1] * s, x + tail[i]![0] * s * dir, y + tail[i]![1] * s);
    g.fillStyle(t.lit, a * 0.8);
    g.fillCircle(x - 40 * s * dir, y + (-18 + sway * 1.5) * s, 2.4 * s);
    blob(g, CAT_BODY, x, y, s, dir, t.base, a);
    blob(g, CAT_CHEST, x, y, s, dir, t.lit, 0.5 * a);
    g.lineStyle(1.2 * s, t.shade, 0.8 * a);
    g.lineBetween(x + 6 * s * dir, y - 26 * s, x + 8 * s * dir, y - 2 * s);
    // Las orejas con el interior, la nariz, los bigotes.
    poly(g, [[11, -66], [9, -80], [19, -68]], x, y, s, dir, t.base, a);
    poly(g, [[25, -68], [31, -80], [33, -66]], x, y, s, dir, t.base, a);
    poly(g, [[12, -67], [11, -76], [17, -68]], x, y, s, dir, t.shade, 0.7 * a);
    poly(g, [[26, -68], [30, -76], [31, -67]], x, y, s, dir, t.shade, 0.7 * a);
    g.fillStyle(t.shade, a);
    g.fillTriangle(x + 22 * s * dir, y - 53 * s, x + 26 * s * dir, y - 53 * s, x + 24 * s * dir, y - 50 * s);
    g.lineStyle(1, t.lit, 0.45 * a);
    for (const [dy, len] of [
      [-54, 16],
      [-51, 17],
      [-48, 15],
    ] as const) {
      g.lineBetween(x + 27 * s * dir, y + dy * s, x + (27 + len) * s * dir, y + (dy + 2) * s);
      g.lineBetween(x + 20 * s * dir, y + dy * s, x + (20 - len) * s * dir, y + (dy + 2) * s);
    }
    rimOf(g, CAT_BODY, x, y, s, dir, { ...t, rimA: t.rimA * a });
  }
  drawEyes(g, x + 24 * s * dir, y - 58 * s, 9 * s, 1.9 * s, t.light, 0.95 * t.night);
}

class Cat extends Active {
  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 13);
    if (x < -120) return false;
    const y0 = feetY(x, f.slope);
    const g = L.near;
    const t = tonesAt(f, x);
    // La tapia y el gato se ven cuando llegas; los ojos, antes.
    const a = clamp01((RENDER.width + 90 - x) / 340);
    if (a > 0) {
      g.fillStyle(t.base, a);
      g.fillRect(x - 90, y0 - 42, 180, 42);
      g.fillStyle(t.lit, 0.35 * a);
      g.fillRect(x - 90, y0 - 44, 180, 3);
      g.lineStyle(1, 0x000000, 0.3 * a);
      g.lineBetween(x - 90, y0 - 21, x + 90, y0 - 21);
      for (const dx of [-64, -32, 0, 32, 64]) g.lineBetween(x + dx, y0 - 42, x + dx, y0 - 21);
      for (const dx of [-48, -16, 16, 48]) g.lineBetween(x + dx, y0 - 21, x + dx, y0);
      g.fillStyle(t.shade, 0.5 * a);
      g.fillRect(x - 70, y0 - 36, 14, 8);
      g.fillRect(x + 20, y0 - 16, 10, 7);
    }
    drawCat(g, x, y0 - 42, 0.5, -1, t, a, Math.sin(this.t * 2.2) * 5);
    return true;
  }
}

// ---- el otro superviviente -----------------------------------------------------------

class OtherCyclist extends Active {
  private readonly rider: Cyclist;
  private rang = false;

  constructor(startM: number, rnd: () => number, scene: Phaser.Scene) {
    super(startM, rnd);
    this.rider = new Cyclist(scene);
  }

  protected draw(f: EncounterFrame, _L: EncounterLayers): boolean {
    // Viene de frente a unos 20 km/h por el carril de allá, y al cruzarse toca el timbre.
    const x = worldX(f, this.startM, 16) - this.t * 5.5 * PX_M;
    if (x < -120) return false;
    this.rider.place(x, feetY(x, f.slope) + 6, 1.15, 1, true);
    this.rider.update(f.dt, 78, 5.5, 0.35, 0);
    if (!this.rang && x < RENDER.playerX + 300) {
      this.rang = true;
      encounterAudio.bell();
    }
    return true;
  }

  override destroy(): void {
    this.rider.destroy();
  }
}

// ---- el coche abandonado -------------------------------------------------------------

const CAR_BODY: Shape = [
  [-76, -14],
  [-79, -24],
  [-76, -32],
  [-40, -38],
  [-30, -40],
  [-14, -60],
  [26, -62],
  [40, -58],
  [52, -44],
  [56, -30],
  [54, -16],
  [40, -12],
  [-60, -12],
];
const CAR_HATCH: Shape = [
  [26, -62],
  [40, -90],
  [68, -84],
  [56, -60],
];

class Car extends Active {
  private phase = 0;

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 14);
    if (x < -130) return false;
    const y0 = feetY(x, f.slope);
    const g = L.near;
    const t = tonesAt(f, x);
    const dir: 1 | -1 = -1;
    // La carrocería (mirando hacia ti), el portón levantado, los cristales, la línea de la puerta.
    poly(g, CAR_HATCH, x, y0, 1, dir, t.shade);
    poly(g, [[32, -64], [42, -84], [60, -80], [52, -64]], x, y0, 1, dir, 0x1a2030, 0.9);
    poly(g, CAR_BODY, x, y0, 1, dir, t.base);
    poly(g, [[-30, -40], [-15, -59], [2, -59], [-4, -40]], x, y0, 1, dir, 0x1a2030, 0.95);
    poly(g, [[6, -59], [26, -61], [36, -57], [40, -42], [10, -42]], x, y0, 1, dir, 0x1a2030, 0.95);
    g.lineStyle(1.5, t.lit, 0.35);
    g.lineBetween(x - 26 * dir, y0 - 42, x - 12 * dir, y0 - 57);
    g.lineBetween(x + 12 * dir, y0 - 44, x + 30 * dir, y0 - 59);
    g.lineStyle(1.2, t.shade, 0.9);
    g.lineBetween(x + 2 * dir, y0 - 40, x + 2 * dir, y0 - 14);
    g.fillStyle(t.lit, 0.7);
    g.fillRect(x + 12 * dir - 3, y0 - 30, 6, 2);
    poly(g, [[-30, -46], [-36, -46], [-36, -40], [-30, -41]], x, y0, 1, dir, t.base);
    // Abolladuras y óxido, los faros apagados y el piloto.
    g.fillStyle(t.shade, 0.45);
    g.fillEllipse(x - 50 * dir, y0 - 24, 18, 8);
    g.fillEllipse(x + 30 * dir, y0 - 20, 12, 6);
    g.fillStyle(0x5a3a28, 0.4);
    g.fillEllipse(x - 20 * dir, y0 - 16, 16, 5);
    g.fillStyle(0x0c0e18, 1);
    g.fillEllipse(x - 74 * dir, y0 - 28, 9, 6);
    g.fillStyle(t.lit, 0.35);
    g.fillEllipse(x - 75 * dir, y0 - 29, 3, 2);
    g.fillStyle(0x5a1414, 1);
    g.fillRect(x + 52 * dir - 2, y0 - 32, 4, 8);
    // Las ruedas: neumático, llanta y buje; la trasera pinchada, sobre la llanta.
    for (const [wx, flat] of [
      [-46, false],
      [44, true],
    ] as const) {
      const wy = y0 - 4 + (flat ? 3 : 0);
      g.fillStyle(0x12141c, 1);
      g.fillEllipse(x + wx * dir, wy, 24, flat ? 18 : 24);
      g.fillStyle(t.shade, 1);
      g.fillCircle(x + wx * dir, wy - (flat ? 1 : 0), 7);
      g.lineStyle(1, t.lit, 0.5);
      g.strokeCircle(x + wx * dir, wy - (flat ? 1 : 0), 7);
      g.fillStyle(t.lit, 0.8);
      g.fillCircle(x + wx * dir, wy - (flat ? 1 : 0), 1.8);
    }
    g.lineStyle(1.4, t.rim, t.rimA);
    g.strokePoints(place(CAR_BODY.map(([px, py]) => ({ x: px, y: py })), x, y0, 1, dir), true);
    // Los intermitentes, con la batería agonizando: cada vez más lentos.
    const period = 0.75 + 1.3 * clamp01((this.t - 2) / 14);
    this.phase += f.dt;
    const lit = this.phase % period < period * 0.42;
    if (lit && f.night > 0.05) {
      const a = f.night * (1 - 0.35 * clamp01((this.t - 2) / 14));
      for (const lx of [x - 76 * dir, x + 55 * dir]) {
        g.fillStyle(AMBER, 0.28 * a);
        g.fillCircle(lx, y0 - 35, 11);
        g.fillStyle(EMBER, 0.95 * a);
        g.fillEllipse(lx, y0 - 35, 6, 4);
      }
      g.fillStyle(AMBER, 0.1 * a);
      g.fillEllipse(x, y0 + 8, 240, 26);
    }
    return true;
  }
}

// ---- la señal pintada ----------------------------------------------------------------

class Sign extends Active {
  private readonly line1: Phaser.GameObjects.Text;
  private readonly line2: Phaser.GameObjects.Text;

  constructor(startM: number, rnd: () => number, scene: Phaser.Scene, sign: { refuge: string; kmLeft: number } | undefined) {
    super(startM, rnd);
    const top = sign ? `${sign.refuge}   ${Math.max(1, sign.kmLeft)}` : 'REFUGIO   →';
    const phrase = SIGN_PHRASES[Math.floor(rnd() * SIGN_PHRASES.length)] ?? SIGN_PHRASES[0]!;
    this.line1 = scene.add
      .text(-500, 0, top, { fontFamily: FONT_SANS, fontSize: '17px', fontStyle: 'bold', color: '#e8f0e4' })
      .setOrigin(0.5, 0)
      .setDepth(1);
    this.line2 = scene.add
      .text(-500, 0, phrase, { fontFamily: FONT_SANS, fontSize: '15px', fontStyle: 'bold', color: PAINT })
      .setOrigin(0.5, 0)
      .setRotation(-0.07)
      .setDepth(1);
  }

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 13);
    if (x < -120) return false;
    const y0 = feetY(x, f.slope);
    const g = L.near;
    const t = tonesAt(f, x);
    // La placa es retrorreflectante: se enciende cuando le da tu frontal.
    const hit = clamp01(1 - Math.abs(x - 1060) / 320) * (0.4 + 0.6 * f.night);
    // Dos postes galvanizados con la base, la placa con el marco y sus tornillos, y tres agujeros de bala.
    for (const dx of [-60, 60]) {
      g.fillStyle(t.base, 1);
      g.fillRect(x + dx - 3, y0 - 150, 6, 150);
      g.fillStyle(t.lit, 0.4);
      g.fillRect(x + dx - 3, y0 - 150, 2, 150);
      g.fillStyle(t.shade, 1);
      g.fillRect(x + dx - 7, y0 - 4, 14, 4);
    }
    const face = lerpColor(0x1d3a2a, 0x8fd0a4, hit);
    g.fillStyle(t.shade, 1);
    g.fillRoundedRect(x - 88, y0 - 160, 176, 70, 5);
    g.fillStyle(face, 1);
    g.fillRoundedRect(x - 86, y0 - 158, 172, 66, 4);
    g.lineStyle(2, lerpColor(0x8fb09a, 0xf0fff4, hit), 0.5 + 0.5 * hit);
    g.strokeRoundedRect(x - 80, y0 - 152, 160, 54, 3);
    g.fillStyle(t.lit, 0.8);
    for (const [bx, by] of [
      [-60, -152],
      [60, -152],
      [-60, -100],
      [60, -100],
    ] as const) {
      g.fillCircle(x + bx, y0 + by, 1.8);
    }
    for (const [hx, hy] of [
      [-30, -112],
      [50, -140],
      [64, -104],
    ] as const) {
      g.fillStyle(0x05060c, 1);
      g.fillCircle(x + hx, y0 + hy, 2.4);
      g.lineStyle(1, t.lit, 0.5);
      g.strokeCircle(x + hx, y0 + hy, 3.2);
    }
    // La flecha hacia delante y el chorreón de pintura bajo la frase.
    g.fillStyle(lerpColor(0xc8d8cc, 0xffffff, hit), 0.75 + 0.25 * hit);
    g.fillTriangle(x + 66, y0 - 146, x + 66, y0 - 134, x + 76, y0 - 140);
    g.fillStyle(0xc8412f, 0.85);
    g.fillRect(x + 22, y0 - 110, 2, 10);
    g.fillRect(x - 38, y0 - 108, 2, 6);
    this.line1.setPosition(x - 4, y0 - 151).setAlpha(0.45 + 0.55 * hit);
    this.line2.setPosition(x + 2, y0 - 125).setAlpha(0.6 + 0.4 * hit);
    return true;
  }

  override destroy(): void {
    this.line1.destroy();
    this.line2.destroy();
  }
}

// ---- el semáforo ---------------------------------------------------------------------

class TrafficLight extends Active {
  private wasLit = false;

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 13);
    if (x < -130) return false;
    const y0 = feetY(x, f.slope);
    const g = L.near;
    const t = tonesAt(f, x);
    // El cruce: la calle que se va, más oscura, la línea de detención y el paso de cebra.
    g.fillStyle(0x05060c, 0.55);
    g.fillRect(x - 64, y0 - 10, 128, RENDER.height - y0 + 10);
    g.fillStyle(t.base, 0.5);
    g.fillRect(x - 64, y0 - 12, 128, 2);
    g.fillStyle(0xd8d4c4, 0.28);
    g.fillRect(x - 74, y0 - 8, 4, RENDER.height - y0 + 8);
    for (let i = 0; i < 5; i++) g.fillRect(x - 52 + i * 22, y0 + 6, 12, RENDER.height - y0 - 6);
    // El poste con la base, el brazo, la carcasa con la pantalla de fondo y las viseras.
    g.fillStyle(t.shade, 1);
    g.fillRect(x - 9, y0 - 5, 18, 5);
    g.fillStyle(t.base, 1);
    g.fillRect(x - 4, y0 - 160, 8, 160);
    g.fillStyle(t.lit, 0.35);
    g.fillRect(x - 4, y0 - 160, 2.5, 160);
    g.fillStyle(t.shade, 1);
    g.fillRoundedRect(x - 20, y0 - 232, 40, 84, 6);
    g.fillStyle(t.base, 1);
    g.fillRoundedRect(x - 14, y0 - 226, 28, 72, 5);
    const lenses: ReadonlyArray<readonly [number, number]> = [
      [-210, 0x4a1616],
      [-190, 0x4a3410],
      [-170, 0x143020],
    ];
    const lit = this.t % 1 < 0.5;
    if (lit !== this.wasLit) {
      this.wasLit = lit;
      if (lit && x > -20 && x < RENDER.width + 20) encounterAudio.tick();
    }
    lenses.forEach(([ly, color], i) => {
      const amber = i === 1 && lit;
      if (amber) {
        g.fillStyle(AMBER, 0.3 * f.night);
        g.fillCircle(x, y0 + ly, 17);
      }
      g.fillStyle(amber ? EMBER : color, 1);
      g.fillCircle(x, y0 + ly, 7);
      g.fillStyle(0xffffff, amber ? 0.5 : 0.12);
      g.fillCircle(x - 2, y0 + ly - 2, 2);
      // La visera sobre cada lente.
      g.fillStyle(t.shade, 1);
      g.fillRect(x - 10, y0 + ly - 12, 20, 3);
      poly(g, [[-10, -12], [10, -12], [12, -6], [-12, -6]], x, y0 + ly, 1, 1, t.base);
    });
    if (lit) {
      g.fillStyle(AMBER, 0.1 * f.night);
      g.fillEllipse(x, y0 + 30, 200, 60);
    }
    return true;
  }
}

// ---- las luciérnagas -----------------------------------------------------------------

interface Firefly {
  ox: number;
  oy: number;
  phase: number;
  rate: number;
}

class FireflySwarm extends Active {
  private readonly flies: Firefly[] = [];

  constructor(startM: number, rnd: () => number) {
    super(startM, rnd);
    for (let i = 0; i < 60; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd());
      this.flies.push({ ox: Math.cos(a) * r * 170, oy: Math.sin(a) * r * 62, phase: rnd() * Math.PI * 2, rate: 0.8 + rnd() * 1.6 });
    }
  }

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const cx = worldX(f, this.startM, 22, NEAR_F);
    if (cx < -220) return false;
    const cy = HORIZON_Y - 44;
    const g = L.near;
    const fade = clamp01(this.t / 3) * f.night;
    for (const fly of this.flies) {
      const k = Math.max(0, Math.sin(this.t * fly.rate + fly.phase)) ** 3;
      if (k < 0.03) continue;
      const px = cx + fly.ox + Math.sin(this.t * 0.6 + fly.phase) * 12;
      const py = cy + fly.oy + Math.cos(this.t * 0.5 + fly.phase * 1.3) * 9;
      g.fillStyle(FIREFLY, 0.3 * k * fade);
      g.fillCircle(px, py, 7);
      g.fillStyle(0xf0ffb0, 0.95 * k * fade);
      g.fillCircle(px, py, 2.3);
    }
    return true;
  }
}

// ---- la hoguera ----------------------------------------------------------------------

const SITTER: Shape = [
  [-11, 0],
  [-13, -12],
  [-10, -24],
  [-4, -30],
  [-2, -40],
  [4, -42],
  [8, -36],
  [8, -28],
  [12, -20],
  [12, -8],
  [10, 0],
];

function flame(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, tm: number, color: number, alpha: number): void {
  const w = (k: number, r: number) => Math.sin(tm * r + k) * 3;
  const pts: Shape = [
    [-10, 0],
    [-12, -8],
    [-8 + w(1, 11), -18],
    [-4 + w(2, 13), -30],
    [w(3, 17) * 0.6, -44 + w(4, 9)],
    [4 + w(5, 15), -28],
    [8 + w(6, 12), -16],
    [12, -6],
    [10, 0],
  ];
  blob(g, pts, x, y, s, 1, color, alpha);
}

class Campfire extends Active {
  private readonly sound: SoundHandle = encounterAudio.crackle();

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 32, MID_FACTOR);
    if (x < -220) return false;
    const y0 = HORIZON_Y - 40;
    const g = L.mid;
    const t = tonesMid(f);
    const flick = 0.75 + 0.25 * Math.sin(this.t * 13) * Math.sin(this.t * 7.3);
    // Detrás, la tienda con la entrada iluminada, y una mochila en el suelo.
    poly(g, [[-120, 0], [-62, -52], [-4, 0]], x, y0, 1, 1, t.shade);
    poly(g, [[-78, 0], [-62, -30], [-46, 0]], x, y0, 1, 1, FLAME, 0.18 * flick * f.night);
    g.lineStyle(1, t.lit, 0.35);
    g.lineBetween(x - 62, y0 - 52, x - 62, y0);
    g.fillStyle(t.shade, 1);
    g.fillRoundedRect(x + 46, y0 - 18, 16, 18, 4);
    // El resplandor en el suelo y en el aire.
    g.fillStyle(FLAME, 0.09 * flick * (0.5 + 0.5 * f.night));
    g.fillEllipse(x, y0 - 2, 240 * flick + 40, 74);
    g.fillStyle(FLAME, 0.07 * flick * f.night);
    g.fillCircle(x, y0 - 24, 64 + 10 * flick);
    // Tres figuras encapuchadas sentadas en troncos; la de la derecha levanta el brazo al verte.
    for (const [px, arm] of [
      [-40, false],
      [36, true],
      [6, false],
    ] as const) {
      const sx = x + px;
      const sy = y0 - (px === 6 ? 8 : 0);
      const dir: 1 | -1 = px < 0 ? 1 : -1;
      g.fillStyle(t.shade, 1);
      g.fillRoundedRect(sx - 14, sy - 6, 28, 6, 2);
      // Las figuras toman el calor del fuego: más claras que la capa, y encendidas por el lado que le da.
      blob(g, SITTER, sx, sy, 1, dir, lerpColor(t.base, 0x8a5a38, 0.35 * flick));
      g.fillStyle(0xffc080, 0.5 * flick);
      g.fillEllipse(sx + dir * 8, sy - 22, 7, 24);
      g.fillStyle(t.shade, 0.9);
      g.fillCircle(sx + dir * 3, sy - 38, 4.5);
      if (arm) {
        const up = Math.abs(x - RENDER.playerX) < 320;
        g.lineStyle(4, t.base, 1);
        if (up) g.lineBetween(sx - 6, sy - 26, sx - 14, sy - 48 + Math.sin(this.t * 6) * 2);
        else g.lineBetween(sx - 6, sy - 26, sx - 12, sy - 10);
        g.fillStyle(t.base, 1);
        g.fillCircle(up ? sx - 14 : sx - 12, up ? sy - 48 + Math.sin(this.t * 6) * 2 : sy - 10, 2.5);
      }
    }
    // Los troncos cruzados con las brasas, las llamas en tres capas, chispas y humo.
    poly(g, [[-16, 0], [14, -8], [16, -4], [-14, 4]], x, y0, 1, 1, t.shade);
    poly(g, [[-14, -8], [16, 0], [14, 4], [-16, -4]], x, y0, 1, 1, t.base);
    g.fillStyle(EMBER, 0.6 * flick);
    g.fillEllipse(x, y0 - 2, 18, 5);
    flame(g, x, y0 - 3, 1, this.t, FLAME, 0.9);
    flame(g, x, y0 - 3, 0.62, this.t * 1.3 + 1, EMBER, 0.9);
    flame(g, x - 1, y0 - 3, 0.32, this.t * 1.7 + 2, 0xfff4d0, 0.9);
    g.fillStyle(EMBER, 0.85);
    for (let i = 0; i < 5; i++) {
      const k = (this.t * 0.6 + i * 0.2) % 1;
      g.fillCircle(x + Math.sin(this.t * 3 + i * 2) * 10 * k, y0 - 12 - k * 64, 1.4 * (1 - k));
    }
    for (let i = 0; i < 3; i++) {
      const k = (this.t * 0.25 + i * 0.33) % 1;
      g.fillStyle(0x9aa0b0, 0.06 * (1 - k));
      g.fillCircle(x + 6 + Math.sin(this.t * 0.8 + i) * 14 * k, y0 - 50 - k * 70, 8 + k * 16);
    }
    this.sound.setLevel(clamp01(1 - Math.abs(x - RENDER.width / 2) / 820));
    return true;
  }

  override destroy(): void {
    this.sound.stop();
  }
}

// ---- los cuervos ---------------------------------------------------------------------

interface Crow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

const CROW_PERCHED: Shape = [
  [-9, 0],
  [-12, -4],
  [-8, -8],
  [-1, -10],
  [5, -9],
  [8, -6],
  [13, -5],
  [8, -3],
  [5, 0],
  [-2, 1],
];

function drawCrowFlying(g: Phaser.GameObjects.Graphics, x: number, y: number, flap: number, color: number): void {
  // Cuerpo con la cola, y dos alas de dos tramos (brazo y mano) que baten.
  g.fillStyle(color, 0.95);
  g.fillEllipse(x, y, 10, 4);
  g.fillTriangle(x - 4, y - 1, x - 4, y + 1, x - 10, y + 1.5);
  g.fillCircle(x + 5, y - 0.5, 2);
  for (const d of [-1, 1]) {
    poly(g, [[0, -1], [7 * d, -6 * flap - 1], [15 * d, -4 * flap - 7 * flap], [13 * d, 1 - 3 * flap], [6 * d, 2]], x, y, 1, 1, color, 0.95);
  }
}

class Crows extends Active {
  private readonly perches: ReadonlyArray<readonly [number, number, 1 | -1]> = [
    [-30, -96, -1],
    [-14, -118, 1],
    [10, -128, -1],
    [24, -108, 1],
    [-38, -78, -1],
    [16, -84, 1],
    [2, -60, -1],
  ];
  private crows: Crow[] = [];
  private burstAt = -1;
  private cawed = 0;

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 36, MID_FACTOR);
    const y0 = HORIZON_Y - 30;
    const g = L.mid;
    const t = tonesMid(f);
    // El árbol seco: tronco que se estrecha, ramas de dos tramos.
    poly(g, [[-8, 0], [8, 0], [5, -70], [7, -130], [3, -130], [1, -70]], x, y0, 1, 1, t.base);
    g.lineStyle(3, t.base, 1);
    for (const [ax, ay, bx, by, cx, cy] of [
      [-2, -88, -22, -98, -36, -102],
      [3, -104, -12, -118, -18, -130],
      [5, -112, 10, -126, 12, -138],
      [6, -100, 20, -110, 30, -112],
      [-1, -72, -26, -80, -40, -84],
      [4, -80, 14, -88, 22, -92],
      [2, -56, 8, -62, 12, -70],
    ] as const) {
      g.lineStyle(3, t.base, 1);
      g.lineBetween(x + ax, y0 + ay, x + bx, y0 + by);
      g.lineStyle(1.8, t.base, 1);
      g.lineBetween(x + bx, y0 + by, x + cx, y0 + cy);
    }
    const burst = this.burstAt >= 0;
    if (!burst && (x < 1000 || this.t > 10)) {
      this.burstAt = this.t;
      this.crows = this.perches.map(([px, py]) => ({
        x: x + px,
        y: y0 + py,
        vx: -(70 + this.rnd() * 110),
        vy: -(50 + this.rnd() * 90),
        phase: this.rnd() * Math.PI * 2,
      }));
    }
    if (burst) {
      const since = this.t - this.burstAt;
      if (this.cawed < 3 && since > [0, 0.4, 1.0][this.cawed]!) {
        this.cawed++;
        encounterAudio.caw();
      }
      for (const c of this.crows) {
        c.x += c.vx * f.dt;
        c.y += c.vy * f.dt;
        c.vy += 12 * f.dt; // se van nivelando
        c.phase += f.dt * 16;
        drawCrowFlying(g, c.x, c.y, Math.sin(c.phase), SKY_INK);
      }
      this.crows = this.crows.filter((c) => c.x > -40 && c.y > -40);
    } else {
      // Posados, con algún cabeceo, el pico hacia fuera.
      this.perches.forEach(([px, py, dir], i) => {
        blob(g, CROW_PERCHED, x + px, y0 + py - 3 + Math.sin(this.t * 2 + i) * 0.6, 0.9, dir, SKY_INK, 0.95);
      });
    }
    return x > -120 || this.crows.length > 0;
  }
}

// ---- el tren -------------------------------------------------------------------------

const TRAIN_COACHES = 14;
const COACH_W = 52;
const TRAIN_LEN = 50 + TRAIN_COACHES * COACH_W;

class Train extends Active {
  private readonly sound: SoundHandle = encounterAudio.rumble();

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    // Va en tu sentido, despacio, y el horizonte se le va por detrás.
    const headX = -40 + this.t * 62 - (f.distanceM - this.startM) * PX_M * FAR_F;
    const tailX = headX - TRAIN_LEN;
    if (tailX > RENDER.width + 30) return false;
    const y = HORIZON_Y - 112;
    const g = L.horizon;
    const body = lerpColor(f.farInk, 0x8090b0, 0.14);
    const roof = lerpColor(body, 0x000000, 0.3);
    // La vía con sus traviesas, solo bajo el tren.
    g.fillStyle(f.farInk, 0.7);
    g.fillRect(tailX - 60, y + 1, TRAIN_LEN + 120, 2);
    g.fillStyle(f.farInk, 0.4);
    for (let sx = Math.max(-20, tailX - 60); sx < Math.min(RENDER.width + 20, headX + 60); sx += 9) g.fillRect(sx, y + 3, 4, 1.5);
    // La locomotora: morro en pendiente, cabina con las ventanas encendidas, el faro y su haz.
    poly(g, [[-46, 0], [-46, -22], [-30, -26], [-8, -26], [-2, -20], [0, -10], [0, 0]], headX, y, 1, 1, body);
    g.fillStyle(roof, 1);
    g.fillRect(headX - 44, y - 27, 34, 2);
    g.fillStyle(f.light, 0.75 * f.night + 0.1);
    g.fillRect(headX - 28, y - 22, 6, 5);
    g.fillRect(headX - 18, y - 22, 6, 5);
    g.fillStyle(0x000000, 0.35);
    g.fillRect(headX - 44, y - 8, 44, 2);
    g.fillStyle(f.light, 0.12 * f.night);
    g.fillTriangle(headX, y - 12, headX + 140, y - 26, headX + 140, y + 2);
    g.fillStyle(0xfff4d0, 0.95 * f.night);
    g.fillCircle(headX - 2, y - 12, 2.2);
    // Los vagones: techo redondeado, ventanas encendidas (alguna a oscuras), bogies y enganches.
    for (let i = 0; i < TRAIN_COACHES; i++) {
      const cx = headX - 50 - i * COACH_W - COACH_W / 2;
      if (cx + COACH_W < -10 || cx - COACH_W > RENDER.width + 10) continue;
      g.fillStyle(body, 1);
      g.fillRoundedRect(cx - 24, y - 18, 48, 18, { tl: 4, tr: 4, bl: 0, br: 0 });
      g.fillStyle(roof, 1);
      g.fillRect(cx - 22, y - 19, 44, 1.5);
      g.fillStyle(0x000000, 0.35);
      g.fillRect(cx - 22, y - 2, 44, 2);
      for (const bx of [cx - 15, cx + 15]) {
        g.fillStyle(roof, 1);
        g.fillRect(bx - 6, y - 1, 12, 2);
        g.fillCircle(bx - 3, y + 1, 1.6);
        g.fillCircle(bx + 3, y + 1, 1.6);
      }
      g.fillStyle(roof, 1);
      g.fillRect(cx + 24, y - 8, 4, 2);
      for (let j = 0; j < 4; j++) {
        if ((i * 4 + j) % 7 === 3) continue;
        g.fillStyle(f.light, 0.85 * f.night + 0.1);
        g.fillRect(cx - 19 + j * 10, y - 14, 5.5, 5);
        g.fillStyle(0xffffff, 0.25);
        g.fillRect(cx - 19 + j * 10, y - 14, 5.5, 1.5);
      }
    }
    const visible = Math.max(0, Math.min(headX, RENDER.width) - Math.max(tailX, 0)) / TRAIN_LEN;
    this.sound.setLevel(visible);
    return true;
  }

  override destroy(): void {
    this.sound.stop();
  }
}

// ---- el cielo ------------------------------------------------------------------------

interface Bat {
  a: number;
  r: number;
  w: number;
  phase: number;
  lift: number;
}

const BATS_SEC = 22;

function drawBat(g: Phaser.GameObjects.Graphics, x: number, y: number, flap: number, color: number): void {
  // Cuerpo con las orejas, y alas membranosas festoneadas que baten.
  g.fillStyle(color, 0.95);
  g.fillEllipse(x, y + 1, 5, 4);
  g.fillCircle(x, y - 1.5, 1.8);
  g.fillTriangle(x - 1.8, y - 2, x - 0.4, y - 2, x - 1.4, y - 4.5);
  g.fillTriangle(x + 1.8, y - 2, x + 0.4, y - 2, x + 1.4, y - 4.5);
  for (const d of [-1, 1]) {
    poly(g, [[0, -1], [4 * d, -4 * flap - 2], [9 * d, -5 * flap - 1], [13 * d, -2 * flap + 1], [10 * d, 2 - flap], [7 * d, 1 - 1.5 * flap], [4 * d, 2.5 - flap], [0, 2]], x, y, 1, 1, color, 0.95);
  }
}

class Bats extends Active {
  private readonly bats: Bat[] = [];

  constructor(startM: number, rnd: () => number) {
    super(startM, rnd);
    for (let i = 0; i < 9; i++) {
      this.bats.push({
        a: rnd() * Math.PI * 2,
        r: 45 + rnd() * 75,
        w: (1.4 + rnd() * 1.6) * (rnd() < 0.5 ? -1 : 1),
        phase: rnd() * Math.PI * 2,
        lift: rnd() * 40 - 20,
      });
    }
  }

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    if (this.t > BATS_SEC) return false;
    const g = L.sky;
    const mx = f.moonX;
    const my = f.moonY;
    const inK = clamp01(this.t / 3.5);
    const outK = clamp01((this.t - (BATS_SEC - 5)) / 5);
    const ease = (k: number) => k * k * (3 - 2 * k);
    this.bats.forEach((b, i) => {
      const a = b.a + this.t * b.w;
      const sx = mx + Math.cos(a) * b.r * 1.5 + Math.sin(this.t * 7 + b.phase) * 6;
      const sy = my + b.lift + Math.sin(a) * b.r * 0.6 + Math.cos(this.t * 5 + b.phase) * 5;
      const fromX = RENDER.width + 60 + i * 30;
      const fromY = my - 90 + i * 22;
      const toX = -80 - i * 25;
      const toY = my - 170 - i * 8;
      let x = fromX + (sx - fromX) * ease(inK);
      let y = fromY + (sy - fromY) * ease(inK);
      if (outK > 0) {
        x = sx + (toX - sx) * ease(outK);
        y = sy + (toY - sy) * ease(outK);
      }
      drawBat(g, x, y, Math.sin(this.t * 19 + b.phase), 0x241e3a);
    });
    return true;
  }
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const METEORS_SEC = 20;

class MeteorShower extends Active {
  private meteors: Meteor[] = [];
  private nextAt = 0.4;

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    if (this.t < METEORS_SEC && this.t >= this.nextAt) {
      this.nextAt = this.t + 0.5 + this.rnd() * 1.4;
      const n = this.rnd() < 0.3 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        this.meteors.push({
          x: 560 + this.rnd() * 420,
          y: 20 + this.rnd() * 110,
          vx: 600 + this.rnd() * 600,
          vy: 160 + this.rnd() * 220,
          life: 0.55 + this.rnd() * 0.3,
        });
      }
    }
    const g = L.sky;
    for (const m of this.meteors) {
      m.x += m.vx * f.dt;
      m.y += m.vy * f.dt;
      m.life -= f.dt;
      const a = clamp01(m.life / 0.7) * f.night;
      // La cabeza brillante y la cola que se apaga en tres tramos.
      g.lineStyle(2.2, 0xffffff, a * 0.95);
      g.lineBetween(m.x, m.y, m.x - m.vx * 0.06, m.y - m.vy * 0.06);
      g.lineStyle(1.6, 0xdde6ff, a * 0.55);
      g.lineBetween(m.x - m.vx * 0.06, m.y - m.vy * 0.06, m.x - m.vx * 0.15, m.y - m.vy * 0.15);
      g.lineStyle(1, 0xbcc8ff, a * 0.25);
      g.lineBetween(m.x - m.vx * 0.15, m.y - m.vy * 0.15, m.x - m.vx * 0.28, m.y - m.vy * 0.28);
      g.fillStyle(0xffffff, a * 0.5);
      g.fillCircle(m.x, m.y, 2);
    }
    this.meteors = this.meteors.filter((m) => m.life > 0);
    return this.t < METEORS_SEC || this.meteors.length > 0;
  }
}

// ---- el perro ------------------------------------------------------------------------

/** Segundos que el perro aguanta a tu lado antes de volverse a su cuneta. */
const DOG_RUN_SEC = 40;
/** Por debajo de esto el perro no tiene a quién seguir. */
const DOG_MIN_MPS = 2;

const DOG_SITTING: Shape = [
  [-26, -6],
  [-30, -22],
  [-26, -40],
  [-14, -50],
  [0, -54],
  [8, -64],
  [10, -76],
  [16, -84],
  [26, -82],
  [36, -74],
  [40, -68],
  [36, -62],
  [26, -60],
  [18, -56],
  [14, -44],
  [12, -30],
  [10, -14],
  [6, -4],
  [-8, -2],
];
const DOG_RUNNING: Shape = [
  [-40, -30],
  [-34, -40],
  [-14, -46],
  [6, -46],
  [20, -48],
  [32, -56],
  [40, -58],
  [50, -54],
  [58, -48],
  [60, -44],
  [54, -40],
  [44, -40],
  [30, -38],
  [22, -30],
  [6, -26],
  [-14, -28],
  [-32, -26],
];

function drawDog(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, dir: 1 | -1, t: Tones, gait: number | undefined): void {
  if (gait === undefined) {
    // Sentado en la cuneta: la cola en el suelo, las patas delanteras rectas, la oreja caída, mirando la carretera.
    g.lineStyle(3.5 * s, t.base, 1);
    g.lineBetween(x - 26 * s * dir, y - 8 * s, x - 44 * s * dir, y - 2 * s);
    g.lineBetween(x - 44 * s * dir, y - 2 * s, x - 52 * s * dir, y - 10 * s);
    blob(g, DOG_SITTING, x, y, s, dir, t.base);
    g.fillStyle(t.shade, 0.8);
    g.fillEllipse(x - 16 * s * dir, y - 18 * s, 26 * s, 24 * s);
    g.fillStyle(t.lit, 0.5);
    g.fillEllipse(x + 12 * s * dir, y - 44 * s, 10 * s, 26 * s);
    limb(g, x, y, s, dir, [12, -30], [12, -14], [14, 0], 5, 4, t.base);
    limb(g, x, y, s, dir, [4, -30], [3, -14], [4, 0], 5, 4, t.shade);
    g.fillStyle(t.base, 1);
    g.fillEllipse(x + 15 * s * dir, y - 1.5 * s, 8 * s, 4 * s);
    poly(g, [[12, -84], [4, -70], [16, -70]], x, y, s, dir, t.shade);
    g.fillStyle(t.shade, 1);
    g.fillCircle(x + 39 * s * dir, y - 69 * s, 2.2 * s);
    rimOf(g, DOG_SITTING, x, y, s, dir, t);
    drawEyes(g, x + 28 * s * dir, y - 75 * s, 0, 1.6 * s, t.light, 0.9 * t.night);
    return;
  }
  // Corriendo: cuerpo estirado, orejas atrás, cola arriba, patas al galope con la lengua fuera.
  const k = Math.sin(gait);
  const k2 = Math.sin(gait + Math.PI);
  limb(g, x, y, s, dir, [-26, -32], [-30 - 8 * k2, -16], [-28 - 14 * k2, 0], 4.5, 3, t.shade);
  limb(g, x, y, s, dir, [16, -32], [20 + 8 * k, -16], [22 + 14 * k, 0], 4.5, 3, t.shade);
  blob(g, DOG_RUNNING, x, y, s, dir, t.base);
  g.fillStyle(t.shade, 0.8);
  g.fillEllipse(x - 4 * s * dir, y - 30 * s, 52 * s, 8 * s);
  limb(g, x, y, s, dir, [-20, -32], [-24 + 8 * k, -16], [-20 + 14 * k, 0], 5, 3.5, t.base);
  limb(g, x, y, s, dir, [22, -32], [26 - 8 * k2, -16], [30 - 14 * k2, 0], 5, 3.5, t.base);
  g.lineStyle(3.5 * s, t.base, 1);
  g.lineBetween(x - 40 * s * dir, y - 34 * s, x - 52 * s * dir, y - 52 * s + Math.sin(gait * 0.5) * 4 * s);
  poly(g, [[34, -58], [22, -62], [28, -50]], x, y, s, dir, t.shade);
  g.fillStyle(0xc8503c, 0.9);
  g.fillEllipse(x + 54 * s * dir, y - 38 * s, 3 * s, 6 * s);
  g.fillStyle(t.shade, 1);
  g.fillCircle(x + 59 * s * dir, y - 45 * s, 2 * s);
  rimOf(g, DOG_RUNNING, x, y, s, dir, t);
  drawEyes(g, x + 47 * s * dir, y - 51 * s, 0, 1.5 * s, t.light, 0.9 * t.night);
}

class Dog extends Active {
  private phase: 'waiting' | 'running' | 'leaving' = 'waiting';
  private x = 0;
  private ranSec = 0;
  private gait = 0;
  private barked = false;

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const g = L.near;
    if (this.phase === 'waiting') {
      // Sentado en la cuneta, pasa con la carretera; si pasas en zona, sale detrás de ti.
      const x = worldX(f, this.startM, 12);
      if (x < -80) return false;
      drawDog(g, x, feetY(x, f.slope), 0.6, -1, tonesAt(f, x), undefined);
      if (!this.barked && x < RENDER.playerX + 260) {
        this.barked = true;
        encounterAudio.bark();
      }
      if (x < RENDER.playerX + 150 && f.inZone && f.speedMps > DOG_MIN_MPS) {
        this.phase = 'running';
        this.x = x;
      }
      return true;
    }
    // Corre a tu lado mientras aguantes la zona; si te sales se queda atrás, y si
    // vuelves antes de perderlo de vista, te alcanza. Pasado su rato, se vuelve.
    if (this.phase === 'running') {
      this.ranSec += f.dt;
      if (this.ranSec >= DOG_RUN_SEC) this.phase = 'leaving';
    }
    const keeping = this.phase === 'running' && f.inZone && f.speedMps > DOG_MIN_MPS;
    if (keeping) this.x += (RENDER.playerX + 70 - this.x) * Math.min(1, f.dt * 1.4);
    else this.x -= (50 + f.speedMps * 12) * f.dt;
    if (this.x < -80) return false;
    this.gait += f.dt * (5 + f.speedMps * 1.8);
    drawDog(g, this.x, feetY(this.x, f.slope) + 4, 0.6, 1, tonesAt(f, this.x), this.gait);
    return true;
  }
}

// ---- los caballos --------------------------------------------------------------------

const HORSE_MPS = 20 / 3.6;
/** Pasado este rato los caballos se abren y se van por delante. */
const HORSES_RUN_SEC = 70;

// Grupa alta, lomo con un leve hundimiento, cruz, cuello estrecho que sube
// arqueado, cabeza larga con la quijada marcada, pecho profundo y vientre recogido.
const HORSE_BODY: Shape = [
  [-46, -52],
  [-40, -64],
  [-22, -70],
  [0, -68],
  [18, -70],
  [28, -74],
  [38, -86],
  [48, -100],
  [56, -108],
  [62, -108],
  [68, -102],
  [76, -92],
  [84, -80],
  [86, -74],
  [80, -68],
  [72, -70],
  [64, -76],
  [54, -84],
  [44, -74],
  [36, -62],
  [32, -52],
  [30, -40],
  [22, -32],
  [4, -30],
  [-16, -32],
  [-32, -38],
  [-42, -44],
];
const HORSE_BELLY: Shape = [
  [30, -40],
  [22, -32],
  [4, -30],
  [-16, -32],
  [-32, -38],
  [-42, -44],
  [-38, -48],
  [-20, -42],
  [0, -40],
  [20, -42],
  [28, -44],
];
const HORSE_CHEST: Shape = [
  [44, -74],
  [36, -62],
  [32, -52],
  [30, -40],
  [36, -44],
  [40, -56],
  [46, -66],
  [52, -78],
];

function drawHorse(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, dir: 1 | -1, t: Tones, gallop: number): void {
  const k1 = Math.sin(gallop);
  const k2 = Math.sin(gallop + 0.7);
  const k3 = Math.sin(gallop + Math.PI);
  const k4 = Math.sin(gallop + Math.PI + 0.7);
  const bob = -3 * Math.abs(Math.sin(gallop)) * s;
  const by = y + bob;
  // Las patas lejanas en sombra, el cuerpo, las cercanas delante. Las de atrás doblan hacia atrás.
  limb(g, x, by, s, dir, [-30, -38], [-34 - 10 * k4, -18], [-28 - 20 * k4, 0 - bob / s], 6, 4, t.shade);
  limb(g, x, by, s, dir, [24, -38], [28 + 10 * k2, -18], [30 + 20 * k2, 0 - bob / s], 6, 4, t.shade);
  blob(g, HORSE_BODY, x, by, s, dir, t.base);
  blob(g, HORSE_BELLY, x, by, s, dir, t.shade, 0.85);
  blob(g, HORSE_CHEST, x, by, s, dir, t.lit, 0.5);
  limb(g, x, by, s, dir, [-24, -38], [-28 - 10 * k3, -18], [-22 - 20 * k3, 0 - bob / s], 6.5, 4.5, t.base);
  limb(g, x, by, s, dir, [20, -38], [24 + 10 * k1, -18], [26 + 20 * k1, 0 - bob / s], 6.5, 4.5, t.base);
  for (const foot of [
    [-22 - 20 * k3, 0 - bob / s],
    [26 + 20 * k1, 0 - bob / s],
    [-28 - 20 * k4, 0 - bob / s],
    [30 + 20 * k2, 0 - bob / s],
  ] as const) {
    hoof(g, x, by, s, dir, foot, 7, t.shade);
  }
  // La crin al viento, el flequillo, la oreja, el ollar, la cola en mechones y el ojo.
  g.lineStyle(3 * s, t.shade, 1);
  for (let i = 0; i < 7; i++) {
    const mx = 26 + i * 4.5;
    const my = -74 - i * 5.5;
    const sway = Math.sin(gallop * 0.5 + i) * 2;
    g.lineBetween(x + mx * s * dir, by + my * s, x + (mx - 11 - sway) * s * dir, by + (my + 9) * s);
  }
  g.lineBetween(x + 58 * s * dir, by - 108 * s, x + 68 * s * dir, by - 100 * s);
  poly(g, [[60, -109], [55, -108], [56, -122]], x, by, s, dir, t.base);
  poly(g, [[64, -108], [60, -108], [63, -119]], x, by, s, dir, t.shade, 0.8);
  g.fillStyle(t.shade, 1);
  g.fillEllipse(x + 83 * s * dir, by - 77 * s, 3 * s, 2 * s);
  g.lineStyle(1.2 * s, t.shade, 0.7);
  g.lineBetween(x + 72 * s * dir, by - 70 * s, x + 80 * s * dir, by - 69 * s);
  for (const [tx, ty, w] of [
    [-72, -44, 3.5],
    [-74, -32, 3],
    [-70, -20, 2.5],
    [-66, -12, 2],
  ] as const) {
    const sw = Math.sin(gallop * 0.5) * 5;
    g.lineStyle(w * s, t.shade, 1);
    g.lineBetween(x - 45 * s * dir, by - 58 * s, x + tx * s * dir, by + (ty + sw) * s);
  }
  rimOf(g, HORSE_BODY, x, by, s, dir, t);
  drawEyes(g, x + 69 * s * dir, by - 97 * s, 0, 1.7 * s, t.light, 0.8 * t.night);
}

interface HorseSpec {
  dx: number;
  dy: number;
  s: number;
  ph: number;
}

class Horses extends Active {
  private readonly members: readonly HorseSpec[] = [
    { dx: 0, dy: 0, s: 1.05, ph: 0 },
    { dx: -130, dy: -6, s: 0.95, ph: 1.7 },
    { dx: -235, dy: 4, s: 1, ph: 3.1 },
    { dx: -340, dy: -3, s: 0.9, ph: 4.4 },
    { dx: -455, dy: 2, s: 0.97, ph: 0.9 },
  ];
  private readonly sound: SoundHandle = encounterAudio.hooves();
  /** Posición del caballo que va delante, en metros de la salida (como distanceM). */
  private herdM: number;
  private seen = false;

  constructor(startM: number, rnd: () => number, speedMps: number) {
    super(startM, rnd);
    // Si vas más rápido que ellos, los alcanzas por detrás; si no, te alcanzan ellos.
    const ahead = speedMps > HORSE_MPS;
    this.herdM = ahead ? startM + (RENDER.width + 140 - RENDER.playerX) / PX_M : startM - (RENDER.playerX + 540) / PX_M;
  }

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const away = this.t > HORSES_RUN_SEC ? 3 : 0;
    this.herdM += (HORSE_MPS + away) * f.dt;
    const leadX = RENDER.playerX + (this.herdM - f.distanceM) * PX_M;
    const tailX = leadX - 455 - 90;
    const on = leadX > -100 && tailX < RENDER.width + 100;
    if (on) this.seen = true;
    if (!on && (this.seen || this.t > 45)) return false;
    this.sound.setLevel(on ? clamp01((Math.min(leadX + 60, RENDER.width) - Math.max(tailX, 0)) / 500) : 0);
    if (!on) return true;
    const g = L.near;
    const gallop = this.t * 7;
    // Los de atrás primero, para que los de delante los tapen.
    for (let i = this.members.length - 1; i >= 0; i--) {
      const m = this.members[i]!;
      const x = leadX + m.dx;
      const y0 = feetY(x, f.slope) + m.dy;
      // El polvo que levantan.
      g.fillStyle(0x8a8070, 0.07);
      for (let p = 0; p < 3; p++) {
        const k = (this.t * 1.3 + p * 0.33 + i * 0.2) % 1;
        g.fillCircle(x - 50 * m.s - k * 50, y0 - 6 - k * 26, 6 + k * 14);
      }
      drawHorse(g, x, y0, m.s, 1, tonesAt(f, x), gallop + m.ph);
    }
    return true;
  }

  override destroy(): void {
    this.sound.stop();
  }
}

// ---- el gestor -----------------------------------------------------------------------

function make(kind: EncounterKind, opts: EncounterStart, scene: Phaser.Scene): Active {
  const rnd = opts.rnd ?? Math.random;
  const m = opts.distanceM;
  switch (kind) {
    case 'deer':
      return new Deer(m, rnd);
    case 'boars':
      return new Boars(m, rnd);
    case 'owl':
      return new Owl(m, rnd);
    case 'cat':
      return new Cat(m, rnd);
    case 'cyclist':
      return new OtherCyclist(m, rnd, scene);
    case 'car':
      return new Car(m, rnd);
    case 'sign':
      return new Sign(m, rnd, scene, opts.sign);
    case 'trafficLight':
      return new TrafficLight(m, rnd);
    case 'fireflies':
      return new FireflySwarm(m, rnd);
    case 'campfire':
      return new Campfire(m, rnd);
    case 'crows':
      return new Crows(m, rnd);
    case 'train':
      return new Train(m, rnd);
    case 'bats':
      return new Bats(m, rnd);
    case 'meteors':
      return new MeteorShower(m, rnd);
    case 'dog':
      return new Dog(m, rnd);
    case 'horses':
      return new Horses(m, rnd, opts.speedMps ?? 0);
  }
}

/** El encuentro en curso de la salida (uno como mucho), dibujado sobre las capas del paisaje. */
export class Encounters {
  private active: Active | undefined;
  private activeKind: EncounterKind | undefined;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layers: EncounterLayers,
  ) {}

  get current(): EncounterKind | undefined {
    return this.activeKind;
  }

  start(kind: EncounterKind, opts: EncounterStart): void {
    this.active?.destroy();
    this.active = make(kind, opts, this.scene);
    this.activeKind = kind;
  }

  /** Después de que el paisaje limpie sus capas: dibuja encima lo que esté pasando. */
  update(frame: EncounterFrame): void {
    if (!this.active) return;
    if (!this.active.update(frame, this.layers)) {
      this.active.destroy();
      this.active = undefined;
      this.activeKind = undefined;
    }
  }

  destroy(): void {
    this.active?.destroy();
    this.active = undefined;
    this.activeKind = undefined;
  }
}
