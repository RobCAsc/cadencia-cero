import Phaser from 'phaser';
import { RENDER } from '../../config';
import type { ScreeningFlag } from '../../storage/planStore';
import { promptText } from '../textPrompt';
import { FONT_SANS, UI } from '../theme';
import { makeTextButton, type TapButton } from '../uiButton';
import { INK, INK_DIM, INK_GOLD, INK_GREEN, INK_RED, paperPanel } from '../ui/paper';

// El cribado de una vez, antes de la primera salida: cuatro preguntas que
// son las que cualquier profesional haría antes de mandar a alguien a
// pedalear fuerte. Un "sí" no prohíbe nada: pide consultar y ofrece el modo
// por sensación, donde el pulso no manda. No es un dispositivo médico y se
// dice.

const DEPTH = 60;
const PANEL_W = 960;
const PANEL_H = 660;

const QUESTIONS: ReadonlyArray<readonly [ScreeningFlag, string]> = [
  ['chestPain', '¿Has notado dolor o presión en el pecho al hacer esfuerzo?'],
  ['dizziness', '¿Te has mareado o desmayado haciendo ejercicio, o pierdes el equilibrio?'],
  ['heartCondition', '¿Te han diagnosticado alguna enfermedad del corazón o tensión alta sin controlar?'],
  ['medication', '¿Tomas medicación que afecte al pulso (betabloqueantes u otra)?'],
];

export interface ScreeningPanelOptions {
  /** Respuestas previas, si el cribado se reabre. */
  flags?: readonly ScreeningFlag[];
  /** Por qué pedalea, si ya lo escribió. */
  why?: string;
  /** Al continuar: las banderas marcadas, el modo elegido y el porqué. */
  onDone: (flags: ScreeningFlag[], mode: 'heartRate' | 'feel', why: string | undefined) => void;
}

export class ScreeningPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly toggles = new Map<ScreeningFlag, { yes: TapButton; no: TapButton; value: boolean | undefined }>();
  private readonly verdict: Phaser.GameObjects.Text;
  private readonly whyText: Phaser.GameObjects.Text;
  private readonly feelButton: TapButton;
  private readonly continueButton: TapButton;
  private why: string | undefined;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: ScreeningPanelOptions,
  ) {
    const sheet = paperPanel(
      scene,
      PANEL_W,
      PANEL_H,
      DEPTH,
      'Antes de entrenar',
      'Cuatro preguntas, una vez. Con un "sí" el juego no te prohíbe nada: te pide consultar y te ofrece pedalear sin que el pulso mande.',
    );
    const { cx, top } = sheet;
    this.objects.push(...sheet.objects);

    const left = sheet.left + 40;
    QUESTIONS.forEach(([flag, text], i) => {
      const y = top + 140 + i * 64;
      const q = scene.add
        .text(left, y, text, { fontFamily: FONT_SANS, fontSize: '19px', color: INK, wordWrap: { width: PANEL_W - 320 } })
        .setOrigin(0, 0.5)
        .setDepth(DEPTH + 1);
      const yes = makeTextButton(scene, cx + PANEL_W / 2 - 200, y, 90, 42, 'Sí', () => this.set(flag, true), DEPTH + 1, 18);
      const no = makeTextButton(scene, cx + PANEL_W / 2 - 96, y, 90, 42, 'No', () => this.set(flag, false), DEPTH + 1, 18);
      this.objects.push(q, yes.rect, yes.label, no.rect, no.label);
      this.toggles.set(flag, { yes, no, value: opts.flags ? opts.flags.includes(flag) : undefined });
    });

    this.verdict = scene.add
      .text(cx, top + 420, '', { fontFamily: FONT_SANS, fontSize: '17px', color: INK_RED, align: 'center', wordWrap: { width: PANEL_W - 80 } })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);

    // Tu porqué: una línea en tus palabras. Es la afirmación de valores, y
    // vuelve a aparecer en el ritual y en la revisión semanal.
    this.why = opts.why;
    const whyLabel = scene.add
      .text(left, top + 476, '¿Por qué pedaleas?', { fontFamily: FONT_SANS, fontSize: '19px', color: INK })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH + 1);
    this.whyText = scene.add
      .text(left + 200, top + 476, '', { fontFamily: FONT_SANS, fontSize: '16px', color: INK_GOLD, wordWrap: { width: PANEL_W - 520 } })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH + 1);
    const whyButton = makeTextButton(scene, cx + PANEL_W / 2 - 148, top + 476, 190, 42, 'Escribirlo', () => void this.askWhy(), DEPTH + 1, 17);
    this.objects.push(whyLabel, this.whyText, whyButton.rect, whyButton.label);
    const disclaimer = scene.add
      .text(cx, top + PANEL_H - 118, 'Esto no es un dispositivo médico. El pulso de muñeca orienta, no diagnostica: si notas dolor en el pecho, mareo o falta de aire desproporcionada, para y consulta.', {
        fontFamily: FONT_SANS,
        fontSize: '14px',
        color: INK_DIM,
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

  private async askWhy(): Promise<void> {
    const answer = await promptText({
      title: '¿Por qué pedaleas?',
      placeholder: 'para subir las escaleras sin ahogarme',
      initial: this.why,
      maxLength: 80,
    });
    if (answer !== undefined) this.why = answer;
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
    this.verdict.setColor(flagged ? INK_RED : INK_GREEN);
    this.whyText.setText(this.why ? `«${this.why}»` : 'Una línea, en tus palabras. Opcional, pero ayuda los días flojos.');
    this.whyText.setColor(this.why ? INK_GOLD : INK_DIM);
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
    const why = this.why;
    this.destroy();
    this.opts.onDone(flags, mode, why);
  }

  destroy(): void {
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
  }
}
