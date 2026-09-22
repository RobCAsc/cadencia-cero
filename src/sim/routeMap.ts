import type { SessionRecord } from './history';
import { marks, type MarkId } from './marks';
import { nextRefuge, refugeAt, type Refuge } from './progress';

// El diario de la Ruta: lo que el mapa de la salida enseña y el sim no sabe.
// Todo sale de la lista de sesiones: cada salida como un tramo de carretera,
// los refugios encendidos con su fecha, las marcas donde se ganaron, y lo que
// falta para el siguiente refugio en km y en salidas. Puro y sin Phaser.

/** Una salida pasada (o la de hoy) como tramo de la Ruta. */
export interface RouteRide {
  fromKm: number;
  toKm: number;
  startedAtMs: number;
  today: boolean;
}

export interface RouteRefuge extends Refuge {
  reached: boolean;
  /** Cuándo se encendió: la salida que lo alcanzó. Sin fecha si fue hoy. */
  reachedAtMs?: number;
  reachedToday: boolean;
}

export interface RouteMark {
  id: MarkId;
  title: string;
  /** Km de la Ruta donde se ganó: al final de la salida que la dio. */
  km: number;
}

export interface RouteNext {
  refuge: Refuge;
  remainingKm: number;
  /** Salidas que faltan a tu distancia típica; undefined sin historia. */
  ridesEstimate?: number;
}

export interface RouteOverview {
  /** Km de la Ruta antes de hoy. */
  beforeKm: number;
  totalKm: number;
  /** Hasta dónde llega el mapa: el siguiente refugio por delante de hoy. */
  toKm: number;
  rides: RouteRide[];
  refuges: RouteRefuge[];
  marks: RouteMark[];
  next: RouteNext;
  /** Tu salida más larga (completa, que cuenta), en km; 0 sin historia. */
  longestRideKm: number;
  typicalRideKm?: number;
}

const COUNTABLE_SEC = 300;
const TYPICAL_RIDES = 5;

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * La Ruta entera hasta el siguiente refugio, con lo de hoy en curso.
 * @param todayKm lo pedaleado hoy (aún no está en `sessions`).
 * @param plannedEndKm dónde calculo que acaba la salida de hoy.
 * @param todayStartedAtMs cuándo empezó la salida de hoy.
 */
export function routeOverview(
  sessions: readonly SessionRecord[],
  todayKm: number,
  plannedEndKm: number,
  todayStartedAtMs: number,
): RouteOverview {
  const past = [...sessions].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const rides: RouteRide[] = [];
  let cum = 0;
  for (const s of past) {
    if (!(s.distanceM > 0)) continue;
    const toKm = cum + s.distanceM / 1000;
    rides.push({ fromKm: cum, toKm, startedAtMs: s.startedAtMs, today: false });
    cum = toKm;
  }
  const beforeKm = cum;
  const totalKm = beforeKm + Math.max(0, todayKm);
  if (todayKm > 0) rides.push({ fromKm: beforeKm, toKm: totalKm, startedAtMs: todayStartedAtMs, today: true });

  const toKm = nextRefuge(Math.max(totalKm, plannedEndKm)).km;
  const refuges: RouteRefuge[] = [];
  for (let i = 0; i < 1000; i++) {
    const r = refugeAt(i);
    if (r.km > toKm) break;
    const reached = totalKm >= r.km;
    const by = rides.find((ride) => !ride.today && ride.toKm >= r.km);
    refuges.push({
      ...r,
      reached,
      ...(reached && by ? { reachedAtMs: by.startedAtMs } : {}),
      reachedToday: reached && !by,
    });
  }

  const kmAt = (ms: number): number => {
    let km = 0;
    for (const ride of rides) if (!ride.today && ride.startedAtMs <= ms) km = ride.toKm;
    return km;
  };
  const routeMarks: RouteMark[] = marks(past)
    .filter((m): m is typeof m & { achievedAtMs: number } => m.achievedAtMs !== undefined)
    .map((m) => ({ id: m.id, title: m.title, km: kmAt(m.achievedAtMs) }));

  const countable = past.filter((s) => s.durationSec >= COUNTABLE_SEC && s.distanceM > 0);
  const longestRideKm = countable.filter((s) => s.completed).reduce((acc, s) => Math.max(acc, s.distanceM / 1000), 0);
  const typicalRideKm = median(countable.slice(-TYPICAL_RIDES).map((s) => s.distanceM / 1000));
  const refuge = nextRefuge(totalKm);
  const remainingKm = refuge.km - totalKm;
  const ridesEstimate = typicalRideKm !== undefined && typicalRideKm > 0 ? Math.max(1, Math.ceil(remainingKm / typicalRideKm)) : undefined;

  return {
    beforeKm,
    totalKm,
    toKm,
    rides,
    refuges,
    marks: routeMarks,
    next: { refuge, remainingKm, ...(ridesEstimate !== undefined ? { ridesEstimate } : {}) },
    longestRideKm,
    ...(typicalRideKm !== undefined ? { typicalRideKm } : {}),
  };
}

export interface TodayWindow {
  fromKm: number;
  toKm: number;
  frac(km: number): number;
}

/**
 * La ventana del trozo de hoy: desde donde empezaste hasta donde acabas, o
 * hasta tu salida más larga si es más lejos (la regla tiene que caber).
 */
export function todayWindow(startKm: number, nowKm: number, plannedEndKm: number, longestRideKm: number, marginKm = 0.4): TodayWindow {
  const fromKm = Math.max(0, startKm - marginKm);
  const toKm = Math.max(plannedEndKm, startKm + longestRideKm, nowKm + 0.5) + marginKm;
  const span = Math.max(0.1, toKm - fromKm);
  return { fromKm, toKm, frac: (km) => Math.min(1, Math.max(0, (km - fromKm) / span)) };
}
