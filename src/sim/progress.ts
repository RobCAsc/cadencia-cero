import { HABIT } from '../config';
import { isCountable, type SessionRecord } from './history';
import { activeSec } from './zones';

// Todo lo que el campamento muestra sobre el hábito sale de aquí: semana en
// curso, racha, la Ruta con sus refugios, récords y la salida recomendada.
// TypeScript puro sobre la lista de sesiones; sin Phaser, sin DOM, sin reloj
// propio (el ahora se pasa siempre como argumento).

export interface HabitGoals {
  sessionsPerWeek: number;
  activeMinPerWeek: number;
}

const DAY_MS = 86_400_000;
const HARD_TARGETS = new Set(['anaerobic', 'threshold', 'mixed']);

/** Lunes 00:00 (hora local) de la semana que contiene ms. */
export function weekStartMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  return d.getTime();
}

function previousWeekStart(weekStart: number): number {
  return weekStartMs(weekStart - DAY_MS);
}

export function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// ---- semana ----------------------------------------------------------------

export interface WeekSummary {
  weekStartMs: number;
  /** Salidas que cuentan (≥ 5 min). */
  sessions: number;
  activeMin: number;
  ridingMin: number;
  distanceKm: number;
  goal: HabitGoals;
  /** Cumplida por salidas O por minutos: cualquiera de las dos puertas vale. */
  met: boolean;
}

export function summarizeWeek(
  sessions: readonly SessionRecord[],
  weekStart: number,
  goal: HabitGoals = HABIT,
): WeekSummary {
  const inWeek = sessions.filter((s) => weekStartMs(s.startedAtMs) === weekStart);
  const countable = inWeek.filter(isCountable);
  const activeMin = inWeek.reduce((acc, s) => acc + activeSec(s.zoneSec), 0) / 60;
  const ridingMin = inWeek.reduce((acc, s) => acc + s.durationSec, 0) / 60;
  const distanceKm = inWeek.reduce((acc, s) => acc + s.distanceM, 0) / 1000;
  return {
    weekStartMs: weekStart,
    sessions: countable.length,
    activeMin,
    ridingMin,
    distanceKm,
    goal,
    met: countable.length >= goal.sessionsPerWeek || activeMin >= goal.activeMinPerWeek,
  };
}

/** Las últimas `weeks` semanas, de la más antigua a la actual (última). */
export function recentWeeks(
  sessions: readonly SessionRecord[],
  nowMs: number,
  weeks: number,
  goal: HabitGoals = HABIT,
): WeekSummary[] {
  const out: WeekSummary[] = [];
  let cursor = weekStartMs(nowMs);
  for (let i = 0; i < weeks; i++) {
    out.unshift(summarizeWeek(sessions, cursor, goal));
    cursor = previousWeekStart(cursor);
  }
  return out;
}

/**
 * Semanas seguidas con la meta cumplida. La semana en curso suma si ya está
 * cumplida y no resta si todavía no. Una semana fallada entre dos cumplidas
 * se perdona una vez por racha: la vida pasa, y romper la racha por una
 * semana mala es la forma más rápida de que alguien deje de entrenar.
 */
export function streakWeeks(
  sessions: readonly SessionRecord[],
  nowMs: number,
  goal: HabitGoals = HABIT,
): number {
  if (sessions.length === 0) return 0;
  const firstWeek = weekStartMs(Math.min(...sessions.map((s) => s.startedAtMs)));
  let cursor = weekStartMs(nowMs);
  let streak = 0;
  let graceUsed = false;

  if (summarizeWeek(sessions, cursor, goal).met) streak += 1;
  cursor = previousWeekStart(cursor);

  while (cursor >= firstWeek) {
    if (summarizeWeek(sessions, cursor, goal).met) {
      streak += 1;
    } else {
      const before = previousWeekStart(cursor);
      const bridged = before >= firstWeek && summarizeWeek(sessions, before, goal).met;
      if (graceUsed || !bridged) break;
      graceUsed = true;
    }
    cursor = previousWeekStart(cursor);
  }
  return streak;
}

// ---- la Ruta ---------------------------------------------------------------

export interface Refuge {
  km: number;
  name: string;
}

/** Hitos con nombre, sin narrativa: son mojones en la carretera y nada más. */
export const REFUGES: readonly Refuge[] = [
  { km: 10, name: 'El puente' },
  { km: 25, name: 'La gasolinera' },
  { km: 50, name: 'El faro' },
  { km: 100, name: 'La presa' },
  { km: 175, name: 'El monasterio' },
  { km: 275, name: 'La estación' },
  { km: 400, name: 'El puerto' },
  { km: 600, name: 'La isla' },
  { km: 850, name: 'El observatorio' },
  { km: 1200, name: 'La frontera' },
];

export interface RouteProgress {
  totalKm: number;
  /** Refugios ya alcanzados. */
  reached: number;
  last: Refuge | undefined;
  next: Refuge;
  /** 0..1 entre el último refugio y el siguiente. */
  progress01: number;
  remainingKm: number;
}

function refugeAt(index: number): Refuge {
  const known = REFUGES[index];
  if (known) return known;
  // Más allá de la lista, un refugio cada 500 km.
  const lastKnown = REFUGES[REFUGES.length - 1] ?? { km: 0, name: 'Refugio' };
  const extra = index - REFUGES.length + 1;
  return { km: lastKnown.km + 500 * extra, name: `Refugio ${index + 1}` };
}

export function routeProgress(sessions: readonly SessionRecord[]): RouteProgress {
  const totalKm = sessions.reduce((acc, s) => acc + s.distanceM, 0) / 1000;
  let reached = 0;
  while (totalKm >= refugeAt(reached).km) reached += 1;
  const last = reached > 0 ? refugeAt(reached - 1) : undefined;
  const next = refugeAt(reached);
  const fromKm = last?.km ?? 0;
  const span = next.km - fromKm;
  return {
    totalKm,
    reached,
    last,
    next,
    progress01: span > 0 ? Math.min(1, Math.max(0, (totalKm - fromKm) / span)) : 1,
    remainingKm: Math.max(0, next.km - totalKm),
  };
}

// ---- récords y salud -------------------------------------------------------

export interface PersonalRecords {
  rides: number;
  longestRideSec: number;
  longestRideKm: number;
  /** Salidas completas sin ninguna captura. */
  cleanRides: number;
  bestActiveMin: number;
  lowestRestBpm: number | undefined;
  /** Reposo de la última salida menos el de la primera: negativo = mejora. */
  restBpmChange: number | undefined;
}

export function personalRecords(sessions: readonly SessionRecord[]): PersonalRecords {
  const countable = sessions.filter(isCountable);
  const rests = countable.map((s) => s.hrRestBpm).filter((r) => r > 0);
  const first = rests[0];
  const latest = rests[rests.length - 1];
  return {
    rides: countable.length,
    longestRideSec: Math.max(0, ...countable.map((s) => s.durationSec)),
    longestRideKm: Math.max(0, ...countable.map((s) => s.distanceM)) / 1000,
    cleanRides: countable.filter((s) => s.completed && s.timesCaught === 0).length,
    bestActiveMin: Math.max(0, ...countable.map((s) => activeSec(s.zoneSec))) / 60,
    lowestRestBpm: rests.length > 0 ? Math.min(...rests) : undefined,
    restBpmChange:
      first !== undefined && latest !== undefined && rests.length >= 2 ? latest - first : undefined,
  };
}

/** Qué récords rompió `latest` respecto a lo anterior, en texto para el resumen. */
export function brokenRecords(before: readonly SessionRecord[], latest: SessionRecord): string[] {
  if (!isCountable(latest)) return [];
  const prev = personalRecords(before);
  const out: string[] = [];
  if (prev.rides === 0) return ['Primera salida en la Ruta'];
  const km = latest.distanceM / 1000;
  const active = activeSec(latest.zoneSec) / 60;
  if (latest.completed && latest.timesCaught === 0 && prev.cleanRides === 0) {
    out.push('Primera salida sin ser alcanzado');
  }
  if (latest.durationSec > prev.longestRideSec) out.push('Tu salida más larga');
  if (km > prev.longestRideKm) out.push('Tu mayor distancia');
  if (active > 0 && active > prev.bestActiveMin) out.push('Tu mejor cardio en una salida');
  return out;
}

// ---- salida de hoy ---------------------------------------------------------

export interface Recommendation {
  programId: string;
  /** Ajustes sugeridos para ese programa (ids de AdjustmentSpec). */
  values: Record<string, number>;
  reason: string;
}

/**
 * Qué salida toca hoy. Quien empieza recibe salidas cortas y suaves; después
 * la semana rota fondo → oleadas → recuperación, sin dos duras seguidas y sin
 * exigir nada tras una salida ya hecha hoy. Un principio simple y explicable
 * vale más aquí que un planificador listo: el rider tiene que entenderlo.
 */
export function recommendToday(sessions: readonly SessionRecord[], nowMs: number): Recommendation {
  const countable = sessions.filter(isCountable);
  const total = countable.length;
  const thisWeek = countable.filter((s) => weekStartMs(s.startedAtMs) === weekStartMs(nowMs)).length;
  const last = countable[countable.length - 1];
  const lastWasToday = last !== undefined && sameLocalDay(last.startedAtMs, nowMs);
  const lastWasHard =
    last !== undefined && HARD_TARGETS.has(last.target) && nowMs - last.startedAtMs < 2 * DAY_MS;
  const weekParity = Math.floor(weekStartMs(nowMs) / (7 * DAY_MS)) % 2;

  if (total === 0) {
    return {
      programId: 'primera-salida',
      values: {},
      reason: 'Tu primera salida: doce minutos para conocer la bici y la horda.',
    };
  }
  if (total === 1) {
    return {
      programId: 'primera-salida',
      values: {},
      reason: 'Una corta más para asentar el gesto. La horda sigue lenta.',
    };
  }
  if (total < 6) {
    return total % 2 === 0
      ? {
          programId: 'recuperacion',
          values: { warmupMin: 3 },
          reason: 'Semanas de arranque: rodar suave y seguido vale más que apretar.',
        }
      : {
          programId: 'fondo',
          values: { warmupMin: 3 },
          reason: 'Semanas de arranque: hoy un poco más largo, sin oleadas.',
        };
  }
  if (lastWasToday) {
    return {
      programId: 'recuperacion',
      values: {},
      reason: 'Ya saliste hoy. Si repites, que sea suave.',
    };
  }
  if (thisWeek === 0) {
    return total >= 12 && weekParity === 1
      ? { programId: 'umbral', values: {}, reason: 'Primera salida de la semana: presión sostenida.' }
      : { programId: 'fondo', values: {}, reason: 'Primera salida de la semana: base aerobia.' };
  }
  if (thisWeek === 1) {
    if (lastWasHard) {
      return { programId: 'fondo', values: {}, reason: 'Ayer fue dura: hoy base, la horda lejos.' };
    }
    return total >= 12 && weekParity === 1
      ? { programId: 'piramide', values: {}, reason: 'La salida dura de la semana: oleadas en pirámide.' }
      : {
          programId: 'hiit-30-30',
          values: { repeats: total < 12 ? 5 : 8 },
          reason:
            total < 12
              ? 'La salida dura de la semana: cinco oleadas para empezar.'
              : 'La salida dura de la semana: ocho oleadas.',
        };
  }
  return {
    programId: 'recuperacion',
    values: {},
    reason: thisWeek >= 3 ? 'Semana cumplida. Lo de hoy es regalo: suave.' : 'Tercera de la semana: recuperación para cerrar.',
  };
}
