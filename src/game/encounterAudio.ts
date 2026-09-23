import { gameAudio } from './audio';

// Los sonidos de los encuentros, sintetizados como el resto de la noche: el
// ulular de la lechuza, el relé del semáforo, el graznido de los cuervos, el
// gruñido de los jabalíes, y dos ruidos continuos con nivel (el retumbo del
// tren, el chisporroteo de la hoguera) que suben y bajan con lo que se ve.
// Todo bajo: son texturas de un momento, no efectos de golpe.

export interface SoundHandle {
  /** 0 … 1: cuánto se oye ahora mismo. */
  setLevel(level: number): void;
  stop(): void;
}

const SILENT: SoundHandle = { setLevel: () => undefined, stop: () => undefined };

function noiseBuffer(ctx: AudioContext, seconds: number, shape: (i: number, n: number) => number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = shape(i, n);
  return buffer;
}

function brownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  let last = 0;
  return noiseBuffer(ctx, seconds, () => {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    return last * 3;
  });
}

function loopWithLevel(ctx: AudioContext, buffer: AudioBuffer, filter: BiquadFilterNode, maxGain: number): SoundHandle {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
  let stopped = false;
  return {
    setLevel: (level) => {
      if (stopped) return;
      const target = Math.max(0, Math.min(1, level)) * maxGain;
      gain.gain.setTargetAtTime(target, ctx.currentTime, 0.4);
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      source.stop(ctx.currentTime + 1.5);
    },
  };
}

class EncounterAudio {
  /** Lechuza: dos notas huecas, la segunda más baja y más larga. */
  hoot(): void {
    const ctx = gameAudio.context;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.05;
    for (const [at, freq, dur] of [
      [0, 390, 0.28],
      [0.42, 330, 0.5],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0 + at);
      osc.frequency.linearRampToValueAtTime(freq * 0.92, t0 + at + dur);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(0.09, t0 + at + 0.06);
      gain.gain.setTargetAtTime(0, t0 + at + dur - 0.12, 0.08);
      osc.connect(filter).connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.4);
    }
  }

  /** El relé del semáforo: un clic seco. */
  tick(): void {
    const ctx = gameAudio.context;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.02, (i, n) => (Math.random() * 2 - 1) * (1 - i / n));
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  /** Un cuervo: un graznido ronco, con vibración. */
  caw(): void {
    const ctx = gameAudio.context;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(640, t0);
    osc.frequency.exponentialRampToValueAtTime(380, t0 + 0.28);
    const tremolo = ctx.createOscillator();
    tremolo.frequency.value = 34;
    const tremoloGain = ctx.createGain();
    tremoloGain.gain.value = 0.5;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    tremolo.connect(tremoloGain).connect(am.gain);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1300;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.05, t0 + 0.03);
    gain.gain.setTargetAtTime(0, t0 + 0.2, 0.06);
    osc.connect(am).connect(filter).connect(gain).connect(ctx.destination);
    osc.start(t0);
    tremolo.start(t0);
    osc.stop(t0 + 0.5);
    tremolo.stop(t0 + 0.5);
  }

  /** Un jabalí: un gruñido corto y grave. */
  grunt(): void {
    const ctx = gameAudio.context;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.16, () => Math.random() * 2 - 1);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, t0);
    filter.frequency.exponentialRampToValueAtTime(160, t0 + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0, t0);
    gain.gain.linearRampToValueAtTime(0.12, t0 + 0.02);
    gain.gain.setTargetAtTime(0, t0 + 0.1, 0.03);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  }

  /** El timbre de otra bici: dos pings claros, el saludo de un ciclista de noche. */
  bell(): void {
    const ctx = gameAudio.context;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    for (const at of [0, 0.16]) {
      for (const [freq, g0] of [
        [2350, 0.05],
        [3520, 0.02],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t0 + at);
        gain.gain.linearRampToValueAtTime(g0, t0 + at + 0.004);
        gain.gain.setTargetAtTime(0, t0 + at + 0.01, 0.09);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + 0.7);
      }
    }
  }

  /** Un perro: dos ladridos cortos. */
  bark(): void {
    const ctx = gameAudio.context;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    for (const at of [0, 0.24]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(330, t0 + at);
      osc.frequency.exponentialRampToValueAtTime(170, t0 + at + 0.13);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer(ctx, 0.14, (i, n) => (Math.random() * 2 - 1) * (1 - i / n));
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(0.09, t0 + at + 0.015);
      gain.gain.setTargetAtTime(0, t0 + at + 0.08, 0.03);
      osc.connect(filter);
      noise.connect(filter);
      filter.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      noise.start(t0 + at);
      osc.stop(t0 + at + 0.3);
    }
  }

  /** Cascos al galope: golpes sordos en ritmo de tres, con nivel. */
  hooves(): SoundHandle {
    const ctx = gameAudio.context;
    if (!ctx) return SILENT;
    const hits = [0, 0.09, 0.2, 0.62, 0.71, 0.82, 1.24, 1.33, 1.44, 1.86, 1.95, 2.06];
    const rate = ctx.sampleRate;
    const buffer = noiseBuffer(ctx, 2.48, (i) => {
      const t = i / rate;
      let env = 0;
      for (const h of hits) if (t >= h && t < h + 0.12) env = Math.max(env, Math.exp(-(t - h) / 0.03));
      return (Math.random() * 2 - 1) * env;
    });
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    return loopWithLevel(ctx, buffer, filter, 0.22);
  }

  /** El tren en el horizonte: un retumbo grave continuo, con nivel. */
  rumble(): SoundHandle {
    const ctx = gameAudio.context;
    if (!ctx) return SILENT;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 110;
    return loopWithLevel(ctx, brownNoise(ctx, 3), filter, 0.16);
  }

  /** La hoguera: chasquidos secos sobre un rumor, con nivel. */
  crackle(): SoundHandle {
    const ctx = gameAudio.context;
    if (!ctx) return SILENT;
    let spike = 0;
    const buffer = noiseBuffer(ctx, 4, () => {
      if (Math.random() < 0.0006) spike = 1;
      spike *= 0.985;
      return (Math.random() * 2 - 1) * (0.06 + spike);
    });
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 0.7;
    return loopWithLevel(ctx, buffer, filter, 0.09);
  }
}

export const encounterAudio = new EncounterAudio();
