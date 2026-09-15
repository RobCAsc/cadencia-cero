import Phaser from 'phaser';
import { RENDER } from '../../config';

// Tu fantasma: dónde ibas la última vez con este mismo programa, en este
// mismo minuto. Una silueta pálida delante o detrás de ti; competir contigo
// mismo es el motivador más fuerte para quien pedalea solo, y no toca la
// prescripción.

const PALE = 0x9fb3c8;
const WHEEL_R = 15;
const AXLE_Y = -WHEEL_R;

export class Ghost {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private wheelAngle = 0;
  private tAlive = 0;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics({ x: RENDER.playerX, y: RENDER.groundY }).setDepth(2).setAlpha(0.3);
    this.gfx.setScale(1.4);
    this.gfx.setVisible(false);
  }

  /** @param x posición en pantalla, o undefined para ocultarlo. */
  update(dt: number, x: number | undefined, speedMps: number): void {
    if (x === undefined) {
      this.gfx.setVisible(false);
      return;
    }
    this.tAlive += dt;
    this.wheelAngle += (speedMps / 0.35) * dt;
    this.gfx.setVisible(true);
    this.gfx.x += (x - this.gfx.x) * Math.min(1, dt * 4); // se desliza, no salta
    this.draw();
  }

  private draw(): void {
    const g = this.gfx;
    g.clear();
    const bob = Math.sin(this.tAlive * 6) * 0.8;
    for (const ax of [-26, 27]) {
      g.lineStyle(3, PALE, 1);
      g.strokeCircle(ax, AXLE_Y, WHEEL_R);
      g.lineStyle(1, PALE, 0.8);
      for (let s = 0; s < 3; s++) {
        const a = this.wheelAngle + (s * Math.PI * 2) / 3;
        g.lineBetween(ax, AXLE_Y, ax + Math.cos(a) * (WHEEL_R - 4), AXLE_Y + Math.sin(a) * (WHEEL_R - 4));
      }
    }
    g.lineStyle(3, PALE, 1);
    g.lineBetween(2, -20, -26, AXLE_Y);
    g.lineBetween(2, -20, -12, -50);
    g.lineBetween(-12, -50, -26, AXLE_Y);
    g.lineBetween(2, -20, 22, -44);
    g.lineBetween(22, -44, 27, AXLE_Y);
    g.lineBetween(-12, -50, 22, -44);
    // Torso, brazo y cabeza, sin piernas: una silueta que se reconoce y no compite con la tuya.
    g.lineStyle(5, PALE, 1);
    g.lineBetween(-10, -52 + bob, 8, -78 + bob);
    g.lineStyle(3.5, PALE, 1);
    g.lineBetween(8, -78 + bob, 25, -48);
    g.fillStyle(PALE, 1);
    g.fillCircle(15, -86 + bob, 6);
  }
}
