/**
 * Sintetizador WebAudio de placeholder: cero assets. El AudioContext se crea y
 * resume en el gesto del botón EMPEZAR (misma política de gesto que exigirá
 * requestDevice() en Fase 1).
 */
class GameAudio {
  private ctx: AudioContext | null = null;

  /** El contexto compartido (null hasta el primer unlock por gesto). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Golpe del catch: barrido grave + ráfaga de ruido. Fuerte y desagradable, a propósito. */
  playCatch(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.5, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.5);

    const noiseLen = Math.floor(ctx.sampleRate * 0.25);
    const buffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.3;
    noise.connect(noiseGain).connect(ctx.destination);
    noise.start(t);
  }

  /** Pip de la cuenta regresiva de oleada; el final es más agudo y largo. */
  playPip(finalPip: boolean): void {
    this.tone(finalPip ? 1320 : 880, finalPip ? 0.18 : 0.08, 'square', 0.18);
  }

  playFinish(): void {
    this.tone(523, 0.15, 'triangle', 0.25);
    this.tone(659, 0.15, 'triangle', 0.25, 0.16);
    this.tone(784, 0.3, 'triangle', 0.25, 0.32);
  }

  /** Trueno tras el relámpago: ruido marrón filtrado, dos segundos de retumbo. */
  playThunder(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.3; // la luz llega antes que el sonido
    const len = Math.floor(ctx.sampleRate * 2.2);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5 * (1 - i / len) ** 1.6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(90, t);
    filter.frequency.exponentialRampToValueAtTime(260, t + 0.15);
    filter.frequency.exponentialRampToValueAtTime(70, t + 2.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.7, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
  }

  private tone(
    freq: number,
    durationSec: number,
    type: OscillatorType,
    gainValue: number,
    delaySec = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durationSec);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + durationSec + 0.05);
  }
}

export const gameAudio = new GameAudio();
