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

/** Zona prescrita por un tramo: una sola (2) o un rango inclusivo ([1, 2]). 0 = suave. */
export type ZoneRange = number | readonly [number, number];

export function zoneRange(range: ZoneRange): [number, number] {
  return typeof range === 'number' ? [range, range] : [range[0], range[1]];
}

/** Esfuerzo mínimo para estar en la zona. La zona 0 tiene un piso propio (config). */
export function floorEffort(zone: number, bounds: readonly number[] = ZONES.lowerBounds): number {
  if (zone <= 0) return ZONES.easyFloorEffort;
  return bounds[Math.min(zone, bounds.length) - 1] ?? 1;
}

/** Esfuerzo desde el que ya estás POR ENCIMA de la zona: el piso de la siguiente. Z5 no tiene techo. */
export function ceilingEffort(zone: number, bounds: readonly number[] = ZONES.lowerBounds): number {
  return bounds[zone] ?? Number.POSITIVE_INFINITY;
}

/** "Z2", "Z1-Z2", "suave", "suave-Z1": la etiqueta de un rango para la HUD. */
export function zoneLabel(zoneMin: number, zoneMax: number): string {
  const one = (z: number) => (z <= 0 ? 'suave' : `Z${z}`);
  return zoneMin === zoneMax ? one(zoneMin) : `${one(zoneMin)}-${one(zoneMax)}`;
}

/**
 * La prueba del habla por zona: la guía del modo por sensación y de quien no
 * lleva pulsera. Es lo que la fisiología sabe leer sin sensor.
 */
const TALK_TEST: readonly string[] = [
  'muy suave: podrías cantar',
  'suave: hablas sin ningún esfuerzo',
  'hablas frases enteras',
  'solo frases cortas',
  'palabras sueltas',
  'no puedes hablar',
];

export function talkTestCue(zoneMin: number, zoneMax: number = zoneMin): string {
  const lo = TALK_TEST[Math.max(0, Math.min(TALK_TEST.length - 1, zoneMin))] ?? '';
  const hi = TALK_TEST[Math.max(0, Math.min(TALK_TEST.length - 1, zoneMax))] ?? '';
  return zoneMin === zoneMax || lo === hi ? lo : `entre "${lo}" y "${hi}"`;
}

/** Segundos de cardio real: desde activeFromZone (Z2) hacia arriba. */
export function activeSec(zoneSec: readonly number[], fromZone: number = ZONES.activeFromZone): number {
  let total = 0;
  for (let z = fromZone; z < zoneSec.length; z++) total += zoneSec[z] ?? 0;
  return total;
}
