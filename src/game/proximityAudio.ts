import { gameAudio } from './audio';

// La banda sonora de la persecución es tu propio pulso: un drone grave que
// crece cuando la horda se acerca, un latido que acelera bajo los 30 m, y
// gruñidos sueltos que llegan de la manada cuanto más cerca está.
// Sintetizado en WebAudio, cero assets.

const DRONE_MAX_GAIN = 0.055;
const DRONE_RANGE_M = 60;
const HEARTBEAT_RANGE_M = 30;
const GROAN_RANGE_M = 70;

class ProximityAudio {
  private ctx: AudioContext | null = null;
  private droneGain: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private nextBeatAt = 0;
  private nextGroanAt = 0;
  private running = false;

  start(): void {
    const ctx = gameAudio.context;
    if (!ctx || this.running) return;
    this.ctx = ctx;

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

    this.droneGain = gain;
    this.nextBeatAt = 0;
    this.nextGroanAt = ctx.currentTime + 3;
    this.running = true;
  }

  update(gapM: number, dt: number): void {
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

    // Gruñidos: más seguidos y más presentes cuanto más cerca.
    const near = 1 - Math.min(1, Math.max(0, gapM) / GROAN_RANGE_M);
    if (near > 0.05 && ctx.currentTime >= this.nextGroanAt) {
      this.groan(0.08 + near * 0.3, near);
      this.nextGroanAt = ctx.currentTime + 1.5 + (1 - near) * 5 + Math.random() * 2;
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const ctx = this.ctx;
    if (ctx && this.droneGain) {
      this.droneGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    }
    const oscs = this.oscillators;
    this.oscillators = [];
    setTimeout(() => oscs.forEach((o) => o.stop()), 600);
    this.droneGain = null;
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

  /** Un gruñido: diente de sierra grave con vibrato, filtrado y con ataque lento. */
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
