import { describe, expect, it } from 'vitest';
import type { SessionRecord } from './history';
import { routeOverview, todayWindow } from './routeMap';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 10);

function rec(over: Partial<SessionRecord> & { startedAtMs: number; distanceM: number }): SessionRecord {
  return {
    id: `${over.startedAtMs}-fondo`,
    programId: 'fondo',
    programName: 'Fondo',
    target: 'aerobic',
    inputMode: 'heartRate',
    completed: true,
    plannedSec: 1200,
    durationSec: 1200,
    timesCaught: 0,
    avgHeartRateBpm: 120,
    peakHeartRateBpm: 140,
    avgEffortFrac: 0.6,
    zoneSec: [0, 0, 1200, 0, 0, 0],
    hrRestBpm: 65,
    ...over,
  };
}

describe('el diario de la Ruta', () => {
  it('cada salida es un tramo, los refugios se encienden con la fecha de la salida que los alcanzó, y el mapa llega al siguiente', () => {
    const sessions = [
      rec({ startedAtMs: T0 + 2 * DAY, distanceM: 8000 }), // desordenada a propósito
      rec({ startedAtMs: T0, distanceM: 3000, durationSec: 600, completed: false }),
      rec({ startedAtMs: T0 + 3 * DAY, distanceM: 0, durationSec: 3, completed: false }), // abortada al arrancar
    ];
    const o = routeOverview(sessions, 2.5, 13.9, T0 + 5 * DAY);
    expect(o.beforeKm).toBeCloseTo(11, 5);
    expect(o.totalKm).toBeCloseTo(13.5, 5);
    expect(o.toKm).toBe(25);
    expect(o.rides.map((r) => [r.fromKm, r.toKm, r.today])).toEqual([
      [0, 3, false],
      [3, 11, false],
      [11, 13.5, true],
    ]);
    expect(o.refuges.map((r) => [r.name, r.reached, r.reachedAtMs, r.reachedToday])).toEqual([
      ['El puente', true, T0 + 2 * DAY, false],
      ['La gasolinera', false, undefined, false],
    ]);
    // La primera salida limpia fue la segunda: su marca está al final de ese tramo.
    expect(o.marks.map((m) => [m.id, m.km])).toEqual([['first-clean', 11]]);
    expect(o.next.refuge.name).toBe('La gasolinera');
    expect(o.next.remainingKm).toBeCloseTo(11.5, 5);
    expect(o.typicalRideKm).toBeCloseTo(5.5, 5); // mediana de 3 y 8
    expect(o.next.ridesEstimate).toBe(3);
    expect(o.longestRideKm).toBeCloseTo(8, 5); // la de 3 km no se completó
  });

  it('un refugio alcanzado hoy se enciende sin fecha, y sin historia no hay estimación', () => {
    const o = routeOverview([rec({ startedAtMs: T0, distanceM: 9500 })], 1, 12, T0 + DAY);
    expect(o.refuges[0]).toMatchObject({ name: 'El puente', reached: true, reachedToday: true });
    expect(o.refuges[0]?.reachedAtMs).toBeUndefined();
    const fresh = routeOverview([], 0.5, 6, T0);
    expect(fresh.rides).toEqual([{ fromKm: 0, toKm: 0.5, startedAtMs: T0, today: true }]);
    expect(fresh.refuges.map((r) => r.name)).toEqual(['El puente']);
    expect(fresh.next.ridesEstimate).toBeUndefined();
    expect(fresh.longestRideKm).toBe(0);
    expect(fresh.marks).toEqual([]);
  });

  it('el mapa se alarga hasta el refugio siguiente si hoy vas a pasar el próximo', () => {
    const o = routeOverview([rec({ startedAtMs: T0, distanceM: 8000 })], 1.5, 11, T0 + DAY);
    expect(o.toKm).toBe(25);
  });

  it('la ventana de hoy cabe la salida, la regla de la más larga y un margen', () => {
    const w = todayWindow(11, 12, 13.9, 8);
    expect(w.fromKm).toBeCloseTo(10.6, 5);
    expect(w.toKm).toBeCloseTo(19.4, 5);
    expect(w.frac(10.6)).toBe(0);
    expect(w.frac(19.4)).toBe(1);
    expect(w.frac(15)).toBeCloseTo(4.4 / 8.8, 5);
    // Sin salida más larga, manda el final previsto.
    expect(todayWindow(0, 0.2, 5, 0).toKm).toBeCloseTo(5.4, 5);
  });
});
