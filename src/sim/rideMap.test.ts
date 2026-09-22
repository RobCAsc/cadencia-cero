import { describe, expect, it } from 'vitest';
import { expandProgram, type TrainingProgram } from './program';
import { nextRefuge } from './progress';
import { aheadSegments, asymptoticPx, etaSec, routeWindow } from './rideMap';

const program: TrainingProgram = {
  id: 't',
  name: 't',
  target: 't',
  segments: [
    { kind: 'warmup', durationSec: 300, zone: [0, 1], zombieSpeedKph: 10 },
    { kind: 'steady', durationSec: 600, zone: 2, zombieSpeedKph: 30, grade: 6 },
    { kind: 'cooldown', durationSec: 180, zone: [0, 1], zombieSpeedKph: 10 },
  ],
};

describe('el mapa de la salida', () => {
  it('recorta los tramos a la ventana por delante y marca el actual', () => {
    const segs = expandProgram(program);
    const wide = aheadSegments(segs, 250, 900);
    expect(wide.map((s) => [s.kind, s.offsetSec, s.durationSec, s.current])).toEqual([
      ['warmup', 0, 50, true],
      ['steady', 50, 600, false],
      ['cooldown', 650, 180, false],
    ]);
    expect(wide[1]?.grade).toBe(6);
    const narrow = aheadSegments(segs, 250, 100);
    expect(narrow.map((s) => [s.kind, s.offsetSec, s.durationSec])).toEqual([
      ['warmup', 0, 50],
      ['steady', 50, 50],
    ]);
    expect(aheadSegments(segs, 1080, 900)).toEqual([]);
  });

  it('la escala asintótica: cerca se ve, lejos se aplana', () => {
    expect(asymptoticPx(0, 45, 170)).toBe(0);
    expect(asymptoticPx(45, 45, 170)).toBeCloseTo(85, 5);
    expect(asymptoticPx(100, 45, 170)).toBeCloseTo(117.24, 1);
    expect(asymptoticPx(10000, 45, 170)).toBeLessThan(170);
    expect(asymptoticPx(-5, 45, 170)).toBe(0);
  });

  it('el tiempo hasta el refugio: parado no hay', () => {
    expect(etaSec(1000, 0)).toBeUndefined();
    expect(etaSec(1000, 2)).toBeUndefined();
    expect(etaSec(1000, 36)).toBeCloseTo(100, 5);
    expect(etaSec(-20, 36)).toBe(0);
  });

  it('la ventana de la Ruta: unos km atrás y otros por delante, con los refugios que caen dentro', () => {
    const w = routeWindow(23.4, 5, 10);
    expect(w.fromKm).toBeCloseTo(18.4, 5);
    expect(w.toKm).toBeCloseTo(33.4, 5);
    expect(w.refuges.map((r) => [r.name, r.km, r.reached])).toEqual([['La gasolinera', 25, false]]);
    expect(w.refuges[0]?.frac).toBeCloseTo((25 - 18.4) / 15, 5);
    expect(w.frac(18.4)).toBe(0);
    expect(w.frac(40)).toBe(1);
    // Al principio de la Ruta la ventana empieza en el km 0.
    const start = routeWindow(2, 5, 10);
    expect(start.fromKm).toBe(0);
    expect(start.toKm).toBe(15);
    expect(start.refuges.map((r) => r.name)).toEqual(['El puente']);
    // Un refugio justo alcanzado cuenta como alcanzado.
    expect(routeWindow(10, 5, 10).refuges[0]?.reached).toBe(true);
  });

  it('el siguiente refugio por delante de un km', () => {
    expect(nextRefuge(0).name).toBe('El puente');
    expect(nextRefuge(10).name).toBe('La gasolinera');
    expect(nextRefuge(1300)).toEqual({ km: 1700, name: 'Refugio 11' });
  });
});
