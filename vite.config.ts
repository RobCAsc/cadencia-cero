import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  // Rutas relativas: el build estático funciona en cualquier subruta HTTPS.
  base: './',
  plugins: [
    // `npm run dev:tablet` sirve por HTTPS con certificado autofirmado: Web
    // Bluetooth exige contexto seguro y desde la tablet localhost no vale.
    // En Chrome de la tablet hay que aceptar el aviso del certificado una vez.
    ...(mode === 'https' ? [basicSsl()] : []),
    VitePWA({
      // 'prompt': el service worker nuevo espera a que la app se cierre del
      // todo. Con 'autoUpdate' la página se recargaría sola al desplegar, y
      // eso puede pasar en mitad de una salida.
      registerType: 'prompt',
      // El registro lo hace src/pwa.ts, no un script inyectado.
      injectRegister: false,
      manifest: {
        name: 'Cadencia Cero',
        short_name: 'Cadencia',
        description: 'Pedalea para que la horda no te alcance. Entrenamiento en bici estática guiado por el pulso.',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#0b0b12',
        theme_color: '#0b0b12',
        categories: ['health', 'fitness', 'games'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Todo el build va precacheado: la app abre sin red una vez instalada.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,mp3,ogg,json}'],
        // El bundle de Phaser pasa de 1 MB; el tope por defecto son 2 MiB.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  test: {
    // Los módulos bajo test nunca importan Phaser ni DOM; corren en node puro.
    environment: 'node',
    include: [
      'src/sim/**/*.test.ts',
      'src/input/**/*.test.ts',
      'src/game/gapMapping.test.ts',
    ],
  },
}));
