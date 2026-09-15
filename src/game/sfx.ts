import biteUrl from '../../assets/sfx/zombie-eating.mp3';
import hordeUrl from '../../assets/sfx/zombie-horde.mp3';
import moansUrl from '../../assets/sfx/zombie-idle-moans.mp3';
import screamUrl from '../../assets/sfx/zombie-scream.mp3';
import growlUrl from '../../assets/sfx/zombie-voice-growl.mp3';

// Las voces de la horda son los únicos assets del juego: cinco clips cortos
// en assets/sfx (Vite los emite con hash y el service worker los precachea).
// Todo lo demás (viento, grillos, pájaros, drone, latido, trueno, el golpe
// del catch) sigue sintetizado en WebAudio.
//
// Los bytes se piden al cargar el módulo, sin gesto de usuario; decodificar
// necesita el AudioContext, que solo existe tras el toque de EMPEZAR, así
// que `load(ctx)` se llama al arrancar la salida. Si un clip no llega o no
// se puede decodificar, quien lo pida recibe undefined y usa su fallback.

export type SfxName = 'moans' | 'growl' | 'horde' | 'scream' | 'bite';

const URLS: Record<SfxName, string> = {
  moans: moansUrl,
  growl: growlUrl,
  horde: hordeUrl,
  scream: screamUrl,
  bite: biteUrl,
};

export interface PlayOptions {
  /** Ganancia lineal (los clips vienen normalizados cerca de 0 dBFS). */
  gain?: number;
  /** Velocidad de reproducción: <1 más grave y largo, >1 más agudo y corto. */
  rate?: number;
  /** Instante absoluto (`ctx.currentTime`) en el que debe empezar; por defecto ya. */
  startAtSec?: number;
  /** Fundidos, para clips cortados en seco. */
  fadeInSec?: number;
  fadeOutSec?: number;
}

class SfxBank {
  private readonly bytes = new Map<SfxName, Promise<ArrayBuffer | undefined>>();
  private readonly buffers = new Map<SfxName, AudioBuffer>();
  private decoding: Promise<void> | undefined;
  /** Clips lanzados desde que arrancó la app; solo para inspección en dev. */
  played = 0;

  constructor() {
    for (const [name, url] of Object.entries(URLS) as [SfxName, string][]) {
      this.bytes.set(
        name,
        fetch(url)
          .then((r) => (r.ok ? r.arrayBuffer() : undefined))
          .catch(() => undefined),
      );
    }
  }

  /** Cuántos de los clips están decodificados y listos. */
  get ready(): number {
    return this.buffers.size;
  }

  /** Decodifica los clips con el contexto dado; idempotente. */
  load(ctx: AudioContext): Promise<void> {
    this.decoding ??= Promise.all(
      [...this.bytes].map(async ([name, promise]) => {
        const data = await promise;
        if (!data) return;
        try {
          // decodeAudioData vacía el ArrayBuffer que recibe: se le da una copia
          // por si el contexto se recrea y hay que decodificar otra vez.
          this.buffers.set(name, await ctx.decodeAudioData(data.slice(0)));
        } catch {
          // Clip ilegible: quien lo pida usará el sonido sintetizado.
        }
      }),
    ).then(() => undefined);
    return this.decoding;
  }

  buffer(name: SfxName): AudioBuffer | undefined {
    return this.buffers.get(name);
  }

  /**
   * Lanza un clip por `out` con su envolvente. Devuelve la fuente, o
   * undefined si el clip no está disponible (todavía, o nunca).
   */
  play(
    ctx: AudioContext,
    name: SfxName,
    out: AudioNode,
    opts: PlayOptions = {},
  ): AudioBufferSourceNode | undefined {
    const buffer = this.buffers.get(name);
    if (!buffer) return undefined;
    const rate = opts.rate ?? 1;
    const gain = Math.max(0.0001, opts.gain ?? 1);
    const t0 = Math.max(ctx.currentTime, opts.startAtSec ?? ctx.currentTime);
    const dur = buffer.duration / rate;
    const fadeIn = Math.min(opts.fadeInSec ?? 0, dur / 2);
    const fadeOut = Math.min(opts.fadeOutSec ?? 0, dur / 2);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const env = ctx.createGain();
    if (fadeIn > 0) {
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(gain, t0 + fadeIn);
    } else {
      env.gain.setValueAtTime(gain, t0);
    }
    if (fadeOut > 0) {
      env.gain.setValueAtTime(gain, t0 + dur - fadeOut);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }
    src.connect(env).connect(out);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    this.played += 1;
    return src;
  }
}

export const sfx = new SfxBank();

/**
 * Un clip encadenado consigo mismo con solape: cada vuelta entra en fundido
 * mientras la anterior se apaga, así no hay clic ni hueco entre vueltas, y
 * una velocidad ligeramente distinta por vuelta disimula la repetición.
 */
export class CrossfadeLoop {
  private readonly out: GainNode;
  private nextAt = 0;
  private prevLevel = 0;
  private sources: AudioBufferSourceNode[] = [];

  constructor(
    private readonly ctx: AudioContext,
    private readonly name: SfxName,
    destination: AudioNode,
    private readonly overlapSec: number,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
  }

  /** Nivel objetivo 0..1; por debajo de 0.01 deja de encadenar vueltas. */
  update(level: number): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.out.gain.setTargetAtTime(Math.max(0, level), now, 0.4);
    if (level < 0.01) {
      this.prevLevel = level;
      return;
    }
    if (this.prevLevel < 0.01) this.nextAt = now; // vuelve a sonar: empieza ya
    this.prevLevel = level;

    const buffer = sfx.buffer(this.name);
    if (!buffer) return;
    // Programa con medio segundo de antelación; cada vuelta avanza el reloj
    // al menos varios segundos, así que el bucle siempre termina.
    while (this.nextAt < now + 0.5) {
      const rate = 0.94 + Math.random() * 0.12;
      const dur = buffer.duration / rate;
      const overlap = Math.min(this.overlapSec, dur / 3);
      const src = sfx.play(ctx, this.name, this.out, {
        rate,
        startAtSec: this.nextAt,
        fadeInSec: overlap,
        fadeOutSec: overlap,
      });
      if (src) {
        this.sources.push(src);
        src.onended = () => {
          this.sources = this.sources.filter((s) => s !== src);
        };
      }
      this.nextAt = Math.max(this.nextAt, now) + dur - overlap;
    }
  }

  stop(): void {
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    const sources = this.sources;
    this.sources = [];
    this.prevLevel = 0;
    setTimeout(() => {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          // ya parada
        }
      }
    }, 800);
  }
}
