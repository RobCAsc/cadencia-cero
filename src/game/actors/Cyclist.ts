import Phaser from 'phaser';
import { RENDER } from '../../config';
import { slopeRotation } from '../gapMapping';

// El ciclista, redibujado por frame: las bielas giran con TU cadencia real,
// las piernas las siguen con IK de dos huesos, las ruedas con la velocidad y
// el faro delantero corta la noche. Cuando dejas de pedalear, se queda quieto
// respirando — y la horda sigue caminando.

// Dos tonos más claros que el fondo cercano (0x06070f) y que el asfalto: el
// rider se leía como una sombra más. Encima, un borde de luz de luna en la
// silueta, bandas reflectantes y un charco de luz detrás, como la horda.
const BODY = 0x2e3d63;
const JACKET = 0x4d629a;
const BIKE = 0x3f5384;
const RIM = 0x7f96c4;
const TIRE = 0x1b2238;
const ACCENT = 0x5ff0dc;
const REAR_LIGHT = 0xff4444;
const LIGHT = 0xffe9b0;
/** Luz de luna en el borde de la silueta y en lo reflectante. */
const RIM_LIGHT = 0xc4d6ec;
const REFLECTIVE = 0xeaf2ff;
const RIM_LIGHT_ALPHA = 0.55;
const RIM_LIGHT_EXTRA_W = 2.6;

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
  private readonly glow: Phaser.GameObjects.Image;
  private crankAngle = 0;
  private wheelAngle = 0;
  private tAlive = 0;
  /** 0 = erguido y tranquilo, 1 = recogido sobre el manillar, a tope. Con inercia. */
  private tuck = 0;
  private speedMps = 0;
  private slope = 0;

  constructor(scene: Phaser.Scene) {
    // Charco de luz de luna tras el rider: garantiza contraste con el fondo
    // cercano, que en noche cerrada es casi negro.
    if (!scene.textures.exists('rider-glow')) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      for (let i = 7; i >= 1; i--) {
        g.fillStyle(0xb8cfe0, 0.045);
        g.fillEllipse(160, 90, 40 + i * 34, 30 + i * 22);
      }
      g.generateTexture('rider-glow', 320, 180);
      g.destroy();
    }
    this.glow = scene.add
      .image(RENDER.playerX - 6, RENDER.groundY - 62, 'rider-glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.9)
      .setDepth(2.6);
    this.gfx = scene.add.graphics({ x: RENDER.playerX, y: RENDER.groundY }).setDepth(3);
    this.gfx.setScale(1.4);
  }

  /** Ángulo de biela acumulado (rad): la cámara se balancea con la pedalada. */
  get crank(): number {
    return this.crankAngle;
  }

  /**
   * @param effort01 fracción de esfuerzo cardíaco: la postura la cuenta. En
   * Z1 el rider va erguido; en Z4-Z5 se recoge sobre el manillar.
   */
  update(dt: number, rpm: number, speedMps: number, effort01 = 0, slope = 0): void {
    this.tAlive += dt;
    this.crankAngle += (rpm / 60) * Math.PI * 2 * dt;
    this.wheelAngle += (speedMps / 0.35) * dt;
    this.speedMps = speedMps;
    this.slope = slope;
    const targetTuck = Math.max(0, Math.min(1, (effort01 - 0.45) / 0.45));
    this.tuck += (targetTuck - this.tuck) * Math.min(1, dt * 0.8);
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
    // Balanceo por pedalada, y la bici apoyada en la pendiente de la carretera.
    g.rotation = (pedaling ? Math.sin(this.crankAngle) * 0.01 : 0) + slopeRotation(this.slope);
    const tuck = this.tuck;

    // Faro delantero.
    g.fillStyle(LIGHT, 0.16);
    g.fillTriangle(28, -41, 225, -37, 225, 4);
    g.fillStyle(LIGHT, 0.11);
    g.fillTriangle(28, -41, 225, -29, 225, -8);
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
    // Recogido: los hombros bajan y avanzan hacia el manillar.
    const shoulder: Point = { x: SHOULDER.x + tuck * 6, y: SHOULDER.y + lift + tuck * 9 };

    // Pierna y biela lejanas.
    g.lineStyle(2.5, BIKE, 0.8);
    g.lineBetween(BB.x, BB.y, pedalFar.x, pedalFar.y);
    const kneeFar = solveKnee(hip, pedalFar, THIGH, SHIN);
    g.lineStyle(4.5, BODY, 0.7);
    g.lineBetween(hip.x, hip.y, kneeFar.x, kneeFar.y);
    g.lineBetween(kneeFar.x, kneeFar.y, pedalFar.x, pedalFar.y);
    g.fillStyle(REFLECTIVE, 0.6);
    g.fillCircle(pedalFar.x, pedalFar.y - 3, 1.6); // banda reflectante del tobillo lejano

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

    // Chaqueta: ondea hacia atrás con la velocidad.
    const flap = Math.min(1, this.speedMps / 9);
    const wave = Math.sin(this.tAlive * 15) * 2 * flap;
    const jacketTail: Point = { x: hip.x - 9 - flap * 8, y: hip.y - 8 + wave };
    g.fillStyle(JACKET, 0.9);
    g.fillTriangle(shoulder.x - 4, shoulder.y + 2, hip.x - 3, hip.y - 2, jacketTail.x, jacketTail.y);

    const kneeNear = solveKnee(hip, pedalNear, THIGH, SHIN);
    const elbow: Point = {
      x: (shoulder.x + BAR.x) / 2 + 1,
      y: (shoulder.y + BAR.y) / 2 + 4 + tuck * 5,
    };
    const headX = shoulder.x + 7 + tuck * 2;
    const headY = shoulder.y - 8 + lift * 0.3 + tuck * 3;
    const torso: Point[] = [
      { x: hip.x - 4, y: hip.y },
      { x: hip.x + 5, y: hip.y + 2 },
      { x: shoulder.x + 5, y: shoulder.y + 2 },
      { x: shoulder.x - 5, y: shoulder.y - 2 },
    ];

    // Borde de luz de luna: la silueta entera, un poco más ancha y clara,
    // debajo de la figura. Es lo que la separa del fondo cuando la noche cierra.
    g.lineStyle(5 + RIM_LIGHT_EXTRA_W, RIM_LIGHT, RIM_LIGHT_ALPHA);
    g.lineBetween(hip.x, hip.y, kneeNear.x, kneeNear.y);
    g.lineBetween(kneeNear.x, kneeNear.y, pedalNear.x, pedalNear.y);
    g.lineStyle(3.5 + RIM_LIGHT_EXTRA_W, RIM_LIGHT, RIM_LIGHT_ALPHA);
    g.lineBetween(shoulder.x, shoulder.y, elbow.x, elbow.y);
    g.lineBetween(elbow.x, elbow.y, BAR.x, BAR.y);
    g.lineStyle(RIM_LIGHT_EXTRA_W, RIM_LIGHT, RIM_LIGHT_ALPHA);
    g.strokePoints(torso, true, true);
    g.strokeCircle(headX, headY - 0.5, 7.4);
    g.strokeTriangle(shoulder.x - 4, shoulder.y + 2, hip.x - 3, hip.y - 2, jacketTail.x, jacketTail.y);

    // Torso.
    g.fillStyle(BODY, 1);
    g.fillPoints(torso, true);
    // Banda reflectante en la espalda, como la de cualquier chaleco.
    g.lineStyle(1.6, REFLECTIVE, 0.75);
    g.lineBetween(hip.x - 2, hip.y - 12, shoulder.x - 3, shoulder.y + 6);

    // Pierna cercana, con banda reflectante en el tobillo.
    g.lineStyle(5, BODY, 1);
    g.lineBetween(hip.x, hip.y, kneeNear.x, kneeNear.y);
    g.lineBetween(kneeNear.x, kneeNear.y, pedalNear.x, pedalNear.y);
    g.fillStyle(REFLECTIVE, 0.95);
    g.fillCircle(pedalNear.x, pedalNear.y - 3, 1.9);

    // Brazo al manillar: cuanto más recogido, más doblado el codo.
    g.lineStyle(3.5, BODY, 1);
    g.lineBetween(shoulder.x, shoulder.y, elbow.x, elbow.y);
    g.lineBetween(elbow.x, elbow.y, BAR.x, BAR.y);

    // Cabeza con casco: recogido, la cabeza baja y mira al asfalto.
    g.fillStyle(BODY, 1);
    g.fillCircle(headX, headY, 6);
    g.fillStyle(JACKET, 1);
    g.beginPath();
    g.arc(headX, headY - 1.5, 7, Math.PI, 0, false);
    g.fillPath();
    g.lineStyle(1.6, ACCENT, 1);
    g.beginPath();
    g.arc(headX, headY - 1.5, 5.2, Math.PI * 1.15, Math.PI * 1.85, false);
    g.strokePath();
  }
}
