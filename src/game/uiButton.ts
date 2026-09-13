import Phaser from 'phaser';
import { FONT_MONO, FONT_SANS, UI } from './theme';

export interface TapButton {
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
}

/** Botón táctil rectangular con texto; mismo hover y pulso que el cuadrado. */
export function makeTextButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  onTap: () => void,
  depth = 10,
  fontSize = 20,
): TapButton {
  const rect = scene.add
    .rectangle(x, y, w, h, UI.button)
    .setDepth(depth)
    .setInteractive({ useHandCursor: true });
  const label = scene.add
    .text(x, y, text, { fontFamily: FONT_SANS, fontSize: `${fontSize}px`, color: UI.textBright })
    .setOrigin(0.5)
    .setDepth(depth + 1);
  rect.on('pointerdown', () => {
    onTap();
    rect.setFillStyle(UI.buttonActive);
    scene.time.delayedCall(90, () => rect.setFillStyle(UI.button));
  });
  rect.on('pointerover', () => rect.setFillStyle(UI.buttonHover));
  rect.on('pointerout', () => rect.setFillStyle(UI.button));
  return { rect, label };
}

/** Botón táctil cuadrado (rect + glifo) con hover y pulso al tocar. */
export function makeTapButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  size: number,
  glyph: string,
  onTap: () => void,
  depth = 10,
): TapButton {
  const rect = scene.add
    .rectangle(x, y, size, size, UI.button)
    .setDepth(depth)
    .setInteractive({ useHandCursor: true });
  const label = scene.add
    .text(x, y, glyph, {
      fontFamily: FONT_MONO,
      fontSize: `${Math.round(size * 0.62)}px`,
      color: UI.textBright,
    })
    .setOrigin(0.5)
    .setDepth(depth + 1);
  rect.on('pointerdown', () => {
    onTap();
    rect.setFillStyle(UI.buttonActive);
    scene.time.delayedCall(90, () => rect.setFillStyle(UI.button));
  });
  rect.on('pointerover', () => rect.setFillStyle(UI.buttonHover));
  rect.on('pointerout', () => rect.setFillStyle(UI.button));
  return { rect, label };
}
