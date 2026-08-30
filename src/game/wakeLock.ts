// Mantiene la pantalla despierta durante la sesión. Sin esto la tablet se
// duerme a mitad del workout. Se re-adquiere en visibilitychange (contrato).

let sentinel: WakeLockSentinel | null = null;
let wanted = false;
let listenerInstalled = false;

async function request(): Promise<void> {
  if (!('wakeLock' in navigator)) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // P. ej. pestaña oculta o política del navegador; se reintenta al volver.
    sentinel = null;
  }
}

export function acquireWakeLock(): void {
  wanted = true;
  if (!listenerInstalled) {
    listenerInstalled = true;
    document.addEventListener('visibilitychange', () => {
      if (wanted && document.visibilityState === 'visible' && sentinel === null) {
        void request();
      }
    });
  }
  void request();
}

export function releaseWakeLock(): void {
  wanted = false;
  void sentinel?.release();
  sentinel = null;
}
