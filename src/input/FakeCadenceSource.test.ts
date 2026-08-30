import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadenceSample } from './CadenceSource';
import { FakeCadenceSource } from './FakeCadenceSource';

describe('FakeCadenceSource', () => {
  let clockMs = 0;
  const make = () =>
    new FakeCadenceSource({ intervalMs: 500, jitterRpm: 0, now: () => clockMs });

  const advance = (ms: number, step = 500) => {
    for (let t = 0; t < ms; t += step) {
      clockMs += step;
      vi.advanceTimersByTime(step);
    }
  };

  beforeEach(() => {
    clockMs = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emite una muestra por intervalo con la cadencia y timestamp actuales', () => {
    const source = make();
    const samples: CadenceSample[] = [];
    source.onSample((s) => samples.push(s));
    source.start();
    source.setCadence(80);

    advance(1500);
    expect(samples).toHaveLength(3);
    expect(samples.map((s) => s.rpm)).toEqual([80, 80, 80]);
    expect(samples.map((s) => s.timestampMs)).toEqual([500, 1000, 1500]);

    source.setCadence(95);
    advance(500);
    expect(samples[3]?.rpm).toBe(95);
    source.stop();
  });

  it('con las bielas paradas (rpm 0) guarda silencio, como un sensor CSC real', () => {
    const source = make();
    const samples: CadenceSample[] = [];
    source.onSample((s) => samples.push(s));
    source.start();

    advance(2000); // rpm 0 desde el inicio
    expect(samples).toHaveLength(0);

    source.setCadence(70);
    advance(500);
    expect(samples).toHaveLength(1);

    source.setCadence(0);
    advance(2000);
    expect(samples).toHaveLength(1);
    source.stop();
  });

  it('setEmitting(false) simula un dropout con las bielas girando', () => {
    const source = make();
    const samples: CadenceSample[] = [];
    source.onSample((s) => samples.push(s));
    source.start();
    source.setCadence(90);

    advance(500);
    expect(samples).toHaveLength(1);

    source.setEmitting(false);
    advance(3000);
    expect(samples).toHaveLength(1);

    source.setEmitting(true);
    advance(500);
    expect(samples).toHaveLength(2);
    source.stop();
  });

  it('stop() detiene el timer y la desuscripción funciona', () => {
    const source = make();
    const samples: CadenceSample[] = [];
    const unsubscribe = source.onSample((s) => samples.push(s));
    source.start();
    source.setCadence(60);

    advance(500);
    expect(samples).toHaveLength(1);

    unsubscribe();
    advance(500);
    expect(samples).toHaveLength(1);

    source.stop();
    advance(2000);
    expect(samples).toHaveLength(1);
  });

  it('aplica jitter acotado cuando esta configurado', () => {
    const source = new FakeCadenceSource({
      intervalMs: 500,
      jitterRpm: 2,
      now: () => clockMs,
      random: () => 1, // jitter máximo: +2 rpm
    });
    const samples: CadenceSample[] = [];
    source.onSample((s) => samples.push(s));
    source.start();
    source.setCadence(80);
    advance(500);
    expect(samples[0]?.rpm).toBe(82);
    source.stop();
  });
});
