import Phaser from 'phaser';
import type { SessionRecord } from '../../sim/history';
import { isCountable } from '../../sim/history';
import { marks } from '../../sim/marks';
import {
  healthTrends,
  personalRecords,
  routeProgress,
  sameLocalDay,
  season,
  SEASON_WEEKS,
  streakWeeks,
  summarizeWeek,
  weekAtRisk,
  weekStartMs,
  type Trend,
} from '../../sim/progress';
import { FONT_MONO, FONT_SANS } from '../theme';
import {
  bigNumber,
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
  paper,
  stamp,
  tally,
} from '../ui/paper';

// La columna del hábito, como papeles clavados en el tablón del campamento:
// la semana como un calendario de siete casillas con marcas, la racha a
// tiza, la Ruta como un mapa a mano con el ciclista y la horda encima, y la
// salud como tres relojes. Se redibuja entera con show(); todo sale de la
// lista de sesiones.

const DAY_MS = 86_400_000;
const DAYS_ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const km1 = (km: number): string => km.toFixed(1).replace('.', ',');

export class Board {
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
    this.drawWeek(sessions, nowMs, this.y, 186);
    this.drawRoute(sessions, this.y + 202, 168);
    this.drawHealth(sessions, this.y + 386, 186);
  }

  private keep<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.objects.push(o);
    return o;
  }

  private text(x: number, y: number, value: string, size: number, color: string, extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}): Phaser.GameObjects.Text {
    return this.keep(this.scene.add.text(x, y, value, { fontFamily: FONT_SANS, fontSize: `${size}px`, color, ...extra }).setDepth(2));
  }

  // ---- la semana: un calendario clavado ---------------------------------------

  private drawWeek(sessions: readonly SessionRecord[], nowMs: number, py: number, h: number): void {
    const px = this.x;
    const w = this.width;
    this.keep(paper(this.scene, px, py, w, h, { tilt: -0.006, depth: 1 }));
    const week = summarizeWeek(sessions, weekStartMs(nowMs));
    const streak = streakWeeks(sessions, nowMs);
    const current = season(sessions, nowMs);
    this.keep(heading(this.scene, px + 18, py + 14, current ? `Temporada ${current.number} · semana ${current.week} de ${SEASON_WEEKS}` : 'Esta semana', 12, INK_MUTED, 2));

    // Salidas: el número grande con la bici.
    const g = this.keep(this.scene.add.graphics().setDepth(2));
    icon(g, 'bike', px + 42, py + 68, 40, INK_HEX);
    this.keep(bigNumber(this.scene, px + 72, py + 40, `${week.sessions}`, 46, week.met ? INK_GREEN : INK, 2));
    this.text(px + 72 + (week.sessions >= 10 ? 56 : 30), py + 66, `de ${week.goal.sessionsPerWeek} salidas`, 15, INK_MUTED);

    // Siete casillas: lunes a domingo, con marca los días que saliste.
    const cellW = 30;
    const cellsX = px + w - 18 - 7 * cellW;
    const cellsY = py + 46;
    const monday = weekStartMs(nowMs);
    for (let d = 0; d < 7; d++) {
      const dayMs = monday + d * DAY_MS + DAY_MS / 2;
      const cx = cellsX + d * cellW + cellW / 2;
      const rode = sessions.some((s) => isCountable(s) && sameLocalDay(s.startedAtMs, dayMs));
      const isToday = sameLocalDay(dayMs, nowMs);
      const future = dayMs > nowMs + DAY_MS / 2;
      this.text(cx, cellsY - 14, DAYS_ES[d] ?? '', 12, isToday ? INK_RED : INK_DIM).setOrigin(0.5);
      g.lineStyle(isToday ? 2.5 : 1.5, isToday ? INK_RED_HEX : INK_HEX, future ? 0.35 : 0.8);
      g.strokeRect(cx - 12, cellsY, 24, 24);
      if (rode) icon(g, 'check', cx, cellsY + 12, 18, INK_GREEN_HEX);
    }

    // Cardio: una barra a lápiz.
    const barY = py + 104;
    this.text(px + 18, barY - 2, 'cardio', 13, INK_MUTED);
    this.text(px + w - 18, barY - 2, `${Math.round(week.activeMin)} / ${week.goal.activeMinPerWeek} min`, 13, INK_MUTED).setOrigin(1, 0);
    g.lineStyle(6, INK_HEX, 0.18);
    g.lineBetween(px + 76, barY + 8, px + w - 130, barY + 8);
    const frac = Math.min(1, week.activeMin / week.goal.activeMinPerWeek);
    g.lineStyle(6, week.met ? INK_GREEN_HEX : INK_HEX, 0.85);
    g.lineBetween(px + 76, barY + 8, px + 76 + (w - 206) * frac, barY + 8);

    // La racha, a tiza; o la semana en riesgo, con la salida al lado.
    const risk = weekAtRisk(sessions, nowMs);
    const rowY = py + 134;
    if (risk) {
      this.keep(stamp(this.scene, px + 92, rowY + 16, 'en riesgo', INK_RED, 3, 14));
      this.text(px + 170, rowY + 4, `${risk.daysLeft === 1 ? 'hoy' : `${risk.daysLeft} días`} y ${risk.ridesMissing} salida${risk.ridesMissing === 1 ? '' : 's'}: diez minutos la salvan`, 14, INK_RED, { wordWrap: { width: w - 190 } });
      return;
    }
    icon(g, 'flame', px + 30, rowY + 16, 26, streak >= 2 ? INK_GOLD_HEX : INK_HEX, streak >= 1 ? 1 : 0.35);
    if (streak >= 1) {
      const end = tally(g, px + 52, rowY + 4, Math.min(streak, 15), 24, INK_HEX);
      this.text(end + 10, rowY + 5, `${streak} ${streak === 1 ? 'semana' : 'semanas'} seguidas`, 15, streak >= 2 ? INK_GOLD : INK_MUTED);
    } else {
      this.text(px + 52, rowY + 5, sessions.length === 0 ? 'La primera semana empieza hoy.' : 'Cumple esta semana y arranca la racha.', 14, INK_MUTED);
    }
  }

  // ---- la Ruta: un mapa a mano ----------------------------------------------------

  private drawRoute(sessions: readonly SessionRecord[], py: number, h: number): void {
    const px = this.x;
    const w = this.width;
    this.keep(paper(this.scene, px, py, w, h, { tilt: 0.005, depth: 1, dark: true }));
    const route = routeProgress(sessions);
    this.keep(heading(this.scene, px + 18, py + 14, 'La Ruta', 12, INK_MUTED, 2));
    this.keep(bigNumber(this.scene, px + 18, py + 30, `${km1(route.totalKm)} km`, 30, INK, 2));
    const g = this.keep(this.scene.add.graphics().setDepth(2));
    icon(g, 'compass', px + w - 34, py + 34, 30, INK_HEX, 0.7);
    if (route.reached > 0) {
      icon(g, 'flag', px + w - 96, py + 34, 18, INK_GOLD_HEX);
      this.text(px + w - 84, py + 34, `${route.reached}`, 15, INK_GOLD).setOrigin(0, 0.5);
    }

    // La carretera entre el último refugio y el siguiente, ondulada, a doble línea.
    const x0 = px + 44;
    const x1 = px + w - 44;
    const ry = py + 108;
    const curve = new Phaser.Curves.CubicBezier(
      new Phaser.Math.Vector2(x0, ry + 8),
      new Phaser.Math.Vector2(x0 + (x1 - x0) * 0.35, ry - 26),
      new Phaser.Math.Vector2(x0 + (x1 - x0) * 0.65, ry + 30),
      new Phaser.Math.Vector2(x1, ry - 4),
    );
    g.lineStyle(9, INK_HEX, 0.16);
    curve.draw(g, 48);
    g.lineStyle(2, INK_HEX, 0.9);
    curve.draw(g, 48);
    // Trazo hecho: hasta donde vas, más marcado.
    const done = new Phaser.Curves.Path(x0, ry + 8);
    const pts = curve.getPoints(48).slice(0, Math.max(2, Math.round(48 * route.progress01)));
    g.lineStyle(4, INK_GOLD_HEX, 0.9);
    for (let i = 1; i < pts.length; i++) g.lineBetween(pts[i - 1]!.x, pts[i - 1]!.y, pts[i]!.x, pts[i]!.y);
    void done;
    // Refugios en los extremos, tú en el camino y la horda un poco atrás.
    icon(g, 'house', x0, ry - 8, 26, INK_HEX, route.last ? 1 : 0.4);
    icon(g, 'house', x1, ry - 22, 26, INK_HEX, 0.55);
    const me = curve.getPoint(route.progress01);
    icon(g, 'bike', me.x, me.y - 14, 28, INK_HEX);
    const back = curve.getPoint(Math.max(0, route.progress01 - 0.12));
    for (let k = 0; k < 3; k++) icon(g, 'zombie', back.x - k * 12, back.y - 10 + (k % 2) * 3, 18, INK_RED_HEX, 0.7 - k * 0.15);
    this.text(x0, ry + 30, route.last?.name ?? 'Salida', 12, INK_DIM).setOrigin(0.5, 0);
    this.text(x1, ry + 30, route.next.name, 12, INK_MUTED).setOrigin(0.5, 0);
    this.text(px + w / 2, py + h - 26, `faltan ${km1(route.remainingKm)} km`, 14, INK_GOLD).setOrigin(0.5, 0);
  }

  // ---- salud: tres relojes ----------------------------------------------------------

  private drawHealth(sessions: readonly SessionRecord[], py: number, h: number): void {
    const px = this.x;
    const w = this.width;
    this.keep(paper(this.scene, px, py, w, h, { tilt: -0.004, depth: 1 }));
    this.keep(heading(this.scene, px + 18, py + 14, 'Salud', 12, INK_MUTED, 2));
    const r = personalRecords(sessions);
    const g = this.keep(this.scene.add.graphics().setDepth(2));
    if (r.rides === 0) {
      icon(g, 'sun', px + 44, py + 80, 40, INK_GOLD_HEX);
      this.text(px + 78, py + 62, 'Tu primera salida abre la Ruta.\nCorta y suave: lo que importa es volver mañana.', 14, INK_MUTED);
      return;
    }
    const t = healthTrends(sessions);
    const gauges: Array<{ label: string; ico: 'heart' | 'lung' | 'target'; trend: Trend; min: number; max: number; unit: string; lowerIsBetter: boolean; scale: number }> = [
      { label: 'reposo', ico: 'heart', trend: t.restBpm, min: 45, max: 90, unit: 'bpm', lowerIsBetter: true, scale: 1 },
      { label: 'recuperación', ico: 'lung', trend: t.recoveryBpm, min: 0, max: 40, unit: 'lpm', lowerIsBetter: false, scale: 1 },
      { label: 'precisión', ico: 'target', trend: t.zonePrecision, min: 0, max: 100, unit: '%', lowerIsBetter: false, scale: 100 },
    ];
    const gw = (w - 36) / 3;
    gauges.forEach((gauge, i) => {
      const cx = px + 18 + gw * i + gw / 2;
      const cy = py + 92;
      const now = gauge.trend.now === undefined ? undefined : gauge.trend.now * gauge.scale;
      const before = gauge.trend.before === undefined ? undefined : gauge.trend.before * gauge.scale;
      // El arco, de 200° a 340° (abierto abajo), con la aguja.
      const a0 = Math.PI * 0.85;
      const a1 = Math.PI * 2.15;
      g.lineStyle(7, INK_HEX, 0.14);
      g.beginPath();
      g.arc(cx, cy, 34, a0, a1, false);
      g.strokePath();
      if (now !== undefined) {
        const frac = Math.max(0, Math.min(1, (now - gauge.min) / (gauge.max - gauge.min)));
        const good = gauge.lowerIsBetter ? 1 - frac : frac;
        g.lineStyle(7, good > 0.5 ? INK_GREEN_HEX : INK_GOLD_HEX, 0.85);
        g.beginPath();
        g.arc(cx, cy, 34, a0, a0 + (a1 - a0) * frac, false);
        g.strokePath();
        const na = a0 + (a1 - a0) * frac;
        g.lineStyle(2.5, INK_HEX, 1);
        g.lineBetween(cx, cy, cx + Math.cos(na) * 30, cy + Math.sin(na) * 30);
        g.fillStyle(INK_HEX, 1);
        g.fillCircle(cx, cy, 3.5);
      }
      icon(g, gauge.ico, cx, cy - 52, 16, INK_HEX, 0.8);
      const value = now === undefined ? '––' : `${Math.round(now)}`;
      this.keep(this.scene.add.text(cx, cy + 12, value, { fontFamily: FONT_MONO, fontSize: '22px', fontStyle: 'bold', color: INK }).setOrigin(0.5, 0).setDepth(2));
      this.text(cx, cy + 36, `${gauge.label} · ${gauge.unit}`, 11, INK_MUTED).setOrigin(0.5, 0);
      if (now !== undefined && before !== undefined) {
        const d = Math.round(now - before);
        const better = d === 0 ? undefined : gauge.lowerIsBetter ? d < 0 : d > 0;
        const arrow = d === 0 ? '=' : d > 0 ? '▲' : '▼';
        this.text(cx + 38, cy - 30, `${arrow}${Math.abs(d)}`, 13, better === undefined ? INK_DIM : better ? INK_GREEN : INK_RED, { fontStyle: 'bold' });
      }
    });

    // Marcas y salidas limpias, con sus iconos.
    const all = marks(sessions);
    const got = all.filter((m) => m.achievedAtMs !== undefined).length;
    const rowY = py + h - 26;
    icon(g, 'trophy', px + 30, rowY, 20, INK_GOLD_HEX);
    this.text(px + 46, rowY, `${got} / ${all.length} marcas`, 14, INK_GOLD).setOrigin(0, 0.5);
    icon(g, 'skull', px + 210, rowY, 20, INK_HEX, 0.8);
    this.text(px + 226, rowY, `${r.cleanRides} / ${r.rides} sin ser alcanzado`, 14, INK_MUTED).setOrigin(0, 0.5);
  }
}
