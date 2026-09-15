import { gameAudio } from './audio';
import { CrossfadeLoop, sfx } from './sfx';

// La banda sonora de la persecución. Lo tuyo va sintetizado: un drone grave
// que crece cuando la horda se acerca y un latido que acelera bajo los 30 m.
// La horda habla con los clips de assets/sfx: gemidos sueltos cuanto más
// cerca está, gruñidos con voz cuando ya la tienes encima, la manada
// corriendo cuando corre, un alarido cuando carga y un mordisco al alcanzarte.
// Todo lo de la horda pasa por un bus propio, un pelín a la izquierda: viene
// por detrás. Sin clips (aún no decodificados, o sin red la primera vez),
// queda el gruñido sintetizado.

const DRONE_MAX_GAIN = 0.055;
const DRONE_RANGE_M = 60;
const HEARTBEAT_RANGE_M = 30;
const GROAN_RANGE_M = 70;

/** Ganancia del bus de la horda: los clips vienen normalizados cerca de 0 dBFS. */
const HORDE_BUS_GAIN = 0.55;
/** Paneo del bus (−1 izquierda): lejos viene claramente por detrás, encima casi centrado. */
const PAN_FAR = -0.5;
const PAN_NEAR = -0.1;
/** Ganancias [lejos, encima] de cada voz, sobre el bus. */
const MOAN_GAIN: readonly [number, number] = [0.12, 0.4];
const GROWL_GAIN: readonly [number, number] = [0.25, 0.7];
/** Los gruñidos con voz solo a partir de esta cercanía (0..1). */
const GROWL_FROM_NEAR = 0.45;
/** La manada corriendo: por la carrera de la horda, y más cuanto más cerca. */
const RUN_LOOP_GAIN = 0.7;
const RUN_LOOP_OVERLAP_SEC = 1.5;
const SCREAM_CHARGE_GAIN = 0.4;
const SCREAM_CATCH_GAIN = 0.8;
const BITE_GAIN = 0.75;

const lerp = (range: readonly [number, number], k: number): number =>
  range[0] + (range[1] - range[0]) * k;

class ProximityAudio {
  private ctx: AudioContext | null = null;
  private droneGain: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private hordeBus: GainNode | null = null;
  private hordePan: StereoPannerNode | null = null;
  private runLoop: CrossfadeLoop | null = null;
  private nextBeatAt = 0;
  private nextGroanAt = 0;
  private running = false;

  start(): void {
    const ctx = gameAudio.context;
    if (!ctx || this.running) return;
    this.ctx = ctx;
    void sfx.load(ctx);

    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 170;
    filter.connect(gain).connect(ctx.destination);

    this.oscillators = [55, 55.7, 110.3].map((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.connect(filter);
      osc.start();
      return osc;
    });

    const bus = ctx.createGain();
    bus.gain.value = HORDE_BUS_GAIN;
    const pan = ctx.createStereoPanner();
    pan.pan.value = PAN_FAR;
    bus.connect(pan).connect(ctx.destination);
    this.hordeBus = bus;
    this.hordePan = pan;
    this.runLoop = new CrossfadeLoop(ctx, 'horde', bus, RUN_LOOP_OVERLAP_SEC);

    this.droneGain = gain;
    this.nextBeatAt = 0;
    this.nextGroanAt = ctx.currentTime + 3;
    this.running = true;
  }

  /**
   * @param gapM metros de ventaja.
   * @param run01 0 horda arrastrándose … 1 a la carrera (de `Horde.run01`).
   */
  update(gapM: number, run01: number, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.running || !this.droneGain) return;

    const closeness = 1 - Math.min(1, Math.max(0, gapM - 4) / DRONE_RANGE_M);
    const target = DRONE_MAX_GAIN * closeness * closeness;
    const current = this.droneGain.gain.value;
    this.droneGain.gain.value = current + (target - current) * Math.min(1, dt * 3);

    if (gapM < HEARTBEAT_RANGE_M) {
      const urgency = 1 - gapM / HEARTBEAT_RANGE_M;
      const bpm = 52 + urgency * 68;
      if (ctx.currentTime >= this.nextBeatAt) {
        this.thump(0, 0.5 + urgency * 0.35);
        this.thump(0.15, 0.3 + urgency * 0.2);
        this.nextBeatAt = Math.max(ctx.currentTime, this.nextBeatAt) + 60 / bpm;
      }
    } else {
      this.nextBeatAt = 0; // late el próximo tick en cuanto entre en rango
    }

    const near = 1 - Math.min(1, Math.max(0, gapM) / GROAN_RANGE_M);
    this.hordePan?.pan.setTargetAtTime(PAN_FAR + (PAN_NEAR - PAN_FAR) * near, ctx.currentTime, 0.5);

    // Gemidos y gruñidos: más seguidos y más presentes cuanto más cerca.
    if (near > 0.05 && ctx.currentTime >= this.nextGroanAt) {
      this.voice(near);
      this.nextGroanAt = ctx.currentTime + 1.5 + (1 - near) * 5 + Math.random() * 2;
    }

    // La manada corriendo: se oye en cuanto la horda corre, aunque esté lejos
    // (es el aviso de que viene), y crece al acercarse.
    this.runLoop?.update(RUN_LOOP_GAIN * run01 * (0.35 + 0.65 * near));
  }

  /** La horda carga al empezar una oleada: un alarido, grave y lejano. */
  charge(): void {
    const ctx = this.ctx;
    const bus = this.hordeBus;
    if (!ctx || !this.running || !bus) return;
    sfx.play(ctx, 'scream', bus, {
      gain: SCREAM_CHARGE_GAIN,
      rate: 0.85 + Math.random() * 0.1,
      fadeInSec: 0.05,
      fadeOutSec: 0.2,
    });
  }

  /** Te alcanzan: alarido encima y el mordisco justo detrás. */
  bite(): void {
    const ctx = this.ctx;
    const bus = this.hordeBus;
    if (!ctx || !this.running || !bus) return;
    sfx.play(ctx, 'scream', bus, { gain: SCREAM_CATCH_GAIN, fadeInSec: 0.02, fadeOutSec: 0.12 });
    sfx.play(ctx, 'bite', bus, {
      gain: BITE_GAIN,
      startAtSec: ctx.currentTime + 0.25,
      fadeOutSec: 0.08, // el clip acaba cortado en seco
    });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const ctx = this.ctx;
    if (ctx && this.droneGain) {
      this.droneGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    }
    if (ctx && this.hordeBus) {
      this.hordeBus.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    }
    this.runLoop?.stop();
    this.runLoop = null;
    const oscs = this.oscillators;
    this.oscillators = [];
    setTimeout(() => oscs.forEach((o) => o.stop()), 600);
    this.droneGain = null;
    this.hordeBus = null;
    this.hordePan = null;
  }

  /** Una voz de la horda: gemido lejano o gruñido con voz según la cercanía. */
  private voice(near: number): void {
    const ctx = this.ctx;
    const bus = this.hordeBus;
    if (!ctx || !bus) return;
    const voiced = near > GROWL_FROM_NEAR && Math.random() < near;
    const played = voiced
      ? sfx.play(ctx, 'growl', bus, { gain: lerp(GROWL_GAIN, near), rate: 0.9 + Math.random() * 0.2 })
      : sfx.play(ctx, 'moans', bus, { gain: lerp(MOAN_GAIN, near), rate: 0.92 + Math.random() * 0.16 });
    if (!played) this.groan(0.08 + near * 0.3, near);
  }

  private thump(delaySec: number, volume: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(58, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume * 0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** Fallback sin clips: diente de sierra grave con vibrato, filtrado y con ataque lento. */
  private groan(volume: number, near: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = 0.5 + Math.random() * 0.6;
    const base = 70 + Math.random() * 50;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * (0.8 + Math.random() * 0.3), t + dur);

    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5 + Math.random() * 4;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = 6;
    vibrato.connect(vibratoGain).connect(osc.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220 + near * 500, t);
    filter.frequency.exponentialRampToValueAtTime(140, t + dur);
    filter.Q.value = 3;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + dur * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start(t);
    vibrato.start(t);
    osc.stop(t + dur + 0.05);
    vibrato.stop(t + dur + 0.05);
  }
}

export const proximityAudio = new ProximityAudio();
