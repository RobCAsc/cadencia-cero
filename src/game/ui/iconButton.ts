import Phaser from 'phaser';
import { FONT_SANS, UI } from '../theme';
import { icon, type IconName } from './paper';

export interface IconButton {
  rect: Phaser.GameObjects.Rectangle;
  gfx: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  setLabel(text: string): void;
  destroy(): void;
}

/** Botón con icono trazado y etiqueta corta: menos palabras, más señal. */
export function makeIconButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  name: IconName,
  text: string,
  onTap: () => void,
  depth = 10,
  fontSize = 15,
  fill: number = UI.button,
): IconButton {
  const rect = scene.add.rectangle(x, y, w, h, fill).setDepth(depth).setInteractive({ useHandCursor: true });
  const gfx = scene.add.graphics().setDepth(depth + 1);
  const size = Math.round(h * 0.55);
  const label = scene.add
    .text(x - w / 2 + size + 20, y, text, { fontFamily: FONT_SANS, fontSize: `${fontSize}px`, color: UI.textBright })
    .setOrigin(0, 0.5)
    .setDepth(depth + 1);
  icon(gfx, name, x - w / 2 + 12 + size / 2, y, size, 0xecf0f1);
  const hover = Phaser.Display.Color.IntegerToColor(fill).brighten(12).color;
  rect.on('pointerdown', () => {
    onTap();
    rect.setFillStyle(Phaser.Display.Color.IntegerToColor(fill).brighten(22).color);
    scene.time.delayedCall(90, () => rect.setFillStyle(fill));
  });
  rect.on('pointerover', () => rect.setFillStyle(hover));
  rect.on('pointerout', () => rect.setFillStyle(fill));
  return {
    rect,
    gfx,
    label,
    setLabel: (t) => label.setText(t),
    destroy: () => {
      rect.destroy();
      gfx.destroy();
      label.destroy();
    },
  };
}
