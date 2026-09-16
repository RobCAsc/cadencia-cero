import Phaser from 'phaser';
import { RENDER } from '../../config';
import type { HeartRateSource } from '../../input/HeartRateSource';
import { RestTest } from '../../sim/heartRateTests';
import type { SessionRecord } from '../../sim/history';
import { readiness, type ReadinessVerdict } from '../../sim/progress';
import { formatMMSS } from '../format';
import { FONT_MONO, FONT_SANS } from '../theme';
import { makeTextButton, type TapButton } from '../uiButton';
import { INK, INK_DIM, INK_GOLD, INK_GREEN, INK_HEX, INK_MUTED, INK_RED, INK_RED_HEX, paper } from '../ui/paper';

// El ritual de salida: un minuto quieto sobre la bici con la pulsera puesta.
// Sirve para tres cosas a la vez: confirma que la señal llega antes de que
// importe, mide el reposo del día (la tendencia más honesta que da un pulso),
// y si viene claramente alto, propone aflojar. Es también la señal de
// arranque del hábito: siempre el mismo minuto antes de cada salida.

const DEPTH = 25;
const PANEL_W = 680;
const PANEL_H = 392;
const NO_SIGNAL_AFTER_MS = 8000;

export interface CalmPanelOptions {
  source: HeartRateSource;
  history: readonly SessionRecord[];
  /** El aviso de seguridad, si toca esta semana. */
  safetyNote?: string;
  /** Por qué pedalea, en sus palabras: se muestra cuando no toca el aviso. */
  why?: string;
  /** Arrancar la salida (con el reposo medido, o sin él si se saltó). */
  onStart: (restBpm: number | undefined) => void;
  /** Cambiar la salida de hoy por una suave (solo se ofrece si el reposo viene alto). */
  onEasier: (restBpm: number) => void;
  /** No salir hoy (solo se ofrece si el reposo viene muy alto). */
  onRest: () => void;
}

export class CalmPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly test = new RestTest();
  private readonly unsubscribe: () => void;
  private readonly openedAtMs: number;
  private readonly countdown: Phaser.GameObjects.Text;
  private readonly bpmText: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly verdictText: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly startButton: TapButton;
  private readonly easierButton: TapButton;
  private readonly restButton: TapButton;
  private readonly skipButton: TapButton;
  private result: number | undefined;
  private done = false;
  private closed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: CalmPanelOptions,
  ) {
    this.openedAtMs = performance.now();
    const cx = RENDER.width / 2;
    const top = 150;

    const dim = scene.add
      .rectangle(cx, RENDER.height / 2, RENDER.width, RENDER.height, 0x05050a, 0.45)
      .setDepth(DEPTH)
      .setInteractive();
    const panel = paper(scene, cx - PANEL_W / 2, top, PANEL_W, PANEL_H, { depth: DEPTH, tilt: 0.004 });
    const title = scene.add
      .text(cx, top + 38, 'Un minuto de calma', {
        fontFamily: FONT_SANS,
        fontSize: '34px',
        fontStyle: 'bold',
        color: INK,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    const subtitle = scene.add
      .text(cx, top + 74, 'Quieto sobre la bici. Respira. La noche llega mientras tanto.', {
        fontFamily: FONT_SANS,
        fontSize: '18px',
        color: INK_MUTED,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.countdown = scene.add
      .text(cx, top + 140, '1:00', { fontFamily: FONT_MONO, fontSize: '64px', fontStyle: 'bold', color: INK })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.bpmText = scene.add
      .text(cx, top + 192, '♥ ––', { fontFamily: FONT_MONO, fontSize: '28px', fontStyle: 'bold', color: INK_RED })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.bar = scene.add.graphics().setDepth(DEPTH + 1);
    this.hint = scene.add
      .text(cx, top + 232, 'Esperando el pulso de la pulsera…', { fontFamily: FONT_SANS, fontSize: '16px', color: INK_DIM })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.verdictText = scene.add
      .text(cx, top + 262, '', { fontFamily: FONT_SANS, fontSize: '18px', color: INK_MUTED, align: 'center' })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);

    const buttonsY = top + PANEL_H - 40;
    this.skipButton = makeTextButton(scene, cx - PANEL_W / 2 + 90, buttonsY, 140, 44, 'Saltar', () => this.finish(true), DEPTH + 1, 18);
    this.skipButton.rect.setAlpha(0.7);
    this.startButton = makeTextButton(scene, cx + PANEL_W / 2 - 120, buttonsY, 200, 56, 'Salir', () => this.finish(false), DEPTH + 1, 24);
    this.easierButton = makeTextButton(scene, cx - 10, buttonsY, 200, 56, 'Mejor suave hoy', () => this.easier(), DEPTH + 1, 19);
    this.restButton = makeTextButton(scene, cx - PANEL_W / 2 + 110, buttonsY, 200, 56, 'Descansar hoy', () => this.rest(), DEPTH + 1, 19);
    this.setButtonVisible(this.startButton, false);
    this.setButtonVisible(this.easierButton, false);
    this.setButtonVisible(this.restButton, false);

    this.objects.push(dim, panel, title, subtitle, this.countdown, this.bpmText, this.bar, this.hint, this.verdictText);
    for (const b of [this.skipButton, this.startButton, this.easierButton, this.restButton]) this.objects.push(b.rect, b.label);

    // El aviso de seguridad, una vez por semana, donde el rider ya está quieto
    // y leyendo; el resto de días, su porqué.
    const line = opts.safetyNote ?? (opts.why ? `«${opts.why}»` : undefined);
    if (line) {
      const note = scene.add
        .text(cx, top + PANEL_H - 84, line, {
          fontFamily: FONT_SANS,
          fontSize: opts.safetyNote ? '13px' : '16px',
          color: opts.safetyNote ? INK_DIM : INK_GOLD,
          align: 'center',
          wordWrap: { width: PANEL_W - 60 },
        })
        .setOrigin(0.5)
        .setDepth(DEPTH + 1);
      this.objects.push(note);
    }

    this.unsubscribe = opts.source.onSample((sample) => this.test.push(sample));
  }

  /** Una vez por frame: cuenta atrás, pulso en vivo y el veredicto al terminar. */
  update(): void {
    if (this.closed || this.done) return;
    const progress = this.test.progress(performance.now());
    const live = progress.liveBpm > 0 ? `♥ ${Math.round(progress.liveBpm)}` : '♥ ––';
    this.bpmText.setText(live);
    this.countdown.setText(formatMMSS(Math.ceil(progress.remainingSec)));
    this.drawBar(progress.elapsedSec / 60);

    if (progress.elapsedSec === 0) {
      const waitedMs = performance.now() - this.openedAtMs;
      this.hint.setText(
        waitedMs > NO_SIGNAL_AFTER_MS
          ? 'Sin pulso todavía. Conecta la pulsera desde el campamento, o salta el minuto.'
          : 'Esperando el pulso de la pulsera…',
      );
      this.hint.setColor(waitedMs > NO_SIGNAL_AFTER_MS ? INK_RED : INK_DIM);
    } else {
      this.hint.setText('Midiendo tu reposo de hoy.');
      this.hint.setColor(INK_DIM);
    }

    if (progress.done) this.complete();
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
  }

  private complete(): void {
    this.done = true;
    this.result = this.test.result();
    this.countdown.setText(this.result !== undefined ? `${this.result} bpm` : '––');
    this.hint.setText(this.result !== undefined ? 'Tu reposo de hoy.' : 'No llegaron muestras suficientes.');
    this.drawBar(1);
    const verdict: ReadinessVerdict | undefined =
      this.result !== undefined ? readiness(this.opts.history, this.result) : undefined;
    this.showVerdict(verdict);
    this.setButtonVisible(this.skipButton, false);
    this.setButtonVisible(this.startButton, true);
    this.setButtonVisible(this.easierButton, verdict?.state === 'elevated' || verdict?.state === 'rest');
    this.setButtonVisible(this.restButton, verdict?.state === 'rest');
  }

  private showVerdict(verdict: ReadinessVerdict | undefined): void {
    if (!verdict || verdict.state === 'unknown') {
      const n = this.opts.history.filter((s) => s.preRideRestBpm !== undefined).length;
      this.verdictText.setText(
        verdict === undefined
          ? ''
          : `Con ${Math.max(0, 3 - n)} lectura${3 - n === 1 ? '' : 's'} más sabré cuál es tu normal.`,
      );
      this.verdictText.setColor(INK_DIM);
      return;
    }
    if (verdict.state === 'rest') {
      this.verdictText.setText(
        `${verdict.deltaBpm} latidos por encima de tu normal (${verdict.baselineBpm}).\nHoy toca descansar, no aflojar. Vuelve mañana.`,
      );
      this.verdictText.setColor(INK_RED);
      return;
    }
    if (verdict.state === 'elevated') {
      this.verdictText.setText(
        `${verdict.deltaBpm} latidos por encima de tu normal (${verdict.baselineBpm}).\nHoy tu cuerpo pide suave.`,
      );
      this.verdictText.setColor(INK_GOLD);
      return;
    }
    const delta = verdict.deltaBpm ?? 0;
    this.verdictText.setText(
      delta <= -4
        ? `Por debajo de tu normal (${verdict.baselineBpm}). Vienes fresco.`
        : `En tu normal (${verdict.baselineBpm}). Adelante con el plan.`,
    );
    this.verdictText.setColor(INK_GREEN);
  }

  private drawBar(frac: number): void {
    const cx = RENDER.width / 2;
    const w = 400;
    const y = 150 + 214;
    this.bar.clear();
    this.bar.fillStyle(INK_HEX, 0.15);
    this.bar.fillRect(cx - w / 2, y, w, 6);
    this.bar.fillStyle(INK_RED_HEX, 0.9);
    this.bar.fillRect(cx - w / 2, y, Math.round(w * Math.max(0, Math.min(1, frac))), 6);
  }

  private setButtonVisible(button: TapButton, visible: boolean): void {
    button.rect.setVisible(visible);
    button.label.setVisible(visible);
    if (visible) button.rect.setInteractive({ useHandCursor: true });
    else button.rect.disableInteractive();
  }

  private finish(skipped: boolean): void {
    const rest = skipped ? undefined : this.result;
    this.destroy();
    this.opts.onStart(rest);
  }

  private easier(): void {
    const rest = this.result;
    if (rest === undefined) return;
    this.destroy();
    this.opts.onEasier(rest);
  }

  private rest(): void {
    this.destroy();
    this.opts.onRest();
  }
}
