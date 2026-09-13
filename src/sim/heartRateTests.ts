import type { HeartRateSample } from './types';

/** Media de las muestras que caen dentro de una ventana temporal deslizante. */
export class SampleWindow {
  private readonly samples: HeartRateSample[] = [];

  constructor(private readonly windowMs: number) {}

  push(sample: HeartRateSample): void {
    this.samples.push(sample);
    const cutoff = sample.timestampMs - this.windowMs;
    while (this.samples.length > 0 && (this.samples[0]?.timestampMs ?? 0) < cutoff) {
      this.samples.shift();
    }
  }

  /** true cuando las muestras cubren la ventana completa. */
  isFull(): boolean {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last) return false;
    return last.timestampMs - first.timestampMs >= this.windowMs * 0.9;
  }

  mean(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((acc, s) => acc + s.bpm, 0) / this.samples.length;
  }

  count(): number {
    return this.samples.length;
  }
}

export interface TestProgress {
  elapsedSec: number;
  remainingSec: number;
  /** Lectura en vivo para la UI. */
  liveBpm: number;
  done: boolean;
}

/**
 * Prueba de reposo: quieto sobre la bici durante durationSec. El resultado es
 * el mínimo de la media móvil de windowSec, que ignora el pico de sentarse y
 * el jitter del sensor.
 */
export class RestTest {
  private readonly window: SampleWindow;
  private startMs: number | undefined;
  private minMean = Number.POSITIVE_INFINITY;
  private lastBpm = 0;

  constructor(
    private readonly durationSec = 60,
    windowSec = 15,
  ) {
    this.window = new SampleWindow(windowSec * 1000);
  }

  push(sample: HeartRateSample): void {
    if (this.startMs === undefined) this.startMs = sample.timestampMs;
    this.lastBpm = sample.bpm;
    this.window.push(sample);
    if (this.window.isFull()) this.minMean = Math.min(this.minMean, this.window.mean());
  }

  progress(nowMs: number): TestProgress {
    const elapsedSec = this.startMs === undefined ? 0 : (nowMs - this.startMs) / 1000;
    return {
      elapsedSec,
      remainingSec: Math.max(0, this.durationSec - elapsedSec),
      liveBpm: this.lastBpm,
      done: elapsedSec >= this.durationSec,
    };
  }

  /** undefined si no llegó a llenarse ni una ventana (pulsera muda). */
  result(): number | undefined {
    return Number.isFinite(this.minMean) ? Math.round(this.minMean) : undefined;
  }
}

/**
 * Prueba de ritmo cómodo: pedaleas durationSec a un ritmo que aguantarías
 * media hora hablando. El resultado es la media de los últimos tailSec, cuando
 * el pulso ya se estabilizó.
 */
export class PaceTest {
  private readonly tail: SampleWindow;
  private startMs: number | undefined;
  private lastBpm = 0;

  constructor(
    private readonly durationSec = 300,
    tailSec = 120,
  ) {
    this.tail = new SampleWindow(tailSec * 1000);
  }

  push(sample: HeartRateSample): void {
    if (this.startMs === undefined) this.startMs = sample.timestampMs;
    this.lastBpm = sample.bpm;
    this.tail.push(sample);
  }

  progress(nowMs: number): TestProgress {
    const elapsedSec = this.startMs === undefined ? 0 : (nowMs - this.startMs) / 1000;
    return {
      elapsedSec,
      remainingSec: Math.max(0, this.durationSec - elapsedSec),
      liveBpm: this.lastBpm,
      done: elapsedSec >= this.durationSec,
    };
  }

  /** undefined si el tramo final no tiene muestras suficientes. */
  result(): number | undefined {
    return this.tail.isFull() ? Math.round(this.tail.mean()) : undefined;
  }
}
