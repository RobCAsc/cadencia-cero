import { describe, expect, it } from 'vitest';
import { activeSec, emptyZoneSec, ZONE_COUNT, zoneOf } from './zones';

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
