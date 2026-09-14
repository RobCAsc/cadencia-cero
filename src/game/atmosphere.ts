import Phaser from 'phaser';
import { RENDER } from '../config';
import { lcg } from './rng';

// Atmósfera en siluetas que avanza con el programa: la salida empieza al
// anochecer, el grueso del trabajo es noche cerrada, y la vuelta a la calma
// es el amanecer. Terminar la sesión es ver salir el sol. Todo dibujado por
// código: las siluetas se generan en blanco una vez y se tintan por fase; el
// cielo se redibuja (barato) cuando cambia; luna y sol son texturas que se
// mueven. Encima, la vida del lugar: estrellas que titilan y alguna fugaz,
// farolas rotas que parpadean al pasar, niebla que se espesa cuando la horda
// se acerca, y al amanecer rayos de sol y pájaros. El scroll es proporcional
// a la velocidad del jugador y la niebla deriva sola con el "viento".

const HORIZON_Y = 600;

interface Phase {
  t: number;
  skyTop: number;
  skyMid: number;
  skyHorizon: number;
  far: number;
  mid: number;
  near: number;
  fog: number;
  stars: number;
  moon: number;
  sun: number;
}

// Fotogramas clave de la noche. Las siluetas van un tier más claras que el
// fondo en cada fase o desaparecen; la niebla toma el color de la luz.
const PHASES: readonly Phase[] = [
  { t: 0.0, skyTop: 0x1a1230, skyMid: 0x4a2848, skyHorizon: 0xc8663a, far: 0x2a1c3a, mid: 0x1a1128, near: 0x0e0a16, fog: 0x8a6a78, stars: 0.15, moon: 0.55, sun: 0 },
  { t: 0.2, skyTop: 0x06081a, skyMid: 0x131a38, skyHorizon: 0x3a4468, far: 0x131730, mid: 0x0b0e20, near: 0x06070f, fog: 0x7285ad, stars: 1, moon: 1, sun: 0 },
  { t: 0.78, skyTop: 0x06081a, skyMid: 0x131a38, skyHorizon: 0x3a4468, far: 0x131730, mid: 0x0b0e20, near: 0x06070f, fog: 0x7285ad, stars: 1, moon: 1, sun: 0 },
  { t: 0.9, skyTop: 0x0e1834, skyMid: 0x2a3a66, skyHorizon: 0x8a6070, far: 0x1c2040, mid: 0x12162c, near: 0x0a0c18, fog: 0x8a86a8, stars: 0.35, moon: 0.5, sun: 0.15 },
  { t: 1.0, skyTop: 0x2c4c86, skyMid: 0x7888b4, skyHorizon: 0xf2b872, far: 0x3c3a68, mid: 0x28264a, near: 0x181632, fog: 0xc8a898, stars: 0, moon: 0, sun: 1 },
];

const ROAD_BASE = 0x0d0f1c;
const ROAD_EDGE = 0x353d63;
const ROAD_DASH = 0x343b60;
const ROAD_CRACK = 0x04050b;
const WHITE = 0xffffff;
const LIGHTNING = 0xdde4ff;
const LAMP_LIGHT = 0xffd9a0;

/** Farolas al borde de la carretera: cada cuántos px se repite el patrón y dónde cae cada una. */
const LAMP_PERIOD_PX = 2600;
const LAMPS: ReadonlyArray<{ offset: number; kind: 'dead' | 'flicker' | 'steady' }> = [
  { offset: 300, kind: 'flicker' },
  { offset: 1150, kind: 'dead' },
  { offset: 1900, kind: 'steady' },
];
const TWINKLE_COUNT = 16;

export function lerpColor(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const r = ((a >> 16) & 0xff) + (((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * k;
  const g = ((a >> 8) & 0xff) + (((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * k;
  const bl = (a & 0xff) + ((b & 0xff) - (a & 0xff)) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

function phaseAt(t: number): Phase {
  const x = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < PHASES.length - 2 && x >= (PHASES[i + 1]?.t ?? 1)) i++;
  const a = PHASES[i]!;
  const b = PHASES[i + 1]!;
  const k = b.t > a.t ? (x - a.t) / (b.t - a.t) : 0;
  const lerp = (p: number, q: number) => p + (q - p) * k;
  return {
    t: x,
    skyTop: lerpColor(a.skyTop, b.skyTop, k),
    skyMid: lerpColor(a.skyMid, b.skyMid, k),
    skyHorizon: lerpColor(a.skyHorizon, b.skyHorizon, k),
    far: lerpColor(a.far, b.far, k),
    mid: lerpColor(a.mid, b.mid, k),
    near: lerpColor(a.near, b.near, k),
    fog: lerpColor(a.fog, b.fog, k),
    stars: lerp(a.stars, b.stars),
    moon: lerp(a.moon, b.moon),
    sun: lerp(a.sun, b.sun),
  };
}

function fillVerticalGradient(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  from: number,
  to: number,
  steps = 40,
): void {
  const strip = h / steps;
  for (let i = 0; i < steps; i++) {
    g.fillStyle(lerpColor(from, to, i / (steps - 1)), 1);
    g.fillRect(x, y + i * strip, w, strip + 1);
  }
}

function makeStarsTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const rnd = lcg(1337);
  for (let i = 0; i < 110; i++) {
    const x = rnd() * RENDER.width;
    const y = rnd() * rnd() * 420;
    g.fillStyle(0xcdd8f0, 0.15 + rnd() * 0.55);
    g.fillRect(x, y, rnd() < 0.2 ? 2 : 1, rnd() < 0.2 ? 2 : 1);
  }
  g.generateTexture('atm-stars', RENDER.width, 440);
  g.clear();
  // Una estrella que titila: punto con halo.
  g.fillStyle(0xdde6ff, 0.35);
  g.fillCircle(4, 4, 4);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(4, 4, 1.6);
  g.generateTexture('atm-twinkle', 8, 8);
  g.destroy();
}

function makeCloudsTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(WHITE, 0.06);
  g.fillEllipse(370, 145, 280, 16);
  g.fillEllipse(270, 200, 340, 14);
  g.fillEllipse(820, 120, 380, 12);
  g.fillEllipse(1050, 240, 300, 10);
  g.fillEllipse(600, 260, 260, 9);
  g.generateTexture('atm-clouds', RENDER.width, 300);
  g.clear();
  // Un segundo banco de nubes, más alto y más tenue, para que el cielo tenga fondo.
  g.fillStyle(WHITE, 0.04);
  g.fillEllipse(200, 60, 420, 12);
  g.fillEllipse(700, 40, 520, 10);
  g.fillEllipse(1100, 90, 360, 9);
  g.generateTexture('atm-clouds2', RENDER.width, 140);
  g.destroy();
}

function makeMoonTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const c = 170;
  for (let i = 8; i >= 1; i--) {
    g.fillStyle(0xcfe3c0, 0.016 * (9 - i));
    g.fillCircle(c, c, 58 + i * 13);
  }
  g.fillStyle(0xdfe9cc, 1);
  g.fillCircle(c, c, 58);
  g.fillStyle(0xc3d4ae, 0.55);
  g.fillCircle(c - 16, c - 10, 9);
  g.fillCircle(c + 12, c + 8, 6);
  g.fillCircle(c - 2, c + 22, 5);
  g.generateTexture('atm-moon', c * 2, c * 2);
  g.destroy();
}

function makeSunTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const c = 220;
  for (let i = 10; i >= 1; i--) {
    g.fillStyle(0xffc070, 0.03 * (11 - i));
    g.fillCircle(c, c, 44 + i * 17);
  }
  g.fillStyle(0xfff0c0, 1);
  g.fillCircle(c, c, 44);
  g.generateTexture('atm-sun', c * 2, c * 2);
  g.destroy();
}

function makeLampTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // Poste con brazo y cabeza, en blanco para tintarlo como el plano cercano.
  g.fillStyle(WHITE, 1);
  g.fillRect(4, 12, 5, 150);
  g.fillRect(4, 8, 24, 5);
  g.fillRect(20, 2, 12, 9);
  g.fillRect(0, 158, 13, 4);
  g.generateTexture('atm-lamp', 32, 162);
  g.clear();
  // Cono de luz hacia abajo, cálido y suave.
  for (let i = 10; i >= 1; i--) {
    g.fillStyle(LAMP_LIGHT, 0.03);
    g.fillTriangle(70, 0, 70 - i * 8, 170, 70 + i * 8, 170);
  }
  g.generateTexture('atm-lampcone', 140, 170);
  g.clear();
  // Charco de luz en el asfalto.
  for (let i = 7; i >= 1; i--) {
    g.fillStyle(LAMP_LIGHT, 0.045);
    g.fillEllipse(110, 24, 30 + i * 24, 8 + i * 5);
  }
  g.generateTexture('atm-lamppool', 220, 48);
  g.destroy();
}

function makeFarTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const H = 260;
  g.fillStyle(WHITE, 1);

  // Skyline en ruinas: cada edificio son rects apilados con tope roto.
  const buildings: Array<[number, number, number]> = [
    [0, 58, 120],
    [58, 40, 74],
    [110, 66, 168],
    [188, 46, 96],
    [246, 60, 200],
    [318, 44, 64],
    [372, 62, 140],
    [446, 66, 108],
  ];
  for (const [x, w, h] of buildings) {
    g.fillRect(x, H - h, w, h);
    g.fillRect(x + 4, H - h - 10, w * 0.3, 10);
    g.fillRect(x + w * 0.55, H - h - 16, w * 0.28, 16);
  }
  // Antena y tanque de agua.
  g.fillRect(272, H - 232, 3, 32);
  g.fillRect(150, H - 190, 3, 22);
  g.fillRect(140, H - 196, 24, 8);
  g.fillCircle(152, H - 202, 11);

  // Postes de luz vencidos con cable colgando.
  g.fillRect(348, H - 120, 4, 120);
  g.fillRect(336, H - 116, 28, 4);
  g.fillRect(496, H - 132, 4, 132);
  g.fillRect(484, H - 128, 28, 4);
  g.lineStyle(2, WHITE, 1);
  g.beginPath();
  g.moveTo(350, H - 112);
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    g.lineTo(350 + t * 148, H - 112 + Math.sin(t * Math.PI) * 26);
  }
  g.strokePath();

  g.generateTexture('atm-far', 512, H);
  g.destroy();
}

function drawDeadTree(
  g: Phaser.GameObjects.Graphics,
  x: number,
  base: number,
  h: number,
  lean: number,
): void {
  const top = base - h;
  g.fillTriangle(x - 5, base, x + 5, base, x + lean, top);
  g.lineStyle(3, WHITE, 1);
  const branches: Array<[number, number, number]> = [
    [0.35, -34, -18],
    [0.5, 30, -22],
    [0.66, -26, -16],
    [0.8, 22, -14],
  ];
  for (const [at, dx, dy] of branches) {
    const bx = x + lean * at;
    const by = base - h * at;
    g.lineBetween(bx, by, bx + dx, by + dy);
    g.lineBetween(bx + dx, by + dy, bx + dx + dx * 0.4, by + dy - 10);
  }
}

function makeMidTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const H = 230;
  const B = H;
  g.fillStyle(WHITE, 1);

  drawDeadTree(g, 70, B, 170, 14);
  drawDeadTree(g, 340, B, 140, -10);
  drawDeadTree(g, 560, B, 185, 8);

  // Coche abandonado con el cofre abierto.
  g.fillStyle(WHITE, 1);
  g.fillRect(160, B - 26, 92, 18);
  g.fillPoints(
    [
      { x: 178, y: B - 26 },
      { x: 192, y: B - 40 },
      { x: 228, y: B - 40 },
      { x: 240, y: B - 26 },
    ],
    true,
  );
  g.fillTriangle(160, B - 26, 160, B - 40, 176, B - 26);
  g.fillCircle(178, B - 8, 9);
  g.fillCircle(234, B - 8, 9);

  // Lápidas y una cruz.
  for (const [gx, gh] of [
    [262, 18],
    [282, 24],
    [304, 15],
  ] as const) {
    g.fillRect(gx, B - gh, 12, gh);
    g.fillCircle(gx + 6, B - gh, 6);
  }
  g.fillRect(324, B - 30, 4, 30);
  g.fillRect(317, B - 22, 18, 4);

  // Valla vencida.
  [430, 456, 482, 508].forEach((px, i) => {
    if (i === 2) {
      g.fillPoints(
        [
          { x: px, y: B },
          { x: px + 5, y: B },
          { x: px + 13, y: B - 26 },
          { x: px + 8, y: B - 27 },
        ],
        true,
      );
    } else {
      g.fillRect(px, B - 28, 5, 28);
    }
  });
  g.fillRect(424, B - 22, 96, 4);
  g.fillRect(424, B - 10, 96, 4);

  // Matas de pasto seco.
  const rnd = lcg(99);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 640;
    const h = 5 + rnd() * 9;
    g.fillTriangle(x - 2.5, B, x + 2.5, B, x + (rnd() * 6 - 3), B - h);
  }

  g.generateTexture('atm-mid', 640, H);
  g.destroy();
}

function makeNearTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const H = 100;
  const rnd = lcg(4242);
  g.fillStyle(WHITE, 1);

  for (let i = 0; i < 30; i++) {
    const x = rnd() * 512;
    const r = 9 + rnd() * 15;
    g.fillCircle(x, H - r * 0.4, r);
  }
  for (let i = 0; i < 8; i++) {
    const x = rnd() * 512;
    const s = 6 + rnd() * 12;
    g.fillTriangle(x - s, H, x + s, H, x + (rnd() * 8 - 4), H - s);
  }
  // Señal de tráfico vencida.
  g.fillPoints(
    [
      { x: 300, y: H },
      { x: 304, y: H },
      { x: 316, y: H - 54 },
      { x: 312, y: H - 55 },
    ],
    true,
  );
  g.fillPoints(
    [
      { x: 306, y: H - 68 },
      { x: 330, y: H - 62 },
      { x: 326, y: H - 42 },
      { x: 302, y: H - 48 },
    ],
    true,
  );

  g.generateTexture('atm-near', 512, H);
  g.destroy();
}

function makeRoadTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const H = 130;
  const rnd = lcg(777);

  g.fillStyle(ROAD_BASE, 1);
  g.fillRect(0, 0, 512, H);
  g.fillStyle(ROAD_EDGE, 1);
  g.fillRect(0, 0, 512, 3);
  g.fillStyle(0x171b33, 1);
  g.fillRect(0, 3, 512, 1);

  const dashes: Array<[number, number, number]> = [
    [8, 46, 0.85],
    [136, 30, 0.5],
    [264, 46, 0.7],
    [392, 38, 0.6],
  ];
  for (const [x, w, a] of dashes) {
    g.fillStyle(ROAD_DASH, a);
    g.fillRect(x, 58, w, 5);
  }

  g.lineStyle(2, ROAD_CRACK, 1);
  for (const startX of [70, 250, 430]) {
    g.beginPath();
    let cx = startX;
    let cy = 10 + rnd() * 30;
    g.moveTo(cx, cy);
    for (let s = 0; s < 5; s++) {
      cx += 8 + rnd() * 18;
      cy += 12 + rnd() * 16;
      g.lineTo(cx, cy);
    }
    g.strokePath();
  }

  g.fillStyle(0x170d13, 0.5);
  g.fillEllipse(180, 92, 60, 14);
  g.fillEllipse(400, 40, 44, 10);
  for (let i = 0; i < 14; i++) {
    g.fillStyle(0x23284a, 0.6);
    g.fillRect(rnd() * 512, 12 + rnd() * 108, 2, 2);
  }
  // Charcos: reflejan un poco de cielo.
  g.fillStyle(0x3a4468, 0.35);
  g.fillEllipse(96, 104, 54, 9);
  g.fillEllipse(330, 118, 40, 7);

  g.generateTexture('atm-road', 512, H);
  g.destroy();
}

function makeFogTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const rnd = lcg(31416);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 512;
    const y = 50 + rnd() * 70;
    const r = 26 + rnd() * 44;
    g.fillStyle(WHITE, 0.035);
    g.fillCircle(x, y, r);
  }
  for (let i = 0; i < 5; i++) {
    g.fillStyle(WHITE, 0.03);
    g.fillEllipse(rnd() * 512, 70 + rnd() * 50, 220 + rnd() * 160, 26 + rnd() * 18);
  }
  g.generateTexture('atm-fog', 512, 160);
  g.destroy();
}

function ensureTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('atm-stars')) return;
  makeStarsTexture(scene);
  makeCloudsTexture(scene);
  makeMoonTexture(scene);
  makeSunTexture(scene);
  makeLampTextures(scene);
  makeFarTexture(scene);
  makeMidTexture(scene);
  makeNearTexture(scene);
  makeRoadTexture(scene);
  makeFogTexture(scene);
}

interface Lamp {
  offset: number;
  kind: 'dead' | 'flicker' | 'steady';
  post: Phaser.GameObjects.Image;
  cone: Phaser.GameObjects.Image;
  pool: Phaser.GameObjects.Image;
  /** Estado del parpadeo: cuánto queda en el estado actual (s) y si está encendida. */
  flickerLeft: number;
  lit: boolean;
}

interface Bird {
  x: number;
  y: number;
  speed: number;
  phase: number;
  size: number;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export class Atmosphere {
  private readonly sky: Phaser.GameObjects.Graphics;
  private readonly stars: Phaser.GameObjects.Image;
  private readonly twinkles: Phaser.GameObjects.Image[] = [];
  private readonly clouds: Phaser.GameObjects.TileSprite;
  private readonly clouds2: Phaser.GameObjects.TileSprite;
  private readonly moon: Phaser.GameObjects.Image;
  private readonly sun: Phaser.GameObjects.Image;
  private readonly rays: Phaser.GameObjects.Graphics;
  private readonly skyFx: Phaser.GameObjects.Graphics;
  private readonly far: Phaser.GameObjects.TileSprite;
  private readonly mid: Phaser.GameObjects.TileSprite;
  private readonly near: Phaser.GameObjects.TileSprite;
  private readonly road: Phaser.GameObjects.TileSprite;
  private readonly fogBack: Phaser.GameObjects.TileSprite;
  private readonly fogMid: Phaser.GameObjects.TileSprite;
  private readonly fogFront: Phaser.GameObjects.TileSprite;
  private readonly lamps: Lamp[] = [];
  private readonly frontFogBase: number;

  private progress = 0.3;
  private drawnProgress = -1;
  private phase: Phase = phaseAt(0.3);
  private flash = 0;
  private dread = 0;
  private roadScroll = 0;
  private tAlive = 0;
  private birds: Bird[] = [];
  private nextFlockSec = 3;
  private shooting: ShootingStar | undefined;
  private readonly rnd = lcg(8675309);

  constructor(scene: Phaser.Scene, withFrontFog = true) {
    ensureTextures(scene);
    const w = RENDER.width;

    this.sky = scene.add.graphics({ x: 0, y: 0 });
    this.stars = scene.add.image(0, 0, 'atm-stars').setOrigin(0, 0);
    const trnd = lcg(2718);
    for (let i = 0; i < TWINKLE_COUNT; i++) {
      const star = scene.add
        .image(trnd() * w, trnd() * trnd() * 380, 'atm-twinkle')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.7 + trnd() * 0.8)
        .setData('phase', trnd() * Math.PI * 2)
        .setData('rate', 0.6 + trnd() * 1.6);
      this.twinkles.push(star);
    }
    this.clouds2 = scene.add.tileSprite(0, 20, w, 140, 'atm-clouds2').setOrigin(0, 0);
    this.clouds = scene.add.tileSprite(0, 0, w, 300, 'atm-clouds').setOrigin(0, 0);
    this.moon = scene.add.image(330, 175, 'atm-moon');
    this.sun = scene.add.image(1000, 640, 'atm-sun').setBlendMode(Phaser.BlendModes.ADD);
    this.rays = scene.add.graphics({ x: 0, y: 0 }).setBlendMode(Phaser.BlendModes.ADD);
    this.skyFx = scene.add.graphics({ x: 0, y: 0 });
    this.far = scene.add.tileSprite(0, HORIZON_Y - 260, w, 260, 'atm-far').setOrigin(0, 0);
    // La niebla abraza el horizonte, sin lavar las siluetas cercanas.
    this.fogBack = scene.add
      .tileSprite(0, HORIZON_Y - 200, w, 160, 'atm-fog')
      .setOrigin(0, 0)
      .setAlpha(0.4);
    this.mid = scene.add.tileSprite(0, HORIZON_Y - 230, w, 230, 'atm-mid').setOrigin(0, 0);
    this.fogMid = scene.add
      .tileSprite(0, HORIZON_Y - 150, w, 160, 'atm-fog')
      .setOrigin(0, 0)
      .setAlpha(0.3);
    this.near = scene.add.tileSprite(0, HORIZON_Y - 100, w, 100, 'atm-near').setOrigin(0, 0);
    this.road = scene.add.tileSprite(0, HORIZON_Y - 10, w, 130, 'atm-road').setOrigin(0, 0);

    // Farolas al borde del asfalto: pasan con la carretera, por detrás de los actores.
    for (const spec of LAMPS) {
      const post = scene.add.image(0, HORIZON_Y + 6, 'atm-lamp').setOrigin(0.15, 1).setDepth(1);
      const cone = scene.add
        .image(0, HORIZON_Y - 150, 'atm-lampcone')
        .setOrigin(0.5, 0)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(1);
      const pool = scene.add
        .image(0, HORIZON_Y + 16, 'atm-lamppool')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(1);
      this.lamps.push({ ...spec, post, cone, pool, flickerLeft: 0, lit: spec.kind !== 'dead' });
    }

    // Niebla frontal, por delante de los actores (depth > actores, < HUD).
    this.frontFogBase = withFrontFog ? 0.18 : 0;
    this.fogFront = scene.add
      .tileSprite(0, HORIZON_Y - 30, w, 160, 'atm-fog')
      .setOrigin(0, 0)
      .setAlpha(this.frontFogBase)
      .setDepth(4);

    this.applyPhase(true);
  }

  /** 0 = anochecer (arranque), 1 = amanecer (fin del programa). */
  setProgress(t01: number): void {
    this.progress = Math.max(0, Math.min(1, t01));
  }

  /** 0 lejos … 1 con la horda encima: la niebla se espesa. */
  setDread(d01: number): void {
    this.dread = Math.max(0, Math.min(1, d01));
  }

  /** Un relámpago: el cielo y las siluetas se blanquean un instante. */
  lightning(): void {
    this.flash = 1;
  }

  update(playerSpeedMps: number, dtSec: number): void {
    this.tAlive += dtSec;
    const px = playerSpeedMps * RENDER.groundPxPerMeter * dtSec;
    this.roadScroll += px;
    this.road.tilePositionX += px;
    this.near.tilePositionX += px * RENDER.nearFactor;
    this.mid.tilePositionX += px * 0.38;
    this.far.tilePositionX += px * 0.12;
    this.clouds.tilePositionX += px * 0.02 + 1.2 * dtSec;
    this.clouds2.tilePositionX += px * 0.01 + 0.5 * dtSec;
    // La niebla scrollea poco con el mundo y deriva sola con el viento; con
    // la horda encima se espesa.
    this.fogBack.tilePositionX += px * 0.1 + 2.5 * dtSec;
    this.fogMid.tilePositionX += px * 0.35 + 5 * dtSec;
    this.fogFront.tilePositionX += px * 0.8 + 9 * dtSec;
    const fogTarget = this.frontFogBase + this.dread * 0.3;
    this.fogFront.alpha += (fogTarget - this.fogFront.alpha) * Math.min(1, dtSec * 1.5);
    this.fogMid.setAlpha(0.3 + this.dread * 0.2);

    // El cielo se redibuja solo cuando la fase cambió lo bastante o mientras
    // dura un relámpago.
    const flashing = this.flash > 0.005;
    if (flashing) this.flash *= Math.exp(-7 * dtSec);
    this.applyPhase(flashing);

    this.updateTwinkles();
    this.updateLamps(dtSec);
    this.updateSkyLife(dtSec);
  }

  private applyPhase(force: boolean): void {
    if (!force && Math.abs(this.progress - this.drawnProgress) < 0.002) return;
    this.drawnProgress = this.progress;
    const p = phaseAt(this.progress);
    this.phase = p;
    const f = Math.min(1, this.flash) * 0.75;

    const g = this.sky;
    g.clear();
    fillVerticalGradient(g, 0, 0, RENDER.width, 400, lerpColor(p.skyTop, LIGHTNING, f), lerpColor(p.skyMid, LIGHTNING, f));
    fillVerticalGradient(g, 0, 400, RENDER.width, HORIZON_Y - 400, lerpColor(p.skyMid, LIGHTNING, f), lerpColor(p.skyHorizon, LIGHTNING, f));
    g.fillStyle(p.skyTop, 1);
    g.fillRect(0, HORIZON_Y, RENDER.width, RENDER.height - HORIZON_Y);

    this.stars.setAlpha(p.stars * (1 - f));
    this.clouds.setTint(p.fog);
    this.clouds2.setTint(p.fog);

    // La luna cruza el cielo en arco por la izquierda y se pone tras las ruinas.
    const theta = Math.PI * Math.min(1, this.progress / 0.9);
    this.moon.setPosition(420 - Math.cos(theta) * 260, 420 - Math.sin(theta) * 280);
    this.moon.setAlpha(p.moon);

    // El sol sale por delante del ciclista en el último tramo.
    const rise = Math.max(0, (this.progress - 0.84) / 0.16);
    this.sun.setPosition(1000, 640 - rise * 190);
    this.sun.setAlpha(p.sun);

    this.far.setTint(lerpColor(p.far, LIGHTNING, f * 0.6));
    this.mid.setTint(lerpColor(p.mid, LIGHTNING, f * 0.5));
    this.near.setTint(lerpColor(p.near, LIGHTNING, f * 0.4));
    for (const fog of [this.fogBack, this.fogMid, this.fogFront]) fog.setTint(p.fog);
    for (const lamp of this.lamps) lamp.post.setTint(lerpColor(p.near, LIGHTNING, f * 0.4));
  }

  // ---- estrellas -------------------------------------------------------------

  private updateTwinkles(): void {
    const base = this.phase.stars;
    for (const star of this.twinkles) {
      const phase = star.getData('phase') as number;
      const rate = star.getData('rate') as number;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(this.tAlive * rate + phase));
      star.setAlpha(base * tw);
    }
  }

  // ---- farolas ---------------------------------------------------------------

  private updateLamps(dtSec: number): void {
    // Encendidas de noche; con el sol fuera se apagan.
    const night = 1 - this.phase.sun;
    for (const lamp of this.lamps) {
      const raw = ((lamp.offset - this.roadScroll) % LAMP_PERIOD_PX + LAMP_PERIOD_PX) % LAMP_PERIOD_PX;
      const x = raw - 200;
      const visible = x > -60 && x < RENDER.width + 60;
      lamp.post.setVisible(visible).setX(x);
      lamp.cone.setVisible(visible).setX(x + 20);
      lamp.pool.setVisible(visible).setX(x + 20);
      if (!visible) continue;

      if (lamp.kind === 'flicker') {
        lamp.flickerLeft -= dtSec;
        if (lamp.flickerLeft <= 0) {
          // Encendida ratos largos, apagones cortos y nerviosos.
          lamp.lit = !lamp.lit;
          lamp.flickerLeft = lamp.lit ? 0.4 + this.rnd() * 2.2 : 0.05 + this.rnd() * 0.25;
        }
      }
      const on = lamp.kind === 'dead' ? 0 : lamp.lit ? 1 : 0;
      const buzz = lamp.kind === 'steady' ? 0.92 + Math.sin(this.tAlive * 53) * 0.04 : 1;
      const a = on * night * buzz;
      lamp.cone.setAlpha(a);
      lamp.pool.setAlpha(a * 0.9);
    }
  }

  // ---- vida del cielo: fugaces, rayos, pájaros ---------------------------------

  private updateSkyLife(dtSec: number): void {
    const p = this.phase;
    const fx = this.skyFx;
    fx.clear();

    // Estrella fugaz: rara, solo en noche cerrada.
    if (!this.shooting && p.stars > 0.8 && this.rnd() < dtSec / 45) {
      this.shooting = {
        x: 200 + this.rnd() * 800,
        y: 30 + this.rnd() * 160,
        vx: 700 + this.rnd() * 500,
        vy: 180 + this.rnd() * 160,
        life: 0.7,
      };
    }
    if (this.shooting) {
      const s = this.shooting;
      s.x += s.vx * dtSec;
      s.y += s.vy * dtSec;
      s.life -= dtSec;
      const a = Math.max(0, Math.min(1, s.life / 0.7));
      fx.lineStyle(2, 0xffffff, a * 0.9);
      fx.lineBetween(s.x, s.y, s.x - s.vx * 0.1, s.y - s.vy * 0.1);
      fx.lineStyle(1, 0xdde6ff, a * 0.4);
      fx.lineBetween(s.x - s.vx * 0.1, s.y - s.vy * 0.1, s.x - s.vx * 0.22, s.y - s.vy * 0.22);
      if (s.life <= 0) this.shooting = undefined;
    }

    // Rayos del sol: cuñas que giran despacio desde el disco.
    const rays = this.rays;
    rays.clear();
    if (p.sun > 0.05) {
      const cx = this.sun.x;
      const cy = this.sun.y;
      const spin = this.tAlive * 0.04;
      for (let i = 0; i < 7; i++) {
        const a0 = -Math.PI * 0.95 + (i / 7) * Math.PI * 0.9 + spin;
        const a1 = a0 + 0.07 + 0.03 * Math.sin(this.tAlive * 0.7 + i);
        const len = 1100;
        rays.fillStyle(0xffd090, p.sun * 0.05);
        rays.fillTriangle(cx, cy, cx + Math.cos(a0) * len, cy + Math.sin(a0) * len, cx + Math.cos(a1) * len, cy + Math.sin(a1) * len);
      }
    }

    // Pájaros al amanecer: bandadas pequeñas que cruzan el cielo.
    if (p.sun > 0.25) {
      this.nextFlockSec -= dtSec;
      if (this.nextFlockSec <= 0) {
        this.nextFlockSec = 5 + this.rnd() * 6;
        const n = 3 + Math.floor(this.rnd() * 3);
        const y0 = 120 + this.rnd() * 200;
        const speed = 60 + this.rnd() * 50;
        for (let i = 0; i < n; i++) {
          this.birds.push({
            x: RENDER.width + 40 + i * 26,
            y: y0 + (i % 2) * 14 + i * 4,
            speed,
            phase: this.rnd() * Math.PI * 2,
            size: 5 + this.rnd() * 3,
          });
        }
      }
    }
    if (this.birds.length > 0) {
      const color = lerpColor(0x1a1630, 0x3a3660, p.sun);
      fx.lineStyle(2, color, 0.9);
      for (const b of this.birds) {
        b.x -= b.speed * dtSec;
        b.y += Math.sin(this.tAlive * 0.8 + b.phase) * 4 * dtSec;
        b.phase += dtSec * 9;
        const flap = Math.sin(b.phase) * 0.5;
        fx.lineBetween(b.x, b.y, b.x - b.size, b.y - b.size * (0.6 - flap));
        fx.lineBetween(b.x, b.y, b.x + b.size, b.y - b.size * (0.6 - flap));
      }
      this.birds = this.birds.filter((b) => b.x > -40);
    }
  }
}
