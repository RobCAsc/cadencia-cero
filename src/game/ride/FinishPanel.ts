import Phaser from 'phaser';
import { RENDER, type InputMode } from '../../config';
import { describeEncounter } from '../../sim/encounters';
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
import { FONT_MONO, FONT_SANS, ZONE_COLOR } from '../theme';
import { makeTextButton } from '../uiButton';
import {
  face,
  heading,
  icon,
  INK,
  INK_DIM,
  INK_GOLD,
  INK_GOLD_HEX,
  INK_GREEN,
  INK_GREEN_HEX,
  INK_HEX,
  INK_MUTED,
  INK_RED,
  INK_RED_HEX,
  PAPER_DARK,
  paper,
  stamp,
  type IconName,
} from '../ui/paper';

const DEPTH = 30;
const PANEL_X = 200;
const PANEL_Y = 36;
const PANEL_W = 880;
const PANEL_H = 652;
const LEFT_X = PANEL_X + 36;
const HARD_TARGETS = new Set(['anaerobic', 'threshold', 'mixed', 'tempo']);

const km1 = (km: number): string => km.toFixed(1).replace('.', ',');
const km2 = (km: number): string => km.toFixed(2).replace('.', ',');
const fmtInt = (n: number): string => n.toLocaleString('es');

const RPE_ES: ReadonlyArray<readonly [RideRpe, string]> = [
  ['easy', 'fácil'],
  ['right', 'justa'],
  ['hard', 'demasiado'],
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

interface Tap {
  hit: Phaser.GameObjects.Rectangle;
  paint: (selected: boolean) => void;
}

/**
 * El resumen del amanecer, en un papel: cuatro fichas grandes con icono, los
 * minutos por zona, tres caras para decir cómo fue, una palabra del día, y
 * tres casillas de calendario para comprometer el siguiente. Lo que sumó a
 * la semana y a la Ruta, y los récords y marcas, debajo. La noche sigue viva
 * detrás, a propósito: terminar es ver el sol.
 */
export class FinishPanel {
  private readonly scene: Phaser.Scene;
  private readonly noteText: Phaser.GameObjects.Text;
  private readonly rpeTaps: Array<{ rpe: RideRpe; tap: Tap }> = [];
  private readonly noteTaps: Array<{ tap: Tap; label: Phaser.GameObjects.Text }> = [];
  private readonly dayTaps: Tap[] = [];
  private readonly hardRide: boolean;

  constructor(scene: Phaser.Scene, opts: FinishPanelOptions) {
    this.scene = scene;
    const before = opts.history.filter((r) => r.id !== opts.record.id);
    const nowMs = opts.record.startedAtMs + opts.record.durationSec * 1000;
    this.hardRide = HARD_TARGETS.has(opts.record.target);

    // El dim se traga los toques para que la HUD de abajo quede inerte.
    scene.add
      .rectangle(RENDER.width / 2, RENDER.height / 2, RENDER.width, RENDER.height, 0x05050a, 0.45)
      .setDepth(DEPTH)
      .setInteractive();
    paper(scene, PANEL_X, PANEL_Y, PANEL_W, PANEL_H, { depth: DEPTH, tilt: 0 });

    const text = (x: number, y: number, value: string, size: number, color: string, extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}) =>
      scene.add
        .text(x, y, value, { fontFamily: size >= 24 ? FONT_MONO : FONT_SANS, fontSize: `${size}px`, color, ...extra })
        .setDepth(DEPTH + 1);
    const g = scene.add.graphics().setDepth(DEPTH + 1);

    const cx = RENDER.width / 2;
    icon(g, opts.completed ? 'sun' : 'skull', cx - 250, PANEL_Y + 46, 44, opts.completed ? INK_GOLD_HEX : INK_RED_HEX);
    text(cx, PANEL_Y + 46, opts.completed ? '¡SOBREVIVISTE!' : 'SALIDA CORTADA', 44, opts.completed ? INK_GREEN : INK_RED, { fontFamily: FONT_SANS, fontStyle: 'bold' }).setOrigin(0.5);
    text(cx, PANEL_Y + 82, opts.completed ? `${opts.record.programName} · amaneció` : `${opts.record.programName} · lo pedaleado queda guardado`, 15, INK_MUTED).setOrigin(0.5);

    // ---- cuatro fichas ----
    const s = opts.summary;
    const cardio = Math.round(activeSec(s.zoneSec) / 60);
    const tiles: Array<[IconName, string, string]> = [
      ['road', `${km2(s.distanceM / 1000)}`, 'km'],
      ['clock', formatMMSS(s.durationSec), 'tiempo'],
      ['zombie', `${s.timesCaught}`, s.timesCaught === 1 ? 'vez alcanzado' : 'veces alcanzado'],
      ['heart', `${cardio}`, opts.mode === 'feel' ? 'min cardio (plan)' : 'min de cardio'],
    ];
    const tileW = 200;
    tiles.forEach(([ico, value, label], i) => {
      const tx = LEFT_X + i * (tileW + 4);
      const ty = PANEL_Y + 104;
      g.fillStyle(PAPER_DARK, 0.9);
      g.fillRect(tx, ty, tileW, 84);
      icon(g, ico, tx + 26, ty + 42, 30, ico === 'zombie' ? INK_RED_HEX : INK_HEX, 0.85);
      text(tx + 52, ty + 14, value, 30, INK, { fontStyle: 'bold' });
      text(tx + 52, ty + 54, label, 13, INK_MUTED);
    });

    // ---- minutos por zona (izquierda) y el pulso (derecha) ----
    const zoneY = PANEL_Y + 204;
    heading(scene, LEFT_X, zoneY, 'Minutos por zona', 12, INK_MUTED, DEPTH + 1);
    const zones = s.zoneSec;
    const maxSec = Math.max(60, ...zones);
    const barW = 240;
    for (let z = 1; z <= 5; z++) {
      const zy = zoneY + 24 + (z - 1) * 24;
      const sec = zones[z] ?? 0;
      const w = Math.max(2, (barW * sec) / maxSec);
      g.fillStyle(INK_HEX, 0.1);
      g.fillRect(LEFT_X + 34, zy, barW, 16);
      g.fillStyle(ZONE_COLOR[z] ?? 0xffffff, sec > 0 ? 0.95 : 0.3);
      g.fillRect(LEFT_X + 34, zy, w, 16);
      text(LEFT_X, zy - 1, `Z${z}`, 14, INK_MUTED);
      text(LEFT_X + 34 + barW + 8, zy - 1, `${Math.round(sec / 60)}'`, 13, INK_MUTED);
    }

    const rightX = LEFT_X + 360;
    const rows: Array<[string, string]> = [];
    if (opts.mode === 'heartRate') {
      if (opts.record.preRideRestBpm !== undefined) rows.push(['reposo de hoy', `${opts.record.preRideRestBpm}`]);
      rows.push(['pulso medio', `${Math.round(s.avgHeartRateBpm)}`]);
      rows.push(['pico sostenido', `${Math.round(s.peakHeartRateBpm)}`]);
      if (s.durationSec > 0) rows.push(['precisión de zona', `${Math.round((s.inZoneSec / s.durationSec) * 100)} %`]);
      if (s.bestInZoneRunSec >= 60) rows.push(['mejor racha en zona', formatMMSS(s.bestInZoneRunSec)]);
      if (s.recoveryDrops.length > 0) {
        const drop = s.recoveryDrops.reduce((a, b) => a + b, 0) / s.recoveryDrops.length;
        rows.push(['recuperación en 1 min', `${Math.round(drop)}`]);
      }
    } else if (opts.mode === 'cadence') {
      rows.push(['cadencia media', `${Math.round(s.avgCadenceRpm)} rpm`]);
    }
    if (rows.length > 0) heading(scene, rightX, zoneY, 'El pulso', 12, INK_MUTED, DEPTH + 1);
    rows.forEach(([label, value], i) => {
      const ry = zoneY + 24 + i * 23;
      text(rightX, ry, label, 13, INK_MUTED);
      text(rightX + 300, ry - 3, value, 18, INK, { fontStyle: 'bold' }).setOrigin(1, 0);
      g.lineStyle(1, INK_HEX, 0.15);
      g.lineBetween(rightX, ry + 18, rightX + 300, ry + 18);
    });
    const beats = opts.mode === 'heartRate' ? heartbeats(s.avgHeartRateBpm, s.durationSec) : undefined;
    if (beats !== undefined) {
      // La señal de la pulsera, en claro: sin ella no hay diagnóstico honesto.
      const stale = Math.round(s.staleHeartRateSec);
      const signal = stale > 0 ? `${stale} s sin señal de pulsera` : 'pulsera sin cortes';
      icon(g, 'heart', rightX + 8, zoneY + 24 + rows.length * 23 + 12, 14, INK_RED_HEX);
      text(rightX + 22, zoneY + 24 + rows.length * 23 + 4, `latió unas ${fmtInt(beats)} veces · ${signal}`, 13, INK_MUTED);
    }

    // ---- las tres preguntas ----
    const askY = PANEL_Y + 360;
    heading(scene, LEFT_X, askY, '¿Cómo fue?', 12, INK_MUTED, DEPTH + 1);
    RPE_ES.forEach(([rpe, label], i) => {
      const fx = LEFT_X + 40 + i * 78;
      const fy = askY + 52;
      const tap = this.makeTap(fx, fy, 70, 74, (gfx, selected) => {
        face(gfx, fx, fy - 8, 22, rpe, selected ? INK_GREEN_HEX : INK_HEX, selected ? 1 : 0.55);
      });
      text(fx, fy + 22, label, 11, INK_MUTED).setOrigin(0.5, 0);
      tap.hit.on('pointerdown', () => this.chooseRpe(rpe, opts));
      this.rpeTaps.push({ rpe, tap });
    });

    const noteX = LEFT_X + 280;
    heading(scene, noteX, askY, 'Una palabra del día', 12, INK_MUTED, DEPTH + 1);
    [...NOTE_CHIPS, 'otra…'].forEach((word, i) => {
      const chipW = 88;
      const nx = noteX + chipW / 2 + (i % 3) * (chipW + 6);
      const ny = askY + 36 + Math.floor(i / 3) * 34;
      const label = text(nx, ny, word, 12, INK).setOrigin(0.5).setDepth(DEPTH + 3);
      const tap = this.makeTap(nx, ny, chipW, 28, (gfx, selected) => {
        gfx.fillStyle(selected ? INK_GREEN_HEX : PAPER_DARK, selected ? 0.9 : 1);
        gfx.fillRect(nx - chipW / 2, ny - 14, chipW, 28);
        gfx.lineStyle(1.5, INK_HEX, 0.5);
        gfx.strokeRect(nx - chipW / 2, ny - 14, chipW, 28);
      });
      tap.hit.on('pointerdown', () => void this.chooseNote(i, word, opts));
      this.noteTaps.push({ tap, label });
    });

    const dayX = LEFT_X + 580;
    heading(scene, dayX, askY, '¿Cuándo vuelves?', 12, INK_MUTED, DEPTH + 1);
    nextRideOptions(nowMs).forEach((option, i) => {
      const dx = dayX + 32 + i * 74;
      const dy = askY + 52;
      const dayName = new Date(option.dayStartMs).toLocaleDateString('es', { weekday: 'short' }).replace('.', '');
      const dayNum = new Date(option.dayStartMs).getDate();
      const tap = this.makeTap(dx, dy, 64, 74, (gfx, selected) => {
        gfx.fillStyle(selected ? INK_GREEN_HEX : PAPER_DARK, selected ? 0.9 : 1);
        gfx.fillRect(dx - 30, dy - 34, 60, 68);
        gfx.fillStyle(selected ? INK_HEX : INK_RED_HEX, 0.9);
        gfx.fillRect(dx - 30, dy - 34, 60, 14);
      });
      text(dx, dy - 27, dayName, 10, '#f2eadc').setOrigin(0.5).setDepth(DEPTH + 3);
      text(dx, dy - 2, `${dayNum}`, 26, INK, { fontStyle: 'bold' }).setOrigin(0.5).setDepth(DEPTH + 3);
      text(dx, dy + 22, i === 0 ? 'mañana' : '', 10, INK_MUTED).setOrigin(0.5).setDepth(DEPTH + 3);
      tap.hit.on('pointerdown', () => this.chooseDay(i, option.dayStartMs, opts));
      this.dayTaps.push(tap);
    });

    // ---- lo que sumó ----
    let y = PANEL_Y + 470;
    const week = summarizeWeek(opts.history, weekStartMs(nowMs));
    const streak = streakWeeks(opts.history, nowMs);
    icon(g, 'bike', LEFT_X + 10, y + 9, 18, INK_HEX, 0.8);
    text(LEFT_X + 26, y, `Semana: ${week.sessions} de ${week.goal.sessionsPerWeek} salidas · ${Math.round(week.activeMin)} de ${week.goal.activeMinPerWeek} min${streak >= 2 ? ` · racha de ${streak}` : week.met ? ' · cumplida' : ''}`, 14, week.met ? INK_GREEN : INK_MUTED);
    const routeBefore = routeProgress(before);
    const routeAfter = routeProgress(opts.history);
    const added = routeAfter.totalKm - routeBefore.totalKm;
    const reachedNew = routeAfter.reached > routeBefore.reached;
    icon(g, 'road', LEFT_X + 440, y + 9, 18, INK_GOLD_HEX, 0.9);
    text(LEFT_X + 456, y, reachedNew ? `+${km1(added)} km · ¡${routeAfter.last?.name ?? 'refugio'}!` : `+${km1(added)} km · faltan ${km1(routeAfter.remainingKm)} hasta ${routeAfter.next.name}`, 14, INK_GOLD, { wordWrap: { width: 360 } });
    y += 30;
    const records = brokenRecords(before, opts.record).map((r) => `★ ${r}`);
    const marks = newMarks(before, opts.history).map((m) => `★ Marca: ${m.title}`);
    const wins = [...records, ...marks];
    if (wins.length > 0) {
      icon(g, 'trophy', LEFT_X + 10, y + 9, 18, INK_GOLD_HEX);
      text(LEFT_X + 26, y, wins.join('   '), 14, INK_GOLD, { wordWrap: { width: PANEL_W - 100 } });
      y += 30;
    }
    // Lo que pasó en la carretera sin que nadie lo prescribiera: una línea, sin más.
    const encounter = opts.record.encounter;
    if (encounter) {
      icon(g, 'compass', LEFT_X + 10, y + 9, 18, INK_HEX, 0.8);
      text(LEFT_X + 26, y, describeEncounter(encounter.kind, encounter.km), 14, INK_MUTED);
      y += 30;
    }
    if (this.hardRide) stamp(scene, PANEL_X + PANEL_W - 130, PANEL_Y + PANEL_H - 100, 'mañana descansa', INK_GOLD, DEPTH + 2, 12);
    this.noteText = text(LEFT_X, Math.min(y, PANEL_Y + 552), '', 13, INK_GOLD, { wordWrap: { width: PANEL_W - 300 } });

    makeTextButton(scene, cx, PANEL_Y + PANEL_H - 36, 320, 48, 'Volver al campamento', opts.onBack, DEPTH + 2, 20);
  }

  /** Un área tocable con su dibujo, que se repinta al seleccionar. */
  private makeTap(cx: number, cy: number, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics, selected: boolean) => void): Tap {
    const gfx = this.scene.add.graphics().setDepth(DEPTH + 2);
    const hit = this.scene.add.rectangle(cx, cy, w, h, 0xffffff, 0.001).setDepth(DEPTH + 4).setInteractive({ useHandCursor: true });
    const paint = (selected: boolean) => {
      gfx.clear();
      draw(gfx, selected);
    };
    paint(false);
    return { hit, paint };
  }

  private chooseRpe(rpe: RideRpe, opts: FinishPanelOptions): void {
    for (const { rpe: r, tap } of this.rpeTaps) tap.paint(r === rpe);
    const note = opts.onRpe(rpe);
    const rest = this.hardRide ? ' Mañana descansa o suave: el cuerpo asimila hoy.' : '';
    this.noteText.setText(note ?? (rpe === 'hard' ? `Anotado. Si la próxima también es demasiado, el plan afloja.${rest}` : `Anotado.${rest}`));
    this.noteText.setColor(note ? INK_RED : INK_DIM);
  }

  private async chooseNote(index: number, word: string, opts: FinishPanelOptions): Promise<void> {
    let note = word;
    if (index === NOTE_CHIPS.length) {
      const typed = await promptText({ title: 'Una palabra sobre el día', placeholder: 'estresado, sin ganas, feliz…', maxLength: 30 });
      if (!typed) return;
      note = typed;
      this.noteTaps[index]?.label.setText(note.length > 10 ? `${note.slice(0, 9)}…` : note);
    }
    this.noteTaps.forEach(({ tap, label }, i) => {
      tap.paint(i === index);
      label.setColor(i === index ? '#f2eadc' : INK);
    });
    opts.onNote(note);
  }

  private chooseDay(index: number, dayStartMs: number, opts: FinishPanelOptions): void {
    this.dayTaps.forEach((tap, i) => tap.paint(i === index));
    opts.onNextRide(dayStartMs);
  }
}
