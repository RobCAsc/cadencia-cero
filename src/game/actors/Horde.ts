import Phaser from 'phaser';
import { RENDER } from '../../config';
import { gapToPx, groundYAt, hordeScale, slopeRotation } from '../gapMapping';
import { lcg } from '../rng';
import { Zombie } from './Zombie';

/** Bajo esta velocidad la horda se arrastra; a partir de la superior corre a pleno. */
const WALK_KPH = 15;
const RUN_KPH = 28;
/** Tamaño de los actores en pantalla, a juego con el ciclista (1.4). */
const ACTOR_SCALE = 1.3;

/**
 * Hordas con carácter: lo que te persigue cambia con lo que entrenas. Un
 * corredor solo y grande en el umbral, una marea en las oleadas, rezagados
 * que se arrastran en la recuperación. Solo presentación: la velocidad la
 * pone el programa.
 */
export interface HordeCharacter {
  /** Cuántos van siempre, y cuántos pueden llegar cuando la horda corre. */
  baseCount: number;
  maxCount: number;
  /** Del primero al último, cuánto abarcan hacia atrás (px, sin escalar). */
  spreadPx: number;
  /** El primero es un corredor: más grande, y nunca por debajo de esta carrera. */
  leader?: { scale: number; minRun: number };
  /** Zancada relativa de todos (los rezagados arrastran los pies). */
  strideMul: number;
  /** Cuánto se ve la masa de atrás en reposo. */
  massAlpha: number;
}

const CHARACTERS: Record<string, HordeCharacter> = {
  default: { baseCount: 7, maxCount: 12, spreadPx: 160, strideMul: 1, massAlpha: 0.3 },
  tide: { baseCount: 9, maxCount: 14, spreadPx: 150, strideMul: 1.05, massAlpha: 0.45 },
  runner: { baseCount: 3, maxCount: 5, spreadPx: 120, leader: { scale: 1.18, minRun: 0.6 }, strideMul: 1.1, massAlpha: 0.15 },
  stragglers: { baseCount: 4, maxCount: 5, spreadPx: 220, strideMul: 0.8, massAlpha: 0.12 },
};

/** Carácter de la horda según el objetivo del programa. */
export function hordeCharacterFor(target: string): HordeCharacter {
  const key =
    target === 'anaerobic' || target === 'mixed'
      ? 'tide'
      : target === 'threshold'
        ? 'runner'
        : target === 'recovery' || target === 'starter'
          ? 'stragglers'
          : 'default';
  return CHARACTERS[key] ?? CHARACTERS.default!;
}

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
  private readonly character: HordeCharacter;
  private lungePx = 0;
  private runLevel = 0;

  constructor(scene: Phaser.Scene, target = 'aerobic') {
    this.character = hordeCharacterFor(target);
    const { baseCount: BASE_COUNT, maxCount: MAX_COUNT, spreadPx, leader, strideMul } = this.character;
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
    this.mass = scene.add.image(-300, 4, 'horde-mass').setOrigin(0.5, 1).setAlpha(this.character.massAlpha);
    this.container.add(this.mass);

    const rnd = lcg(2024);
    for (let i = 0; i < MAX_COUNT; i++) {
      const extra = i >= BASE_COUNT;
      // Los de base ocupan el frente; los refuerzos llegan por detrás. El
      // último índice de base es el que va delante; con corredor, es él.
      const x = extra
        ? -spreadPx - 170 + (150 / Math.max(1, MAX_COUNT - BASE_COUNT)) * (i - BASE_COUNT) + (rnd() * 12 - 6)
        : -spreadPx + (spreadPx / Math.max(1, BASE_COUNT - 1)) * i + (rnd() * 10 - 5);
      const isLeader = leader !== undefined && i === BASE_COUNT - 1;
      const zombie = new Zombie(scene, i + 1, x, rnd() * 4 - 2, isLeader ? leader.scale : 1, strideMul);
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
    const { baseCount, maxCount, leader, massAlpha } = this.character;
    this.mass.setAlpha(massAlpha + this.runLevel * 0.6);
    this.mass.setScale(1 + this.runLevel * 0.25, 1 + this.runLevel * 0.35);

    // Refuerzos: aparecen (uno tras otro) cuando la horda pasa a correr y se
    // desvanecen cuando vuelve a arrastrarse.
    const wanted = baseCount + Math.round(run01 * (maxCount - baseCount));
    this.zombies.forEach((zombie, i) => {
      if (i >= baseCount) {
        const target = i < wanted ? 1 : 0;
        const a = this.extraAlpha[i] ?? 0;
        const next = a + (target - a) * Math.min(1, dt * 0.8);
        this.extraAlpha[i] = next;
        zombie.gfx.setAlpha(next);
        if (next < 0.02) return; // invisible: no gastar en dibujarlo
      }
      // El corredor del umbral no se arrastra nunca: sostiene presión.
      const run = leader !== undefined && i === baseCount - 1 ? Math.max(run01, leader.minRun) : run01;
      zombie.update(dt, zombieMps, stumbling, run, closeness);
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
