import { describe, expect, it } from 'vitest';
import {
  expandProgram,
  segmentIndexAt,
  totalDurationSec,
  zombieSpeedAt,
  type TrainingProgram,
} from './program';
import { HIIT_30_30 } from './programs/hiit-30-30';

const prog = (segments: TrainingProgram['segments']): TrainingProgram => ({
  id: 'test',
  name: 'test',
  target: 'test',
  segments,
});

describe('expandProgram', () => {
  it('expande Oleadas a 17 segmentos, 8 oleadas, 1260 s', () => {
    const exp = expandProgram(HIIT_30_30);
    expect(exp).toHaveLength(17);
    expect(exp.filter((s) => s.kind === 'surge')).toHaveLength(8);
    expect(totalDurationSec(exp)).toBe(1260);
  });

  it('acumula startSec/endSec correctamente', () => {
    const exp = expandProgram(HIIT_30_30);
    expect(exp[0]).toMatchObject({ kind: 'warmup', startSec: 0, endSec: 300 });
    expect(exp[1]).toMatchObject({ kind: 'surge', startSec: 300, endSec: 330 });
    expect(exp[2]).toMatchObject({ kind: 'recover', startSec: 330, endSec: 420 });
    expect(exp[3]).toMatchObject({ kind: 'surge', startSec: 420, endSec: 450 });
    expect(exp[16]).toMatchObject({ kind: 'recover', endSec: 1260 });
  });

  it('numera las oleadas 1..8 y conserva el sourceIndex original', () => {
    const exp = expandProgram(HIIT_30_30);
    const surges = exp.filter((s) => s.kind === 'surge');
    expect(surges.map((s) => s.waveNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(surges.every((s) => s.waveTotal === 8)).toBe(true);
    expect(surges.every((s) => s.sourceIndex === 1)).toBe(true);
  });

  it('rechaza times < 1, fromIndex fuera de rango y repeat anidado', () => {
    const seg = { kind: 'steady', durationSec: 60, zombieSpeedKph: 15 } as const;
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
      expandProgram(prog([{ kind: 'steady', durationSec: 0, zombieSpeedKph: 10 }])),
    ).toThrow(/durationSec/);
  });
});

describe('zombieSpeedAt', () => {
  const exp = expandProgram(HIIT_30_30);

  it('devuelve la velocidad del segmento fuera de la rampa', () => {
    expect(zombieSpeedAt(exp, 0, 2)).toBe(14);
    expect(zombieSpeedAt(exp, 299.9, 2)).toBe(14);
    expect(zombieSpeedAt(exp, 302, 2)).toBe(32);
    expect(zombieSpeedAt(exp, 329.9, 2)).toBe(32);
    expect(zombieSpeedAt(exp, 1259.9, 2)).toBe(12);
  });

  it('rampa lineal de 2 s al entrar a un segmento', () => {
    // Warmup 14 → oleada 32: a mitad de rampa, 23.
    expect(zombieSpeedAt(exp, 301, 2)).toBeCloseTo(23, 10);
    // Oleada 32 → recover 12: a mitad de rampa, 22.
    expect(zombieSpeedAt(exp, 331, 2)).toBeCloseTo(22, 10);
  });

  it('sin rampa en el primer segmento ni con rampSec 0', () => {
    expect(zombieSpeedAt(exp, 0.5, 2)).toBe(14);
    expect(zombieSpeedAt(exp, 300.5, 0)).toBe(32);
  });

  it('clampa más allá del final al último segmento', () => {
    expect(zombieSpeedAt(exp, 5000, 2)).toBe(12);
    expect(segmentIndexAt(exp, 5000)).toBe(16);
  });
});
