import Phaser from 'phaser';
import { RENDER } from '../config';
import type { EncounterKind } from '../sim/encounters';
import { HORIZON_Y, lerpColor, MID_FACTOR } from './atmosphere';
import { encounterAudio, type SoundHandle } from './encounterAudio';
import { groundYAt } from './gapMapping';
import { FONT_SANS } from './theme';

// Los encuentros, dibujados: cada uno vive en una capa del paisaje (cielo,
// horizonte, capa media o junto al asfalto) y se mueve con ella, a la escala
// de esa capa, con una animación propia encima. Todo con primitivas del
// Graphics de Phaser, como los refugios; el único texto es el de la señal.
// Ninguno toca la simulación: son cosas que pasan mientras pedaleas.

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
}

export interface EncounterStart {
  distanceM: number;
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
const PAINT = '#c8412f';
const SIGN_PHRASES = ['SIGUE PEDALEANDO', 'NO MIRES ATRÁS', 'AÚN QUEDAMOS', 'NO PARES AHORA', 'EL SOL SALE ALLÍ →'];

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

// ---- junto al asfalto ------------------------------------------------------------

function drawEyes(g: Phaser.GameObjects.Graphics, x: number, y: number, gap: number, r: number, light: number, a: number): void {
  if (a <= 0.01) return;
  g.fillStyle(light, a * 0.35);
  g.fillCircle(x - gap / 2, y, r * 2.2);
  g.fillCircle(x + gap / 2, y, r * 2.2);
  g.fillStyle(0xfff4d0, a);
  g.fillCircle(x - gap / 2, y, r);
  g.fillCircle(x + gap / 2, y, r);
}

function drawDeer(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, ink: number, light: number, night: number, k: number): void {
  // Cuerpo, cuello, cabeza con la cornamenta, y las patas en el salto (k = fase del brinco).
  g.fillStyle(ink, 1);
  g.fillEllipse(x, y - 30 * s, 48 * s, 20 * s);
  g.lineStyle(7 * s, ink, 1);
  g.lineBetween(x - 16 * s, y - 36 * s, x - 30 * s, y - 60 * s);
  g.fillEllipse(x - 34 * s, y - 62 * s, 18 * s, 10 * s);
  g.lineStyle(2 * s, ink, 1);
  for (const [dx, dy] of [
    [-6, -22],
    [-12, -18],
    [2, -20],
  ] as const) {
    g.lineBetween(x - 34 * s, y - 66 * s, x - 34 * s + dx * s, y - 66 * s + dy * s);
    g.lineBetween(x - 34 * s + dx * s * 0.6, y - 66 * s + dy * s * 0.6, x - 34 * s + dx * s * 0.6 + 5 * s, y - 66 * s + dy * s * 0.6 - 6 * s);
  }
  // Patas: delanteras estiradas hacia delante en el salto, traseras hacia atrás.
  const leap = Math.sin(k * Math.PI * 3);
  g.lineStyle(3.5 * s, ink, 1);
  g.lineBetween(x - 14 * s, y - 24 * s, x - 14 * s - 12 * s * leap, y - 2 * s);
  g.lineBetween(x - 8 * s, y - 24 * s, x - 8 * s - 8 * s * leap, y);
  g.lineBetween(x + 12 * s, y - 24 * s, x + 12 * s + 12 * s * leap, y - 2 * s);
  g.lineBetween(x + 18 * s, y - 24 * s, x + 18 * s + 8 * s * leap, y);
  drawEyes(g, x - 39 * s, y - 63 * s, 5 * s, 1.6 * s, light, 0.9 * night);
}

class Deer extends Active {
  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const k = Math.min(1, this.t / 1.7);
    const x = worldX(f, this.startM, 9) - k * 40;
    const yTop = feetY(x, f.slope) - 6;
    const y = yTop + k * 150 - Math.abs(Math.sin(k * Math.PI * 3)) * 30;
    if (y > RENDER.height + 80 || x < -80) return false;
    const s = 0.95 + k * 0.7;
    drawDeer(L.near, x, y, s, nearTone(f, x), f.light, f.night, k);
    // El contorno de la luna, como el del ciclista: lo que lo separa del asfalto.
    L.near.lineStyle(1.5, 0x9fb0d0, 0.35 * f.night);
    L.near.strokeEllipse(x, y - 30 * s, 48 * s, 20 * s);
    return true;
  }
}

function drawBoar(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, ink: number, light: number, night: number, trot: number): void {
  g.fillStyle(ink, 1);
  g.fillEllipse(x, y - 15 * s, 42 * s, 24 * s);
  g.fillTriangle(x - 20 * s, y - 24 * s, x - 20 * s, y - 8 * s, x - 38 * s, y - 12 * s);
  g.fillTriangle(x - 14 * s, y - 26 * s, x - 6 * s, y - 26 * s, x - 12 * s, y - 34 * s);
  g.lineStyle(3 * s, ink, 1);
  const swing = Math.sin(trot) * 5 * s;
  g.lineBetween(x - 12 * s, y - 8 * s, x - 12 * s + swing, y);
  g.lineBetween(x - 4 * s, y - 8 * s, x - 4 * s - swing, y);
  g.lineBetween(x + 8 * s, y - 8 * s, x + 8 * s - swing, y);
  g.lineBetween(x + 16 * s, y - 8 * s, x + 16 * s + swing, y);
  g.lineStyle(2 * s, ink, 1);
  g.lineBetween(x + 20 * s, y - 20 * s, x + 28 * s, y - 28 * s);
  drawEyes(g, x - 28 * s, y - 16 * s, 3 * s, 1.2 * s, light, 0.8 * night);
}

class Boars extends Active {
  private readonly members = [
    { scale: 1, delay: 0, speed: 1 },
    { scale: 0.55, delay: 0.5, speed: 1 },
    { scale: 0.55, delay: 0.85, speed: 1 },
    // El último se despista y corre a alcanzarlos.
    { scale: 0.55, delay: 1.7, speed: 1.5 },
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
      const x = worldX(f, this.startM, 10) - i * 16 - k * 24;
      if (x < -80) return;
      const y = feetY(x, f.slope) - 4 + k * 150 - Math.abs(Math.sin(k * Math.PI * 7)) * 4 * m.scale;
      alive = true;
      drawBoar(L.near, x, y, m.scale * (1 + k * 0.6), nearTone(f, x), f.light, f.night, k * Math.PI * 14);
    });
    return alive || this.t < 0.5;
  }
}

class Owl extends Active {
  private hooted = false;

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 12);
    if (x < -40) return false;
    const y0 = feetY(x, f.slope);
    const g = L.near;
    const ink = nearTone(f, x);
    g.fillStyle(ink, 1);
    g.fillRect(x - 3.5, y0 - 124, 7, 124);
    g.fillRect(x - 20, y0 - 126, 40, 5);
    // La lechuza: cuerpo, cabeza con las orejas, y los ojos que te siguen.
    g.fillEllipse(x, y0 - 146, 24, 36);
    g.fillCircle(x, y0 - 168, 12);
    g.fillTriangle(x - 11, y0 - 174, x - 4, y0 - 172, x - 10, y0 - 184);
    g.fillTriangle(x + 11, y0 - 174, x + 4, y0 - 172, x + 10, y0 - 184);
    g.lineStyle(1.5, 0x9fb0d0, 0.3 * f.night);
    g.strokeEllipse(x, y0 - 146, 24, 36);
    const turn = Math.max(-1, Math.min(1, (RENDER.playerX - x) / 400));
    drawEyes(g, x + turn * 3.5, y0 - 169, 9, 2.4, f.light, 0.9 * f.night);
    if (!this.hooted && x < 1080) {
      this.hooted = true;
      encounterAudio.hoot();
    }
    return true;
  }
}

class Cat extends Active {
  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 13);
    if (x < -120) return false;
    const y0 = feetY(x, f.slope);
    const g = L.near;
    // La tapia y el gato se ven cuando llegas; los ojos, antes.
    const a = clamp01((RENDER.width + 90 - x) / 340);
    const ink = nearTone(f, x);
    if (a > 0) {
      g.fillStyle(ink, a);
      g.fillRect(x - 90, y0 - 42, 180, 42);
      g.lineStyle(1, 0x000000, 0.3 * a);
      g.lineBetween(x - 90, y0 - 21, x + 90, y0 - 21);
      for (const dx of [-64, -32, 0, 32, 64]) g.lineBetween(x + dx, y0 - 42, x + dx, y0 - 21);
      for (const dx of [-48, -16, 16, 48]) g.lineBetween(x + dx, y0 - 21, x + dx, y0);
      g.fillStyle(ink, a);
      g.fillEllipse(x + 12, y0 - 56, 40, 24);
      g.fillCircle(x - 8, y0 - 68, 10.5);
      g.fillTriangle(x - 17, y0 - 73, x - 10, y0 - 73, x - 15, y0 - 84);
      g.fillTriangle(x + 1, y0 - 73, x - 6, y0 - 73, x - 1, y0 - 84);
      g.lineStyle(3.5, ink, a);
      const sway = Math.sin(this.t * 2.2) * 7;
      g.lineBetween(x + 30, y0 - 54, x + 42, y0 - 70 + sway);
      g.lineBetween(x + 42, y0 - 70 + sway, x + 38, y0 - 86 + sway * 1.5);
      g.lineStyle(1.5, 0x9fb0d0, 0.3 * f.night * a);
      g.strokeEllipse(x + 12, y0 - 56, 40, 24);
    }
    drawEyes(g, x - 10, y0 - 69, 6.5, 1.9, f.light, 0.95 * f.night);
    return true;
  }
}

class OtherCyclist extends Active {
  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    // Viene de frente a unos 20 km/h, por el carril de allá, y te saluda al cruzarse.
    const x = worldX(f, this.startM, 16) - this.t * 5.5 * PX_M;
    if (x < -90) return false;
    const y = feetY(x, f.slope) + 8;
    const s = 0.8;
    const g = L.near;
    const ink = nearTone(f, x);
    g.lineStyle(3 * s, ink, 1);
    g.strokeCircle(x - 22 * s, y - 14 * s, 14 * s);
    g.strokeCircle(x + 22 * s, y - 14 * s, 14 * s);
    g.lineBetween(x - 22 * s, y - 14 * s, x + 2 * s, y - 40 * s);
    g.lineBetween(x + 2 * s, y - 40 * s, x + 22 * s, y - 14 * s);
    g.lineBetween(x - 4 * s, y - 14 * s, x + 2 * s, y - 40 * s);
    g.lineBetween(x - 22 * s, y - 14 * s, x - 30 * s, y - 42 * s);
    g.lineBetween(x - 4 * s, y - 14 * s, x - 30 * s, y - 42 * s);
    g.lineBetween(x - 30 * s, y - 42 * s, x - 36 * s, y - 46 * s); // manillar, mirando a la izquierda
    // El ciclista: piernas, tronco inclinado hacia delante (izquierda), cabeza.
    const crank = this.t * 9;
    g.lineStyle(4 * s, ink, 1);
    g.lineBetween(x + 4 * s, y - 60 * s, x - 4 * s + Math.cos(crank) * 8 * s, y - 24 * s + Math.sin(crank) * 8 * s);
    g.lineBetween(x + 4 * s, y - 60 * s, x - 4 * s - Math.cos(crank) * 8 * s, y - 24 * s - Math.sin(crank) * 8 * s);
    g.lineStyle(6 * s, ink, 1);
    g.lineBetween(x + 6 * s, y - 60 * s, x - 22 * s, y - 76 * s);
    g.fillStyle(ink, 1);
    g.fillCircle(x - 28 * s, y - 84 * s, 7 * s);
    const waving = Math.abs(x - RENDER.playerX) < 280;
    g.lineStyle(3.5 * s, ink, 1);
    if (waving) g.lineBetween(x - 16 * s, y - 72 * s, x - 30 * s, y - 100 * s);
    else g.lineBetween(x - 16 * s, y - 72 * s, x - 34 * s, y - 46 * s);
    // Su frontal, hacia donde va.
    g.fillStyle(f.light, 0.12 * f.night);
    g.fillTriangle(x - 36 * s, y - 46 * s, x - 150 * s, y - 70 * s, x - 150 * s, y - 20 * s);
    g.fillStyle(0xfff4d0, 0.95 * f.night);
    g.fillCircle(x - 37 * s, y - 46 * s, 2.4 * s);
    return true;
  }
}

class Car extends Active {
  private phase = 0;

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 14);
    if (x < -130) return false;
    const y0 = feetY(x, f.slope);
    const g = L.near;
    const ink = nearTone(f, x);
    g.fillStyle(ink, 1);
    g.fillRect(x - 76, y0 - 34, 152, 26);
    g.fillPoints(
      [
        { x: x - 40, y: y0 - 34 },
        { x: x - 26, y: y0 - 58 },
        { x: x + 30, y: y0 - 58 },
        { x: x + 46, y: y0 - 34 },
      ],
      true,
    );
    // El portón trasero abierto y la puerta del conductor, también.
    g.fillTriangle(x - 76, y0 - 34, x - 76, y0 - 64, x - 96, y0 - 44);
    g.fillRect(x - 14, y0 - 30, 28, 30);
    g.fillStyle(0x000000, 0.35);
    g.fillRect(x - 12, y0 - 26, 24, 22);
    g.fillStyle(ink, 1);
    g.fillCircle(x - 46, y0 - 8, 11);
    g.fillCircle(x + 48, y0 - 8, 11);
    g.fillStyle(0x000000, 0.4);
    g.fillCircle(x - 46, y0 - 8, 4);
    g.fillCircle(x + 48, y0 - 8, 4);
    // Los intermitentes, con la batería agonizando: cada vez más lentos.
    const period = 0.75 + 1.3 * clamp01((this.t - 2) / 14);
    this.phase += f.dt;
    const lit = this.phase % period < period * 0.42;
    if (lit && f.night > 0.05) {
      const a = f.night * (1 - 0.35 * clamp01((this.t - 2) / 14));
      for (const lx of [x - 74, x + 74]) {
        g.fillStyle(AMBER, 0.28 * a);
        g.fillCircle(lx, y0 - 27, 10);
        g.fillStyle(0xffd070, 0.95 * a);
        g.fillCircle(lx, y0 - 27, 3.2);
      }
      g.fillStyle(AMBER, 0.1 * a);
      g.fillEllipse(x, y0 + 8, 240, 26);
    }
    return true;
  }
}

class Sign extends Active {
  private readonly line1: Phaser.GameObjects.Text;
  private readonly line2: Phaser.GameObjects.Text;

  constructor(startM: number, rnd: () => number, scene: Phaser.Scene, sign: { refuge: string; kmLeft: number } | undefined) {
    super(startM, rnd);
    const top = sign ? `${sign.refuge}  ${Math.max(1, sign.kmLeft)}` : 'REFUGIO  →';
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
    const ink = nearTone(f, x);
    // La placa es retrorreflectante: se enciende cuando le da tu frontal.
    const hit = clamp01(1 - Math.abs(x - 1060) / 320) * (0.4 + 0.6 * f.night);
    g.fillStyle(ink, 1);
    g.fillRect(x - 3, y0 - 144, 6, 144);
    g.fillStyle(Phaser.Display.Color.GetColor(0x2a + hit * 80, 0x4e + hit * 120, 0x3a + hit * 90), 1);
    g.fillRect(x - 84, y0 - 154, 168, 64);
    g.lineStyle(2, 0xe8f0e4, 0.25 + 0.6 * hit);
    g.strokeRect(x - 84, y0 - 154, 168, 64);
    this.line1.setPosition(x, y0 - 148).setAlpha(0.45 + 0.55 * hit);
    this.line2.setPosition(x + 2, y0 - 122).setAlpha(0.55 + 0.45 * hit);
    return true;
  }

  override destroy(): void {
    this.line1.destroy();
    this.line2.destroy();
  }
}

class TrafficLight extends Active {
  private wasLit = false;

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 13);
    if (x < -130) return false;
    const y0 = feetY(x, f.slope);
    const g = L.near;
    const ink = nearTone(f, x);
    // El cruce: la calle que se va, más oscura, y su borde.
    g.fillStyle(0x05060c, 0.55);
    g.fillRect(x - 64, y0 - 10, 128, RENDER.height - y0 + 10);
    g.fillStyle(ink, 0.5);
    g.fillRect(x - 64, y0 - 12, 128, 2);
    g.fillStyle(ink, 1);
    g.fillRect(x - 3, y0 - 150, 6, 150);
    g.fillRect(x - 13, y0 - 216, 26, 68);
    g.fillStyle(0x3a1a1a, 1);
    g.fillCircle(x, y0 - 201, 7);
    g.fillStyle(0x16301c, 1);
    g.fillCircle(x, y0 - 163, 7);
    const lit = this.t % 1 < 0.5;
    if (lit !== this.wasLit) {
      this.wasLit = lit;
      if (lit && x > -20 && x < RENDER.width + 20) encounterAudio.tick();
    }
    if (lit) {
      g.fillStyle(AMBER, 0.3 * f.night);
      g.fillCircle(x, y0 - 182, 18);
      g.fillStyle(0xffd070, 0.95);
      g.fillCircle(x, y0 - 182, 7);
      g.fillStyle(AMBER, 0.1 * f.night);
      g.fillEllipse(x, y0 + 30, 200, 60);
    } else {
      g.fillStyle(0x4a3410, 1);
      g.fillCircle(x, y0 - 182, 7);
    }
    return true;
  }
}

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

// ---- entre los árboles (capa media) ------------------------------------------------

class Campfire extends Active {
  private readonly sound: SoundHandle = encounterAudio.crackle();

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 32, MID_FACTOR);
    if (x < -160) return false;
    const y0 = HORIZON_Y - 40;
    const g = L.mid;
    const ink = f.midInk;
    const flick = 0.75 + 0.25 * Math.sin(this.t * 13) * Math.sin(this.t * 7.3);
    // El resplandor en el suelo y sobre las siluetas.
    g.fillStyle(FLAME, 0.09 * flick * (0.5 + 0.5 * f.night));
    g.fillEllipse(x, y0 - 2, 220 * flick + 40, 70);
    g.fillStyle(FLAME, 0.07 * flick * f.night);
    g.fillCircle(x, y0 - 22, 60 + 10 * flick);
    // Tres siluetas sentadas, una levanta el brazo al verte.
    for (const [px, arm] of [
      [-38, false],
      [34, true],
      [8, false],
    ] as const) {
      const sx = x + px;
      const sy = y0 - (px === 8 ? 6 : 0);
      g.fillStyle(ink, 1);
      g.fillEllipse(sx, sy - 12, 22, 24);
      g.fillCircle(sx, sy - 30, 6.5);
      if (arm) {
        const up = Math.abs(x - RENDER.playerX) < 320;
        g.lineStyle(3.5, ink, 1);
        if (up) g.lineBetween(sx + 6, sy - 18, sx + 16, sy - 44 + Math.sin(this.t * 6) * 2);
        else g.lineBetween(sx + 6, sy - 18, sx + 14, sy - 6);
      }
      // El lado que da al fuego, encendido.
      const toward = Math.sign(x - sx);
      g.fillStyle(0xffc080, 0.28 * flick);
      g.fillEllipse(sx + toward * 7, sy - 13, 5, 18);
    }
    // Los troncos y las llamas.
    g.lineStyle(5, ink, 1);
    g.lineBetween(x - 14, y0, x + 12, y0 - 5);
    g.lineBetween(x - 12, y0 - 5, x + 14, y0);
    const h1 = 28 + Math.sin(this.t * 13) * 6;
    const h2 = 18 + Math.sin(this.t * 17 + 1) * 5;
    const h3 = 14 + Math.sin(this.t * 11 + 2) * 4;
    g.fillStyle(FLAME, 0.9);
    g.fillTriangle(x - 9, y0 - 3, x + 9, y0 - 3, x + Math.sin(this.t * 9) * 3, y0 - 3 - h1);
    g.fillStyle(0xffd070, 0.9);
    g.fillTriangle(x - 5, y0 - 3, x + 4, y0 - 3, x - 2 + Math.sin(this.t * 15) * 2, y0 - 3 - h2);
    g.fillStyle(0xfff0c0, 0.85);
    g.fillTriangle(x - 2, y0 - 3, x + 2, y0 - 3, x + Math.sin(this.t * 21) * 1.5, y0 - 3 - h3);
    // Chispas.
    g.fillStyle(0xffc060, 0.8);
    for (let i = 0; i < 4; i++) {
      const k = (this.t * 0.6 + i * 0.25) % 1;
      g.fillCircle(x + Math.sin(this.t * 3 + i * 2) * 8 * k, y0 - 10 - k * 60, 1.4 * (1 - k));
    }
    this.sound.setLevel(clamp01(1 - Math.abs(x - RENDER.width / 2) / 820));
    return true;
  }

  override destroy(): void {
    this.sound.stop();
  }
}

interface Crow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

class Crows extends Active {
  private readonly perches: ReadonlyArray<readonly [number, number]> = [
    [-30, -96],
    [-14, -118],
    [10, -128],
    [24, -108],
    [-38, -78],
    [16, -84],
    [2, -60],
  ];
  private crows: Crow[] = [];
  private burstAt = -1;
  private cawed = 0;

  protected draw(f: EncounterFrame, L: EncounterLayers): boolean {
    const x = worldX(f, this.startM, 36, MID_FACTOR);
    const y0 = HORIZON_Y - 30;
    const g = L.mid;
    const ink = f.midInk;
    // El árbol seco.
    g.fillStyle(ink, 1);
    g.fillTriangle(x - 6, y0, x + 6, y0, x + 8, y0 - 130);
    g.lineStyle(3, ink, 1);
    for (const [ax, ay, bx, by] of [
      [-2, -88, -34, -100],
      [3, -104, -18, -122],
      [5, -112, 12, -132],
      [6, -100, 28, -112],
      [-1, -72, -40, -82],
      [4, -80, 20, -88],
      [2, -56, 8, -62],
    ] as const) {
      g.lineBetween(x + ax, y0 + ay, x + bx, y0 + by);
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
      g.lineStyle(2.5, 0x14121f, 0.95);
      for (const c of this.crows) {
        c.x += c.vx * f.dt;
        c.y += c.vy * f.dt;
        c.vy += 12 * f.dt; // se van nivelando
        c.phase += f.dt * 16;
        const flap = Math.sin(c.phase) * 0.7;
        g.lineBetween(c.x, c.y, c.x - 10, c.y - 6 * flap);
        g.lineBetween(c.x, c.y, c.x + 10, c.y - 6 * flap);
        g.fillStyle(0x14121f, 0.95);
        g.fillEllipse(c.x, c.y, 6, 3);
      }
      this.crows = this.crows.filter((c) => c.x > -40 && c.y > -40);
    } else {
      // Posados, quietos, con algún cabeceo.
      g.fillStyle(0x14121f, 0.95);
      this.perches.forEach(([px, py], i) => {
        g.fillEllipse(x + px, y0 + py - 4 + Math.sin(this.t * 2 + i) * 0.6, 8, 5);
        g.fillCircle(x + px - 3, y0 + py - 7, 2.2);
      });
    }
    return x > -120 || this.crows.length > 0;
  }
}

// ---- el horizonte -----------------------------------------------------------------

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
    const body = Phaser.Display.Color.GetColor(
      Math.min(255, ((f.farInk >> 16) & 0xff) + 18),
      Math.min(255, ((f.farInk >> 8) & 0xff) + 18),
      Math.min(255, (f.farInk & 0xff) + 26),
    );
    // La vía, solo bajo el tren.
    g.fillStyle(f.farInk, 0.7);
    g.fillRect(tailX - 60, y + 1, TRAIN_LEN + 120, 2);
    // La locomotora con su faro.
    g.fillStyle(body, 1);
    g.fillRect(headX - 46, y - 22, 46, 22);
    g.fillRect(headX - 40, y - 28, 22, 6);
    g.fillStyle(f.light, 0.12 * f.night);
    g.fillTriangle(headX, y - 12, headX + 140, y - 26, headX + 140, y + 2);
    g.fillStyle(0xfff4d0, 0.95 * f.night);
    g.fillCircle(headX - 2, y - 12, 2.2);
    // Los vagones con las ventanas encendidas.
    for (let i = 0; i < TRAIN_COACHES; i++) {
      const cx = headX - 50 - i * COACH_W - COACH_W / 2;
      if (cx + COACH_W < -10 || cx - COACH_W > RENDER.width + 10) continue;
      g.fillStyle(body, 1);
      g.fillRect(cx - 24, y - 17, 48, 17);
      g.fillStyle(0x000000, 0.35);
      g.fillRect(cx - 22, y - 1, 44, 1.5);
      for (let j = 0; j < 4; j++) {
        if ((i * 4 + j) % 7 === 3) continue;
        g.fillStyle(f.light, 0.85 * f.night + 0.1);
        g.fillRect(cx - 19 + j * 10, y - 13, 5.5, 5);
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

// ---- el cielo ---------------------------------------------------------------------

interface Bat {
  a: number;
  r: number;
  w: number;
  phase: number;
  lift: number;
}

const BATS_SEC = 22;

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
    this.bats.forEach((b, i) => {
      const a = b.a + this.t * b.w;
      const sx = mx + Math.cos(a) * b.r * 1.5 + Math.sin(this.t * 7 + b.phase) * 6;
      const sy = my + b.lift + Math.sin(a) * b.r * 0.6 + Math.cos(this.t * 5 + b.phase) * 5;
      const fromX = RENDER.width + 60 + i * 30;
      const fromY = my - 90 + i * 22;
      const toX = -80 - i * 25;
      const toY = my - 170 - i * 8;
      const ease = (k: number) => k * k * (3 - 2 * k);
      let x = fromX + (sx - fromX) * ease(inK);
      let y = fromY + (sy - fromY) * ease(inK);
      if (outK > 0) {
        x = sx + (toX - sx) * ease(outK);
        y = sy + (toY - sy) * ease(outK);
      }
      const flap = Math.sin(this.t * 19 + b.phase);
      g.lineStyle(2.5, 0x241e3a, 0.95);
      g.lineBetween(x, y, x - 5, y - 4 * flap);
      g.lineBetween(x - 5, y - 4 * flap, x - 11, y + 2 * flap);
      g.lineBetween(x, y, x + 5, y - 4 * flap);
      g.lineBetween(x + 5, y - 4 * flap, x + 11, y + 2 * flap);
      g.fillStyle(0x241e3a, 0.95);
      g.fillEllipse(x, y + 1, 5, 3.5);
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
      g.lineStyle(2, 0xffffff, a * 0.9);
      g.lineBetween(m.x, m.y, m.x - m.vx * 0.1, m.y - m.vy * 0.1);
      g.lineStyle(1, 0xdde6ff, a * 0.4);
      g.lineBetween(m.x - m.vx * 0.1, m.y - m.vy * 0.1, m.x - m.vx * 0.24, m.y - m.vy * 0.24);
    }
    this.meteors = this.meteors.filter((m) => m.life > 0);
    return this.t < METEORS_SEC || this.meteors.length > 0;
  }
}

// ---- el gestor ---------------------------------------------------------------------

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
      return new OtherCyclist(m, rnd);
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
