import Phaser from 'phaser';
import { RENDER } from '../../config';
import type { SessionRecord } from '../../sim/history';
import {
  brokenRecords,
  routeProgress,
  streakWeeks,
  summarizeWeek,
  weekStartMs,
} from '../../sim/progress';
import type { RideSummary } from '../../sim/types';
import { activeSec } from '../../sim/zones';
import { formatMMSS } from '../format';
import { FONT_MONO, FONT_SANS, UI, ZONE_COLOR } from '../theme';
import { makeTextButton } from '../uiButton';

const DEPTH = 30;
const PANEL_X = 200;
const PANEL_Y = 48;
const PANEL_W = 880;
const PANEL_H = 630;
const LEFT_X = PANEL_X + 40;
const RIGHT_X = PANEL_X + 470;
const GOLD = '#d9b06a';

const km1 = (km: number): string => km.toFixed(1).replace('.', ',');
const km2 = (km: number): string => km.toFixed(2).replace('.', ',');

export interface FinishPanelOptions {
  summary: RideSummary;
  /** La sesión recién guardada. */
  record: SessionRecord;
  /** Historial completo, con la sesión de hoy incluida. */
  history: readonly SessionRecord[];
  completed: boolean;
  heartRateMode: boolean;
  calibrationNote: string | undefined;
  onBack: () => void;
}

/**
 * El resumen del amanecer: lo que hiciste hoy, lo que sumó a la semana y a
 * la Ruta, los récords que rompiste. La noche sigue viva detrás, a propósito:
 * terminar es ver el sol.
 */
export class FinishPanel {
  constructor(scene: Phaser.Scene, opts: FinishPanelOptions) {
    const before = opts.history.filter((r) => r.id !== opts.record.id);
    const nowMs = opts.record.startedAtMs + opts.record.durationSec * 1000;

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
      .text(cx, PANEL_Y + 44, opts.completed ? '¡SOBREVIVISTE!' : 'SALIDA CORTADA', {
        fontFamily: FONT_SANS,
        fontSize: '54px',
        fontStyle: 'bold',
        color: opts.completed ? UI.good : UI.warn,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    scene.add
      .text(
        cx,
        PANEL_Y + 88,
        opts.completed
          ? `${opts.record.programName} · amaneció`
          : `${opts.record.programName} · lo pedaleado queda guardado`,
        { fontFamily: FONT_SANS, fontSize: '18px', color: UI.textMuted },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);

    // ---- izquierda: la salida en números ----
    let y = PANEL_Y + 128;
    const s = opts.summary;
    const rows: Array<[string, string]> = [
      ['Distancia', `${km2(s.distanceM / 1000)} km`],
      ['Tiempo', formatMMSS(s.durationSec)],
      ['Alcanzado', `${s.timesCaught} ${s.timesCaught === 1 ? 'vez' : 'veces'}`],
    ];
    if (opts.heartRateMode) {
      rows.push(['Pulso medio', `${Math.round(s.avgHeartRateBpm)} bpm`]);
      rows.push(['Pico sostenido', `${Math.round(s.peakHeartRateBpm)} bpm`]);
      rows.push(['Cardio (Z2+)', `${Math.round(activeSec(s.zoneSec) / 60)} min`]);
    } else {
      rows.push(['Cadencia media', `${Math.round(s.avgCadenceRpm)} rpm`]);
    }
    for (const [label, value] of rows) {
      text(LEFT_X, y, label, 18, UI.textMuted);
      text(LEFT_X + 380, y - 4, value, 26, UI.textBright).setOrigin(1, 0);
      y += 40;
    }

    // ---- derecha: minutos por zona ----
    text(RIGHT_X, PANEL_Y + 128, 'MINUTOS POR ZONA', 13, UI.textDim).setLetterSpacing(2);
    const zones = s.zoneSec;
    const maxSec = Math.max(60, ...zones);
    const g = scene.add.graphics().setDepth(DEPTH + 1);
    const barW = 300;
    for (let z = 1; z <= 5; z++) {
      const zy = PANEL_Y + 156 + (z - 1) * 34;
      const sec = zones[z] ?? 0;
      const w = Math.max(2, (barW * sec) / maxSec);
      g.fillStyle(0x1c2334, 1);
      g.fillRect(RIGHT_X + 40, zy, barW, 22);
      g.fillStyle(ZONE_COLOR[z] ?? 0xffffff, sec > 0 ? 1 : 0.35);
      g.fillRect(RIGHT_X + 40, zy, w, 22);
      text(RIGHT_X, zy + 2, `Z${z}`, 16, UI.textMuted);
      text(RIGHT_X + 40 + barW + 10, zy + 2, `${Math.round(sec / 60)} min`, 15, UI.textMuted);
    }
    const easy = zones[0] ?? 0;
    text(RIGHT_X, PANEL_Y + 156 + 5 * 34 + 2, `suave (bajo Z1): ${Math.round(easy / 60)} min`, 14, UI.textDim);

    // ---- abajo: semana, Ruta, récords ----
    y = PANEL_Y + 372;
    const week = summarizeWeek(opts.history, weekStartMs(nowMs));
    const streak = streakWeeks(opts.history, nowMs);
    const weekLine =
      `Esta semana: ${week.sessions} de ${week.goal.sessionsPerWeek} salidas · ` +
      `${Math.round(week.activeMin)} de ${week.goal.activeMinPerWeek} min de cardio` +
      (streak >= 2 ? ` · racha de ${streak} semanas` : week.met ? ' · semana cumplida' : '');
    text(LEFT_X, y, weekLine, 18, week.met ? UI.good : UI.textMuted);
    y += 32;

    const routeBefore = routeProgress(before);
    const routeAfter = routeProgress(opts.history);
    const added = routeAfter.totalKm - routeBefore.totalKm;
    const reachedNew = routeAfter.reached > routeBefore.reached;
    const routeLine = reachedNew
      ? `La Ruta: +${km1(added)} km · ¡llegaste a ${routeAfter.last?.name ?? 'un refugio'}!`
      : `La Ruta: +${km1(added)} km · faltan ${km1(routeAfter.remainingKm)} km hasta ${routeAfter.next.name}`;
    text(LEFT_X, y, routeLine, 18, GOLD);
    y += 32;

    const records = brokenRecords(before, opts.record);
    if (records.length > 0) {
      text(LEFT_X, y, records.map((r) => `★ ${r}`).join('    '), 18, GOLD, { wordWrap: { width: PANEL_W - 80 } });
      y += 32;
    }
    if (opts.calibrationNote) {
      text(LEFT_X, y, opts.calibrationNote, 16, UI.warn, { wordWrap: { width: PANEL_W - 80 } });
    }

    makeTextButton(scene, cx, PANEL_Y + PANEL_H - 56, 320, 64, 'Volver al campamento', opts.onBack, DEPTH + 1, 24);
  }
}
