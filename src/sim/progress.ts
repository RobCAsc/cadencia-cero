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

export function refugeAt(index: number): Refuge {
  const known = REFUGES[index];
  if (known) return known;
  // Más allá de la lista, un refugio cada 500 km.
  const lastKnown = REFUGES[REFUGES.length - 1] ?? { km: 0, name: 'Refugio' };
  const extra = index - REFUGES.length + 1;
  return { km: lastKnown.km + 500 * extra, name: `Refugio ${index + 1}` };
}

/** El primer refugio por delante de un km de la Ruta (el que está justo en ese km ya se alcanzó). */
export function nextRefuge(totalKm: number): Refuge {
  let i = 0;
  while (totalKm >= refugeAt(i).km) i += 1;
  return refugeAt(i);
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
/** La rotación exige evidencia, no solo un contador: semanas cumplidas y unos Empujones limpios. */
export const ROTATION_MIN_MET_WEEKS = 2;
/** Con tantas semanas cumplidas seguidas, el fondo puede crecer hasta el tope largo. */
const LONG_BASE_WEEKS = 8;
/** Topes del tramo principal (min) por fase: el volumen sigue creciendo, la puerta de 150 min se alcanza. */
const EASY_CAP_MIN = { base: 15, rotacion: 20 } as const;
const BASE_CAP_MIN = { base: 25, rotacion: 35, rotacionLarga: 45 } as const;
/** Dos salidas seguidas "demasiado": se repite la fase anterior y el volumen baja a esto. */
const TOO_HARD_VOLUME_SCALE = 0.8;

const NUM_ES: Record<number, string> = { 4: 'cuatro', 6: 'seis', 8: 'ocho' };

const rec = (
  phase: PlanPhase,
  programId: string,
  values: Record<string, number>,
  reason: string,
): Recommendation => ({ phase, programId, values, reason });

/** Semanas con la meta cumplida desde la primera salida (la actual incluida si ya está). */
export function metWeeks(sessions: readonly SessionRecord[], nowMs: number): number {
  if (sessions.length === 0) return 0;
  const first = firstWeekOf(sessions);
  let cursor = weekStartMs(nowMs);
  let met = 0;
  while (cursor >= first) {
    if (summarizeWeek(sessions, cursor).met) met += 1;
    cursor = previousWeekStart(cursor);
  }
  return met;
}

/** Unos Empujones completos sin captura en tramos suaves: la prueba de que las zonas y el rider están listos. */
export function empujonesClean(sessions: readonly SessionRecord[]): boolean {
  return sessions.some(
    (s) =>
      s.programId === 'empujones' &&
      s.completed &&
      isCountable(s) &&
      (s.timesCaughtInEasy ?? s.timesCaught) === 0,
  );
}

/** Las dos últimas salidas que cuentan le parecieron demasiado al rider. */
export function lastTwoTooHard(sessions: readonly SessionRecord[]): boolean {
  const countable = sessions.filter(isCountable);
  return countable.length >= 2 && countable.slice(-2).every((s) => s.rpe === 'hard');
}

export interface PhaseVerdict {
  phase: PlanPhase;
  /** Por qué la fase no es la que el contador daría, si aplica. */
  held?: string;
}

/**
 * La fase del plan: por contador de salidas, y luego por evidencia (la
 * rotación se gana con dos semanas cumplidas y unos Empujones limpios) y por
 * lo que dijo el rider (dos "demasiado" seguidos repiten la fase anterior).
 */
export function planPhase(sessions: readonly SessionRecord[], nowMs: number): PhaseVerdict {
  const countable = sessions.filter(isCountable);
  const total = countable.length;
  let phase: PlanPhase = total < BASE_FROM_RIDES ? 'arranque' : total < ROTATION_FROM_RIDES ? 'base' : 'rotacion';
  let held: string | undefined;
  if (phase === 'rotacion') {
    if (metWeeks(sessions, nowMs) < ROTATION_MIN_MET_WEEKS) {
      phase = 'base';
      held = 'La rotación llega con dos semanas cumplidas.';
    } else if (!empujonesClean(countable)) {
      phase = 'base';
      held = 'La rotación llega con unos Empujones completos sin capturas en los tramos suaves.';
    }
  }
  if (lastTwoTooHard(countable) && phase !== 'arranque') {
    phase = phase === 'rotacion' ? 'base' : 'arranque';
    held = 'Las dos últimas te parecieron demasiado: repetimos la fase anterior, más corto.';
  }
  return held ? { phase, held } : { phase };
}

/** Programas que el plan reserva para la rotación, y desde qué salida. */
const GATED_FROM_RIDES: Record<string, number> = { oleadas: 12, cuestas: 18, umbral: 24, piramide: 24 };

/**
 * Por qué un programa todavía no toca, en una frase; undefined si está
 * abierto. Es información, no prohibición: el chip sigue siendo elegible.
 */
export function programGate(programId: string, sessions: readonly SessionRecord[], nowMs: number): string | undefined {
  const fromRides = GATED_FROM_RIDES[programId];
  if (fromRides === undefined) return undefined;
  const total = sessions.filter(isCountable).length;
  const verdict = planPhase(sessions, nowMs);
  if (verdict.phase === 'rotacion' && total >= fromRides) return undefined;
  if (total < fromRides) {
    return `El plan lo abre en la salida ${fromRides} (llevas ${total}), en rotación: dos semanas cumplidas y unos Empujones sin capturas en tramos suaves.`;
  }
  return `El plan lo abre en rotación. ${verdict.held ?? ''}`.trim();
}

/**
 * Qué salida toca hoy: un plan por fases que se explica solo.
 * - Arranque (salidas 1-5, unas dos semanas): corto y suave, Z1-Z2, sin oleadas.
 * - Base (6-11, otras dos semanas): fondo más largo y los primeros empujones en Z3.
 * - Rotación (12+, y solo con dos semanas cumplidas y unos Empujones limpios):
 *   fondo → oleadas → recuperación; cada tercera semana el fondo son Cuestas,
 *   con más base entran umbral y pirámide, y las oleadas crecen 4 → 6 → 8.
 * - Descarga: tras cuatro semanas cumplidas seguidas, una suave para asimilar.
 * El volumen sube un minuto por salida hasta el tope de la fase (25 en base,
 * 35 en rotación, 45 tras ocho semanas cumplidas seguidas). Dos salidas
 * seguidas "demasiado" repiten la fase anterior con menos volumen. Jamás se
 * encadenan dos días duros ni se exige nada tras una salida ya hecha hoy.
 */
export function recommendToday(sessions: readonly SessionRecord[], nowMs: number): Recommendation {
  const countable = sessions.filter(isCountable);
  const total = countable.length;
  const thisWeek = countable.filter((s) => weekStartMs(s.startedAtMs) === weekStartMs(nowMs)).length;
  const last = countable[total - 1];
  const lastWasToday = last !== undefined && sameLocalDay(last.startedAtMs, nowMs);
  const lastWasHard =
    last !== undefined && HARD_TARGETS.has(last.target) && nowMs - last.startedAtMs < 2 * DAY_MS;
  const weekIndex = Math.floor(weekStartMs(nowMs) / (7 * DAY_MS));
  const tooHard = lastTwoTooHard(countable);
  const doneBefore = streakWeeksBefore(sessions, nowMs);

  // La fase por contador, y luego la evidencia: la rotación se gana.
  const { phase, held } = planPhase(sessions, nowMs);

  // Carga progresiva: un minuto más de tramo principal por salida hecha,
  // hasta el tope de la fase; menos si las últimas fueron demasiado.
  const scale = tooHard ? TOO_HARD_VOLUME_SCALE : 1;
  const easyCap = phase === 'rotacion' ? EASY_CAP_MIN.rotacion : EASY_CAP_MIN.base;
  const baseCap =
    phase === 'rotacion'
      ? doneBefore >= LONG_BASE_WEEKS
        ? BASE_CAP_MIN.rotacionLarga
        : BASE_CAP_MIN.rotacion
      : BASE_CAP_MIN.base;
  const easyMin = Math.round(Math.min(easyCap, 8 + total) * scale);
  const baseMin = Math.round(Math.min(baseCap, 10 + total) * scale);
  const why = (reason: string) => (held ? `${reason} ${held}` : reason);

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
      ? rec('arranque', 'recuperacion', { warmupMin: 3, mainMin: easyMin }, why('Semanas de arranque: rodar suave y seguido vale más que apretar.'))
      : rec('arranque', 'fondo', { warmupMin: 3, mainMin: baseMin }, why('Semanas de arranque: hoy un poco más largo, sin oleadas.'));
  }

  if (doneBefore > 0 && doneBefore % DELOAD_EVERY_WEEKS === 0 && thisWeek < HABIT.sessionsPerWeek) {
    const reason = `Semana de descarga: llevas ${doneBefore} cumplidas seguidas. Hoy suave, el cuerpo asimila.`;
    return thisWeek === 0
      ? rec('descarga', 'fondo', { mainMin: Math.round(baseMin * 0.7) }, reason)
      : rec('descarga', 'recuperacion', { mainMin: easyMin }, reason);
  }

  const closing = thisWeek >= 3 ? 'Semana cumplida. Lo de hoy es regalo: suave.' : 'Tercera de la semana: recuperación para cerrar.';

  if (phase === 'base') {
    if (thisWeek === 0) return rec('base', 'fondo', { mainMin: baseMin }, why('Base: la primera de la semana, larga y en Z2.'));
    if (thisWeek === 1) {
      return lastWasHard
        ? rec('base', 'fondo', { mainMin: baseMin }, why('Ayer fue dura: hoy base, la horda lejos.'))
        : rec('base', 'empujones', {}, why('Empujones: dos minutos en Z3, tres veces. Sin sprints todavía.'));
    }
    return rec('base', 'recuperacion', { mainMin: easyMin }, why(closing));
  }

  const repeats = total < 18 ? 4 : total < 30 ? 6 : 8;
  if (thisWeek === 0) {
    if (total >= 18 && weekIndex % 3 === 2) {
      // Cada cuesta crece con el volumen de base: 3 min con 25, 4 con 35, 5 con 45.
      const climbMin = Math.min(5, Math.max(2, Math.round(baseMin / 8)));
      return rec('rotacion', 'cuestas', { mainMin: climbMin }, 'Primera de la semana: cuestas. Resistencia arriba, cadencia baja; el pulso manda.');
    }
    return rec('rotacion', 'fondo', { mainMin: baseMin }, 'Primera salida de la semana: base aerobia.');
  }
  if (thisWeek === 1) {
    if (lastWasHard) return rec('rotacion', 'fondo', { mainMin: baseMin }, 'Ayer fue dura: hoy base, la horda lejos.');
    if (total >= 24 && weekIndex % 4 === 3) {
      return rec('rotacion', 'umbral', {}, 'La salida dura de la semana: presión sostenida veinte minutos.');
    }
    return total >= 24 && weekIndex % 2 === 1
      ? rec('rotacion', 'piramide', {}, 'La salida dura de la semana: oleadas en pirámide.')
      : rec('rotacion', 'oleadas', { repeats }, `La salida dura de la semana: ${NUM_ES[repeats] ?? repeats} oleadas.`);
  }
  return rec('rotacion', 'recuperacion', { mainMin: easyMin }, closing);
}

// ---- la próxima salida: día comprometido ------------------------------------

const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export interface NextRideOption {
  /** Medianoche local del día elegido. */
  dayStartMs: number;
  label: string;
}

function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Tres días a elegir al terminar: mañana, pasado y el siguiente, con su nombre. */
export function nextRideOptions(nowMs: number): NextRideOption[] {
  const today = dayStart(nowMs);
  return [1, 2, 3].map((offset) => {
    const dayStartMs = dayStart(today + offset * DAY_MS + DAY_MS / 2);
    const name = DAY_NAMES_ES[new Date(dayStartMs).getDay()] ?? '';
    return { dayStartMs, label: offset === 1 ? `Mañana, ${name}` : `El ${name}` };
  });
}

export type NextRideState = 'none' | 'today' | 'upcoming' | 'missed';

export interface NextRideStatus {
  state: NextRideState;
  /** Lo que dice el campamento. */
  label: string;
}

/** Qué dice el campamento del día comprometido: hoy, viene, pasó, o nada. */
export function nextRideStatus(nextDayMs: number | undefined, nowMs: number): NextRideStatus {
  if (nextDayMs === undefined) return { state: 'none', label: '' };
  const today = dayStart(nowMs);
  const target = dayStart(nextDayMs);
  const name = DAY_NAMES_ES[new Date(target).getDay()] ?? '';
  if (target === today) return { state: 'today', label: 'Te esperan hoy.' };
  if (target > today) {
    return { state: 'upcoming', label: target - today === DAY_MS ? 'Te esperan mañana.' : `Te esperan el ${name}.` };
  }
  return { state: 'missed', label: `El ${name} pasó. La horda sigue ahí; cuando quieras.` };
}

// ---- la semana en riesgo ------------------------------------------------------

export interface WeekRisk {
  /** Días que quedan contando hoy. */
  daysLeft: number;
  ridesMissing: number;
}

/**
 * Con dos días o menos y salidas por hacer, la semana está en riesgo; se
 * dice con la puerta de escape al lado (diez minutos la salvan). Aversión a
 * la pérdida en su dosis justa: nunca antes del sábado.
 */
export function weekAtRisk(sessions: readonly SessionRecord[], nowMs: number, goal: HabitGoals = HABIT): WeekRisk | undefined {
  const week = summarizeWeek(sessions, weekStartMs(nowMs), goal);
  if (week.met) return undefined;
  const d = new Date(nowMs);
  const daysLeft = 7 - ((d.getDay() + 6) % 7); // lunes 7 … domingo 1
  if (daysLeft > 2) return undefined;
  const ridesMissing = goal.sessionsPerWeek - week.sessions;
  if (ridesMissing <= 0) return undefined;
  return { daysLeft, ridesMissing };
}

// ---- temporadas ---------------------------------------------------------------

export const SEASON_WEEKS = 12;

export interface Season {
  number: number;
  /** Semana dentro de la temporada, 1..SEASON_WEEKS. */
  week: number;
  startMs: number;
  endMs: number;
}

/** La temporada en curso: doce semanas desde la semana de la primera salida. */
export function season(sessions: readonly SessionRecord[], nowMs: number): Season | undefined {
  if (sessions.length === 0) return undefined;
  const first = firstWeekOf(sessions);
  const weeks = Math.max(0, Math.floor((weekStartMs(nowMs) - first) / (7 * DAY_MS)));
  const number = Math.floor(weeks / SEASON_WEEKS) + 1;
  const startMs = first + (number - 1) * SEASON_WEEKS * 7 * DAY_MS;
  return { number, week: (weeks % SEASON_WEEKS) + 1, startMs, endMs: startMs + SEASON_WEEKS * 7 * DAY_MS };
}

export interface SeasonReport {
  number: number;
  rides: number;
  weeksMet: number;
  activeMinPerWeek: number;
  distanceKm: number;
  /** Reposo al empezar (mediana de las 3 primeras lecturas) y al acabar (3 últimas). */
  restStartBpm: number | undefined;
  restEndBpm: number | undefined;
  recoveryBpm: number | undefined;
  zonePrecision: number | undefined;
}

/** El informe de una temporada ya cerrada. */
export function seasonReport(sessions: readonly SessionRecord[], number: number): SeasonReport {
  const first = sessions.length > 0 ? firstWeekOf(sessions) : 0;
  const startMs = first + (number - 1) * SEASON_WEEKS * 7 * DAY_MS;
  const endMs = startMs + SEASON_WEEKS * 7 * DAY_MS;
  const inSeason = sessions.filter((s) => s.startedAtMs >= startMs && s.startedAtMs < endMs);
  const countable = inSeason.filter(isCountable);
  let weeksMet = 0;
  for (let w = startMs; w < endMs; w += 7 * DAY_MS) if (summarizeWeek(sessions, w).met) weeksMet += 1;
  const rests = preRideRestReadings(inSeason);
  const recoveries = inSeason
    .map((s) => s.recoveryDrops)
    .filter((d): d is number[] => d !== undefined && d.length > 0)
    .map((d) => mean(d));
  const precision = countable.filter((s) => s.inZoneSec !== undefined && s.durationSec > 0).map((s) => (s.inZoneSec ?? 0) / s.durationSec);
  return {
    number,
    rides: countable.length,
    weeksMet,
    activeMinPerWeek: inSeason.reduce((acc, s) => acc + activeSec(s.zoneSec), 0) / 60 / SEASON_WEEKS,
    distanceKm: inSeason.reduce((acc, s) => acc + s.distanceM, 0) / 1000,
    restStartBpm: rests.length >= 3 ? Math.round(median(rests.slice(0, 3))) : undefined,
    restEndBpm: rests.length >= 6 ? Math.round(median(rests.slice(-3))) : undefined,
    recoveryBpm: recoveries.length > 0 ? Math.round(mean(recoveries)) : undefined,
    zonePrecision: precision.length > 0 ? mean(precision) : undefined,
  };
}

/** Toca el informe cuando empieza una temporada nueva y la anterior no se cerró aún (número > 1). */
export function seasonReportDue(sessions: readonly SessionRecord[], lastReportedSeason: number | undefined, nowMs: number): number | undefined {
  const current = season(sessions, nowMs);
  if (!current || current.number <= 1) return undefined;
  const closed = current.number - 1;
  if (lastReportedSeason !== undefined && lastReportedSeason >= closed) return undefined;
  return closed;
}

// ---- revisión semanal --------------------------------------------------------

export interface WeeklyReview {
  lastWeek: WeekSummary;
  previousWeek: WeekSummary;
  streak: number;
  /** Mediana del reposo del ritual en cada semana, si hubo lecturas. */
  restLastWeekBpm: number | undefined;
  restPreviousWeekBpm: number | undefined;
  /** Lo que el rider anotó en las salidas de la semana pasada, con cuántas veces cada palabra. */
  notes: Array<{ note: string; times: number }>;
  /** Lo que el plan propone para la semana que empieza. */
  plan: Recommendation;
}

/** La primera vez que se abre la app en una semana nueva, si ya hay historial. */
export function weeklyReviewDue(
  sessions: readonly SessionRecord[],
  lastReviewWeekMs: number | undefined,
  nowMs: number,
): boolean {
  if (sessions.length === 0) return false;
  const current = weekStartMs(nowMs);
  if (lastReviewWeekMs === current) return false;
  // Solo si la semana pasada tuvo algo que contar (o la anterior): tras un
  // mes sin salir, lo primero no es una revisión.
  const lastStart = previousWeekStart(current);
  return sessions.some((s) => {
    const w = weekStartMs(s.startedAtMs);
    return w === lastStart || w === previousWeekStart(lastStart);
  });
}

export function weeklyReview(sessions: readonly SessionRecord[], nowMs: number): WeeklyReview {
  const current = weekStartMs(nowMs);
  const lastStart = previousWeekStart(current);
  const prevStart = previousWeekStart(lastStart);
  const restOf = (weekStart: number): number | undefined => {
    const readings = sessions
      .filter((s) => weekStartMs(s.startedAtMs) === weekStart)
      .map((s) => s.preRideRestBpm)
      .filter((bpm): bpm is number => bpm !== undefined && bpm > 0);
    return readings.length > 0 ? Math.round(median(readings)) : undefined;
  };
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (weekStartMs(s.startedAtMs) !== lastStart || !s.note) continue;
    counts.set(s.note, (counts.get(s.note) ?? 0) + 1);
  }
  return {
    lastWeek: summarizeWeek(sessions, lastStart),
    previousWeek: summarizeWeek(sessions, prevStart),
    streak: streakWeeks(sessions, nowMs),
    restLastWeekBpm: restOf(lastStart),
    restPreviousWeekBpm: restOf(prevStart),
    notes: [...counts].map(([note, times]) => ({ note, times })).sort((a, b) => b.times - a.times),
    plan: recommendToday(sessions, nowMs),
  };
}

/** Latidos que dio el corazón durante la salida, redondeados a la centena: un dato con sentido. */
export function heartbeats(avgHeartRateBpm: number, durationSec: number): number | undefined {
  if (avgHeartRateBpm <= 0 || durationSec <= 0) return undefined;
  return Math.round((avgHeartRateBpm * durationSec) / 60 / 100) * 100;
}

// ---- el ritual de salida: reposo del día y disposición ---------------------

/** 'rest': tan por encima de lo normal que hoy toca descansar, no aflojar. */
export type Readiness = 'unknown' | 'normal' | 'elevated' | 'rest';

export interface ReadinessVerdict {
  state: Readiness;
  /** Mediana de las últimas lecturas de reposo antes de salir. */
  baselineBpm: number | undefined;
  /** Hoy menos la base (positivo = más alto de lo normal). */
  deltaBpm: number | undefined;
}

/** Con menos lecturas no hay "normal" contra el que comparar. */
export const READINESS_MIN_READINGS = 3;
/** Un reposo esta cantidad por encima de lo normal es señal de fatiga o de que algo se incuba. */
export const ELEVATED_REST_BPM = 8;
/** Y esta cantidad ya no es para aflojar: es para no salir hoy. */
export const REST_DAY_BPM = 12;
const BASELINE_READINGS = 7;

/** Lecturas de reposo del ritual (las que existan), de la más antigua a la más reciente. */
export function preRideRestReadings(sessions: readonly SessionRecord[]): number[] {
  return sessions
    .map((s) => s.preRideRestBpm)
    .filter((bpm): bpm is number => bpm !== undefined && bpm > 0);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function restBaseline(sessions: readonly SessionRecord[]): number | undefined {
  const readings = preRideRestReadings(sessions).slice(-BASELINE_READINGS);
  return readings.length >= READINESS_MIN_READINGS ? Math.round(median(readings)) : undefined;
}

/**
 * ¿Cómo viene el cuerpo hoy? Compara el reposo medido antes de salir con la
 * mediana de las últimas lecturas. Solo señala "elevado": una lectura baja no
 * es licencia para apretar, y una alta sí es razón para aflojar.
 */
export function readiness(sessions: readonly SessionRecord[], todayBpm: number): ReadinessVerdict {
  const baselineBpm = restBaseline(sessions);
  if (baselineBpm === undefined || todayBpm <= 0) return { state: 'unknown', baselineBpm, deltaBpm: undefined };
  const deltaBpm = Math.round(todayBpm - baselineBpm);
  const state: Readiness =
    deltaBpm >= REST_DAY_BPM ? 'rest' : deltaBpm >= ELEVATED_REST_BPM ? 'elevated' : 'normal';
  return { state, baselineBpm, deltaBpm };
}

// ---- mejorar: los tres números que un pulsómetro sí puede dar ---------------

export interface Trend {
  /** Valor reciente (ventana de las últimas salidas), o undefined si aún no hay bastantes. */
  now: number | undefined;
  /** El mismo cálculo sobre la ventana anterior, para comparar. */
  before: number | undefined;
}

export interface HealthTrends {
  /** Reposo antes de salir: mediana de las últimas 7 lecturas frente a las 7 anteriores. Baja con la forma. */
  restBpm: Trend;
  /** Recuperación cardíaca: caída media (bpm en 1 min) de las últimas 5 salidas con oleadas. Sube con la forma. */
  recoveryBpm: Trend;
  /** Precisión de zona: fracción media de la salida dentro de la zona prescrita (últimas 5). */
  zonePrecision: Trend;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function windowed(
  values: readonly number[],
  size: number,
  reduce: (xs: readonly number[]) => number,
  minCount: number,
): Trend {
  const now = values.slice(-size);
  const before = values.slice(-2 * size, -size);
  return {
    now: now.length >= minCount ? reduce(now) : undefined,
    before: before.length >= minCount ? reduce(before) : undefined,
  };
}

export function healthTrends(sessions: readonly SessionRecord[]): HealthTrends {
  const rests = preRideRestReadings(sessions);
  const recoveries = sessions
    .map((s) => s.recoveryDrops)
    .filter((d): d is number[] => d !== undefined && d.length > 0)
    .map((d) => mean(d));
  const precision = sessions
    .filter(isCountable)
    .filter((s) => s.inZoneSec !== undefined && s.durationSec > 0)
    .map((s) => (s.inZoneSec ?? 0) / s.durationSec);
  return {
    restBpm: windowed(rests, BASELINE_READINGS, median, READINESS_MIN_READINGS),
    recoveryBpm: windowed(recoveries, 5, mean, 2),
    zonePrecision: windowed(precision, 5, mean, 2),
  };
}
