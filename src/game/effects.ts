import Phaser from 'phaser';
import { RENDER } from '../config';

// Partículas y viñeta: polvo tras la rueda proporcional a la velocidad y
// salpicadura al ser atrapado. Texturas diminutas generadas al vuelo.

function ensureTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx-dot')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 0.35);
  g.fillCircle(4, 4, 4);
  g.fillStyle(0xffffff, 0.7);
  g.fillCircle(4, 4, 2);
  g.generateTexture('fx-dot', 8, 8);
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillRect(0, 0, 4, 4);
  g.generateTexture('fx-chunk', 4, 4);
  g.destroy();
}

export function ensureVignette(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx-vignette')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const w = RENDER.width;
  const h = RENDER.height;
  const steps = 26;
  const edge = (
    horizontal: boolean,
    from: number,
    size: number,
    a0: number,
    a1: number,
  ): void => {
    const strip = size / steps;
    for (let i = 0; i < steps; i++) {
      const a = a0 + ((a1 - a0) * i) / (steps - 1);
      g.fillStyle(0x000000, a);
      if (horizontal) g.fillRect(0, from + i * strip, w, strip + 1);
      else g.fillRect(from + i * strip, 0, strip + 1, h);
    }
  };
  edge(true, 0, 90, 0.32, 0); // arriba
  edge(true, h - 130, 130, 0, 0.42); // abajo
  edge(false, 0, 150, 0.3, 0); // izquierda
  edge(false, w - 150, 150, 0, 0.3); // derecha
  g.generateTexture('fx-vignette', w, h);
  g.destroy();
}

export class Effects {
  private readonly dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly blood: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene) {
    ensureTextures(scene);

    this.dust = scene.add.particles(RENDER.playerX - 34, RENDER.groundY - 3, 'fx-dot', {
      speedX: { min: -140, max: -70 },
      speedY: { min: -34, max: -6 },
      scale: { start: 0.5, end: 1.7 },
      alpha: { start: 0.3, end: 0 },
      lifespan: 700,
      tint: 0x9aa2b8,
      emitting: false,
    });
    this.dust.setDepth(2.5);

    this.blood = scene.add.particles(0, 0, 'fx-chunk', {
      speed: { min: 70, max: 290 },
      angle: { min: 180, max: 360 },
      gravityY: 520,
      lifespan: { min: 350, max: 750 },
      scale: { start: 1.4, end: 0.4 },
      tint: [0xa01818, 0x7a1010, 0xc22222],
      emitting: false,
    });
    this.blood.setDepth(3.5);
  }

  update(speedMps: number): void {
    if (speedMps < 2) {
      this.dust.emitting = false;
      return;
    }
    this.dust.emitting = true;
    this.dust.frequency = Math.max(28, 130 - speedMps * 9);
  }

  /** Salpicadura al ser atrapado. */
  burstBlood(): void {
    this.blood.explode(26, RENDER.playerX - 8, RENDER.groundY - 42);
  }
}
