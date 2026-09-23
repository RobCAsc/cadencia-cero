import songUrl from '../../assets/sfx/The_Long_Ride_Home.mp3';

// La música del campamento: "The Long Ride Home", el único tema del juego,
// puesto por el rider (2026-09-23). Suena en bucle mientras el tablón está
// en pantalla y se apaga con un fundido al salir a la carretera: la noche
// del ride sigue siendo viento, grillos y la horda. Va por un <audio> y no
// por el banco de clips: un tema de minutos decodificado a PCM son decenas
// de megas, y el elemento lo reproduce en streaming y lo repite él solo.
// Sin un gesto previo el navegador bloquea play(): se reintenta con el
// primer toque en el campamento.

const VOLUME = 0.35;
const FADE_IN_MS = 2500;
const FADE_OUT_MS = 900;
/** La pista empieza en este segundo (los primeros sobran), y cada vuelta vuelve a él. */
const START_SEC = 6;

class CampMusic {
  private el: HTMLAudioElement | undefined;
  private fade: ReturnType<typeof setInterval> | undefined;
  private wanted = false;

  private element(): HTMLAudioElement | undefined {
    if (this.el) return this.el;
    try {
      const el = new Audio(songUrl);
      el.preload = 'auto';
      el.volume = 0;
      // El bucle es propio, no del elemento: cada vuelta empieza en START_SEC, no en 0.
      el.loop = false;
      el.addEventListener('loadedmetadata', () => {
        if (el.currentTime < START_SEC) el.currentTime = START_SEC;
      });
      el.addEventListener('ended', () => {
        el.currentTime = START_SEC;
        if (this.wanted) void el.play().catch(() => undefined);
      });
      this.el = el;
    } catch {
      return undefined;
    }
    return this.el;
  }

  /** El campamento quiere música: arranca (o sigue donde estaba) con fundido. Idempotente. */
  play(): void {
    this.wanted = true;
    const el = this.element();
    if (!el || !el.paused) return;
    if (el.readyState >= 1 && el.currentTime < START_SEC) el.currentTime = START_SEC;
    el.play()
      .then(() => this.fadeTo(VOLUME, FADE_IN_MS))
      .catch(() => {
        // Bloqueada hasta un gesto del usuario: el campamento vuelve a llamar en el primer toque.
      });
  }

  /** Se apaga con un fundido y se para; al volver al campamento sigue donde estaba. */
  stop(): void {
    this.wanted = false;
    const el = this.el;
    if (!el || el.paused) return;
    this.fadeTo(0, FADE_OUT_MS, () => {
      if (!this.wanted) el.pause();
    });
  }

  get playing(): boolean {
    return this.el !== undefined && !this.el.paused;
  }

  private fadeTo(target: number, ms: number, done?: () => void): void {
    const el = this.el;
    if (!el) return;
    if (this.fade !== undefined) clearInterval(this.fade);
    const from = el.volume;
    const t0 = performance.now();
    this.fade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      el.volume = from + (target - from) * k;
      if (k >= 1) {
        if (this.fade !== undefined) clearInterval(this.fade);
        this.fade = undefined;
        done?.();
      }
    }, 50);
  }
}

export const campMusic = new CampMusic();
