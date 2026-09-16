import { describe, expect, it } from 'vitest';
import { isCountable, toSessionRecord } from './history';
import type { RideSummary } from './types';

const summary: RideSummary = {
  durationSec: 1260,
  distanceM: 8200,
  timesCaught: 1,
  timesCaughtInEasy: 0,
  avgCadenceRpm: 0,
  avgHeartRateBpm: 142,
  peakHeartRateBpm: 171,
  avgEffortFrac: 0.62,
  zoneSec: [300, 200, 400, 300, 60, 0],
  inZoneSec: 900,
  aboveZoneSec: 60,
  recoveryDrops: [18, 21],
  gapTrace: [50, 58, 66],
  bestInZoneRunSec: 400,
};

describe('toSessionRecord', () => {
  it('aplana resumen + contexto en un registro con clave estable', () => {
    const record = toSessionRecord({
      startedAtMs: 1_700_000_000_000,
      program: { id: 'hiit-30-30', name: 'Oleadas', target: 'anaerobic' },
      plannedSec: 1260,
      inputMode: 'heartRate',
      completed: true,
      summary,
      hrRestBpm: 58,
    });
    expect(record.id).toBe('1700000000000-hiit-30-30');
    expect(record.programName).toBe('Oleadas');
    expect(record.distanceM).toBe(8200);
    expect(record.zoneSec).toEqual([300, 200, 400, 300, 60, 0]);
    expect(record.recoveryDrops).toEqual([18, 21]);
    expect(record.hrRestBpm).toBe(58);
    expect(record.completed).toBe(true);
    expect(record.timesCaughtInEasy).toBe(0);
    expect(record.gapTrace).toEqual([50, 58, 66]);
    expect(record.rpe).toBeUndefined();
  });

  it('guarda lo que dijo el rider al terminar', () => {
    const record = toSessionRecord({
      startedAtMs: 1,
      program: { id: 'p', name: 'P', target: 't' },
      plannedSec: 10,
      inputMode: 'feel',
      completed: true,
      summary,
      hrRestBpm: 60,
      rpe: 'hard',
      note: 'cansado',
    });
    expect(record.rpe).toBe('hard');
    expect(record.note).toBe('cansado');
    expect(record.bestInZoneRunSec).toBe(400);
    expect(record.inputMode).toBe('feel');
  });

  it('copia las zonas: mutar el resumen después no toca el registro', () => {
    const zones = [1, 2, 3, 4, 5, 6];
    const record = toSessionRecord({
      startedAtMs: 1,
      program: { id: 'p', name: 'P', target: 't' },
      plannedSec: 10,
      inputMode: 'cadence',
      completed: false,
      summary: { ...summary, zoneSec: zones },
      hrRestBpm: 60,
    });
    zones[0] = 99;
    expect(record.zoneSec[0]).toBe(1);
  });
});

describe('isCountable', () => {
  const base = toSessionRecord({
    startedAtMs: 1,
    program: { id: 'p', name: 'P', target: 't' },
    plannedSec: 600,
    inputMode: 'heartRate',
    completed: false,
    summary,
    hrRestBpm: 60,
  });

  it('una salida abandonada cuenta si duró al menos cinco minutos', () => {
    expect(isCountable({ ...base, durationSec: 299 })).toBe(false);
    expect(isCountable({ ...base, durationSec: 300 })).toBe(true);
  });
});
