import Phaser from 'phaser';
import { RENDER } from '../../config';
import { PROGRAM_CATALOG } from '../../sim/programs/catalog';
import { PHASE_ES, type WeeklyReview } from '../../sim/progress';
import { FONT_MONO, FONT_SANS, UI } from '../theme';
import { makeTextButton } from '../uiButton';

// La revisión semanal: una pantalla la primera vez que se abre la app cada
// semana. La semana pasada contra la anterior, la racha, el reposo, y el plan
// de la que empieza. Sin gráficos: cuatro números y una frase.

const DEPTH = 55;
const PANEL_W = 820;
const PANEL_H = 520;
const GOLD = '#d9b06a';

export class ReviewPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, review: WeeklyReview, onClose: () => void) {
    const cx = RENDER.width / 2;
    const cy = RENDER.height / 2;
    const top = cy - PANEL_H / 2;
    const dim = scene.add.rectangle(cx, cy, RENDER.width, RENDER.height, 0x05060e, 0.8).setDepth(DEPTH).setInteractive();
    const panel = scene.add.rectangle(cx, cy, PANEL_W, PANEL_H, UI.panel).setDepth(DEPTH).setStrokeStyle(2, 0x3a4256);
    this.objects.push(dim, panel);

    const text = (x: number, y: number, value: string, size: number, color: string, extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) => {
      const t = scene.add
        .text(x, y, value, { fontFamily: size >= 24 ? FONT_MONO : FONT_SANS, fontSize: `${size}px`, color, ...extra })
        .setDepth(DEPTH + 1);
      this.objects.push(t);
      return t;
    };

    const last = review.lastWeek;
    const prev = review.previousWeek;
    text(cx, top + 40, 'Tu semana', 32, UI.textBright, { fontStyle: 'bold' }).setOrigin(0.5);
    text(cx, top + 76, last.met ? 'Semana cumplida. Así se hace un hábito: volviendo.' : 'La semana pasada no llegó a la meta. No pasa nada: esta empieza hoy.', 17, last.met ? UI.good : UI.textMuted).setOrigin(0.5);

    const left = cx - PANEL_W / 2 + 50;
    const col = cx + 40;
    const rows: Array<[string, string, string]> = [
      ['Salidas', `${last.sessions}`, `${prev.sessions} la anterior`],
      ['Cardio en zona', `${Math.round(last.activeMin)} min`, `${Math.round(prev.activeMin)} min la anterior`],
      ['Kilómetros', `${last.distanceKm.toFixed(1).replace('.', ',')} km`, `${prev.distanceKm.toFixed(1).replace('.', ',')} km la anterior`],
      [
        'Reposo antes de salir',
        review.restLastWeekBpm !== undefined ? `${review.restLastWeekBpm} bpm` : '––',
        review.restPreviousWeekBpm !== undefined ? `${review.restPreviousWeekBpm} bpm la anterior` : 'sin lecturas la anterior',
      ],
    ];
    rows.forEach(([label, value, before], i) => {
      const y = top + 130 + i * 50;
      text(left, y, label, 18, UI.textMuted);
      text(col, y - 6, value, 28, UI.textBright).setOrigin(0, 0);
      text(col + 150, y + 2, before, 15, UI.textDim);
    });

    const streakLine =
      review.streak >= 2
        ? `Racha: ${review.streak} semanas seguidas.`
        : review.streak === 1
          ? 'Racha: 1 semana. Cumple esta y ya son dos.'
          : 'Sin racha ahora mismo. Esta semana la arranca.';
    text(left, top + 340, streakLine, 18, review.streak >= 2 ? GOLD : UI.textMuted);

    const program = PROGRAM_CATALOG.find((e) => e.program.id === review.plan.programId)?.program.name ?? review.plan.programId;
    text(left, top + 376, `Esta semana: fase ${PHASE_ES[review.plan.phase].toLowerCase()}. Primera salida: ${program}.`, 18, UI.info, { wordWrap: { width: PANEL_W - 100 } });
    text(left, top + 404, review.plan.reason, 15, UI.textDim, { wordWrap: { width: PANEL_W - 100 } });

    const close = makeTextButton(scene, cx, top + PANEL_H - 50, 260, 56, 'Al campamento', () => this.close(onClose), DEPTH + 1, 22);
    this.objects.push(close.rect, close.label);
  }

  private close(onClose: () => void): void {
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
    onClose();
  }
}
