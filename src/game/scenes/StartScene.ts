import Phaser from 'phaser';
import { RENDER } from '../../config';
import { HIIT_30_30 } from '../../sim/programs/hiit-30-30';
import { gameAudio } from '../audio';
import { FONT_SANS, UI } from '../theme';
import { acquireWakeLock } from '../wakeLock';

/**
 * Pantalla de inicio alrededor de un gesto explícito: fullscreen, wake lock y
 * AudioContext exigen un gesto del usuario, igual que lo exigirá
 * requestDevice() en Fase 1. El botón EMPEZAR es ese gesto.
 */
export class StartScene extends Phaser.Scene {
  constructor() {
    super('StartScene');
  }

  create(): void {
    const cx = RENDER.width / 2;

    this.add
      .text(cx, 180, 'CADENCIA CERO', {
        fontFamily: FONT_SANS,
        fontSize: '84px',
        fontStyle: 'bold',
        color: UI.textBright,
      })
      .setOrigin(0.5);
    this.add
      .text(cx, 268, 'Pedalea o te alcanzan', {
        fontFamily: FONT_SANS,
        fontSize: '28px',
        color: UI.textMuted,
      })
      .setOrigin(0.5);
    this.add
      .text(cx, 330, `Programa: ${HIIT_30_30.name} · Entrada: cadencia simulada`, {
        fontFamily: FONT_SANS,
        fontSize: '20px',
        color: UI.textDim,
      })
      .setOrigin(0.5);

    const button = this.add
      .rectangle(cx, 470, 320, 96, 0x1e8449)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(cx, 470, 'EMPEZAR', {
        fontFamily: FONT_SANS,
        fontSize: '40px',
        fontStyle: 'bold',
        color: UI.textBright,
      })
      .setOrigin(0.5);

    button.on('pointerover', () => button.setFillStyle(0x27ae60));
    button.on('pointerout', () => button.setFillStyle(0x1e8449));
    button.on('pointerdown', () => {
      // Todo lo que exige gesto de usuario, en el mismo gesto.
      try {
        if (!this.scale.isFullscreen) this.scale.startFullscreen();
      } catch {
        // El fullscreen puede fallar (p. ej. iframe); el juego sigue igual.
      }
      acquireWakeLock();
      gameAudio.unlock();
      this.scene.start('RideScene');
    });
  }
}
