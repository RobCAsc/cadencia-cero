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
const HARD_TARGETS = new Set(['anaerobic', 'threshold', 'mixed', 'tempo']);
/** Cada tantas semanas cumplidas seguidas, una de descarga. */
const DELOAD_EVERY_WEEKS = 4;

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
 * Cuenta semanas cumplidas hacia atrás desde `cursor`. Una semana fallada se
 * perdona una vez si la anterior a ella está cumplida y la posterior también
 * (`headMet` dice si la posterior a `cursor` cuenta como cumplida).
 */
function countWeeksBack(
  sessions: readonly SessionRecord[],
  cursor: number,
  firstWeek: number,
  goal: HabitGoals,
  headMet: boolean,
): number {
  let streak = 0;
  let graceUsed = false;
  let prevMet = headMet;
  while (cursor >= firstWeek) {
    if (summarizeWeek(sessions, cursor, goal).met) {
      streak += 1;
      prevMet = true;
    } else {
      const before = previousWeekStart(cursor);
      const bridged = prevMet && before >= firstWeek && summarizeWeek(sessions, before, goal).met;
      if (graceUsed || !bridged) break;
      graceUsed = true;
      prevMet = false;
    }
    cursor = previousWeekStart(cursor);
  }
  return streak;
}

function firstWeekOf(sessions: readonly SessionRecord[]): number {
  return weekStartMs(Math.min(...sessions.map((s) => s.startedAtMs)));
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
  const current = weekStartMs(nowMs);
  const head = summarizeWeek(sessions, current, goal).met ? 1 : 0;
  return head + countWeeksBack(sessions, previousWeekStart(current), firstWeekOf(sessions), goal, true);
}

/**
 * Semanas cumplidas seguidas que ya TERMINARON (la actual no cuenta), y sin
 * perdón en la cabeza: si la semana pasada se falló, es 0. Es lo que decide
 * la descarga: cuatro cumplidas seguidas y la siguiente afloja.
 */
export function streakWeeksBefore(
  sessions: readonly SessionRecord[],
  nowMs: number,
  goal: HabitGoals = HABIT,
): number {
  if (sessions.length === 0) return 0;
  const current = weekStartMs(nowMs);
  return countWeeksBack(sessions, previousWeekStart(current), firstWeekOf(sessions), goal, false);
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

export type PlanPhase = 'arranque' | 'base' | 'rotacion' | 'descarga';

export const PHASE_ES: Record<PlanPhase, string> = {
  arranque: 'Arranque',
  base: 'Base',
  rotacion: 'Rotación',
  descarga: 'Descarga',
};

export interface Recommendation {
  programId: string;
  /** Ajustes sugeridos para ese programa (ids de AdjustmentSpec). */
  values: Record<string, number>;
  reason: string;
  phase: PlanPhase;
}

/** Salidas que cuentan para pasar de fase. */
const BASE_FROM_RIDES = 6;
const ROTATION_FROM_RIDES = 12;

const NUM_ES: Record<number, string> = { 4: 'cuatro', 6: 'seis', 8: 'ocho' };

const rec = (
  phase: PlanPhase,
  programId: string,
  values: Record<string, number>,
  reason: string,
): Recommendation => ({ phase, programId, values, reason });

/**
 * Qué salida toca hoy: un plan por fases que se explica solo.
 * - Arranque (salidas 1-5, unas dos semanas): corto y suave, Z1-Z2, sin oleadas.
 * - Base (6-11, otras dos semanas): fondo más largo y los primeros empujones en Z3.
 * - Rotación (12+): fondo → oleadas → recuperación; con más base, umbral y
 *   pirámide alternan por semanas, y las oleadas crecen 4 → 6 → 8.
 * - Descarga: tras cuatro semanas cumplidas seguidas, una suave para asimilar.
 * El volumen sube unos minutos por semana con las salidas hechas, nunca de
 * golpe, y jamás se encadenan dos días duros ni se exige nada tras una salida
 * ya hecha hoy.
 */
export function recommendToday(sessions: readonly SessionRecord[], nowMs: number): Recommendation {
  const countable = sessions.filter(isCountable);
  const total = countable.length;
  const thisWeek = countable.filter((s) => weekStartMs(s.startedAtMs) === weekStartMs(nowMs)).length;
  const last = countable[total - 1];
  const lastWasToday = last !== undefined && sameLocalDay(last.startedAtMs, nowMs);
  const lastWasHard =
    last !== undefined && HARD_TARGETS.has(last.target) && nowMs - last.startedAtMs < 2 * DAY_MS;
  const weekParity = Math.floor(weekStartMs(nowMs) / (7 * DAY_MS)) % 2;
  // Carga progresiva: un minuto más de tramo principal por salida hecha.
  const easyMin = Math.min(15, 8 + total);
  const baseMin = Math.min(25, 10 + total);
  const phase: PlanPhase = total < BASE_FROM_RIDES ? 'arranque' : total < ROTATION_FROM_RIDES ? 'base' : 'rotacion';

  if (total === 0) {
    return rec('arranque', 'primera-salida', {}, 'Tu primera salida: doce minutos para conocer la bici y la horda.');
  }
  if (total === 1) {
    return rec('arranque', 'primera-salida', {}, 'Una corta más para asentar el gesto. La horda sigue lenta.');
  }
  if (lastWasToday) {
    return rec(phase, 'recuperacion', { warmupMin: 3, mainMin: 10 }, 'Ya saliste hoy. Si repites, que sea suave.');
  }
  if (phase === 'arranque') {
    return total % 2 === 0
      ? rec('arranque', 'recuperacion', { warmupMin: 3, mainMin: easyMin }, 'Semanas de arranque: rodar suave y seguido vale más que apretar.')
      : rec('arranque', 'fondo', { warmupMin: 3, mainMin: baseMin }, 'Semanas de arranque: hoy un poco más largo, sin oleadas.');
  }

  const doneBefore = streakWeeksBefore(sessions, nowMs);
  if (doneBefore > 0 && doneBefore % DELOAD_EVERY_WEEKS === 0 && thisWeek < HABIT.sessionsPerWeek) {
    const reason = `Semana de descarga: llevas ${doneBefore} cumplidas seguidas. Hoy suave, el cuerpo asimila.`;
    return thisWeek === 0
      ? rec('descarga', 'fondo', { mainMin: Math.round(baseMin * 0.7) }, reason)
      : rec('descarga', 'recuperacion', { mainMin: easyMin }, reason);
  }

  const closing = thisWeek >= 3 ? 'Semana cumplida. Lo de hoy es regalo: suave.' : 'Tercera de la semana: recuperación para cerrar.';

  if (phase === 'base') {
    if (thisWeek === 0) return rec('base', 'fondo', { mainMin: baseMin }, 'Base: la primera de la semana, larga y en Z2.');
    if (thisWeek === 1) {
      return lastWasHard
        ? rec('base', 'fondo', { mainMin: baseMin }, 'Ayer fue dura: hoy base, la horda lejos.')
        : rec('base', 'empujones', {}, 'Primeros empujones: dos minutos en Z3, tres veces. Sin sprints todavía.');
    }
    return rec('base', 'recuperacion', { mainMin: easyMin }, closing);
  }

  const repeats = total < 18 ? 4 : total < 30 ? 6 : 8;
  if (thisWeek === 0) {
    return total >= 24 && weekParity === 1
      ? rec('rotacion', 'umbral', {}, 'Primera salida de la semana: presión sostenida.')
      : rec('rotacion', 'fondo', { mainMin: baseMin }, 'Primera salida de la semana: base aerobia.');
  }
  if (thisWeek === 1) {
    if (lastWasHard) return rec('rotacion', 'fondo', { mainMin: baseMin }, 'Ayer fue dura: hoy base, la horda lejos.');
    return total >= 24 && weekParity === 1
      ? rec('rotacion', 'piramide', {}, 'La salida dura de la semana: oleadas en pirámide.')
      : rec('rotacion', 'oleadas', { repeats }, `La salida dura de la semana: ${NUM_ES[repeats] ?? repeats} oleadas.`);
  }
  return rec('rotacion', 'recuperacion', { mainMin: easyMin }, closing);
}
