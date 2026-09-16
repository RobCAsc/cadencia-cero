import Phaser from 'phaser';
import type { SessionRecord } from '../../sim/history';
import { marks, type MarkId } from '../../sim/marks';
import { FONT_SANS } from '../theme';
import { makeTextButton } from '../uiButton';
import { icon, INK, INK_DIM, INK_GOLD, INK_GOLD_HEX, INK_HEX, INK_MUTED, paperPanel, type IconName } from '../ui/paper';

// Las marcas de forma, en un papel: cada una con su icono trazado, en tinta
// las conseguidas (con fecha) y desvaídas las que faltan. Sin insignias
// compradas: una línea por marca y lo que significa.

const DEPTH = 55;
const PANEL_W = 900;
const PANEL_H = 640;

const MARK_ICON: Record<MarkId, IconName> = {
  'first-clean': 'skull',
  'fondo-30': 'clock',
  'oleadas-clean': 'zombie',
  'recovery-20': 'lung',
  'rest-5': 'heart',
  'active-150': 'sun',
  'streak-4': 'flame',
  'streak-10': 'flame',
  'rides-25': 'bike',
  'rides-50': 'bike',
  'rides-100': 'bike',
};

const fmtDate = (ms: number): string => new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

export class MarksPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, sessions: readonly SessionRecord[], onClose: () => void) {
    const all = marks(sessions);
    const done = all.filter((m) => m.achievedAtMs !== undefined).length;
    const sheet = paperPanel(scene, PANEL_W, PANEL_H, DEPTH, 'Marcas de forma', `${done} de ${all.length}. Lo que un pulsómetro puede certificar, con fecha.`);
    const { cx, top } = sheet;
    this.objects.push(...sheet.objects);

    const text = (x: number, y: number, value: string, size: number, color: string, extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) => {
      const t = scene.add.text(x, y, value, { fontFamily: FONT_SANS, fontSize: `${size}px`, color, ...extra }).setDepth(DEPTH + 1);
      this.objects.push(t);
      return t;
    };
    const g = scene.add.graphics().setDepth(DEPTH + 1);
    this.objects.push(g);

    const left = sheet.left + 40;
    const colW = (PANEL_W - 80) / 2;
    all.forEach((mark, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = left + col * colW;
      const y = top + 108 + row * 78;
      const got = mark.achievedAtMs !== undefined;
      icon(g, MARK_ICON[mark.id], x + 18, y + 16, 30, got ? INK_GOLD_HEX : INK_HEX, got ? 1 : 0.25);
      text(x + 46, y, mark.title, 18, got ? INK : INK_MUTED, { fontStyle: got ? 'bold' : undefined });
      text(x + 46, y + 24, mark.detail, 13, INK_DIM, { wordWrap: { width: colW - 56 } });
      if (got && mark.achievedAtMs !== undefined) {
        text(x + colW - 20, y + 2, fmtDate(mark.achievedAtMs), 13, INK_GOLD).setOrigin(1, 0);
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
