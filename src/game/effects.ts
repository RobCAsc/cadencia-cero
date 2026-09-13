import Phaser from 'phaser';
import { RENDER } from '../config';

// Partículas y luz: polvo tras la rueda proporcional a la velocidad, sangre
// al ser atrapado, el charco del faro sobre el asfalto, el aliento del rider
// en la noche fría, luciérnagas entre los matorrales y líneas de velocidad
// cuando vas lanzado. Texturas diminutas generadas al vuelo.

const SPEED_LINES_FROM_MPS = 7; // ~25 km/h
const HEAD = { x: RENDER.playerX + 23, y: RENDER.groundY - 98 };

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
  g.clear();
  // Charco del faro: elipse con degradado suave, cálida.
  for (let i = 9; i >= 1; i--) {
    g.fillStyle(0xffe2a0, 0.045);
    g.fillEllipse(180, 40, 40 + i * 34, 10 + i * 7);
  }
  g.generateTexture('fx-headlight', 360, 80);
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
  private readonly breath: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly fireflies: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly speedLines: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly headlight: Phaser.GameObjects.Image;
  private tAlive = 0;

  constructor(scene: Phaser.Scene) {
    ensureTextures(scene);

    this.headlight = scene.add
      .image(RENDER.playerX + 165, RENDER.groundY - 4, 'fx-headlight')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.55)
      .setDepth(1.5);

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

    // Vaho: una nubecilla cada pocos segundos que se queda atrás.
    this.breath = scene.add.particles(HEAD.x, HEAD.y, 'fx-dot', {
      frequency: 2600,
      quantity: 3,
      speedX: { min: -46, max: -18 },
      speedY: { min: -16, max: -4 },
      x: { min: -3, max: 3 },
      scale: { start: 0.45, end: 1.7 },
      alpha: { start: 0.26, end: 0 },
      lifespan: 950,
      tint: 0xdfe8f5,
      emitting: false,
    });
    this.breath.setDepth(3.2);

    // Luciérnagas: puntos que se encienden y apagan entre los matorrales.
    this.fireflies = scene.add.particles(0, 0, 'fx-dot', {
      emitZone: {
        type: 'random',
        source: {
          getRandomPoint: (p) => {
            p.x = Math.random() * RENDER.width;
            p.y = 430 + Math.random() * 140;
          },
        },
      },
      frequency: 380,
      lifespan: { min: 2400, max: 4600 },
      speedX: { min: -12, max: 12 },
      speedY: { min: -9, max: 9 },
      scale: { min: 0.3, max: 0.6 },
      alpha: { onEmit: () => 0, onUpdate: (_p, _k, t) => Math.sin(t * Math.PI) ** 2 * 0.85 },
      tint: 0xd4ff7a,
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.fireflies.setDepth(1);

    // Líneas de velocidad: trazos que cruzan la pantalla cuando vas lanzado.
    this.speedLines = scene.add.particles(RENDER.width + 20, 0, 'fx-chunk', {
      y: { min: 370, max: 650 },
      speedX: { min: -1500, max: -1000 },
      lifespan: 520,
      scaleX: { min: 6, max: 14 },
      scaleY: 0.25,
      alpha: { start: 0.14, end: 0 },
      tint: 0xaab4cc,
      emitting: false,
    });
    this.speedLines.setDepth(1.2);
  }

  /**
   * @param night01 1 en noche cerrada, 0 al anochecer y al amanecer: el vaho
   * y las luciérnagas son cosa de la noche.
   */
  update(speedMps: number, dt: number, night01: number): void {
    this.tAlive += dt;
    this.headlight.setAlpha(0.5 + Math.sin(this.tAlive * 37) * 0.03 + Math.sin(this.tAlive * 7.3) * 0.04);

    if (speedMps < 2) {
      this.dust.emitting = false;
    } else {
      this.dust.emitting = true;
      this.dust.frequency = Math.max(28, 130 - speedMps * 9);
    }

    this.breath.emitting = night01 > 0.3;
    this.fireflies.emitting = night01 > 0.5;

    if (speedMps > SPEED_LINES_FROM_MPS) {
      this.speedLines.emitting = true;
      this.speedLines.frequency = Math.max(28, 200 - (speedMps - SPEED_LINES_FROM_MPS) * 28);
    } else {
      this.speedLines.emitting = false;
    }
  }

  /** Salpicadura al ser atrapado. */
  burstBlood(): void {
    this.blood.explode(26, RENDER.playerX - 8, RENDER.groundY - 42);
  }
}
