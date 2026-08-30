import { SPEED, type SpeedTable } from '../config';

/**
 * Velocidad del jugador según la tabla (resistencia declarada, cadencia rpm).
 * Interpolación lineal solo en cadencia; el nivel es un entero declarado por
 * el rider, sin interpolación entre niveles. Por encima del último breakpoint
 * se mantiene la última columna (no se extrapola).
 */
export function playerSpeedKph(
  resistanceLevel: number,
  cadenceRpm: number,
  table: SpeedTable = SPEED,
): number {
  const rows = table.kphByLevel.length;
  const level = Math.min(rows, Math.max(1, Math.round(resistanceLevel)));
  const row = table.kphByLevel[level - 1];
  const bps = table.cadenceBreakpoints;
  if (!row || row.length !== bps.length || bps.length === 0) {
    throw new Error(`tabla de velocidad malformada para nivel ${level}`);
  }

  const rpm = Math.max(0, cadenceRpm);
  const last = bps.length - 1;
  if (rpm >= (bps[last] ?? 0)) return row[last] ?? 0;

  let i = 0;
  while (i < last - 1 && rpm >= (bps[i + 1] ?? Infinity)) i++;
  const x0 = bps[i] ?? 0;
  const x1 = bps[i + 1] ?? x0;
  const y0 = row[i] ?? 0;
  const y1 = row[i + 1] ?? y0;
  if (x1 === x0) return y0;
  return y0 + ((rpm - x0) / (x1 - x0)) * (y1 - y0);
}
