import Phaser from 'phaser';
import { RENDER } from './config';
import { DevPanel } from './dev/DevPanel';
import { EncounterPreviewScene } from './dev/EncounterPreviewScene';
import { RideScene } from './game/scenes/RideScene';
import { StartScene } from './game/scenes/StartScene';
import { BandConnection } from './input/BandConnection';
import { FakeCadenceSource } from './input/FakeCadenceSource';
import { FakeHeartRateSource } from './input/FakeHeartRateSource';
import { createCadenceSource } from './input/createCadenceSource';
import { createHeartRateSource } from './input/createHeartRateSource';
import { toSimRider } from './sim/riderProfile';
import { loadRiderProfile } from './storage/riderStore';
import { loadSessions } from './storage/sessionStore';
import { campMusic } from './game/music';
import { sfx } from './game/sfx';
import { registerServiceWorker } from './pwa';
import { loadPlanState } from './storage/planStore';

registerServiceWorker();

/** Vista previa de los encuentros: la carretera de noche con los dieciséis pasando uno tras otro. */
const previewEncounters = location.search.includes('preview=encuentros');

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
  scene: previewEncounters ? [EncounterPreviewScene] : [StartScene, RideScene],
});

game.registry.set('cadenceSource', source);
game.registry.set('heartRateSource', heartRate);
game.registry.set('band', new BandConnection(game.registry, heartRate));

// El perfil guardado en la tablet; 'riderProfile' es la vista numérica del sim.
const stored = loadRiderProfile();
game.registry.set('riderProfileStored', stored);
game.registry.set('riderProfile', toSimRider(stored));

// Quien no puede fiarse del pulso (cribado) eligió el modo por sensación.
if (loadPlanState().inputMode === 'feel') game.registry.set('inputMode', 'feel');

// El historial de salidas llega de IndexedDB de forma asíncrona; hasta
// entonces el campamento arranca vacío y se refresca al llegar.
game.registry.set('sessionHistory', []);
void loadSessions().then((sessions) => game.registry.set('sessionHistory', sessions));

if (
  (import.meta.env.DEV || location.search.includes('dev=1')) &&
  source instanceof FakeCadenceSource &&
  heartRate instanceof FakeHeartRateSource
) {
  if (!previewEncounters) new DevPanel(game, source, heartRate);
  // Referencias para depurar desde la consola del navegador.
  (window as unknown as { game?: Phaser.Game; sfx?: typeof sfx }).game = game;
  (window as unknown as { sfx?: typeof sfx }).sfx = sfx;
  (window as unknown as { campMusic?: typeof campMusic }).campMusic = campMusic;
}
