import Phaser from 'phaser';
import { RENDER } from './config';
import { DevPanel } from './dev/DevPanel';
import { RideScene } from './game/scenes/RideScene';
import { StartScene } from './game/scenes/StartScene';
import { BandConnection } from './input/BandConnection';
import { FakeCadenceSource } from './input/FakeCadenceSource';
import { FakeHeartRateSource } from './input/FakeHeartRateSource';
import { createCadenceSource } from './input/createCadenceSource';
import { createHeartRateSource } from './input/createHeartRateSource';
import { toSimRider } from './sim/riderProfile';
import { loadRiderProfile } from './storage/riderStore';

const source = createCadenceSource('fake');
void source.start();

// El pulso arranca en la fuente falsa; la pulsera real se enchufa con un
// gesto del usuario (Web Bluetooth lo exige) y sustituye a esta en el registry.
const heartRate = createHeartRateSource('fake');
void heartRate.start();

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
  scene: [StartScene, RideScene],
});

game.registry.set('cadenceSource', source);
game.registry.set('heartRateSource', heartRate);
game.registry.set('band', new BandConnection(game.registry, heartRate));

// El perfil guardado en la tablet; 'riderProfile' es la vista numérica del sim.
const stored = loadRiderProfile();
game.registry.set('riderProfileStored', stored);
game.registry.set('riderProfile', toSimRider(stored));

if (
  (import.meta.env.DEV || location.search.includes('dev=1')) &&
  source instanceof FakeCadenceSource &&
  heartRate instanceof FakeHeartRateSource
) {
  new DevPanel(game, source, heartRate);
  // Referencia para depurar desde la consola del navegador.
  (window as unknown as { game?: Phaser.Game }).game = game;
}
