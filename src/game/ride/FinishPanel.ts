import Phaser from 'phaser';
import { RENDER, type InputMode } from '../../config';
import type { SessionRecord } from '../../sim/history';
import { newMarks } from '../../sim/marks';
import {
  brokenRecords,
  heartbeats,
  nextRideOptions,
  routeProgress,
  streakWeeks,
  summarizeWeek,
  weekStartMs,
} from '../../sim/progress';
import type { RideRpe, RideSummary } from '../../sim/types';
import { activeSec } from '../../sim/zones';
import { formatMMSS } from '../format';
import { promptText } from '../textPrompt';
import { FONT_MONO, FONT_SANS, UI, ZONE_COLOR } from '../theme';
import { makeTextButton, type TapButton } from '../uiButton';

const DEPTH = 30;
const PANEL_X = 200;
const PANEL_Y = 40;
const PANEL_W = 880;
const PANEL_H = 646;
const LEFT_X = PANEL_X + 40;
const RIGHT_X = PANEL_X + 470;
const GOLD = '#d9b06a';
const HARD_TARGETS = new Set(['anaerobic', 'threshold', 'mixed', 'tempo']);

const km1 = (km: number): string => km.toFixed(1).replace('.', ',');
const km2 = (km: number): string => km.toFixed(2).replace('.', ',');
const fmtInt = (n: number): string => n.toLocaleString('es');

const RPE_ES: ReadonlyArray<readonly [RideRpe, string]> = [
  ['easy', 'Fácil'],
  ['right', 'Justa'],
  ['hard', 'Demasiado'],
];
/** El diario de una palabra: las habituales a un toque, y "otra" abre el teclado. */
const NOTE_CHIPS = ['cansado', 'dormí mal', 'con energía', 'genial'];

export interface FinishPanelOptions {
  summary: RideSummary;
  /** La sesión recién guardada. */
  record: SessionRecord;
  /** Historial completo, con la sesión de hoy incluida. */
  history: readonly SessionRecord[];
  completed: boolean;
  mode: InputMode;
  /** Lo que dijo el rider: devuelve la nota de calibración que salga de ello, si hay. */
  onRpe: (rpe: RideRpe) => string | undefined;
  /** La palabra del día. */
  onNote: (note: string) => void;
  /** El día comprometido para la próxima salida (medianoche local). */
  onNextRide: (dayStartMs: number) => void;
  onBack: () => void;
}

/**
 * El resumen del amanecer: lo que hiciste hoy, lo que sumó a la semana y a
 * la Ruta, los récords y marcas que rompiste; y tres preguntas que alimentan
 * el plan: cómo te pareció (la calibración aprende con el rider de acuerdo),
 * una palabra del día (el diario) y cuándo vuelves (el día comprometido es lo
 * que más pesa en el hábito). La noche sigue viva detrás, a propósito:
 * terminar es ver el sol.
 */
export class FinishPanel {
  private readonly noteText: Phaser.GameObjects.Text;
  private readonly rpeButtons: Array<{ rpe: RideRpe; button: TapButton }> = [];
  private readonly noteButtons: TapButton[] = [];
  private readonly dayButtons: TapButton[] = [];
  private readonly hardRide: boolean;

  constructor(scene: Phaser.Scene, opts: FinishPanelOptions) {
    const before = opts.history.filter((r) => r.id !== opts.record.id);
    const nowMs = opts.record.startedAtMs + opts.record.durationSec * 1000;
    this.hardRide = HARD_TARGETS.has(opts.record.target);

    // El dim se traga los toques para que la HUD de abajo quede inerte.
    scene.add
      .rectangle(RENDER.width / 2, RENDER.height / 2, RENDER.width, RENDER.height, 0x05050a, 0.35)
      .setDepth(DEPTH)
      .setInteractive();
    scene.add
      .rectangle(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 0x0b0e18, 0.86)
      .setOrigin(0, 0)
      .setDepth(DEPTH)
      .setStrokeStyle(2, 0x2a3142);

    const text = (
      x: number,
      y: number,
      value: string,
      size: number,
      color: string,
      extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {},
    ) =>
      scene.add
        .text(x, y, value, { fontFamily: size >= 24 ? FONT_MONO : FONT_SANS, fontSize: `${size}px`, color, ...extra })
        .setDepth(DEPTH + 1);

    const cx = RENDER.width / 2;
    scene.add
      .text(cx, PANEL_Y + 40, opts.completed ? '¡SOBREVIVISTE!' : 'SALIDA CORTADA', {
        fontFamily: FONT_SANS,
        fontSize: '50px',
        fontStyle: 'bold',
        color: opts.completed ? UI.good : UI.warn,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    scene.add
      .text(
        cx,
        PANEL_Y + 80,
        opts.completed
          ? `${opts.record.programName} · amaneció`
          : `${opts.record.programName} · lo pedaleado queda guardado`,
        { fontFamily: FONT_SANS, fontSize: '18px', color: UI.textMuted },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);

    // ---- izquierda: la salida en números ----
    let y = PANEL_Y + 116;
    const s = opts.summary;
    const rows: Array<[string, string]> = [
      ['Distancia', `${km2(s.distanceM / 1000)} km`],
      ['Tiempo', formatMMSS(s.durationSec)],
      ['Alcanzado', `${s.timesCaught} ${s.timesCaught === 1 ? 'vez' : 'veces'}`],
    ];
    if (opts.mode === 'heartRate') {
      if (opts.record.preRideRestBpm !== undefined) {
        rows.push(['Reposo de hoy', `${opts.record.preRideRestBpm} bpm`]);
      }
      rows.push(['Pulso medio', `${Math.round(s.avgHeartRateBpm)} bpm`]);
      rows.push(['Pico sostenido', `${Math.round(s.peakHeartRateBpm)} bpm`]);
      rows.push(['Cardio (Z2+)', `${Math.round(activeSec(s.zoneSec) / 60)} min`]);
      if (s.durationSec > 0) {
        rows.push(['Precisión de zona', `${Math.round((s.inZoneSec / s.durationSec) * 100)} %`]);
      }
      if (s.bestInZoneRunSec >= 60) rows.push(['Mejor racha en zona', formatMMSS(s.bestInZoneRunSec)]);
      if (s.recoveryDrops.length > 0) {
        const drop = s.recoveryDrops.reduce((a, b) => a + b, 0) / s.recoveryDrops.length;
        rows.push(['Recuperación en 1 min', `${Math.round(drop)} lpm`]);
      }
    } else if (opts.mode === 'feel') {
      rows.push(['Cardio (por el plan)', `${Math.round(activeSec(s.zoneSec) / 60)} min`]);
    } else {
      rows.push(['Cadencia media', `${Math.round(s.avgCadenceRpm)} rpm`]);
    }
    const pitch = rows.length > 7 ? 28 : rows.length > 6 ? 30 : 38;
    for (const [label, value] of rows) {
      text(LEFT_X, y, label, 17, UI.textMuted);
      text(LEFT_X + 380, y - 4, value, 24, UI.textBright).setOrigin(1, 0);
      y += pitch;
    }

    // ---- derecha: minutos por zona ----
    text(RIGHT_X, PANEL_Y + 116, opts.mode === 'feel' ? 'MINUTOS POR ZONA (PRESCRITA)' : 'MINUTOS POR ZONA', 13, UI.textDim).setLetterSpacing(2);
    const zones = s.zoneSec;
    const maxSec = Math.max(60, ...zones);
    const g = scene.add.graphics().setDepth(DEPTH + 1);
    const barW = 300;
    for (let z = 1; z <= 5; z++) {
      const zy = PANEL_Y + 142 + (z - 1) * 26;
      const sec = zones[z] ?? 0;
      const w = Math.max(2, (barW * sec) / maxSec);
      g.fillStyle(0x1c2334, 1);
      g.fillRect(RIGHT_X + 40, zy, barW, 18);
      g.fillStyle(ZONE_COLOR[z] ?? 0xffffff, sec > 0 ? 1 : 0.35);
      g.fillRect(RIGHT_X + 40, zy, w, 18);
      text(RIGHT_X, zy, `Z${z}`, 15, UI.textMuted);
      text(RIGHT_X + 40 + barW + 10, zy, `${Math.round(sec / 60)} min`, 14, UI.textMuted);
    }
    const easy = zones[0] ?? 0;
    text(RIGHT_X, PANEL_Y + 142 + 5 * 26, `suave (bajo Z1): ${Math.round(easy / 60)} min`, 13, UI.textDim);

    // ---- derecha, abajo: cómo fue, una palabra, cuándo vuelves ----
    const askY = PANEL_Y + 300;
    text(RIGHT_X, askY, '¿CÓMO FUE?', 13, UI.textDim).setLetterSpacing(2);
    RPE_ES.forEach(([rpe, label], i) => {
      const button = makeTextButton(scene, RIGHT_X + 60 + i * 128, askY + 40, 118, 38, label, () => this.chooseRpe(rpe, opts), DEPTH + 1, 17);
      this.rpeButtons.push({ rpe, button });
    });
    text(RIGHT_X, askY + 74, 'UNA PALABRA DEL DÍA', 13, UI.textDim).setLetterSpacing(2);
    const chipW = 72;
    [...NOTE_CHIPS, 'otra…'].forEach((word, i) => {
      const button = makeTextButton(scene, RIGHT_X + chipW / 2 + i * (chipW + 6), askY + 112, chipW, 34, word, () => void this.chooseNote(i, word, opts), DEPTH + 1, 13);
      this.noteButtons.push(button);
    });
    text(RIGHT_X, askY + 144, '¿CUÁNDO VUELVES?', 13, UI.textDim).setLetterSpacing(2);
    nextRideOptions(nowMs).forEach((option, i) => {
      const button = makeTextButton(scene, RIGHT_X + 60 + i * 128, askY + 184, 118, 38, option.label, () => this.chooseDay(i, option.dayStartMs, opts), DEPTH + 1, 14);
      this.dayButtons.push(button);
    });

    // ---- izquierda, abajo: semana, Ruta, el corazón, récords y marcas, nota ----
    y = Math.max(y + 6, PANEL_Y + 392);
    const week = summarizeWeek(opts.history, weekStartMs(nowMs));
    const streak = streakWeeks(opts.history, nowMs);
    const weekLine =
      `Esta semana: ${week.sessions} de ${week.goal.sessionsPerWeek} salidas · ` +
      `${Math.round(week.activeMin)} de ${week.goal.activeMinPerWeek} min de cardio` +
      (streak >= 2 ? ` · racha de ${streak} semanas` : week.met ? ' · semana cumplida' : '');
    text(LEFT_X, y, weekLine, 15, week.met ? UI.good : UI.textMuted, { wordWrap: { width: 410 } });
    y += 36;

    const routeBefore = routeProgress(before);
    const routeAfter = routeProgress(opts.history);
    const added = routeAfter.totalKm - routeBefore.totalKm;
    const reachedNew = routeAfter.reached > routeBefore.reached;
    const routeLine = reachedNew
      ? `La Ruta: +${km1(added)} km · ¡llegaste a ${routeAfter.last?.name ?? 'un refugio'}!`
      : `La Ruta: +${km1(added)} km · faltan ${km1(routeAfter.remainingKm)} km hasta ${routeAfter.next.name}`;
    text(LEFT_X, y, routeLine, 15, GOLD, { wordWrap: { width: 410 } });
    y += 32;

    const beats = opts.mode === 'heartRate' ? heartbeats(s.avgHeartRateBpm, s.durationSec) : undefined;
    if (beats !== undefined) {
      text(LEFT_X, y, `Hoy tu corazón latió unas ${fmtInt(beats)} veces entrenando.`, 15, UI.textMuted);
      y += 32;
    }

    const records = brokenRecords(before, opts.record).map((r) => `★ ${r}`);
    const marks = newMarks(before, opts.history).map((m) => `★ Marca: ${m.title}`);
    const wins = [...records, ...marks];
    if (wins.length > 0) {
      text(LEFT_X, y, wins.join('   '), 15, GOLD, { wordWrap: { width: 410 } });
      y += 36;
    }
    this.noteText = text(LEFT_X, Math.min(y, PANEL_Y + 560), '', 14, UI.warn, { wordWrap: { width: 410 } });

    makeTextButton(scene, cx, PANEL_Y + PANEL_H - 36, 320, 48, 'Volver al campamento', opts.onBack, DEPTH + 1, 20);
  }

  private chooseRpe(rpe: RideRpe, opts: FinishPanelOptions): void {
    for (const { rpe: r, button } of this.rpeButtons) {
      button.rect.setFillStyle(r === rpe ? 0x1e8449 : UI.button);
      button.rect.setAlpha(r === rpe ? 1 : 0.55);
    }
    const note = opts.onRpe(rpe);
    // Tras una salida dura, el descanso es un recurso y se dice.
    const rest = this.hardRide ? ' Mañana descansa o suave: el cuerpo asimila hoy.' : '';
    this.noteText.setText(
      note ?? (rpe === 'hard' ? `Anotado. Si la próxima también es demasiado, el plan afloja.${rest}` : `Anotado.${rest}`),
    );
    this.noteText.setColor(note ? UI.warn : UI.textDim);
  }

  private async chooseNote(index: number, word: string, opts: FinishPanelOptions): Promise<void> {
    let note = word;
    if (index === NOTE_CHIPS.length) {
      const typed = await promptText({ title: 'Una palabra sobre el día', placeholder: 'estresado, sin ganas, feliz…', maxLength: 30 });
      if (!typed) return;
      note = typed;
      this.noteButtons[index]?.label.setText(note.length > 9 ? `${note.slice(0, 8)}…` : note);
    }
    this.noteButtons.forEach((b, i) => {
      b.rect.setFillStyle(i === index ? 0x1e8449 : UI.button);
      b.rect.setAlpha(i === index ? 1 : 0.55);
    });
    opts.onNote(note);
  }

  private chooseDay(index: number, dayStartMs: number, opts: FinishPanelOptions): void {
    this.dayButtons.forEach((b, i) => {
      b.rect.setFillStyle(i === index ? 0x1e8449 : UI.button);
      b.rect.setAlpha(i === index ? 1 : 0.55);
    });
    opts.onNextRide(dayStartMs);
  }
}
