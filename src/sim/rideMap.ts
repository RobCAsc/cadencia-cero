import type { ExpandedSegment } from './program';
import { refugeAt, type Refuge } from './progress';

// El mapa de la salida: lo que hay detrás en metros (la horda, el fantasma)
// y lo que viene en minutos (los tramos, el refugio, el amanecer). Puro y
// sin Phaser: la tira de la HUD y la vista de mapa lo dibujan, esto lo calcula.

/** Un tramo de lo que viene, recortado a la ventana: offsetSec 0 es ahora. */
export interface AheadSegment {
  kind: ExpandedSegment['kind'];
  offsetSec: number;
  durationSec: number;
  zoneMin: number;
  zoneMax: number;
  grade?: number;
  /** Empezó antes de ahora: es el tramo actual, recortado. */
  current: boolean;
}

/** Los tramos entre ahora y windowSec por delante, recortados a esa ventana. */
export function aheadSegments(
  segments: readonly ExpandedSegment[],
  elapsedSec: number,
  windowSec: number,
): AheadSegment[] {
  const out: AheadSegment[] = [];
  const end = elapsedSec + windowSec;
  for (const s of segments) {
    if (s.endSec <= elapsedSec || s.startSec >= end) continue;
    const from = Math.max(s.startSec, elapsedSec);
    const to = Math.min(s.endSec, end);
    if (to - from <= 0) continue;
    out.push({
      kind: s.kind,
      offsetSec: from - elapsedSec,
      durationSec: to - from,
      zoneMin: s.zoneMin,
      zoneMax: s.zoneMax,
      ...(s.grade !== undefined ? { grade: s.grade } : {}),
      current: s.startSec < elapsedSec,
    });
  }
  return out;
}

/**
 * Píxeles para una distancia en metros: crece rápido cerca y se aplana
 * lejos, como la horda en la carretera. A halfM metros va la mitad de maxPx.
 */
export function asymptoticPx(meters: number, halfM: number, maxPx: number): number {
  const m = Math.max(0, meters);
  return (maxPx * m) / (m + halfM);
}

const MIN_ETA_KPH = 3;

/** Segundos hasta cubrir una distancia a esta velocidad; undefined si estás parado. */
export function etaSec(distanceM: number, speedKph: number): number | undefined {
  if (!(speedKph >= MIN_ETA_KPH)) return undefined;
  return Math.max(0, distanceM) / (speedKph / 3.6);
}

export interface WindowRefuge extends Refuge {
  /** 0..1 dentro de la ventana. */
  frac: number;
  reached: boolean;
}

export interface RouteWindow {
  fromKm: number;
  toKm: number;
  refuges: WindowRefuge[];
  /** 0..1 dentro de la ventana para un km, recortado. */
  frac(km: number): number;
}

/**
 * La ventana de la Ruta que enseña el mapa: unos km atrás y unos por
 * delante de donde vas, con los refugios que caen dentro. Toda la Ruta a la
 * vez no sirve: 2,6 km en 60 son un dedo.
 */
export function routeWindow(totalKm: number, behindKm: number, aheadKm: number): RouteWindow {
  const fromKm = Math.max(0, totalKm - behindKm);
  const toKm = fromKm + behindKm + aheadKm;
  const span = toKm - fromKm;
  const frac = (km: number): number => Math.min(1, Math.max(0, (km - fromKm) / span));
  const refuges: WindowRefuge[] = [];
  for (let i = 0; i < 1000; i++) {
    const r = refugeAt(i);
    if (r.km > toKm) break;
    if (r.km >= fromKm) refuges.push({ ...r, frac: frac(r.km), reached: totalKm >= r.km });
  }
  return { fromKm, toKm, refuges, frac };
}
