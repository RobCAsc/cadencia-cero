import Phaser from 'phaser';
import { lcg } from '../rng';

// Silueta articulada de zombie, redibujada por frame: torso vencido hacia
// adelante, brazos extendidos con las manos colgando, piernas que se
// arrastran y ojos encendidos. Cada individuo sale distinto de su semilla.

// Tintes "iluminados por luna": un tier más claros que el fondo para que la
// silueta lea sobre la carretera oscura.
const TINTS = [0x2c3527, 0x2e2a3d, 0x2b3344, 0x3a2f33, 0x2f3b31];
const EYES = [0xff5544, 0xff4433, 0xff7a4a];

export class Zombie {
  readonly gfx: Phaser.GameObjects.Graphics;

  private readonly h: number;
  private readonly tint: number;
  private readonly eyeColor: number;
  private readonly baseLean: number;
  private readonly armTheta: number;
  private readonly strideScale: number;
  private walkPhase: number;

  constructor(scene: Phaser.Scene, seed: number, x: number, y: number) {
    const rnd = lcg(seed * 7919 + 17);
    this.h = 74 + rnd() * 20;
    this.tint = TINTS[Math.floor(rnd() * TINTS.length)] ?? TINTS[0]!;
    this.eyeColor = EYES[Math.floor(rnd() * EYES.length)] ?? EYES[0]!;
    this.baseLean = 0.18 + rnd() * 0.24;
    this.armTheta = -0.12 + rnd() * 0.3;
    this.strideScale = 0.8 + rnd() * 0.4;
    this.walkPhase = rnd() * Math.PI * 2;
    this.gfx = scene.add.graphics({ x, y });
  }

  update(dt: number, mps: number, stumbling: boolean): void {
    const cyclesPerSec = (0.55 + mps * 0.22) * this.strideScale * (stumbling ? 0.55 : 1);
    this.walkPhase += cyclesPerSec * Math.PI * 2 * dt;
    this.draw(mps, stumbling);
  }

  private draw(mps: number, stumbling: boolean): void {
    const g = this.gfx;
    const h = this.h;
    const p = this.walkPhase;
    const lw = h / 15;
    g.clear();

    const bounce = -Math.abs(Math.sin(p)) * 2.6 + (stumbling ? 6 : 0);
    const hipY = -h * 0.46 + bounce;
    const lean = this.baseLean + Math.sin(p * 0.5) * 0.05 + (stumbling ? 0.3 : 0);
    const torsoLen = h * 0.36;
    const shX = Math.sin(lean) * torsoLen;
    const shY = hipY - Math.cos(lean) * torsoLen;
    const headTilt = 0.3 + Math.sin(p * 0.31) * 0.16;
    const neck = h * 0.12;
    const headX = shX + Math.sin(lean + headTilt) * neck;
    const headY = shY - Math.cos(lean + headTilt) * neck;
    const headR = h * 0.1;
    const strideAmp = Math.min(15, 6 + mps * 1.1) * (stumbling ? 0.6 : 1);

    const drawArm = (side: number, alpha: number): void => {
      const ul = h * 0.21;
      const fl = h * 0.19;
      const theta =
        this.armTheta + side * 0.09 + Math.sin(p * 0.9 + side) * 0.1 + (stumbling ? 0.55 : 0);
      const droop = 0.68 + Math.sin(p * 0.7 + side * 2) * 0.16;
      const ex = shX + Math.cos(theta) * ul;
      const ey = shY + Math.sin(theta) * ul;
      g.lineStyle(lw * 0.8, this.tint, alpha);
      g.lineBetween(shX, shY, ex, ey);
      g.lineBetween(ex, ey, ex + Math.cos(theta + droop) * fl, ey + Math.sin(theta + droop) * fl);
    };

    const drawLeg = (offset: number, alpha: number): void => {
      const fp = p + offset;
      const footX = Math.cos(fp) * strideAmp;
      const footY = -Math.max(0, Math.sin(fp)) * 5;
      const kneeX = footX / 2 + 4.5;
      const kneeY = (hipY + footY) / 2 - 1;
      g.lineStyle(lw, this.tint, alpha);
      g.lineBetween(0, hipY, kneeX, kneeY);
      g.lineBetween(kneeX, kneeY, footX, footY);
    };

    // De atrás hacia adelante: brazo y pierna lejanos, cuerpo, cercanos, cabeza.
    drawArm(-1, 0.72);
    drawLeg(Math.PI, 0.72);

    g.fillStyle(this.tint, 1);
    g.fillPoints(
      [
        { x: -h * 0.075, y: hipY },
        { x: h * 0.075, y: hipY },
        { x: shX + h * 0.09, y: shY },
        { x: shX - h * 0.09, y: shY },
      ],
      true,
    );
    // Jirones de ropa colgando de la cintura.
    for (const [dx, len] of [
      [-3, 7],
      [1, 9],
      [4, 6],
    ] as const) {
      const sway = Math.sin(p + dx) * 1.6;
      g.fillTriangle(dx - 2, hipY, dx + 2, hipY, dx + sway, hipY + len);
    }

    drawLeg(0, 1);
    drawArm(1, 1);

    g.fillStyle(this.tint, 1);
    g.fillCircle(headX, headY, headR);

    // Ojos encendidos mirándote.
    const eyeY = headY - headR * 0.15;
    for (const ex of [headX + headR * 0.28, headX + headR * 0.66]) {
      g.fillStyle(this.eyeColor, 0.25);
      g.fillCircle(ex, eyeY, 3.2);
      g.fillStyle(this.eyeColor, 1);
      g.fillCircle(ex, eyeY, 1.5);
    }
  }
}
