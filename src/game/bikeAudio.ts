import { gameAudio } from './audio';
import { CrossfadeLoop, sfx } from './sfx';

// Tu propia bici. El pedaleo son trozos de cycling.mp3 encadenados con
// solape, con volumen y tono según la velocidad (parado, silencio); y al
// entrar en cada tramo del programa suena un cambio de marcha: dos ventanas
// cortas del clip de cadena, al azar. Va centrado: es lo que llevas debajo.

/** Ganancia del pedaleo a tope (el clip ronda los −24 dB de media). */
const CYCLING_GAIN = 0.5;
/** Velocidad a la que el pedaleo suena a tope; por debajo crece con curva suave. */
const CYCLING_FULL_KPH = 25;
/** Tono del pedaleo [parado … a tope]. */
const CYCLING_RATE: readonly [number, number] = [0.85, 1.12];
/** Trozos de 6 s de los primeros 12 s del clip (después decae y muere). */
const CYCLING_CHUNK_SEC = 6;
const CYCLING_OFFSET_RANGE: readonly [number, number] = [0.5, 12];
const CYCLING_OVERLAP_SEC = 2;
/** Cambio de marcha: [desde, duración] en segundos del clip; se elige una al azar. */
const SHIFT_WINDOWS: ReadonlyArray<readonly [number, number]> = [
  [1.9, 1.5],
  [5.6, 1.3],
];
const SHIFT_GAIN = 1;

class BikeAudio {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private pedal: CrossfadeLoop | null = null;
  private running = false;

  start(): void {
    const ctx = gameAudio.context;
    if (!ctx || this.running) return;
    this.ctx = ctx;
    void sfx.load(ctx);
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(ctx.destination);
    this.bus = bus;
    this.pedal = new CrossfadeLoop(ctx, 'cycling', bus, {
      overlapSec: CYCLING_OVERLAP_SEC,
      chunkSec: CYCLING_CHUNK_SEC,
      offsetRangeSec: CYCLING_OFFSET_RANGE,
    });
    this.running = true;
  }

  /** @param speedKph velocidad del ciclista; a 0 el pedaleo calla. */
  update(speedKph: number): void {
    if (!this.running || !this.pedal) return;
    const k = Math.max(0, Math.min(1, speedKph / CYCLING_FULL_KPH));
    const level = CYCLING_GAIN * Math.pow(k, 0.7);
    const rate = CYCLING_RATE[0] + (CYCLING_RATE[1] - CYCLING_RATE[0]) * k;
    this.pedal.update(level, rate);
  }

  /** Cambio de marcha: al entrar en un tramo nuevo del programa. */
  shift(): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !this.running || !bus) return;
    const window = SHIFT_WINDOWS[Math.floor(Math.random() * SHIFT_WINDOWS.length)];
    if (!window) return;
    sfx.play(ctx, 'shift', bus, {
      gain: SHIFT_GAIN,
      rate: 0.95 + Math.random() * 0.1,
      offsetSec: window[0],
      durationSec: window[1],
      fadeInSec: 0.05,
      fadeOutSec: 0.15,
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const ctx = this.ctx;
    if (ctx && this.bus) this.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    this.pedal?.stop();
    this.pedal = null;
    this.bus = null;
  }
}

export const bikeAudio = new BikeAudio();
