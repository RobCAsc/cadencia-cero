import { describe, expect, it } from 'vitest';
import { EFFORT } from '../config';
import { effortFraction, playerSpeedFromEffort } from './effortTable';

const rider = { hrMaxBpm: 180, hrRestBpm: 60 };

describe('effortFraction', () => {
  it('es 0 en reposo, 1 en el máximo y lineal entre medias (Karvonen)', () => {
    expect(effortFraction(60, rider)).toBe(0);
    expect(effortFraction(180, rider)).toBe(1);
    expect(effortFraction(120, rider)).toBeCloseTo(0.5);
  });

  it('se acota a 0..1 y sin lectura es 0', () => {
    expect(effortFraction(40, rider)).toBe(0);
    expect(effortFraction(200, rider)).toBe(1);
    expect(effortFraction(0, rider)).toBe(0);
  });

  it('rechaza un perfil con máximo ≤ reposo', () => {
    expect(() => effortFraction(100, { hrMaxBpm: 60, hrRestBpm: 60 })).toThrow();
  });
});

describe('playerSpeedFromEffort', () => {
  it('devuelve los valores de la tabla en los breakpoints', () => {
    EFFORT.effortBreakpoints.forEach((x, i) => {
      expect(playerSpeedFromEffort(x)).toBeCloseTo(EFFORT.kph[i] ?? -1);
    });
  });

  it('interpola linealmente entre breakpoints', () => {
    const table = { effortBreakpoints: [0, 0.5, 1], kph: [0, 10, 40] };
    expect(playerSpeedFromEffort(0.25, table)).toBeCloseTo(5);
    expect(playerSpeedFromEffort(0.75, table)).toBeCloseTo(25);
  });

  it('no extrapola por encima del último breakpoint', () => {
    expect(playerSpeedFromEffort(1.5)).toBe(EFFORT.kph[EFFORT.kph.length - 1]);
  });

  it('la tabla real es monótona: más esfuerzo nunca es menos velocidad', () => {
    for (let i = 1; i < EFFORT.kph.length; i++) {
      expect(EFFORT.kph[i] ?? 0).toBeGreaterThan(EFFORT.kph[i - 1] ?? 0);
      expect(EFFORT.effortBreakpoints[i] ?? 0).toBeGreaterThan(EFFORT.effortBreakpoints[i - 1] ?? 0);
    }
  });
});
