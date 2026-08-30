import Phaser from 'phaser';
import { RENDER, SIM } from '../../config';
import type { SimState } from '../../sim/types';
import { FONT_SANS, UI } from '../theme';

/**
 * Banner central para telegrafiar lo que viene: la cuenta regresiva de oleada
 * se deriva del estado del sim cada frame; los avisos puntuales (cambio de
 * resistencia, arranque de oleada) llegan por showNotice desde los eventos.
 */
export class CueBanner {
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private noticeUntilMs = 0;
  private lastPipValue = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onPip: (finalPip: boolean) => void = () => {},
  ) {
    this.bg = scene.add
      .rectangle(RENDER.width / 2, 252, 580, 92, UI.panel, 0.94)
      .setDepth(15)
      .setVisible(false);
    this.label = scene.add
      .text(RENDER.width / 2, 252, '', {
        fontFamily: FONT_SANS,
        fontSize: '42px',
        fontStyle: 'bold',
        color: UI.textBright,
      })
      .setOrigin(0.5)
      .setDepth(16)
      .setVisible(false);
  }

  showNotice(message: string, durationMs = 4000, color: string = UI.textBright): void {
    this.noticeUntilMs = this.scene.time.now + durationMs;
    this.display(message, color);
  }

  update(state: SimState): void {
    const next = state.segment.next;
    const surgeInSec =
      state.phase === 'riding' &&
      next !== undefined &&
      next.zombieSpeedKph > state.segment.zombieSpeedKph &&
      next.inSec <= SIM.surgeWarningSec
        ? next.inSec
        : undefined;

    if (surgeInSec !== undefined) {
      const n = Math.max(1, Math.ceil(surgeInSec));
      this.display(`¡OLEADA EN ${n}!`, UI.danger);
      if (n <= 3 && n !== this.lastPipValue) {
        this.lastPipValue = n;
        this.onPip(n === 1);
      }
      return;
    }

    this.lastPipValue = -1;
    if (this.scene.time.now >= this.noticeUntilMs) this.hide();
  }

  private display(message: string, color: string): void {
    this.label.setText(message).setColor(color);
    this.bg.setVisible(true);
    this.label.setVisible(true);
  }

  private hide(): void {
    this.bg.setVisible(false);
    this.label.setVisible(false);
  }
}
