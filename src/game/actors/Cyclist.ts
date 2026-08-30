import Phaser from 'phaser';
import { RENDER } from '../../config';

// El ciclista, redibujado por frame: las bielas giran con TU cadencia real,
// las piernas las siguen con IK de dos huesos, las ruedas con la velocidad y
// el faro delantero corta la noche. Cuando dejas de pedalear, se queda quieto
// respirando — y la horda sigue caminando.

const BODY = 0x131a2e;
const BIKE = 0x212e4e;
const RIM = 0x2c3c63;
const TIRE = 0x0c1120;
const ACCENT = 0x35d0c0;
const REAR_LIGHT = 0xff4444;
const LIGHT = 0xffe9b0;

const WHEEL_R = 15;
const AXLE_Y = -WHEEL_R;
const REAR_AXLE = { x: -26, y: AXLE_Y };
const FRONT_AXLE = { x: 27, y: AXLE_Y };
const BB = { x: 2, y: -20 };
const SEAT = { x: -12, y: -50 };
const HEAD_TUBE = { x: 22, y: -44 };
const BAR = { x: 25, y: -48 };
const CRANK_R = 8;
const HIP = { x: -10, y: -52 };
const SHOULDER = { x: 8, y: -78 };
const THIGH = 23;
const SHIN = 22;

interface Point {
  x: number;
  y: number;
}

/** IK de dos huesos: rodilla siempre arriba/adelante, como al pedalear. */
function solveKnee(hip: Point, target: Point, l1: number, l2: number): Point {
  const dx = target.x - hip.x;
  const dy = target.y - hip.y;
  const d = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx);
  const q = Math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d));
  const a: Point = { x: hip.x + Math.cos(base - q) * l1, y: hip.y + Math.sin(base - q) * l1 };
  const b: Point = { x: hip.x + Math.cos(base + q) * l1, y: hip.y + Math.sin(base + q) * l1 };
  return a.y < b.y ? a : b;
}

export class Cyclist {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private crankAngle = 0;
  private wheelAngle = 0;
  private tAlive = 0;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics({ x: RENDER.playerX, y: RENDER.groundY }).setDepth(3);
    this.gfx.setScale(1.15);
  }

  update(dt: number, rpm: number, speedMps: number): void {
    this.tAlive += dt;
    this.crankAngle += (rpm / 60) * Math.PI * 2 * dt;
    this.wheelAngle += (speedMps / 0.35) * dt;
    this.draw(rpm);
  }

  private draw(rpm: number): void {
    const g = this.gfx;
    g.clear();

    // Balanceo lateral sutil por pedalada; respiración si está parado.
    const pedaling = rpm > 5;
    const lift = pedaling
      ? Math.sin(this.crankAngle * 2) * Math.min(1.6, 0.6 + (rpm / 60) * 0.5)
      : Math.sin(this.tAlive * 1.6) * 0.7;
    g.rotation = pedaling ? Math.sin(this.crankAngle) * 0.01 : 0;

    // Faro delantero.
    g.fillStyle(LIGHT, 0.13);
    g.fillTriangle(28, -41, 215, -36, 215, 2);
    g.fillStyle(LIGHT, 0.09);
    g.fillTriangle(28, -41, 215, -28, 215, -8);
    g.fillStyle(LIGHT, 1);
    g.fillCircle(28, -41, 2.2);

    const pedalNear: Point = {
      x: BB.x + Math.cos(this.crankAngle) * CRANK_R,
      y: BB.y + Math.sin(this.crankAngle) * CRANK_R,
    };
    const pedalFar: Point = {
      x: BB.x - Math.cos(this.crankAngle) * CRANK_R,
      y: BB.y - Math.sin(this.crankAngle) * CRANK_R,
    };
    const hip: Point = { x: HIP.x, y: HIP.y + lift * 0.4 };
    const shoulder: Point = { x: SHOULDER.x, y: SHOULDER.y + lift };

    // Pierna y biela lejanas.
    g.lineStyle(2.5, BIKE, 0.8);
    g.lineBetween(BB.x, BB.y, pedalFar.x, pedalFar.y);
    const kneeFar = solveKnee(hip, pedalFar, THIGH, SHIN);
    g.lineStyle(4.5, BODY, 0.7);
    g.lineBetween(hip.x, hip.y, kneeFar.x, kneeFar.y);
    g.lineBetween(kneeFar.x, kneeFar.y, pedalFar.x, pedalFar.y);

    // Ruedas.
    for (const axle of [REAR_AXLE, FRONT_AXLE]) {
      g.lineStyle(3.5, TIRE, 1);
      g.strokeCircle(axle.x, axle.y, WHEEL_R);
      g.lineStyle(1.4, RIM, 1);
      g.strokeCircle(axle.x, axle.y, WHEEL_R - 3.5);
      g.lineStyle(1, RIM, 0.9);
      for (let s = 0; s < 5; s++) {
        const a = this.wheelAngle + (s * Math.PI * 2) / 5;
        g.lineBetween(
          axle.x,
          axle.y,
          axle.x + Math.cos(a) * (WHEEL_R - 4),
          axle.y + Math.sin(a) * (WHEEL_R - 4),
        );
      }
      g.fillStyle(RIM, 1);
      g.fillCircle(axle.x, axle.y, 2);
    }

    // Cuadro.
    g.lineStyle(3, BIKE, 1);
    g.lineBetween(BB.x, BB.y, REAR_AXLE.x, REAR_AXLE.y);
    g.lineBetween(BB.x, BB.y, SEAT.x, SEAT.y);
    g.lineBetween(SEAT.x, SEAT.y, REAR_AXLE.x, REAR_AXLE.y);
    g.lineBetween(BB.x, BB.y, HEAD_TUBE.x, HEAD_TUBE.y);
    g.lineBetween(HEAD_TUBE.x, HEAD_TUBE.y, FRONT_AXLE.x, FRONT_AXLE.y);
    g.lineBetween(SEAT.x, SEAT.y, HEAD_TUBE.x, HEAD_TUBE.y);
    g.lineBetween(HEAD_TUBE.x, HEAD_TUBE.y, BAR.x, BAR.y);
    g.lineBetween(BAR.x, BAR.y, BAR.x + 4, BAR.y + 5);
    // Sillín y luz trasera parpadeante.
    g.lineStyle(3.5, BODY, 1);
    g.lineBetween(SEAT.x - 5, SEAT.y - 1, SEAT.x + 3, SEAT.y - 1);
    g.fillStyle(REAR_LIGHT, Math.sin(this.tAlive * 7) > 0 ? 1 : 0.15);
    g.fillCircle(SEAT.x - 6, SEAT.y + 4, 1.8);

    // Biela cercana.
    g.lineStyle(2.5, BIKE, 1);
    g.lineBetween(BB.x, BB.y, pedalNear.x, pedalNear.y);
    g.lineStyle(2, TIRE, 1);
    g.lineBetween(pedalNear.x - 3, pedalNear.y, pedalNear.x + 3, pedalNear.y);

    // Torso.
    g.fillStyle(BODY, 1);
    g.fillPoints(
      [
        { x: hip.x - 4, y: hip.y },
        { x: hip.x + 5, y: hip.y + 2 },
        { x: shoulder.x + 5, y: shoulder.y + 2 },
        { x: shoulder.x - 5, y: shoulder.y - 2 },
      ],
      true,
    );

    // Pierna cercana.
    const kneeNear = solveKnee(hip, pedalNear, THIGH, SHIN);
    g.lineStyle(5, BODY, 1);
    g.lineBetween(hip.x, hip.y, kneeNear.x, kneeNear.y);
    g.lineBetween(kneeNear.x, kneeNear.y, pedalNear.x, pedalNear.y);

    // Brazo al manillar.
    const elbow: Point = {
      x: (shoulder.x + BAR.x) / 2 + 1,
      y: (shoulder.y + BAR.y) / 2 + 4,
    };
    g.lineStyle(3.5, BODY, 1);
    g.lineBetween(shoulder.x, shoulder.y, elbow.x, elbow.y);
    g.lineBetween(elbow.x, elbow.y, BAR.x, BAR.y);

    // Cabeza con casco.
    const headX = shoulder.x + 7;
    const headY = shoulder.y - 8 + lift * 0.3;
    g.fillStyle(BODY, 1);
    g.fillCircle(headX, headY, 6);
    g.fillStyle(BIKE, 1);
    g.beginPath();
    g.arc(headX, headY - 1.5, 7, Math.PI, 0, false);
    g.fillPath();
    g.lineStyle(1.4, ACCENT, 0.9);
    g.beginPath();
    g.arc(headX, headY - 1.5, 5.2, Math.PI * 1.15, Math.PI * 1.85, false);
    g.strokePath();
  }
}
