import Phaser from 'phaser';
import { RENDER } from '../../config';
import { gapToPx, hordeScale } from '../gapMapping';
import { lcg } from '../rng';
import { Zombie } from './Zombie';

/**
 * La manada: posición en pantalla desde el gap (mapeo asintótico), escala y
 * alpha con la distancia, tropiezo colectivo durante la gracia post-catch y
 * un amague hacia adelante al atraparte.
 */
export class Horde {
  private readonly container: Phaser.GameObjects.Container;
  private readonly zombies: Zombie[] = [];
  private lungePx = 0;

  constructor(scene: Phaser.Scene, count = 7) {
    this.container = scene.add.container(0, RENDER.groundY).setDepth(2);

    // Charco de luz de luna tras la manada: garantiza contraste donde sea
    // que esté, y vende el contraluz.
    if (!scene.textures.exists('horde-glow')) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      for (let i = 6; i >= 1; i--) {
        g.fillStyle(0xb8cfe0, 0.05);
        g.fillEllipse(190, 60, 60 + i * 52, 22 + i * 16);
      }
      g.generateTexture('horde-glow', 380, 120);
      g.destroy();
    }
    const glow = scene.add
      .image(-80, -34, 'horde-glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.85);
    this.container.add(glow);

    const rnd = lcg(2024);
    for (let i = 0; i < count; i++) {
      const x = -160 + (160 / (count - 1)) * i + (rnd() * 10 - 5);
      const zombie = new Zombie(scene, i + 1, x, rnd() * 4 - 2);
      this.container.add(zombie.gfx);
      this.zombies.push(zombie);
    }
  }

  update(dt: number, gapM: number, zombieMps: number, stumbling: boolean): void {
    this.lungePx *= Math.exp(-9 * dt);
    this.container.x = RENDER.playerX - 30 - gapToPx(gapM) + this.lungePx;
    const s = hordeScale(gapM);
    this.container.setScale(s, stumbling ? s * 0.94 : s);
    this.container.setAlpha(gapM > 100 ? 0.85 : 1);
    for (const zombie of this.zombies) zombie.update(dt, zombieMps, stumbling);
  }

  lunge(): void {
    this.lungePx = 34;
  }
}
