import Phaser from 'phaser';
import { RENDER } from '../../config';
import type { SessionRecord } from '../../sim/history';
import { marks } from '../../sim/marks';
import { FONT_SANS, UI } from '../theme';
import { makeTextButton } from '../uiButton';

// Las marcas de forma: la lista entera, con fecha las conseguidas y en gris
// las que faltan. Sin insignias: una línea por marca y lo que significa.

const DEPTH = 55;
const PANEL_W = 900;
const PANEL_H = 640;
const GOLD = '#d9b06a';

const fmtDate = (ms: number): string => new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

export class MarksPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, sessions: readonly SessionRecord[], onClose: () => void) {
    const cx = RENDER.width / 2;
    const cy = RENDER.height / 2;
    const top = cy - PANEL_H / 2;
    const dim = scene.add.rectangle(cx, cy, RENDER.width, RENDER.height, 0x05060e, 0.8).setDepth(DEPTH).setInteractive();
    const panel = scene.add.rectangle(cx, cy, PANEL_W, PANEL_H, UI.panel).setDepth(DEPTH).setStrokeStyle(2, 0x3a4256);
    this.objects.push(dim, panel);

    const text = (x: number, y: number, value: string, size: number, color: string, extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) => {
      const t = scene.add.text(x, y, value, { fontFamily: FONT_SANS, fontSize: `${size}px`, color, ...extra }).setDepth(DEPTH + 1);
      this.objects.push(t);
      return t;
    };

    const all = marks(sessions);
    const done = all.filter((m) => m.achievedAtMs !== undefined).length;
    text(cx, top + 36, 'Marcas de forma', 30, UI.textBright, { fontStyle: 'bold' }).setOrigin(0.5);
    text(cx, top + 70, `${done} de ${all.length}. Lo que un pulsómetro puede certificar, con fecha y sin insignias.`, 15, UI.textMuted).setOrigin(0.5);

    const left = cx - PANEL_W / 2 + 40;
    const colW = (PANEL_W - 80) / 2;
    all.forEach((mark, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = left + col * colW;
      const y = top + 108 + row * 78;
      const got = mark.achievedAtMs !== undefined;
      text(x, y, got ? '★' : '○', 20, got ? GOLD : UI.textDim);
      text(x + 30, y, mark.title, 18, got ? UI.textBright : UI.textMuted, { fontStyle: got ? 'bold' : undefined });
      text(x + 30, y + 24, mark.detail, 13, UI.textDim, { wordWrap: { width: colW - 40 } });
      if (got && mark.achievedAtMs !== undefined) {
        text(x + colW - 20, y + 2, fmtDate(mark.achievedAtMs), 13, GOLD).setOrigin(1, 0);
      }
    });

    const close = makeTextButton(scene, cx, top + PANEL_H - 44, 220, 52, 'Cerrar', () => this.close(onClose), DEPTH + 1, 22);
    this.objects.push(close.rect, close.label);
  }

  private close(onClose: () => void): void {
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
    onClose();
  }
}
