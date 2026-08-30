import Phaser from 'phaser';
import { RENDER } from '../config';

// Paleta nocturna del placeholder.
const FAR_COLOR = 0x16213e;
const NEAR_COLOR = 0x0f3460;
const GROUND_COLOR = 0x101018;
const GROUND_EDGE = 0x23233a;
const GROUND_DASH = 0x2a2a3e;

const FAR_KEY = 'px-far';
const NEAR_KEY = 'px-near';
const GROUND_KEY = 'px-ground';

const FAR_H = 220;
const NEAR_H = 140;
const GROUND_H = RENDER.height - RENDER.groundY + 40; // 120

function ensureTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(GROUND_KEY)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  // Silueta lejana: bloques tipo skyline.
  const farX = [0, 70, 135, 215, 265, 355, 420, 480];
  const farW = [60, 55, 70, 40, 80, 55, 50, 32];
  const farH = [90, 150, 70, 180, 110, 60, 140, 95];
  g.fillStyle(FAR_COLOR, 1);
  farX.forEach((x, i) => g.fillRect(x, FAR_H - (farH[i] ?? 60), farW[i] ?? 40, farH[i] ?? 60));
  g.generateTexture(FAR_KEY, 512, FAR_H);
  g.clear();

  // Matorral cercano: bloques bajos.
  const nearX = [10, 90, 160, 250, 330, 410, 470];
  const nearW = [50, 40, 60, 45, 55, 35, 42];
  const nearH = [50, 80, 40, 95, 60, 75, 45];
  g.fillStyle(NEAR_COLOR, 1);
  nearX.forEach((x, i) => g.fillRect(x, NEAR_H - (nearH[i] ?? 50), nearW[i] ?? 40, nearH[i] ?? 50));
  g.generateTexture(NEAR_KEY, 512, NEAR_H);
  g.clear();

  // Suelo: franja oscura con borde y marcas de carril.
  g.fillStyle(GROUND_COLOR, 1);
  g.fillRect(0, 0, 512, GROUND_H);
  g.fillStyle(GROUND_EDGE, 1);
  g.fillRect(0, 0, 512, 4);
  g.fillStyle(GROUND_DASH, 1);
  for (let x = 0; x < 512; x += 128) g.fillRect(x, 56, 64, 6);
  g.generateTexture(GROUND_KEY, 512, GROUND_H);
  g.destroy();
}

/** Tres franjas con scroll proporcional a la velocidad del jugador. */
export class Parallax {
  private readonly far: Phaser.GameObjects.TileSprite;
  private readonly near: Phaser.GameObjects.TileSprite;
  private readonly ground: Phaser.GameObjects.TileSprite;

  constructor(scene: Phaser.Scene) {
    ensureTextures(scene);
    const groundTop = RENDER.groundY - 40;
    this.far = scene.add
      .tileSprite(0, groundTop - FAR_H, RENDER.width, FAR_H, FAR_KEY)
      .setOrigin(0, 0);
    this.near = scene.add
      .tileSprite(0, groundTop - NEAR_H, RENDER.width, NEAR_H, NEAR_KEY)
      .setOrigin(0, 0);
    this.ground = scene.add
      .tileSprite(0, groundTop, RENDER.width, GROUND_H, GROUND_KEY)
      .setOrigin(0, 0);
  }

  update(playerSpeedMps: number, dtSec: number): void {
    const px = playerSpeedMps * RENDER.groundPxPerMeter * dtSec;
    this.ground.tilePositionX += px;
    this.near.tilePositionX += px * RENDER.nearFactor;
    this.far.tilePositionX += px * RENDER.farFactor;
  }
}
