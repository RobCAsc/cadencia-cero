import { ZONES } from '../config';

export const ZONE_COUNT = ZONES.lowerBounds.length + 1;

/**
 * Zona cardíaca de una fracción de esfuerzo: 0 = suave (bajo Z1), 1..5 = Z1..Z5.
 * Sin lectura (esfuerzo 0) es zona 0: el tiempo cuenta, el cardio no.
 */
export function zoneOf(effortFrac: number, bounds: readonly number[] = ZONES.lowerBounds): number {
  let zone = 0;
  for (const bound of bounds) {
    if (effortFrac >= bound) zone += 1;
    else break;
  }
  return zone;
}

export function emptyZoneSec(): number[] {
  return new Array<number>(ZONE_COUNT).fill(0);
}

/** Segundos de cardio real: desde activeFromZone (Z2) hacia arriba. */
export function activeSec(zoneSec: readonly number[], fromZone: number = ZONES.activeFromZone): number {
  let total = 0;
  for (let z = fromZone; z < zoneSec.length; z++) total += zoneSec[z] ?? 0;
  return total;
}
