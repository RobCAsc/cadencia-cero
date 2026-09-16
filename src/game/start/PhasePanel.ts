import Phaser from 'phaser';
import { RENDER } from '../../config';
import type { PlanPhase } from '../../sim/progress';
import { FONT_SANS, UI } from '../theme';
import { makeTextButton } from '../uiButton';

// La ceremonia de fase: al pasar a base o a rotación, una pantalla que dice
// qué se ha ganado y con qué evidencia, y qué viene ahora. Una vez por ascenso.

const DEPTH = 55;
const PANEL_W = 760;
const PANEL_H = 360;
const GOLD = '#d9b06a';

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
    const cx = RENDER.width / 2;
    const cy = RENDER.height / 2;
    const top = cy - PANEL_H / 2;
    const dim = scene.add.rectangle(cx, cy, RENDER.width, RENDER.height, 0x05060e, 0.8).setDepth(DEPTH).setInteractive();
    const panel = scene.add.rectangle(cx, cy, PANEL_W, PANEL_H, UI.panel).setDepth(DEPTH).setStrokeStyle(2, 0xd9b06a);
    this.objects.push(dim, panel);
    const text = (y: number, value: string, size: number, color: string, extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) => {
      const t = scene.add
        .text(cx, y, value, { fontFamily: FONT_SANS, fontSize: `${size}px`, color, align: 'center', wordWrap: { width: PANEL_W - 80 }, ...extra })
        .setOrigin(0.5)
        .setDepth(DEPTH + 1);
      this.objects.push(t);
      return t;
    };
    text(top + 54, spec?.title ?? 'Nueva fase', 40, GOLD, { fontStyle: 'bold' });
    text(top + 130, spec?.earned ?? '', 19, UI.textBright);
    text(top + 210, spec?.next ?? '', 17, UI.textMuted);
    const close = makeTextButton(scene, cx, top + PANEL_H - 50, 240, 54, 'Vamos', () => this.close(onClose), DEPTH + 1, 22);
    this.objects.push(close.rect, close.label);
  }

  private close(onClose: () => void): void {
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
    onClose();
  }
}
