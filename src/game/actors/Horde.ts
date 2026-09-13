import Phaser from 'phaser';
import { RENDER } from '../../config';
import { gapToPx, hordeScale } from '../gapMapping';
import { lcg } from '../rng';
import { Zombie } from './Zombie';

/** Bajo esta velocidad la horda se arrastra; a partir de la superior corre a pleno. */
const WALK_KPH = 15;
const RUN_KPH = 28;
const BASE_COUNT = 7;
const MAX_COUNT = 12;

/**
 * La manada: posición en pantalla desde el gap (mapeo asintótico), escala y
 * alpha con la distancia, tropiezo colectivo durante la gracia post-catch y
 * un amague hacia adelante al atraparte. Con la oleada corren, y se les
 * suman más desde atrás: la horda crece cuando el programa aprieta.
 */
export class Horde {
  private readonly container: Phaser.GameObjects.Container;
  private readonly zombies: Zombie[] = [];
  private readonly extraAlpha: number[] = [];
  private lungePx = 0;

  constructor(scene: Phaser.Scene) {
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
    for (let i = 0; i < MAX_COUNT; i++) {
      const extra = i >= BASE_COUNT;
      // Los de base ocupan el frente; los refuerzos llegan por detrás.
      const x = extra
        ? -330 + (150 / (MAX_COUNT - BASE_COUNT)) * (i - BASE_COUNT) + (rnd() * 12 - 6)
        : -160 + (160 / (BASE_COUNT - 1)) * i + (rnd() * 10 - 5);
      const zombie = new Zombie(scene, i + 1, x, rnd() * 4 - 2);
      if (extra) zombie.gfx.setAlpha(0);
      this.container.add(zombie.gfx);
      this.zombies.push(zombie);
      this.extraAlpha.push(extra ? 0 : 1);
    }
  }

  update(dt: number, gapM: number, zombieKph: number, stumbling: boolean): void {
    const zombieMps = zombieKph / 3.6;
    const run01 = Math.max(0, Math.min(1, (zombieKph - WALK_KPH) / (RUN_KPH - WALK_KPH)));
    const closeness = Math.max(0, Math.min(1, 1 - gapM / 40));

    this.lungePx *= Math.exp(-9 * dt);
    this.container.x = RENDER.playerX - 30 - gapToPx(gapM) + this.lungePx;
    const s = hordeScale(gapM);
    this.container.setScale(s, stumbling ? s * 0.94 : s);
    this.container.setAlpha(gapM > 100 ? 0.85 : 1);

    // Refuerzos: aparecen (uno tras otro) cuando la horda pasa a correr y se
    // desvanecen cuando vuelve a arrastrarse.
    const wanted = BASE_COUNT + Math.round(run01 * (MAX_COUNT - BASE_COUNT));
    this.zombies.forEach((zombie, i) => {
      if (i >= BASE_COUNT) {
        const target = i < wanted ? 1 : 0;
        const a = this.extraAlpha[i] ?? 0;
        const next = a + (target - a) * Math.min(1, dt * 0.8);
        this.extraAlpha[i] = next;
        zombie.gfx.setAlpha(next);
        if (next < 0.02) return; // invisible: no gastar en dibujarlo
      }
      zombie.update(dt, zombieMps, stumbling, run01, closeness);
    });
  }

  lunge(): void {
    this.lungePx = 34;
  }
}
