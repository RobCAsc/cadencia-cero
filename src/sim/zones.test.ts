import { describe, expect, it } from 'vitest';
import {
  activeSec,
  ceilingEffort,
  emptyZoneSec,
  floorEffort,
  ZONE_COUNT,
  zoneLabel,
  zoneOf,
  zoneRange,
} from './zones';

describe('piso y techo de zona', () => {
  it('el piso es el límite inferior de la zona; la suave tiene el suyo', () => {
    expect(floorEffort(0)).toBe(0.35);
    expect(floorEffort(1)).toBe(0.5);
    expect(floorEffort(3)).toBe(0.7);
    expect(floorEffort(5)).toBe(0.9);
    expect(floorEffort(9)).toBe(0.9); // se clampa a Z5
  });

  it('el techo es el piso de la zona siguiente; Z5 no tiene', () => {
    expect(ceilingEffort(0)).toBe(0.5);
    expect(ceilingEffort(2)).toBe(0.7);
    expect(ceilingEffort(4)).toBe(0.9);
    expect(ceilingEffort(5)).toBe(Number.POSITIVE_INFINITY);
  });

  it('rangos y etiquetas', () => {
    expect(zoneRange(2)).toEqual([2, 2]);
    expect(zoneRange([1, 3])).toEqual([1, 3]);
    expect(zoneLabel(2, 2)).toBe('Z2');
    expect(zoneLabel(1, 2)).toBe('Z1-Z2');
    expect(zoneLabel(0, 0)).toBe('suave');
    expect(zoneLabel(0, 1)).toBe('suave-Z1');
  });
});

describe('zoneOf', () => {
  it('mapea la fracción de esfuerzo a Z0..Z5 con límites inclusivos por abajo', () => {
    expect(zoneOf(0)).toBe(0);
    expect(zoneOf(0.49)).toBe(0);
    expect(zoneOf(0.5)).toBe(1);
    expect(zoneOf(0.6)).toBe(2);
    expect(zoneOf(0.75)).toBe(3);
    expect(zoneOf(0.8)).toBe(4);
    expect(zoneOf(0.9)).toBe(5);
    expect(zoneOf(1)).toBe(5);
  });

  it('acepta límites propios', () => {
    expect(zoneOf(0.35, [0.3, 0.6])).toBe(1);
    expect(zoneOf(0.7, [0.3, 0.6])).toBe(2);
  });
});

describe('activeSec', () => {
  it('suma desde Z2: lo suave y Z1 no son cardio', () => {
    const zones = emptyZoneSec();
    expect(zones).toHaveLength(ZONE_COUNT);
    zones[0] = 100;
    zones[1] = 50;
    zones[2] = 30;
    zones[4] = 20;
    expect(activeSec(zones)).toBe(50);
    expect(activeSec(zones, 1)).toBe(100);
  });
});
