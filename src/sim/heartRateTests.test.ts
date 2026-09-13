import { describe, expect, it } from 'vitest';
import { PaceTest, RestTest, SampleWindow } from './heartRateTests';

/** Alimenta un test con una muestra por segundo según bpmAt(segundo). */
function feed(test: { push(s: { bpm: number; timestampMs: number }): void }, sec: number, bpmAt: (t: number) => number) {
  for (let t = 0; t <= sec; t++) test.push({ bpm: bpmAt(t), timestampMs: t * 1000 });
}

describe('SampleWindow', () => {
  it('promedia solo las muestras dentro de la ventana', () => {
    const w = new SampleWindow(3000);
    feed(w, 10, (t) => (t < 8 ? 100 : 200)); // ventana: t=7..10 (cutoff inclusivo)
    expect(w.isFull()).toBe(true);
    expect(w.count()).toBe(4);
    expect(w.mean()).toBeCloseTo(175);
  });

  it('no está llena hasta cubrir la ventana', () => {
    const w = new SampleWindow(15000);
    feed(w, 5, () => 60);
    expect(w.isFull()).toBe(false);
  });
});

describe('RestTest', () => {
  it('devuelve el mínimo de la media móvil, ignorando el pico inicial', () => {
    const test = new RestTest(60, 15);
    // Te sientas a 90, baja a 62 y luego repunta un poco.
    feed(test, 60, (t) => (t < 10 ? 90 : t < 45 ? 62 : 68));
    expect(test.progress(60_000).done).toBe(true);
    expect(test.result()).toBe(62);
  });

  it('sin una ventana completa no hay resultado', () => {
    const test = new RestTest(60, 15);
    feed(test, 5, () => 70);
    expect(test.result()).toBeUndefined();
    expect(test.progress(5000)).toMatchObject({ elapsedSec: 5, remainingSec: 55, liveBpm: 70, done: false });
  });
});

describe('PaceTest', () => {
  it('promedia los últimos 2 minutos, cuando el pulso ya se estabilizó', () => {
    const test = new PaceTest(300, 120);
    feed(test, 300, (t) => Math.min(145, 90 + t * 0.5)); // sube y se clava en 145 a los 110 s
    expect(test.progress(300_000).done).toBe(true);
    expect(test.result()).toBe(145);
  });

  it('sin cola suficiente no hay resultado', () => {
    const test = new PaceTest(300, 120);
    feed(test, 60, () => 130);
    expect(test.result()).toBeUndefined();
  });
});
