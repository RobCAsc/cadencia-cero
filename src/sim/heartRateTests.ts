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

export type StepStage = 'warm' | 'easy' | 'hard';

export interface StepProgress extends TestProgress {
  stage: StepStage;
  stageRemainingSec: number;
}

export interface StepResult {
  /** Media del final del escalón "hablas sin problema". */
  easyBpm: number;
  /** Media del final del escalón "no puedes hablar". */
  hardBpm: number;
}

/**
 * La escalera: entrar en calor (cuatro minutos, no cuenta), luego dos minutos
 * a un ritmo en el que hablas sin problema, luego dos en el que no puedes
 * hablar. De cada escalón útil se toma la media de su cola, cuando el pulso
 * ya alcanzó al esfuerzo. Dos anclas del habla, que es lo que la fisiología
 * sí sabe leer sin potenciómetro. El calor es largo a propósito: el escalón
 * fuerte no se pide en frío.
 */
export class StepTest {
  private readonly easyTail: SampleWindow;
  private readonly hardTail: SampleWindow;
  private startMs: number | undefined;
  private lastBpm = 0;

  constructor(
    private readonly stageSec = 120,
    easyTailSec = 60,
    hardTailSec = 45,
    private readonly warmSec = 240,
  ) {
    this.easyTail = new SampleWindow(easyTailSec * 1000);
    this.hardTail = new SampleWindow(hardTailSec * 1000);
  }

  get totalSec(): number {
    return this.warmSec + this.stageSec * 2;
  }

  stageAt(elapsedSec: number): StepStage {
    if (elapsedSec < this.warmSec) return 'warm';
    if (elapsedSec < this.warmSec + this.stageSec) return 'easy';
    return 'hard';
  }

  /** Cuándo termina cada escalón, en segundos desde el inicio. */
  private stageEndSec(stage: StepStage): number {
    if (stage === 'warm') return this.warmSec;
    if (stage === 'easy') return this.warmSec + this.stageSec;
    return this.totalSec;
  }

  push(sample: HeartRateSample): void {
    if (this.startMs === undefined) this.startMs = sample.timestampMs;
    this.lastBpm = sample.bpm;
    const stage = this.stageAt((sample.timestampMs - this.startMs) / 1000);
    if (stage === 'easy') this.easyTail.push(sample);
    else if (stage === 'hard' && sample.timestampMs - this.startMs < this.totalSec * 1000) {
      this.hardTail.push(sample);
    }
  }

  progress(nowMs: number): StepProgress {
    const elapsedSec = this.startMs === undefined ? 0 : (nowMs - this.startMs) / 1000;
    const stage = this.stageAt(elapsedSec);
    return {
      elapsedSec,
      remainingSec: Math.max(0, this.totalSec - elapsedSec),
      stage,
      stageRemainingSec: Math.max(0, this.stageEndSec(stage) - elapsedSec),
      liveBpm: this.lastBpm,
      done: elapsedSec >= this.totalSec,
    };
  }

  /** undefined si algún escalón útil no tiene su cola completa (pulsera muda). */
  result(): StepResult | undefined {
    if (!this.easyTail.isFull() || !this.hardTail.isFull()) return undefined;
    return { easyBpm: Math.round(this.easyTail.mean()), hardBpm: Math.round(this.hardTail.mean()) };
  }
}
