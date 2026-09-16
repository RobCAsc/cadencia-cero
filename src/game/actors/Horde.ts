import Phaser from 'phaser';
import { RENDER } from '../../config';
import { gapToPx, groundYAt, hordeScale, slopeRotation } from '../gapMapping';
import { lcg } from '../rng';
import { Zombie } from './Zombie';

/** Bajo esta velocidad la horda se arrastra; a partir de la superior corre a pleno. */
const WALK_KPH = 15;
const RUN_KPH = 28;
const BASE_COUNT = 7;
const MAX_COUNT = 12;
/** Tamaño de los actores en pantalla, a juego con el ciclista (1.4). */
const ACTOR_SCALE = 1.3;

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
  private readonly mass: Phaser.GameObjects.Image;
  private lungePx = 0;
  private runLevel = 0;

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
      g.clear();
      // La masa: la horda que no cabe en pantalla, una loma oscura de cabezas
      // detrás de los que sí se ven. Un tier más clara que el asfalto.
      g.fillStyle(0x1c2130, 1);
      g.beginPath();
      g.moveTo(0, 120);
      const rnd = lcg(77);
      for (let x = 0; x <= 520; x += 20) {
        const bump = 46 + Math.sin(x / 38) * 10 + rnd() * 16;
        g.lineTo(x, 120 - bump);
        g.lineTo(x + 10, 120 - bump + 9);
      }
      g.lineTo(520, 120);
      g.closePath();
      g.fillPath();
      for (let i = 0; i < 14; i++) {
        g.fillStyle(0xff5544, 0.7);
        g.fillCircle(20 + rnd() * 480, 60 + rnd() * 30, 1.4);
      }
      g.generateTexture('horde-mass', 520, 120);
      g.destroy();
    }
    const glow = scene.add
      .image(-80, -34, 'horde-glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.85);
    this.container.add(glow);
    this.mass = scene.add.image(-300, 4, 'horde-mass').setOrigin(0.5, 1).setAlpha(0.35);
    this.container.add(this.mass);

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

  /** @param slope pendiente de pantalla (tangente): en cuesta la manada viene desde más abajo. */
  update(dt: number, gapM: number, zombieKph: number, stumbling: boolean, slope = 0): void {
    const zombieMps = zombieKph / 3.6;
    const run01 = Math.max(0, Math.min(1, (zombieKph - WALK_KPH) / (RUN_KPH - WALK_KPH)));
    const closeness = Math.max(0, Math.min(1, 1 - gapM / 40));

    this.lungePx *= Math.exp(-9 * dt);
    this.container.x = RENDER.playerX - 30 - gapToPx(gapM) + this.lungePx;
    this.container.y = groundYAt(this.container.x, slope);
    this.container.setRotation(slopeRotation(slope));
    const s = hordeScale(gapM) * ACTOR_SCALE;
    this.container.setScale(s, stumbling ? s * 0.94 : s);
    this.container.setAlpha(gapM > 100 ? 0.85 : 1);
    this.runLevel += (run01 - this.runLevel) * Math.min(1, dt * 1.5);
    // Con la oleada la masa de atrás se levanta: son muchos más de los que ves.
    this.mass.setAlpha(0.3 + this.runLevel * 0.6);
    this.mass.setScale(1 + this.runLevel * 0.25, 1 + this.runLevel * 0.35);

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

  /** Posición del frente de la manada en pantalla (px). */
  get screenX(): number {
    return this.container.x;
  }

  /** 0 arrastrándose … 1 a la carrera (con inercia). */
  get run01(): number {
    return this.runLevel;
  }
}
