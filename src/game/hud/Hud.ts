import Phaser from 'phaser';
import { RENDER, SIM } from '../../config';
import type { SimState } from '../../sim/types';
import { formatMMSS } from '../format';
import { FONT_MONO, FONT_SANS, UI } from '../theme';

export const KIND_ES: Record<string, string> = {
  warmup: 'Calentamiento',
  surge: 'Oleada',
  recover: 'Recuperación',
  steady: 'Ritmo',
  cooldown: 'Vuelta a la calma',
};

const HEALTH_W = 256;

/** Lectura del estado, nada más: el gap gigante al centro es el protagonista. */
export class Hud {
  private readonly gapText: Phaser.GameObjects.Text;
  private readonly hordeSpeedText: Phaser.GameObjects.Text;
  private readonly cadenceText: Phaser.GameObjects.Text;
  private readonly statsText: Phaser.GameObjects.Text;
  private readonly rightText: Phaser.GameObjects.Text;
  private readonly healthFill: Phaser.GameObjects.Rectangle;
  private readonly healthBg: Phaser.GameObjects.Rectangle;

  constructor(private readonly scene: Phaser.Scene) {
    const cx = RENDER.width / 2;
    this.gapText = scene.add
      .text(cx, 18, '', { fontFamily: FONT_MONO, fontSize: '84px', fontStyle: 'bold', color: UI.good })
      .setOrigin(0.5, 0)
      .setDepth(10);
    scene.add
      .text(cx, 112, 'de ventaja', { fontFamily: FONT_SANS, fontSize: '20px', color: UI.textMuted })
      .setOrigin(0.5, 0)
      .setDepth(10);
    this.hordeSpeedText = scene.add
      .text(cx, 140, '', { fontFamily: FONT_SANS, fontSize: '16px', color: UI.textDim })
      .setOrigin(0.5, 0)
      .setDepth(10);

    this.cadenceText = scene.add
      .text(24, 16, '', { fontFamily: FONT_MONO, fontSize: '40px', color: UI.textBright })
      .setDepth(10);
    this.statsText = scene.add
      .text(24, 68, '', { fontFamily: FONT_MONO, fontSize: '24px', color: UI.textMuted, lineSpacing: 6 })
      .setDepth(10);

    this.rightText = scene.add
      .text(RENDER.width - 24, 16, '', {
        fontFamily: FONT_MONO,
        fontSize: '24px',
        color: UI.textMuted,
        align: 'right',
        lineSpacing: 6,
      })
      .setOrigin(1, 0)
      .setDepth(10);

    scene.add
      .text(24, RENDER.height - 86, 'Salud', { fontFamily: FONT_SANS, fontSize: '18px', color: UI.textMuted })
      .setDepth(10);
    this.healthBg = scene.add
      .rectangle(24, RENDER.height - 60, HEALTH_W + 4, 22, 0x2c3242)
      .setOrigin(0, 0)
      .setDepth(10);
    this.healthFill = scene.add
      .rectangle(26, RENDER.height - 58, HEALTH_W, 18, 0x2ecc71)
      .setOrigin(0, 0)
      .setDepth(10);
  }

  update(state: SimState): void {
    this.gapText.setText(`${Math.round(state.gapM)} m`);
    this.gapText.setColor(
      state.gapM < RENDER.gapDangerM ? UI.danger : state.gapM < RENDER.gapWarnM ? UI.warn : UI.good,
    );
    this.hordeSpeedText.setText(`horda a ${state.zombieSpeedKph.toFixed(0)} km/h`);

    this.cadenceText.setText(`${Math.round(state.cadenceRpm)} rpm`);
    this.cadenceText.setColor(state.cadenceStale ? UI.textDim : UI.textBright);
    this.statsText.setText(
      `${state.playerSpeedKph.toFixed(1)} km/h\n${(state.distanceM / 1000).toFixed(2)} km`,
    );

    const seg = state.segment;
    const segName =
      seg.kind === 'surge' && seg.waveNumber !== undefined
        ? `Oleada ${seg.waveNumber}/${seg.waveTotal}`
        : (KIND_ES[seg.kind] ?? seg.kind);
    const nextLine = seg.next
      ? `Sigue: ${KIND_ES[seg.next.kind] ?? seg.next.kind} a ${seg.next.zombieSpeedKph} km/h`
      : 'Último tramo';
    this.rightText.setText(
      `${formatMMSS(state.elapsedSec)} / ${formatMMSS(state.totalSec)}\n${segName} · ${formatMMSS(seg.remainingSec)}\n${nextLine}`,
    );

    const frac = Math.max(0, Math.min(1, state.healthPct / SIM.maxHealth));
    this.healthFill.setScale(frac, 1);
    this.healthFill.setFillStyle(frac > 0.6 ? 0x2ecc71 : frac > 0.3 ? 0xf39c12 : 0xe74c3c);
  }

  pulseHealth(): void {
    this.scene.tweens.add({
      targets: [this.healthFill, this.healthBg],
      alpha: { from: 1, to: 0.25 },
      duration: 110,
      yoyo: true,
      repeat: 3,
    });
  }
}
