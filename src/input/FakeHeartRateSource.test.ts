import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHeartRateSource } from './FakeHeartRateSource';
import type { HeartRateSample } from './HeartRateSource';

describe('FakeHeartRateSource', () => {
  let clockMs = 0;
  const make = () =>
    new FakeHeartRateSource({ intervalMs: 1000, jitterBpm: 0, now: () => clockMs });

  const advance = (ms: number, step = 1000) => {
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

  it('emite una muestra por segundo con el pulso y timestamp actuales', () => {
    const source = make();
    const samples: HeartRateSample[] = [];
    source.onSample((s) => samples.push(s));
    source.start();
    source.setBpm(120);

    advance(3000);
    expect(samples.map((s) => s.bpm)).toEqual([120, 120, 120]);
    expect(samples.map((s) => s.timestampMs)).toEqual([1000, 2000, 3000]);

    source.setBpm(150);
    advance(1000);
    expect(samples[3]?.bpm).toBe(150);
    source.stop();
  });

  it('con bpm 0 (pulsera quitada) guarda silencio', () => {
    const source = make();
    const samples: HeartRateSample[] = [];
    source.onSample((s) => samples.push(s));
    source.start();

    advance(3000);
    expect(samples).toHaveLength(0);

    source.setBpm(80);
    advance(1000);
    expect(samples).toHaveLength(1);

    source.setBpm(0);
    advance(3000);
    expect(samples).toHaveLength(1);
    source.stop();
  });

  it('setEmitting(false) simula un dropout con la pulsera puesta', () => {
    const source = make();
    const samples: HeartRateSample[] = [];
    source.onSample((s) => samples.push(s));
    source.start();
    source.setBpm(100);

    advance(1000);
    expect(samples).toHaveLength(1);
    source.setEmitting(false);
    advance(5000);
    expect(samples).toHaveLength(1);
    source.setEmitting(true);
    advance(1000);
    expect(samples).toHaveLength(2);
    source.stop();
  });

  it('aplica jitter entero acotado y nunca baja de 1 bpm', () => {
    const source = new FakeHeartRateSource({
      intervalMs: 1000,
      jitterBpm: 2,
      now: () => clockMs,
      random: () => 0, // jitter mínimo: -2 bpm
    });
    const samples: HeartRateSample[] = [];
    source.onSample((s) => samples.push(s));
    source.start();
    source.setBpm(1);
    advance(1000);
    expect(samples[0]?.bpm).toBe(1);
    source.setBpm(100);
    advance(1000);
    expect(samples[1]?.bpm).toBe(98);
    source.stop();
  });
});
