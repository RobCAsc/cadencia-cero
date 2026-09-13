import { EFFORT, RIDER, type EffortTable, type RiderProfile } from '../config';

/**
 * Fracción de reserva cardíaca (Karvonen): 0 en reposo, 1 en el máximo.
 * Sin lectura (bpm ≤ 0) es 0: nadie pedalea.
 */
export function effortFraction(bpm: number, rider: RiderProfile = RIDER): number {
  if (bpm <= 0) return 0;
  const range = rider.hrMaxBpm - rider.hrRestBpm;
  if (range <= 0) throw new Error('perfil del rider malformado: máx ≤ reposo');
  const raw = (bpm - rider.hrRestBpm) / range;
  return Math.min(1, Math.max(0, raw * (rider.effortScale ?? 1)));
}

/**
 * Velocidad del jugador según la tabla de esfuerzo, interpolando linealmente.
 * Por encima del último breakpoint se mantiene la última columna.
 */
export function playerSpeedFromEffort(effortFrac: number, table: EffortTable = EFFORT): number {
  const xs = table.effortBreakpoints;
  const ys = table.kph;
  if (xs.length === 0 || xs.length !== ys.length) throw new Error('tabla de esfuerzo malformada');

  const x = Math.max(0, effortFrac);
  const last = xs.length - 1;
  if (x >= (xs[last] ?? 0)) return ys[last] ?? 0;

  let i = 0;
  while (i < last - 1 && x >= (xs[i + 1] ?? Infinity)) i++;
  const x0 = xs[i] ?? 0;
  const x1 = xs[i + 1] ?? x0;
  const y0 = ys[i] ?? 0;
  const y1 = ys[i + 1] ?? y0;
  if (x1 === x0) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}
