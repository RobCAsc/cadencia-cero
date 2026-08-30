import Phaser from 'phaser';
import { RENDER } from './config';
import { DevPanel } from './dev/DevPanel';
import { RideScene } from './game/scenes/RideScene';
import { FakeCadenceSource } from './input/FakeCadenceSource';
import { createCadenceSource } from './input/createCadenceSource';

const source = createCadenceSource('fake');
void source.start();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: RENDER.width,
  height: RENDER.height,
  backgroundColor: '#1a1a2e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [RideScene],
});

game.registry.set('cadenceSource', source);

if (
  (import.meta.env.DEV || location.search.includes('dev=1')) &&
  source instanceof FakeCadenceSource
) {
  new DevPanel(game, source);
  // Referencia para depurar desde la consola del navegador.
  (window as unknown as { game?: Phaser.Game }).game = game;
}
