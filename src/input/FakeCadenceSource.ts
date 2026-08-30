import { FAKE } from '../config';
import type { CadenceListener, CadenceSample, CadenceSource } from './CadenceSource';

export interface FakeCadenceSourceOptions {
  intervalMs?: number;
  jitterRpm?: number;
  now?: () => number;
  random?: () => number;
}

/**
 * Sensor de cadencia simulado, manejado por el slider del panel dev.
 * Se comporta como el sensor CSC real: emite muestras con timestamp a
 * intervalos, y con las bielas paradas (rpm 0) NO emite nada — el silencio
 * es lo que ejercita la regla de staleness del bucle del juego a diario.
 */
export class FakeCadenceSource implements CadenceSource {
  private readonly listeners = new Set<CadenceListener>();
  private readonly intervalMs: number;
  private readonly jitterRpm: number;
  private readonly now: () => number;
  private readonly random: () => number;

  private rpm = 0;
  private emitting = true;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: FakeCadenceSourceOptions = {}) {
    this.intervalMs = opts.intervalMs ?? FAKE.sampleIntervalMs;
    this.jitterRpm = opts.jitterRpm ?? FAKE.jitterRpm;
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

  onSample(listener: CadenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setCadence(rpm: number): void {
    this.rpm = Math.max(0, rpm);
  }

  getCadence(): number {
    return this.rpm;
  }

  /** Apagar la emisión simula un dropout del sensor con las bielas girando. */
  setEmitting(on: boolean): void {
    this.emitting = on;
  }

  isEmitting(): boolean {
    return this.emitting;
  }

  private tick(): void {
    if (!this.emitting || this.rpm <= 0) return;
    const jitter = this.jitterRpm > 0 ? (this.random() * 2 - 1) * this.jitterRpm : 0;
    const sample: CadenceSample = {
      rpm: Math.max(0, this.rpm + jitter),
      timestampMs: this.now(),
    };
    for (const listener of this.listeners) listener(sample);
  }
}
