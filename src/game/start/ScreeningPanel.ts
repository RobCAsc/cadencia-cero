import Phaser from 'phaser';
import { RENDER } from '../../config';
import type { ScreeningFlag } from '../../storage/planStore';
import { FONT_SANS, UI } from '../theme';
import { makeTextButton, type TapButton } from '../uiButton';

// El cribado de una vez, antes de la primera salida: cuatro preguntas que
// son las que cualquier profesional haría antes de mandar a alguien a
// pedalear fuerte. Un "sí" no prohíbe nada: pide consultar y ofrece el modo
// por sensación, donde el pulso no manda. No es un dispositivo médico y se
// dice.

const DEPTH = 60;
const PANEL_W = 960;
const PANEL_H = 600;

const QUESTIONS: ReadonlyArray<readonly [ScreeningFlag, string]> = [
  ['chestPain', '¿Has notado dolor o presión en el pecho al hacer esfuerzo?'],
  ['dizziness', '¿Te has mareado o desmayado haciendo ejercicio, o pierdes el equilibrio?'],
  ['heartCondition', '¿Te han diagnosticado alguna enfermedad del corazón o tensión alta sin controlar?'],
  ['medication', '¿Tomas medicación que afecte al pulso (betabloqueantes u otra)?'],
];

export interface ScreeningPanelOptions {
  /** Respuestas previas, si el cribado se reabre. */
  flags?: readonly ScreeningFlag[];
  /** Al continuar: las banderas marcadas y el modo elegido. */
  onDone: (flags: ScreeningFlag[], mode: 'heartRate' | 'feel') => void;
}

export class ScreeningPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly toggles = new Map<ScreeningFlag, { yes: TapButton; no: TapButton; value: boolean | undefined }>();
  private readonly verdict: Phaser.GameObjects.Text;
  private readonly feelButton: TapButton;
  private readonly continueButton: TapButton;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: ScreeningPanelOptions,
  ) {
    const cx = RENDER.width / 2;
    const cy = RENDER.height / 2;
    const top = cy - PANEL_H / 2;
    const dim = scene.add.rectangle(cx, cy, RENDER.width, RENDER.height, 0x05060e, 0.86).setDepth(DEPTH).setInteractive();
    const panel = scene.add.rectangle(cx, cy, PANEL_W, PANEL_H, UI.panel).setDepth(DEPTH).setStrokeStyle(2, 0x3a4256);
    const title = scene.add
      .text(cx, top + 40, 'Antes de entrenar', { fontFamily: FONT_SANS, fontSize: '32px', fontStyle: 'bold', color: UI.textBright })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    const subtitle = scene.add
      .text(cx, top + 76, 'Cuatro preguntas, una vez. Con un "sí" el juego no te prohíbe nada: te pide consultar y te ofrece pedalear sin que el pulso mande.', {
        fontFamily: FONT_SANS,
        fontSize: '16px',
        color: UI.textMuted,
        align: 'center',
        wordWrap: { width: PANEL_W - 80 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.objects.push(dim, panel, title, subtitle);

    const left = cx - PANEL_W / 2 + 40;
    QUESTIONS.forEach(([flag, text], i) => {
      const y = top + 140 + i * 64;
      const q = scene.add
        .text(left, y, text, { fontFamily: FONT_SANS, fontSize: '19px', color: UI.textBright, wordWrap: { width: PANEL_W - 320 } })
        .setOrigin(0, 0.5)
        .setDepth(DEPTH + 1);
      const yes = makeTextButton(scene, cx + PANEL_W / 2 - 200, y, 90, 42, 'Sí', () => this.set(flag, true), DEPTH + 1, 18);
      const no = makeTextButton(scene, cx + PANEL_W / 2 - 96, y, 90, 42, 'No', () => this.set(flag, false), DEPTH + 1, 18);
      this.objects.push(q, yes.rect, yes.label, no.rect, no.label);
      this.toggles.set(flag, { yes, no, value: opts.flags ? opts.flags.includes(flag) : undefined });
    });

    this.verdict = scene.add
      .text(cx, top + 420, '', { fontFamily: FONT_SANS, fontSize: '17px', color: UI.warn, align: 'center', wordWrap: { width: PANEL_W - 80 } })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    const disclaimer = scene.add
      .text(cx, top + PANEL_H - 118, 'Esto no es un dispositivo médico. El pulso de muñeca orienta, no diagnostica: si notas dolor en el pecho, mareo o falta de aire desproporcionada, para y consulta.', {
        fontFamily: FONT_SANS,
        fontSize: '14px',
        color: UI.textDim,
        align: 'center',
        wordWrap: { width: PANEL_W - 80 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.feelButton = makeTextButton(scene, cx - 170, top + PANEL_H - 52, 300, 56, 'Modo por sensación', () => this.done('feel'), DEPTH + 1, 20);
    this.continueButton = makeTextButton(scene, cx + 170, top + PANEL_H - 52, 300, 56, 'Seguir con pulso', () => this.done('heartRate'), DEPTH + 1, 22);
    this.objects.push(this.verdict, disclaimer, this.feelButton.rect, this.feelButton.label, this.continueButton.rect, this.continueButton.label);
    this.render();
  }

  private set(flag: ScreeningFlag, value: boolean): void {
    const t = this.toggles.get(flag);
    if (!t) return;
    t.value = value;
    this.render();
  }

  private flags(): ScreeningFlag[] {
    return [...this.toggles].filter(([, t]) => t.value === true).map(([flag]) => flag);
  }

  private render(): void {
    let answered = 0;
    for (const t of this.toggles.values()) {
      if (t.value !== undefined) answered += 1;
      t.yes.rect.setFillStyle(t.value === true ? 0x8e3b2f : UI.button);
      t.no.rect.setFillStyle(t.value === false ? 0x1e8449 : UI.button);
      t.yes.rect.setAlpha(t.value === undefined || t.value ? 1 : 0.55);
      t.no.rect.setAlpha(t.value === undefined || !t.value ? 1 : 0.55);
    }
    const complete = answered === QUESTIONS.length;
    const flagged = this.flags().length > 0;
    this.verdict.setText(
      !complete
        ? ''
        : flagged
          ? 'Consulta con un profesional antes de entrenar fuerte. Mientras tanto, el modo por sensación: tramos por tiempo y la prueba del habla como guía, sin horda que te persiga por pulso. Con medicación que afecte al pulso, las zonas no valen: usa ese modo.'
          : 'Sin avisos. Adelante: empieza suave, y si un día algo no va, para.',
    );
    this.verdict.setColor(flagged ? UI.warn : UI.good);
    for (const b of [this.feelButton, this.continueButton]) {
      b.rect.setAlpha(complete ? 1 : 0.35);
      if (complete) b.rect.setInteractive({ useHandCursor: true });
      else b.rect.disableInteractive();
    }
    this.feelButton.rect.setFillStyle(flagged ? 0x1e8449 : UI.button);
    this.continueButton.rect.setFillStyle(flagged ? UI.button : 0x1e8449);
  }

  private done(mode: 'heartRate' | 'feel'): void {
    const flags = this.flags();
    this.destroy();
    this.opts.onDone(flags, mode);
  }

  destroy(): void {
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
  }
}
