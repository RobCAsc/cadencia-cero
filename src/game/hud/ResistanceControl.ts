import Phaser from 'phaser';
import { RENDER } from '../../config';
import { FONT_MONO, FONT_SANS, UI } from '../theme';

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
    makeButton(scene, cx - 80, cy, '−', () => onDelta(-1));
    makeButton(scene, cx + 80, cy, '+', () => onDelta(1));
  }

  update(level: number): void {
    this.levelText.setText(String(level));
  }
}

function makeButton(scene: Phaser.Scene, x: number, y: number, glyph: string, onTap: () => void): void {
  const rect = scene.add
    .rectangle(x, y, BTN, BTN, UI.button)
    .setDepth(10)
    .setInteractive({ useHandCursor: true });
  scene.add
    .text(x, y, glyph, { fontFamily: FONT_MONO, fontSize: '40px', color: UI.textBright })
    .setOrigin(0.5)
    .setDepth(11);
  rect.on('pointerdown', () => {
    onTap();
    rect.setFillStyle(UI.buttonActive);
    scene.time.delayedCall(90, () => rect.setFillStyle(UI.button));
  });
  rect.on('pointerover', () => rect.setFillStyle(UI.buttonHover));
  rect.on('pointerout', () => rect.setFillStyle(UI.button));
}
