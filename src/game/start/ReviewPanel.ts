import Phaser from 'phaser';
import { PROGRAM_CATALOG } from '../../sim/programs/catalog';
import { PHASE_ES, type WeeklyReview } from '../../sim/progress';
import { shareWeek } from '../share';
import { FONT_MONO, FONT_SANS } from '../theme';
import { makeTextButton } from '../uiButton';
import { INK, INK_DIM, INK_GOLD, INK_GREEN, INK_MUTED, paperPanel } from '../ui/paper';

// La revisión semanal: una pantalla la primera vez que se abre la app cada
// semana. La semana pasada contra la anterior, la racha, el reposo, lo que el
// rider anotó, y el plan de la que empieza. Sin gráficos: cuatro números y
// una frase. Se puede compartir como imagen.

const DEPTH = 55;
const PANEL_W = 820;
const PANEL_H = 560;

export interface ReviewPanelOptions {
  review: WeeklyReview;
  why?: string;
  onClose: () => void;
}

export class ReviewPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, opts: ReviewPanelOptions) {
    const { review, onClose } = opts;
    const last = review.lastWeek;
    const prev = review.previousWeek;
    const sheet = paperPanel(
      scene,
      PANEL_W,
      PANEL_H,
      DEPTH,
      'Tu semana',
      last.met ? 'Semana cumplida. Así se hace un hábito: volviendo.' : 'La semana pasada no llegó a la meta. No pasa nada: esta empieza hoy.',
    );
    const { cx, top } = sheet;
    this.objects.push(...sheet.objects);

    const text = (x: number, y: number, value: string, size: number, color: string, extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) => {
      const t = scene.add
        .text(x, y, value, { fontFamily: size >= 24 ? FONT_MONO : FONT_SANS, fontSize: `${size}px`, color, ...extra })
        .setDepth(DEPTH + 1);
      this.objects.push(t);
      return t;
    };

    const left = sheet.left + 50;
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
      text(left, y, label, 18, INK_MUTED);
      text(col, y - 6, value, 28, INK, { fontStyle: 'bold' }).setOrigin(0, 0);
      text(col + 150, y + 2, before, 15, INK_DIM);
    });

    const streakLine =
      review.streak >= 2
        ? `Racha: ${review.streak} semanas seguidas.`
        : review.streak === 1
          ? 'Racha: 1 semana. Cumple esta y ya son dos.'
          : 'Sin racha ahora mismo. Esta semana la arranca.';
    text(left, top + 336, streakLine, 18, review.streak >= 2 ? INK_GOLD : INK_MUTED);
    if (review.notes.length > 0) {
      const words = review.notes.map((n) => (n.times > 1 ? `${n.note} ×${n.times}` : n.note)).join(' · ');
      text(left, top + 362, `Tu diario: ${words}`, 15, INK_MUTED, { wordWrap: { width: PANEL_W - 100 } });
    }
    if (opts.why) text(left, top + 386, `«${opts.why}»`, 15, INK_GOLD, { wordWrap: { width: PANEL_W - 100 } });

    const program = PROGRAM_CATALOG.find((e) => e.program.id === review.plan.programId)?.program.name ?? review.plan.programId;
    text(left, top + 418, `Esta semana: fase ${PHASE_ES[review.plan.phase].toLowerCase()}. Primera salida: ${program}.`, 18, INK_GREEN, { wordWrap: { width: PANEL_W - 100 } });
    text(left, top + 446, review.plan.reason, 15, INK_DIM, { wordWrap: { width: PANEL_W - 100 } });

    const shareButton = makeTextButton(scene, cx - 150, top + PANEL_H - 50, 220, 56, 'Compartir', () => void this.share(opts, shareButton.label), DEPTH + 1, 20);
    const close = makeTextButton(scene, cx + 130, top + PANEL_H - 50, 260, 56, 'Al campamento', () => this.close(onClose), DEPTH + 1, 22);
    this.objects.push(shareButton.rect, shareButton.label, close.rect, close.label);
  }

  private async share(opts: ReviewPanelOptions, label: Phaser.GameObjects.Text): Promise<void> {
    const outcome = await shareWeek(opts.review, opts.why);
    if (!label.active) return;
    label.setText(outcome === 'shared' ? 'Compartida' : outcome === 'opened' ? 'Imagen abierta' : 'No disponible');
  }

  private close(onClose: () => void): void {
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
    onClose();
  }
}
