import Phaser from 'phaser';
import type { PlanPhase } from '../../sim/progress';
import { FONT_SANS } from '../theme';
import { makeTextButton } from '../uiButton';
import { icon, INK, INK_GOLD_HEX, INK_MUTED, paperPanel, stamp } from '../ui/paper';

// La ceremonia de fase: al pasar a base o a rotación, un papel que dice qué
// se ha ganado y con qué evidencia, y qué viene ahora. Una vez por ascenso.

const DEPTH = 55;
const PANEL_W = 760;
const PANEL_H = 380;

const CEREMONY: Partial<Record<PlanPhase, { title: string; earned: string; next: string }>> = {
  base: {
    title: 'Pasas a base',
    earned: 'Cinco salidas hechas. El gesto ya está y la horda te conoce.',
    next: 'Ahora: fondos más largos en Z2 y los primeros Empujones, tres veces dos minutos en Z3. Sin sprints todavía.',
  },
  rotacion: {
    title: 'Pasas a rotación',
    earned: 'Dos semanas cumplidas y unos Empujones completos sin que te alcanzaran en los tramos suaves. Te lo has ganado.',
    next: 'Ahora, cada semana: un fondo, la salida dura (oleadas que crecen de cuatro a ocho) y una recuperación. Cada tercera semana, cuestas.',
  },
};

export function hasCeremony(phase: PlanPhase): boolean {
  return CEREMONY[phase] !== undefined;
}

export class PhasePanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, phase: PlanPhase, onClose: () => void) {
    const spec = CEREMONY[phase];
    const sheet = paperPanel(scene, PANEL_W, PANEL_H, DEPTH, spec?.title ?? 'Nueva fase');
    const { cx, top } = sheet;
    this.objects.push(...sheet.objects);
    this.objects.push(stamp(scene, sheet.left + 110, top + 44, 'ganado', undefined, DEPTH + 2, 14));
    const g = scene.add.graphics().setDepth(DEPTH + 1);
    icon(g, 'trophy', sheet.left + PANEL_W - 70, top + 48, 40, INK_GOLD_HEX);
    this.objects.push(g);
    const text = (y: number, value: string, size: number, color: string) => {
      const t = scene.add
        .text(cx, y, value, { fontFamily: FONT_SANS, fontSize: `${size}px`, color, align: 'center', wordWrap: { width: PANEL_W - 80 } })
        .setOrigin(0.5)
        .setDepth(DEPTH + 1);
      this.objects.push(t);
      return t;
    };
    text(top + 130, spec?.earned ?? '', 19, INK);
    text(top + 216, spec?.next ?? '', 17, INK_MUTED);
    const close = makeTextButton(scene, cx, top + PANEL_H - 50, 240, 54, 'Vamos', () => this.close(onClose), DEPTH + 1, 22);
    this.objects.push(close.rect, close.label);
  }

  private close(onClose: () => void): void {
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
    onClose();
  }
}
