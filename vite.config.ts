import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  // Rutas relativas: el build estático funciona en cualquier subruta HTTPS.
  base: './',
  // `npm run dev:tablet` sirve por HTTPS con certificado autofirmado: Web
  // Bluetooth exige contexto seguro y desde la tablet localhost no vale.
  // En Chrome de la tablet hay que aceptar el aviso del certificado una vez.
  plugins: mode === 'https' ? [basicSsl()] : [],
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
