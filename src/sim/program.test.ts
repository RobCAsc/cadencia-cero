import { describe, expect, it } from 'vitest';
import { playerSpeedFromEffort } from './effortTable';
import {
  expandProgram,
  hordeSpeedForZone,
  segmentIndexAt,
  totalDurationSec,
  zombieSpeedAt,
  type TrainingProgram,
} from './program';
import { OLEADAS } from './programs/oleadas';
import { floorEffort } from './zones';

// Velocidades derivadas de las zonas de Oleadas: calentamiento suave,
// oleada en Z4-Z5 (piso Z4), recuperación en Z1-Z2 (piso Z1).
const WARM = hordeSpeedForZone(0);
const SURGE = hordeSpeedForZone(4);
const RECOVER = hordeSpeedForZone(1);

const prog = (segments: TrainingProgram['segments']): TrainingProgram => ({
  id: 'test',
  name: 'test',
  target: 'test',
  segments,
});

describe('expandProgram', () => {
  it('expande Oleadas a 13 segmentos, 6 oleadas, 1380 s', () => {
    const exp = expandProgram(OLEADAS);
    expect(exp).toHaveLength(13);
    expect(exp.filter((s) => s.kind === 'surge')).toHaveLength(6);
    expect(totalDurationSec(exp)).toBe(1380);
  });

  it('acumula startSec/endSec correctamente', () => {
    const exp = expandProgram(OLEADAS);
    expect(exp[0]).toMatchObject({ kind: 'warmup', startSec: 0, endSec: 300 });
    expect(exp[1]).toMatchObject({ kind: 'surge', startSec: 300, endSec: 360 });
    expect(exp[2]).toMatchObject({ kind: 'recover', startSec: 360, endSec: 480 });
    expect(exp[3]).toMatchObject({ kind: 'surge', startSec: 480, endSec: 540 });
    expect(exp[12]).toMatchObject({ kind: 'recover', endSec: 1380 });
  });

  it('numera las oleadas 1..6 y conserva el sourceIndex original', () => {
    const exp = expandProgram(OLEADAS);
    const surges = exp.filter((s) => s.kind === 'surge');
    expect(surges.map((s) => s.waveNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(surges.every((s) => s.waveTotal === 6)).toBe(true);
    expect(surges.every((s) => s.sourceIndex === 1)).toBe(true);
  });

  it('deriva la velocidad de la horda del piso de la zona, salvo velocidad explícita', () => {
    const exp = expandProgram(
      prog([
        { kind: 'steady', durationSec: 60, zone: 2 },
        { kind: 'steady', durationSec: 60, zone: [1, 3] },
        { kind: 'steady', durationSec: 60, zone: 0 },
        { kind: 'steady', durationSec: 60, zone: 4, zombieSpeedKph: 99 },
      ]),
    );
    expect(exp[0]).toMatchObject({ zoneMin: 2, zoneMax: 2, zombieSpeedKph: playerSpeedFromEffort(floorEffort(2)) });
    expect(exp[0]?.zombieSpeedKph).toBe(18);
    expect(exp[1]).toMatchObject({ zoneMin: 1, zoneMax: 3, zombieSpeedKph: hordeSpeedForZone(1) });
    expect(exp[2]?.zombieSpeedKph).toBeCloseTo(7.5);
    expect(exp[3]).toMatchObject({ zoneMin: 4, zoneMax: 4, zombieSpeedKph: 99 });
  });

  it('rechaza zonas inválidas', () => {
    expect(() => expandProgram(prog([{ kind: 'steady', durationSec: 60, zone: 6 }]))).toThrow(/zona/);
    expect(() => expandProgram(prog([{ kind: 'steady', durationSec: 60, zone: -1 }]))).toThrow(/zona/);
    expect(() => expandProgram(prog([{ kind: 'steady', durationSec: 60, zone: [3, 2] }]))).toThrow(/zona/);
    expect(() => expandProgram(prog([{ kind: 'steady', durationSec: 60, zone: 2.5 }]))).toThrow(/zona/);
  });

  it('rechaza times < 1, fromIndex fuera de rango y repeat anidado', () => {
    const seg = { kind: 'steady', durationSec: 60, zone: 2, zombieSpeedKph: 15 } as const;
    expect(() => expandProgram(prog([seg, { kind: 'repeat', times: 0, fromIndex: 0 }]))).toThrow(
      /times/,
    );
    expect(() => expandProgram(prog([seg, { kind: 'repeat', times: 2, fromIndex: 1 }]))).toThrow(
      /fromIndex/,
    );
    expect(() =>
      expandProgram(
        prog([seg, { kind: 'repeat', times: 2, fromIndex: 0 }, { kind: 'repeat', times: 2, fromIndex: 0 }]),
      ),
    ).toThrow(/anidado/);
  });

  it('rechaza programas sin segmentos de velocidad y duraciones no positivas', () => {
    expect(() => expandProgram(prog([]))).toThrow(/sin segmentos/);
    expect(() =>
      expandProgram(prog([{ kind: 'steady', durationSec: 0, zone: 1, zombieSpeedKph: 10 }])),
    ).toThrow(/durationSec/);
  });
});

describe('zombieSpeedAt', () => {
  const exp = expandProgram(OLEADAS);

  it('devuelve la velocidad del segmento fuera de la rampa', () => {
    expect(zombieSpeedAt(exp, 0, 2)).toBe(WARM);
    expect(zombieSpeedAt(exp, 299.9, 2)).toBe(WARM);
    expect(zombieSpeedAt(exp, 302, 2)).toBe(SURGE);
    expect(zombieSpeedAt(exp, 359.9, 2)).toBe(SURGE);
    expect(zombieSpeedAt(exp, 1379.9, 2)).toBe(RECOVER);
  });

  it('rampa lineal de 2 s al entrar a un segmento', () => {
    // A mitad de rampa, la media de las dos velocidades.
    expect(zombieSpeedAt(exp, 301, 2)).toBeCloseTo((WARM + SURGE) / 2, 10);
    expect(zombieSpeedAt(exp, 361, 2)).toBeCloseTo((SURGE + RECOVER) / 2, 10);
  });

  it('acelera con la rampa larga y frena con la corta', () => {
    // Subida warmup → oleada con 12 s de rampa: a los 6 s va por la mitad.
    expect(zombieSpeedAt(exp, 306, 2, 12)).toBeCloseTo((WARM + SURGE) / 2, 10);
    expect(zombieSpeedAt(exp, 311.9, 2, 12)).toBeLessThan(SURGE);
    expect(zombieSpeedAt(exp, 312, 2, 12)).toBe(SURGE);
    // Bajada oleada → recuperación con 2 s: a los 2 s ya frenó del todo.
    expect(zombieSpeedAt(exp, 362, 2, 12)).toBe(RECOVER);
  });

  it('sin rampa en el primer segmento ni con rampSec 0', () => {
    expect(zombieSpeedAt(exp, 0.5, 2)).toBe(WARM);
    expect(zombieSpeedAt(exp, 300.5, 0)).toBe(SURGE);
  });

  it('clampa más allá del final al último segmento', () => {
    expect(zombieSpeedAt(exp, 5000, 2)).toBe(RECOVER);
    expect(segmentIndexAt(exp, 5000)).toBe(12);
  });
});
