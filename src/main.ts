import Phaser from 'phaser';
import { RENDER } from './config';
import { RideScene } from './game/scenes/RideScene';
import { FakeCadenceSource } from './input/FakeCadenceSource';
import { createCadenceSource } from './input/createCadenceSource';

const source = createCadenceSource('fake');
void source.start();
// Paso 6: cadencia fija para ver la persecución; el panel dev la reemplaza en el paso 7.
if (source instanceof FakeCadenceSource) source.setCadence(70);

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
