import Phaser from 'phaser';
import { RENDER } from '../../config';
import { FONT_MONO, FONT_SANS, UI } from '../theme';
import { makeTapButton } from '../uiButton';

const BTN = 64; // >= 64 px: dedos sobre una bici en movimiento

/**
 * El control con el que el rider DECLARA la resistencia (1-8) sin bajarse:
 * la perilla del freno es analógica y el juego jamás la puede leer ni mover.
 */
export class ResistanceControl {
  private readonly levelText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, onDelta: (delta: number) => void) {
    const cy = RENDER.height - 64;
    const cx = RENDER.width - 152;
    scene.add
      .text(cx, RENDER.height - 122, 'Resistencia', {
        fontFamily: FONT_SANS,
        fontSize: '18px',
        color: UI.textMuted,
      })
      .setOrigin(0.5)
      .setDepth(10);
    this.levelText = scene.add
      .text(cx, cy, '', { fontFamily: FONT_MONO, fontSize: '48px', fontStyle: 'bold', color: UI.textBright })
      .setOrigin(0.5)
      .setDepth(10);
    makeTapButton(scene, cx - 80, cy, BTN, '−', () => onDelta(-1));
    makeTapButton(scene, cx + 80, cy, BTN, '+', () => onDelta(1));
  }

  update(level: number): void {
    this.levelText.setText(String(level));
  }
}
