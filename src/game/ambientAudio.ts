import { gameAudio } from './audio';

// El fondo sonoro de la noche, sintetizado: viento con ráfagas, grillos en
// la noche cerrada y pájaros cuando amanece. Todo muy bajo: es textura, no
// música. Cero assets.

const WIND_GAIN = 0.035;
const CRICKET_GAIN = 0.014;
const BIRD_GAIN = 0.05;

class AmbientAudio {
  private ctx: AudioContext | null = null;
  private running = false;
  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windLfo: OscillatorNode | null = null;
  private cricketGain: GainNode | null = null;
  private nextCricketAt = 0;
  private nextBirdAt = 0;
  private dawn = 0;

  start(): void {
    const ctx = gameAudio.context;
    if (!ctx || this.running) return;
    this.ctx = ctx;

    // Viento: ruido marrón en bucle, filtrado, con una ráfaga lenta en la ganancia.
    const len = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = WIND_GAIN;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = WIND_GAIN * 0.6;
    lfo.connect(lfoGain).connect(gain.gain);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    lfo.start();
    this.windSource = source;
    this.windGain = gain;
    this.windLfo = lfo;

    const cricketGain = ctx.createGain();
    cricketGain.gain.value = 0;
    cricketGain.connect(ctx.destination);
    this.cricketGain = cricketGain;

    this.nextCricketAt = ctx.currentTime + 1;
    this.nextBirdAt = 0;
    this.running = true;
  }

  /**
   * @param night01 1 en noche cerrada: grillos.
   * @param dawn01 1 con el sol fuera: pájaros y el viento amaina.
   */
  update(night01: number, dawn01: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.running || !this.cricketGain || !this.windGain) return;
    this.dawn = dawn01;
    this.cricketGain.gain.setTargetAtTime(CRICKET_GAIN * Math.max(0, night01), ctx.currentTime, 0.5);
    this.windGain.gain.setTargetAtTime(WIND_GAIN * (1 - dawn01 * 0.6), ctx.currentTime, 0.5);

    if (night01 > 0.2 && ctx.currentTime >= this.nextCricketAt) {
      this.chirp();
      this.nextCricketAt = ctx.currentTime + 0.6 + Math.random() * 1.6;
    }
    if (dawn01 > 0.25 && ctx.currentTime >= this.nextBirdAt) {
      this.bird(dawn01);
      this.nextBirdAt = ctx.currentTime + 1.2 + Math.random() * 3.5;
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const ctx = this.ctx;
    if (ctx && this.windGain) this.windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    if (ctx && this.cricketGain) this.cricketGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    const source = this.windSource;
    const lfo = this.windLfo;
    setTimeout(() => {
      source?.stop();
      lfo?.stop();
    }, 800);
    this.windSource = null;
    this.windLfo = null;
  }

  /** Un grillo: tono agudo troceado a ~28 Hz durante medio segundo. */
  private chirp(): void {
    const ctx = this.ctx;
    const out = this.cricketGain;
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const dur = 0.35 + Math.random() * 0.4;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 3900 + Math.random() * 900;
    const trem = ctx.createOscillator();
    trem.type = 'square';
    trem.frequency.value = 24 + Math.random() * 10;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.05);
    env.gain.setValueAtTime(1, t + dur - 0.08);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // Trémolo: el cuadrado (−1..1) escalado a 0..1 sobre la ganancia.
    const offset = ctx.createConstantSource();
    offset.offset.value = 0.5;
    const am = ctx.createGain();
    am.gain.value = 0;
    trem.connect(tremGain).connect(am.gain);
    offset.connect(am.gain);
    osc.connect(am).connect(env).connect(out);
    osc.start(t);
    trem.start(t);
    offset.start(t);
    osc.stop(t + dur + 0.05);
    trem.stop(t + dur + 0.05);
    offset.stop(t + dur + 0.05);
  }

  /** Un pájaro: dos o tres notas con barrido rápido hacia arriba. */
  private bird(level: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const notes = 2 + Math.floor(Math.random() * 2);
    const base = 2200 + Math.random() * 1200;
    for (let n = 0; n < notes; n++) {
      const t = ctx.currentTime + n * (0.16 + Math.random() * 0.08);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.3), t + 0.07);
      osc.frequency.exponentialRampToValueAtTime(base * 1.1, t + 0.12);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(BIRD_GAIN * level, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    }
  }
}

export const ambientAudio = new AmbientAudio();
