import { describe, expect, it } from 'vitest';
import { SPEED } from '../config';
import { playerSpeedKph } from './speedTable';

describe('playerSpeedKph', () => {
  it('da 0 a cadencia 0 en los 8 niveles', () => {
    for (let level = 1; level <= 8; level++) {
      expect(playerSpeedKph(level, 0)).toBe(0);
    }
  });

  it('ancla de calibración: nivel 3 a 80 rpm = 26 km/h', () => {
    expect(playerSpeedKph(3, 80)).toBe(26);
  });

  it('interpola linealmente entre breakpoints', () => {
    // N3: 80 rpm → 26, 90 rpm → 29.5; a 85 rpm el punto medio.
    expect(playerSpeedKph(3, 85)).toBeCloseTo(27.75, 10);
  });

  it('mantiene la última columna por encima de 120 rpm', () => {
    expect(playerSpeedKph(3, 140)).toBe(37);
    expect(playerSpeedKph(3, 120)).toBe(37);
  });

  it('trata cadencia negativa como 0', () => {
    expect(playerSpeedKph(3, -10)).toBe(0);
  });

  it('clampa niveles fuera de rango al 1..8', () => {
    expect(playerSpeedKph(0, 80)).toBe(playerSpeedKph(1, 80));
    expect(playerSpeedKph(-3, 80)).toBe(playerSpeedKph(1, 80));
    expect(playerSpeedKph(9, 80)).toBe(playerSpeedKph(8, 80));
  });

  it('la tabla es estrictamente monótona por filas y por columnas (rpm > 0)', () => {
    const { kphByLevel, cadenceBreakpoints } = SPEED;
    expect(kphByLevel).toHaveLength(8);
    for (const row of kphByLevel) {
      expect(row).toHaveLength(cadenceBreakpoints.length);
      for (let j = 1; j < row.length; j++) {
        expect(row[j]).toBeGreaterThan(row[j - 1] ?? Infinity);
      }
    }
    // Más resistencia a igual cadencia → más velocidad (columna 0 es toda 0).
    for (let j = 1; j < cadenceBreakpoints.length; j++) {
      for (let i = 1; i < kphByLevel.length; i++) {
        expect(kphByLevel[i]?.[j]).toBeGreaterThan(kphByLevel[i - 1]?.[j] ?? Infinity);
      }
    }
  });
});
