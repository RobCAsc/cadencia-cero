import Phaser from 'phaser';
import { RENDER } from '../../config';

// La fogata del campamento: un fuego pequeño al pie de la pantalla, su luz
// cálida que tiembla sobre todo lo demás, y brasas que suben. Es el sitio al
// que se vuelve cada día; que se sienta como tal.

const X = RENDER.width / 2;
const Y = RENDER.height - 4;

function ensureTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('camp-glow')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let i = 12; i >= 1; i--) {
    g.fillStyle(0xff9a40, 0.035);
    g.fillEllipse(480, 200, 80 + i * 76, 40 + i * 30);
  }
  g.generateTexture('camp-glow', 960, 400);
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(3, 3, 3);
  g.generateTexture('camp-ember', 6, 6);
  g.destroy();
}

export class Campfire {
  private readonly glow: Phaser.GameObjects.Image;
  private readonly flames: Phaser.GameObjects.Graphics;
  private readonly embers: Phaser.GameObjects.Particles.ParticleEmitter;
  private t = 0;

  constructor(scene: Phaser.Scene) {
    ensureTextures(scene);
    this.glow = scene.add
      .image(X, Y - 60, 'camp-glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.5);
    this.flames = scene.add.graphics({ x: X, y: Y });
    this.embers = scene.add.particles(X, Y - 18, 'camp-ember', {
      x: { min: -14, max: 14 },
      speedX: { min: -14, max: 14 },
      speedY: { min: -70, max: -30 },
      accelerationX: { min: -8, max: 8 },
      lifespan: { min: 1600, max: 3200 },
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [0xffb060, 0xff8030, 0xffd080],
      frequency: 140,
      blendMode: Phaser.BlendModes.ADD,
    });
  }

  update(dt: number): void {
    this.t += dt;
    // La luz tiembla: dos senos que no comparten periodo y un pelín de ruido.
    const flicker = 0.9 + Math.sin(this.t * 9.3) * 0.05 + Math.sin(this.t * 2.1) * 0.05 + (Math.random() - 0.5) * 0.04;
    this.glow.setAlpha(0.5 * flicker);
    this.glow.setScale(1 + (flicker - 0.9) * 0.6, 1);

    const g = this.flames;
    g.clear();
    // Leños.
    g.fillStyle(0x1a1410, 1);
    g.fillRect(-26, -6, 52, 5);
    g.fillRect(-18, -11, 36, 5);
    // Tres lenguas de fuego que se mecen a destiempo.
    const tongues: Array<[number, number, number, number]> = [
      [0, 30, 0xff8a2a, 0],
      [-9, 22, 0xffb040, 1.7],
      [9, 20, 0xffc860, 3.1],
    ];
    for (const [dx, h, color, ph] of tongues) {
      const sway = Math.sin(this.t * 7 + ph) * 4;
      const hh = h * (0.85 + Math.sin(this.t * 11 + ph) * 0.15);
      g.fillStyle(color, 0.95);
      g.fillTriangle(dx - 8, -8, dx + 8, -8, dx + sway, -8 - hh);
    }
    g.fillStyle(0xfff2c0, 0.9);
    g.fillTriangle(-4, -8, 4, -8, Math.sin(this.t * 13) * 2, -8 - 12);
  }
}
