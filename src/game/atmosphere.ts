import Phaser from 'phaser';
import { RENDER } from '../config';

// Atmósfera nocturna en siluetas: cielo con luna, ruinas lejanas, árboles
// muertos, matorral, carretera y niebla en tres planos. Todo dibujado por
// código a texturas generadas una vez; el scroll es proporcional a la
// velocidad del jugador y la niebla deriva sola con el "viento".

const HORIZON_Y = 600;

// Paleta (de atrás hacia adelante, cada capa más oscura).
const SKY_TOP = 0x06081a;
const SKY_MID = 0x131a38;
const SKY_HORIZON = 0x3a4468;
const MOON_DISC = 0xdfe9cc;
const MOON_GLOW = 0xcfe3c0;
const STAR = 0xcdd8f0;
const CLOUD = 0x8fa0c8;
const FAR_SIL = 0x131730;
const MID_SIL = 0x0b0e20;
const NEAR_SIL = 0x06070f;
const ROAD_BASE = 0x0d0f1c;
const ROAD_EDGE = 0x353d63;
const ROAD_DASH = 0x343b60;
const ROAD_CRACK = 0x04050b;
const FOG = 0x7285ad;

/** LCG determinista: el paisaje es el mismo en cada arranque. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
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
  steps = 48,
): void {
  const a = Phaser.Display.Color.ValueToColor(from);
  const b = Phaser.Display.Color.ValueToColor(to);
  const strip = h / steps;
  for (let i = 0; i < steps; i++) {
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, steps - 1, i);
    g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
    g.fillRect(x, y + i * strip, w, strip + 1);
  }
}

function makeSkyTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const rnd = lcg(1337);

  fillVerticalGradient(g, 0, 0, RENDER.width, 400, SKY_TOP, SKY_MID);
  fillVerticalGradient(g, 0, 400, RENDER.width, HORIZON_Y - 400, SKY_MID, SKY_HORIZON);
  g.fillStyle(SKY_TOP, 1);
  g.fillRect(0, HORIZON_Y, RENDER.width, RENDER.height - HORIZON_Y);

  // Estrellas, más densas arriba.
  for (let i = 0; i < 90; i++) {
    const x = rnd() * RENDER.width;
    const y = rnd() * rnd() * 400;
    g.fillStyle(STAR, 0.15 + rnd() * 0.55);
    g.fillRect(x, y, rnd() < 0.2 ? 2 : 1, rnd() < 0.2 ? 2 : 1);
  }

  // Luna baja sobre el lado de la horda, con halo suave.
  const mx = 330;
  const my = 175;
  for (let i = 8; i >= 1; i--) {
    g.fillStyle(MOON_GLOW, 0.016 * (9 - i));
    g.fillCircle(mx, my, 58 + i * 13);
  }
  g.fillStyle(MOON_DISC, 1);
  g.fillCircle(mx, my, 58);
  g.fillStyle(0xc3d4ae, 0.55);
  g.fillCircle(mx - 16, my - 10, 9);
  g.fillCircle(mx + 12, my + 8, 6);
  g.fillCircle(mx - 2, my + 22, 5);

  // Jirones de nube cruzando la zona de la luna.
  g.fillStyle(CLOUD, 0.06);
  g.fillEllipse(mx + 40, my - 30, 280, 16);
  g.fillEllipse(mx - 60, my + 26, 340, 14);
  g.fillEllipse(820, 120, 380, 12);
  g.fillEllipse(1050, 240, 300, 10);

  g.generateTexture('atm-sky', RENDER.width, RENDER.height);
  g.destroy();
}

function makeFarTexture(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const H = 260;
  g.fillStyle(FAR_SIL, 1);

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
    // Tope roto: dientes desiguales.
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
  g.lineStyle(2, FAR_SIL, 1);
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
  g.lineStyle(3, MID_SIL, 1);
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
  const B = H; // línea de suelo de la capa

  drawDeadTree(g, 70, B, 170, 14);
  drawDeadTree(g, 340, B, 140, -10);
  drawDeadTree(g, 560, B, 185, 8);

  // Coche abandonado con el cofre abierto.
  g.fillStyle(MID_SIL, 1);
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
  const graves: Array<[number, number]> = [
    [262, 18],
    [282, 24],
    [304, 15],
  ];
  for (const [gx, gh] of graves) {
    g.fillRect(gx, B - gh, 12, gh);
    g.fillCircle(gx + 6, B - gh, 6);
  }
  g.fillRect(324, B - 30, 4, 30);
  g.fillRect(317, B - 22, 18, 4);

  // Valla vencida.
  const posts = [430, 456, 482, 508];
  posts.forEach((px, i) => {
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
  g.fillStyle(NEAR_SIL, 1);

  // Matorral bajo: circunferencias solapadas.
  for (let i = 0; i < 30; i++) {
    const x = rnd() * 512;
    const r = 9 + rnd() * 15;
    g.fillCircle(x, H - r * 0.4, r);
  }
  // Escombros.
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

  // Línea central desgastada.
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

  // Grietas.
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

  // Manchas oscuras y gravilla.
  g.fillStyle(0x170d13, 0.5);
  g.fillEllipse(180, 92, 60, 14);
  g.fillEllipse(400, 40, 44, 10);
  for (let i = 0; i < 14; i++) {
    g.fillStyle(0x23284a, 0.6);
    g.fillRect(rnd() * 512, 12 + rnd() * 108, 2, 2);
  }

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
    g.fillStyle(FOG, 0.035);
    g.fillCircle(x, y, r);
  }
  for (let i = 0; i < 5; i++) {
    g.fillStyle(FOG, 0.03);
    g.fillEllipse(rnd() * 512, 70 + rnd() * 50, 220 + rnd() * 160, 26 + rnd() * 18);
  }
  g.generateTexture('atm-fog', 512, 160);
  g.destroy();
}

function ensureTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('atm-sky')) return;
  makeSkyTexture(scene);
  makeFarTexture(scene);
  makeMidTexture(scene);
  makeNearTexture(scene);
  makeRoadTexture(scene);
  makeFogTexture(scene);
}

export class Atmosphere {
  private readonly far: Phaser.GameObjects.TileSprite;
  private readonly mid: Phaser.GameObjects.TileSprite;
  private readonly near: Phaser.GameObjects.TileSprite;
  private readonly road: Phaser.GameObjects.TileSprite;
  private readonly fogBack: Phaser.GameObjects.TileSprite;
  private readonly fogMid: Phaser.GameObjects.TileSprite;
  private readonly fogFront: Phaser.GameObjects.TileSprite;

  constructor(scene: Phaser.Scene, withFrontFog = true) {
    ensureTextures(scene);
    const w = RENDER.width;

    scene.add.image(0, 0, 'atm-sky').setOrigin(0, 0);
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

    // Niebla frontal, por delante de los actores (depth > actores, < HUD).
    this.fogFront = scene.add
      .tileSprite(0, HORIZON_Y - 30, w, 160, 'atm-fog')
      .setOrigin(0, 0)
      .setAlpha(withFrontFog ? 0.18 : 0)
      .setDepth(4);
  }

  update(playerSpeedMps: number, dtSec: number): void {
    const px = playerSpeedMps * RENDER.groundPxPerMeter * dtSec;
    this.road.tilePositionX += px;
    this.near.tilePositionX += px * RENDER.nearFactor;
    this.mid.tilePositionX += px * 0.38;
    this.far.tilePositionX += px * 0.12;
    // La niebla scrollea poco con el mundo y deriva sola con el viento.
    this.fogBack.tilePositionX += px * 0.1 + 2.5 * dtSec;
    this.fogMid.tilePositionX += px * 0.35 + 5 * dtSec;
    this.fogFront.tilePositionX += px * 0.8 + 9 * dtSec;
  }
}
