import Phaser from 'phaser';
import type { SessionRecord } from '../../sim/history';
import { marks } from '../../sim/marks';
import {
  healthTrends,
  personalRecords,
  recentWeeks,
  routeProgress,
  season,
  SEASON_WEEKS,
  streakWeeks,
  summarizeWeek,
  weekAtRisk,
  weekStartMs,
  type Trend,
} from '../../sim/progress';
import { formatMMSS } from '../format';
import { FONT_MONO, FONT_SANS, UI } from '../theme';

// La columna del hábito en el campamento: la semana en curso, la racha, la
// Ruta hacia el próximo refugio y la salud. Se redibuja entera con show();
// no guarda estado propio, todo sale de la lista de sesiones.

const TRACK = 0x2a3142;
const ROUTE = 0xd9b06a;
const ROUTE_TEXT = '#d9b06a';
const CURRENT_WEEK = 0x7ec8ff;
const RIDER = 0xecf0f1;
const WEEKS_SHOWN = 8;

const km1 = (km: number): string => km.toFixed(1).replace('.', ',');

export class ProgressPanel {
  private objects: Phaser.GameObjects.GameObject[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly x: number,
    private readonly y: number,
    private readonly width: number,
  ) {}

  show(sessions: readonly SessionRecord[], nowMs: number): void {
    this.objects.forEach((o) => o.destroy());
    this.objects = [];
    let y = this.y;
    y = this.drawWeek(sessions, nowMs, y);
    y = this.drawRoute(sessions, y + 26);
    this.drawHealth(sessions, y + 26);
  }

  // ---- esta semana ---------------------------------------------------------

  private drawWeek(sessions: readonly SessionRecord[], nowMs: number, y0: number): number {
    const week = summarizeWeek(sessions, weekStartMs(nowMs));
    const streak = streakWeeks(sessions, nowMs);
    const current = season(sessions, nowMs);
    let y = y0;
    this.heading(y, current ? `TEMPORADA ${current.number} · SEMANA ${current.week} DE ${SEASON_WEEKS}` : 'ESTA SEMANA');
    y += 26;

    const done = Math.min(week.sessions, week.goal.sessionsPerWeek);
    this.text(this.x, y, `${week.sessions} de ${week.goal.sessionsPerWeek} salidas`, 28, UI.textBright, 'bold');
    // Puntos de salida: uno por salida de la meta, llenos los hechos.
    const g = this.scene.add.graphics();
    const dotX0 = this.x + this.width - (week.goal.sessionsPerWeek - 1) * 30 - 10;
    for (let i = 0; i < week.goal.sessionsPerWeek; i++) {
      const cx = dotX0 + i * 30;
      if (i < done) {
        g.fillStyle(0x2ecc71, 1);
        g.fillCircle(cx, y + 17, 10);
      } else {
        g.lineStyle(2, 0x3a4256, 1);
        g.strokeCircle(cx, y + 17, 10);
      }
    }
    // Salidas extra por encima de la meta: un punto más pequeño y dorado.
    for (let i = week.goal.sessionsPerWeek; i < week.sessions && i < week.goal.sessionsPerWeek + 3; i++) {
      g.fillStyle(ROUTE, 1);
      g.fillCircle(dotX0 + (week.goal.sessionsPerWeek - 1) * 30 + 26 + (i - week.goal.sessionsPerWeek) * 14, y + 17, 5);
    }
    this.objects.push(g);
    y += 46;

    const activeMin = Math.round(week.activeMin);
    this.text(this.x, y, `Cardio en zona: ${activeMin} de ${week.goal.activeMinPerWeek} min`, 17, UI.textMuted);
    y += 26;
    this.bar(y, Math.min(1, week.activeMin / week.goal.activeMinPerWeek), week.met ? 0x2ecc71 : 0x16a085);
    y += 22;

    // La racha; y desde el sábado, si la semana está en riesgo, eso en su lugar,
    // con la puerta de escape al lado.
    const risk = weekAtRisk(sessions, nowMs);
    const streakText = risk
      ? `Quedan ${risk.daysLeft === 1 ? 'hoy' : `${risk.daysLeft} días`} y ${risk.ridesMissing} salida${risk.ridesMissing === 1 ? '' : 's'}: diez minutos la salvan.`
      : streak >= 2
        ? `Racha: ${streak} semanas seguidas`
        : streak === 1
          ? 'Racha: 1 semana. La segunda la hace racha.'
          : sessions.length === 0
            ? 'La primera semana empieza hoy.'
            : 'Sin racha. Cumple esta semana y arranca.';
    this.text(this.x, y, streakText, risk ? 17 : 18, risk ? UI.warn : streak >= 2 ? ROUTE_TEXT : UI.textMuted);
    y += 34;

    // Las últimas semanas como barritas: cuántas salidas, y si la meta se cumplió.
    const weeks = recentWeeks(sessions, nowMs, WEEKS_SHOWN);
    const barW = Math.floor((this.width - (WEEKS_SHOWN - 1) * 10) / WEEKS_SHOWN);
    const maxH = 40;
    const bars = this.scene.add.graphics();
    weeks.forEach((w, i) => {
      const bx = this.x + i * (barW + 10);
      const level = Math.min(1, Math.max(w.sessions / w.goal.sessionsPerWeek, w.activeMin / w.goal.activeMinPerWeek));
      const h = Math.max(4, Math.round(level * maxH));
      bars.fillStyle(TRACK, 1);
      bars.fillRect(bx, y, barW, maxH);
      bars.fillStyle(w.met ? 0x2ecc71 : level > 0 ? 0x4f8a6b : TRACK, 1);
      bars.fillRect(bx, y + maxH - h, barW, h);
      if (i === weeks.length - 1) {
        bars.lineStyle(2, CURRENT_WEEK, 1);
        bars.strokeRect(bx, y, barW, maxH);
      }
    });
    this.objects.push(bars);
    this.text(this.x, y + maxH + 6, `Últimas ${WEEKS_SHOWN} semanas`, 13, UI.textDim);
    return y + maxH + 22;
  }

  // ---- la Ruta ---------------------------------------------------------------

  private drawRoute(sessions: readonly SessionRecord[], y0: number): number {
    const route = routeProgress(sessions);
    let y = y0;
    this.heading(y, 'LA RUTA');
    y += 26;
    this.text(this.x, y, `${km1(route.totalKm)} km recorridos`, 28, UI.textBright, 'bold');
    if (route.reached > 0) {
      this.text(
        this.x + this.width,
        y + 8,
        `${route.reached} refugio${route.reached === 1 ? '' : 's'}`,
        16,
        UI.textMuted,
      ).setOrigin(1, 0);
    }
    y += 50;

    // Carretera entre el último refugio y el siguiente, con el ciclista encima.
    const g = this.scene.add.graphics();
    const trackY = y;
    g.lineStyle(4, TRACK, 1);
    g.lineBetween(this.x, trackY, this.x + this.width, trackY);
    const px = this.x + route.progress01 * this.width;
    g.lineStyle(4, ROUTE, 1);
    g.lineBetween(this.x, trackY, px, trackY);
    // Refugios: casa pequeña en cada extremo.
    for (const [hx, filled] of [
      [this.x, true],
      [this.x + this.width, false],
    ] as const) {
      g.fillStyle(filled ? ROUTE : TRACK, 1);
      g.fillRect(hx - 7, trackY - 14, 14, 10);
      g.fillTriangle(hx - 9, trackY - 14, hx + 9, trackY - 14, hx, trackY - 22);
    }
    // El ciclista: rueda + rueda + silueta mínima.
    g.lineStyle(2, RIDER, 1);
    g.strokeCircle(px - 6, trackY - 6, 5);
    g.strokeCircle(px + 6, trackY - 6, 5);
    g.lineBetween(px - 6, trackY - 6, px, trackY - 12);
    g.lineBetween(px, trackY - 12, px + 6, trackY - 6);
    g.lineBetween(px, trackY - 12, px - 2, trackY - 18);
    g.fillStyle(RIDER, 1);
    g.fillCircle(px + 1, trackY - 21, 2.5);
    this.objects.push(g);

    this.text(this.x, trackY + 10, route.last?.name ?? 'Salida', 14, UI.textDim);
    this.text(this.x + this.width, trackY + 10, route.next.name, 14, UI.textMuted).setOrigin(1, 0);
    y = trackY + 34;
    this.text(
      this.x,
      y,
      `Faltan ${km1(route.remainingKm)} km hasta ${route.next.name}`,
      17,
      ROUTE_TEXT,
    );
    return y + 24;
  }

  // ---- salud -----------------------------------------------------------------

  private drawHealth(sessions: readonly SessionRecord[], y0: number): void {
    const r = personalRecords(sessions);
    let y = y0;
    this.heading(y, 'SALUD');
    y += 26;
    if (r.rides === 0) {
      this.text(this.x, y, 'Tu primera salida abre la Ruta. Corta y suave: lo que importa es volver mañana.', 17, UI.textMuted, undefined, this.width);
      return;
    }
    // Los tres números que un pulsómetro sí puede dar, con su tendencia:
    // reposo (baja con la forma), recuperación (sube) y precisión de zona.
    const t = healthTrends(sessions);
    const lines: Array<[string, string]> = [];
    lines.push([
      'Reposo antes de salir',
      t.restBpm.now === undefined
        ? 'mídelo con el minuto de calma'
        : `${Math.round(t.restBpm.now)} bpm${this.delta(t.restBpm, 'bpm', true)}`,
    ]);
    lines.push([
      'Recuperación en 1 min',
      t.recoveryBpm.now === undefined
        ? 'aparece con las primeras oleadas'
        : `${Math.round(t.recoveryBpm.now)} lpm${this.delta(t.recoveryBpm, 'lpm', false)}`,
    ]);
    lines.push([
      'Precisión de zona',
      t.zonePrecision.now === undefined
        ? '––'
        : `${Math.round(t.zonePrecision.now * 100)} %${this.delta(
            { now: t.zonePrecision.now * 100, before: t.zonePrecision.before === undefined ? undefined : t.zonePrecision.before * 100 },
            'pts',
            false,
          )}`,
    ]);
    lines.push(['Sin ser alcanzado', `${r.cleanRides} de ${r.rides} salidas · más larga ${formatMMSS(r.longestRideSec)}`]);
    const all = marks(sessions);
    const got = all.filter((m) => m.achievedAtMs !== undefined);
    const latest = got.length > 0 ? got.reduce((a, b) => ((a.achievedAtMs ?? 0) >= (b.achievedAtMs ?? 0) ? a : b)) : undefined;
    lines.push(['Marcas', latest ? `${got.length} de ${all.length} · última: ${latest.title}` : `0 de ${all.length} · toca "Marcas" para verlas`]);
    lines.forEach(([label, value], i) => {
      this.text(this.x, y + i * 26, label, 16, UI.textDim);
      this.text(this.x + 190, y + i * 26, value, label === 'Marcas' ? 16 : 17, label === 'Marcas' ? ROUTE_TEXT : UI.textMuted);
    });
  }

  /** " · −3 bpm vs. antes" en verde si mejora, ámbar si empeora; nada sin "antes". */
  private delta(trend: Trend, unit: string, lowerIsBetter: boolean): string {
    if (trend.now === undefined || trend.before === undefined) return '';
    const d = Math.round(trend.now - trend.before);
    if (d === 0) return ' · igual que antes';
    const better = lowerIsBetter ? d < 0 : d > 0;
    return ` · ${d > 0 ? '+' : ''}${d} ${unit} vs. antes${better ? ' ✓' : ''}`;
  }

  // ---- utilidades ------------------------------------------------------------

  private heading(y: number, label: string): void {
    this.text(this.x, y, label, 13, UI.textDim).setLetterSpacing(2);
  }

  private bar(y: number, frac: number, color: number): void {
    const g = this.scene.add.graphics();
    g.fillStyle(TRACK, 1);
    g.fillRect(this.x, y, this.width, 10);
    g.fillStyle(color, 1);
    g.fillRect(this.x, y, Math.round(this.width * Math.max(0, Math.min(1, frac))), 10);
    this.objects.push(g);
  }

  private text(
    x: number,
    y: number,
    value: string,
    size: number,
    color: string,
    style?: 'bold',
    wrapWidth?: number,
  ): Phaser.GameObjects.Text {
    const t = this.scene.add.text(x, y, value, {
      fontFamily: size >= 24 ? FONT_MONO : FONT_SANS,
      fontSize: `${size}px`,
      fontStyle: style,
      color,
      wordWrap: wrapWidth ? { width: wrapWidth } : undefined,
    });
    this.objects.push(t);
    return t;
  }
}
