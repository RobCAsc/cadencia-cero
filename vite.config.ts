import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Rutas relativas: el build estático funciona en cualquier subruta HTTPS.
  base: './',
  test: {
    // Los módulos bajo test nunca importan Phaser ni DOM; corren en node puro.
    environment: 'node',
    include: [
      'src/sim/**/*.test.ts',
      'src/input/**/*.test.ts',
      'src/game/gapMapping.test.ts',
    ],
  },
});
