import { registerSW } from 'virtual:pwa-register';

/**
 * Registra el service worker que precachea el build para que la app abra sin
 * red una vez instalada.
 *
 * Las actualizaciones no se aplican en caliente a propósito: si llega un
 * despliegue en mitad de una salida, el service worker nuevo se queda en
 * espera y entra la próxima vez que la app se abre desde cero. Recargar la
 * página con la horda detrás sería peor que ir una versión por detrás.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    onNeedRefresh() {
      console.info('[pwa] Hay una versión nueva; se aplicará al reabrir la app.');
    },
    onOfflineReady() {
      console.info('[pwa] Lista para abrir sin conexión.');
    },
  });
}
