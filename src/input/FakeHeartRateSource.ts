import { FAKE } from '../config';
import type { HeartRateListener, HeartRateSample, HeartRateSource } from './HeartRateSource';

export interface FakeHeartRateSourceOptions {
  intervalMs?: number;
  jitterBpm?: number;
  now?: () => number;
  random?: () => number;
}

/**
 * Pulsómetro simulado, manejado por el slider del panel dev.
 * Imita a una banda real: una muestra por segundo mientras hay lectura, y
 * con bpm 0 (pulsera quitada) guarda silencio, que es lo que ejercita la
 * regla de caducidad del bucle del juego.
 */
export class FakeHeartRateSource implements HeartRateSource {
  private readonly listeners = new Set<HeartRateListener>();
  private readonly intervalMs: number;
  private readonly jitterBpm: number;
  private readonly now: () => number;
  private readonly random: () => number;

  private bpm = 0;
  private emitting = true;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: FakeHeartRateSourceOptions = {}) {
    this.intervalMs = opts.intervalMs ?? FAKE.heartRateIntervalMs;
    this.jitterBpm = opts.jitterBpm ?? FAKE.jitterBpm;
    this.now = opts.now ?? (() => performance.now());
    this.random = opts.random ?? Math.random;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  onSample(listener: HeartRateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setBpm(bpm: number): void {
    this.bpm = Math.max(0, bpm);
  }

  getBpm(): number {
    return this.bpm;
  }

  /** Apagar la emisión simula un dropout con la pulsera puesta. */
  setEmitting(on: boolean): void {
    this.emitting = on;
  }

  isEmitting(): boolean {
    return this.emitting;
  }

  private tick(): void {
    if (!this.emitting || this.bpm <= 0) return;
    const jitter = this.jitterBpm > 0 ? Math.round((this.random() * 2 - 1) * this.jitterBpm) : 0;
    const sample: HeartRateSample = {
      bpm: Math.max(1, this.bpm + jitter),
      timestampMs: this.now(),
    };
    for (const listener of this.listeners) listener(sample);
  }
}
