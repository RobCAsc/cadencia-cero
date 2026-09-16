import { isCountable, type SessionRecord } from './history';
import { streakWeeks, summarizeWeek, weekStartMs } from './progress';
import { activeSec } from './zones';

// Marcas de forma: logros que un pulsómetro puede certificar, con fecha y sin
// insignia. No son niveles ni cosméticos: son hechos fisiológicos y de hábito
// que el rider puede leer como "esto ya lo hago". Todo sale de la lista de
// sesiones; nada se guarda aparte.

export type MarkId =
  | 'first-clean'
  | 'fondo-30'
  | 'oleadas-clean'
  | 'recovery-20'
  | 'rest-5'
  | 'active-150'
  | 'streak-4'
  | 'streak-10'
  | 'rides-25'
  | 'rides-50'
  | 'rides-100';

export interface Mark {
  id: MarkId;
  title: string;
  detail: string;
  /** Cuándo se consiguió; undefined si aún no. */
  achievedAtMs?: number;
}

const DAY_MS = 86_400_000;
const REST_DROP_BPM = 5;
const RECOVERY_BPM = 20;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function firstWhere(sessions: readonly SessionRecord[], test: (s: SessionRecord) => boolean): number | undefined {
  return sessions.find(test)?.startedAtMs;
}

function endOfRide(s: SessionRecord): number {
  return s.startedAtMs + s.durationSec * 1000;
}

/** Primera vez que el reposo (mediana de las últimas 7 lecturas) bajó REST_DROP_BPM respecto a la base inicial (mediana de las 3 primeras). */
function restDropAt(sessions: readonly SessionRecord[]): number | undefined {
  const readings = sessions
    .filter((s) => s.preRideRestBpm !== undefined && s.preRideRestBpm > 0)
    .map((s) => ({ atMs: s.startedAtMs, bpm: s.preRideRestBpm as number }));
  if (readings.length < 6) return undefined;
  const baseline = median(readings.slice(0, 3).map((r) => r.bpm));
  for (let i = 6; i <= readings.length; i++) {
    const window = readings.slice(Math.max(0, i - 7), i).map((r) => r.bpm);
    if (window.length >= 3 && median(window) <= baseline - REST_DROP_BPM) return readings[i - 1]!.atMs;
  }
  return undefined;
}

/** Fin (domingo, 23:59) de la primera semana en la que la racha llegó a `weeks`. */
function streakReachedAt(sessions: readonly SessionRecord[], weeks: number): number | undefined {
  if (sessions.length === 0) return undefined;
  const first = weekStartMs(Math.min(...sessions.map((s) => s.startedAtMs)));
  const last = weekStartMs(Math.max(...sessions.map((s) => s.startedAtMs)));
  for (let cursor = first; cursor <= last; cursor = weekStartMs(cursor + 7 * DAY_MS + DAY_MS / 2)) {
    const weekEnd = cursor + 7 * DAY_MS - 1;
    if (streakWeeks(sessions, weekEnd) >= weeks) return weekEnd;
  }
  return undefined;
}

/** Última salida de la primera semana con 150 min de cardio. */
function activeWeekAt(sessions: readonly SessionRecord[]): number | undefined {
  const weeks = [...new Set(sessions.map((s) => weekStartMs(s.startedAtMs)))].sort((a, b) => a - b);
  for (const w of weeks) {
    const summary = summarizeWeek(sessions, w);
    if (summary.activeMin >= summary.goal.activeMinPerWeek) {
      const inWeek = sessions.filter((s) => weekStartMs(s.startedAtMs) === w);
      return Math.max(...inWeek.map(endOfRide));
    }
  }
  return undefined;
}

function nthRideAt(sessions: readonly SessionRecord[], n: number): number | undefined {
  const countable = sessions.filter(isCountable);
  return countable[n - 1]?.startedAtMs;
}

/** Todas las marcas, conseguidas o no, en un orden fijo. `sessions` de la más antigua a la más reciente. */
export function marks(sessions: readonly SessionRecord[]): Mark[] {
  const clean = (s: SessionRecord) => s.completed && isCountable(s) && s.timesCaught === 0;
  const meanRecovery = (s: SessionRecord) =>
    s.recoveryDrops && s.recoveryDrops.length > 0
      ? s.recoveryDrops.reduce((a, b) => a + b, 0) / s.recoveryDrops.length
      : 0;
  const at = (id: MarkId, title: string, detail: string, achievedAtMs: number | undefined): Mark => ({
    id,
    title,
    detail,
    ...(achievedAtMs !== undefined ? { achievedAtMs } : {}),
  });
  return [
    at('first-clean', 'Sin ser alcanzado', 'Una salida completa sin una sola captura.', firstWhere(sessions, clean)),
    at(
      'fondo-30',
      'Media hora de cardio limpia',
      'Treinta minutos en Z2 o más, completa y sin capturas.',
      firstWhere(sessions, (s) => clean(s) && activeSec(s.zoneSec) >= 1800),
    ),
    at(
      'oleadas-clean',
      'Todas las oleadas aguantadas',
      'Unas Oleadas completas sin que la horda te alcance.',
      firstWhere(sessions, (s) => clean(s) && s.programId === 'oleadas'),
    ),
    at(
      'recovery-20',
      `Recuperación de ${RECOVERY_BPM}`,
      `El pulso cae ${RECOVERY_BPM} latidos en el minuto tras una oleada. Sube con la forma.`,
      firstWhere(sessions, (s) => isCountable(s) && meanRecovery(s) >= RECOVERY_BPM),
    ),
    at(
      'rest-5',
      `Reposo ${REST_DROP_BPM} latidos más bajo`,
      'Tu reposo antes de salir, comparado con tus primeras lecturas. La medida más honesta.',
      restDropAt(sessions),
    ),
    at('active-150', '150 minutos en una semana', 'Lo que la OMS pide para la salud, en una sola semana.', activeWeekAt(sessions)),
    at('streak-4', 'Un mes seguido', 'Cuatro semanas cumplidas seguidas.', streakReachedAt(sessions, 4)),
    at('streak-10', 'Diez semanas seguidas', 'Diez semanas cumplidas: esto ya es un hábito.', streakReachedAt(sessions, 10)),
    at('rides-25', '25 salidas', 'Veinticinco salidas que cuentan.', nthRideAt(sessions, 25)),
    at('rides-50', '50 salidas', 'Cincuenta salidas que cuentan.', nthRideAt(sessions, 50)),
    at('rides-100', '100 salidas', 'Cien salidas. La bici ya es parte de la semana.', nthRideAt(sessions, 100)),
  ];
}

/** Marcas conseguidas en `after` que aún no lo estaban en `before`: para anunciarlas en el resumen. */
export function newMarks(before: readonly SessionRecord[], after: readonly SessionRecord[]): Mark[] {
  const had = new Set(marks(before).filter((m) => m.achievedAtMs !== undefined).map((m) => m.id));
  return marks(after).filter((m) => m.achievedAtMs !== undefined && !had.has(m.id));
}
