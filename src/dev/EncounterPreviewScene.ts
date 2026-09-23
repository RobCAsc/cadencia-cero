import Phaser from 'phaser';
import { RENDER } from '../config';
import { Cyclist } from '../game/actors/Cyclist';
import { ambientAudio } from '../game/ambientAudio';
import { Atmosphere } from '../game/atmosphere';
import { gameAudio } from '../game/audio';
import { ensureVignette } from '../game/effects';
import { Encounters } from '../game/encounters';
import { FONT_MONO, FONT_SANS, UI } from '../game/theme';
import { ENCOUNTER_KINDS, type EncounterKind } from '../sim/encounters';

// Vista previa de los encuentros (?preview=encuentros): la carretera de
// noche con el ciclista pedaleando a ritmo fijo, y los dieciséis encuentros
// pasando uno tras otro con su nombre. Un toque pasa al siguiente. Es una
// herramienta para verlos sin esperar treinta salidas; no guarda nada.

const VISUAL_RPM_PER_KPH = 80 / 26;
/** Noche cerrada: estrellas, luna alta, farolas encendidas. */
const NIGHT_PROGRESS = 0.45;
const DEFAULT_KPH = 18;
/** Los caballos van a 20 km/h: a 15 te adelantan y se ve entero en medio minuto. */
const SPEED_KPH: Partial<Record<EncounterKind, number>> = { horses: 15 };
/** Si uno no termina solo (el perro con la zona aguantada), se pasa al siguiente. */
const MAX_SEC = 75;
const GAP_SEC = 2.5;
/** El perro: en zona, fuera de zona unos segundos (se queda atrás), y en zona otra vez (te alcanza). */
const DOG_OUT_OF_ZONE: readonly [number, number] = [17, 23];

const CAPTIONS: Readonly<Record<EncounterKind, readonly [string, string]>> = {
  deer: ['El ciervo', 'cruza en tres saltos, con los ojos en el haz del frontal'],
  boars: ['Los jabalíes', 'la madre y tres rayones; el último se despista y corre a alcanzarlos'],
  owl: ['La lechuza', 'en un poste; te sigue con los ojos y ulula'],
  cat: ['El gato', 'en una tapia; los ojos se encienden antes que el gato'],
  cyclist: ['Otro superviviente', 'viene de frente por el carril de allá y te saluda con el timbre'],
  car: ['El coche abandonado', 'con los intermitentes puestos, cada vez más lentos'],
  sign: ['La señal pintada', 'el km real al próximo refugio y una frase de alguien'],
  trafficLight: ['El semáforo en ámbar', 'en un cruce vacío, con el tic del relé'],
  fireflies: ['Las luciérnagas', 'un enjambre entre los matorrales; solo en tramos suaves'],
  campfire: ['La hoguera', 'tres supervivientes entre los árboles; uno levanta el brazo al verte'],
  crows: ['Los cuervos', 'se levantan de un árbol seco a tu paso, graznando'],
  train: ['El tren', 'con las ventanas encendidas, cruza el horizonte en un minuto'],
  bats: ['Los murciélagos', 'llegan y giran alrededor de la luna; solo de noche cerrada'],
  meteors: ['La lluvia de estrellas', 'veinte segundos de fugaces; solo de noche cerrada'],
  dog: ['El perro', 'espera en la cuneta; si pasas en zona corre a tu lado, si te sales se queda, si vuelves te alcanza'],
  horses: ['Los caballos', 'cinco al galope por el arcén a 20 km/h: en Z3 los adelantas, en Z1 te adelantan'],
};

export class EncounterPreviewScene extends Phaser.Scene {
  private atmosphere!: Atmosphere;
  private cyclist!: Cyclist;
  private encounters!: Encounters;
  private title!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private counter!: Phaser.GameObjects.Text;
  private state!: Phaser.GameObjects.Text;
  private index = -1;
  private distanceM = 0;
  private speedKph = DEFAULT_KPH;
  private targetKph = DEFAULT_KPH;
  private sinceSec = 0;
  private gapLeft = 1;

  constructor() {
    super('EncounterPreviewScene');
  }

  create(): void {
    this.atmosphere = new Atmosphere(this);
    this.atmosphere.setProgress(NIGHT_PROGRESS);
    this.encounters = new Encounters(this, this.atmosphere.encounterLayers);
    this.cyclist = new Cyclist(this);
    ensureVignette(this);
    this.add.image(0, 0, 'fx-vignette').setOrigin(0, 0).setDepth(5);

    const cx = RENDER.width / 2;
    // La banda del título va oscura de verdad: la luna queda justo debajo.
    this.add.rectangle(cx, 66, RENDER.width, 132, 0x05060c, 0.72).setDepth(9);
    this.title = this.add
      .text(cx, 38, '', { fontFamily: FONT_SANS, fontSize: '34px', fontStyle: 'bold', color: UI.textBright })
      .setOrigin(0.5)
      .setDepth(10);
    this.subtitle = this.add
      .text(cx, 80, '', { fontFamily: FONT_SANS, fontSize: '18px', color: UI.textBright, wordWrap: { width: 1100 }, align: 'center' })
      .setOrigin(0.5, 0)
      .setAlpha(0.85)
      .setDepth(10);
    this.counter = this.add
      .text(cx, RENDER.height - 26, 'Encuentros · toca para pasar al siguiente', { fontFamily: FONT_MONO, fontSize: '16px', color: UI.textDim })
      .setOrigin(0.5)
      .setDepth(10);
    this.state = this.add
      .text(RENDER.width - 24, RENDER.height - 26, '', { fontFamily: FONT_MONO, fontSize: '16px', color: UI.textDim })
      .setOrigin(1, 0.5)
      .setDepth(10);

    this.input.on('pointerdown', () => {
      gameAudio.unlock();
      ambientAudio.start();
      this.next();
    });
    this.input.keyboard?.on('keydown-SPACE', () => this.next());
    this.input.keyboard?.on('keydown-RIGHT', () => this.next());
  }

  private next(): void {
    this.index = (this.index + 1) % ENCOUNTER_KINDS.length;
    const kind = ENCOUNTER_KINDS[this.index]!;
    this.targetKph = SPEED_KPH[kind] ?? DEFAULT_KPH;
    this.encounters.start(kind, {
      distanceM: this.distanceM,
      speedMps: this.targetKph / 3.6,
      sign: { refuge: 'El monasterio', kmLeft: 72 },
    });
    this.sinceSec = 0;
    this.gapLeft = GAP_SEC;
    const [title, subtitle] = CAPTIONS[kind];
    this.title.setText(title);
    this.subtitle.setText(subtitle);
    this.counter.setText(`${this.index + 1} / ${ENCOUNTER_KINDS.length} · toca para pasar al siguiente`);
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    if (this.index < 0) {
      this.gapLeft -= dt;
      if (this.gapLeft <= 0) this.next();
    }
    this.speedKph += (this.targetKph - this.speedKph) * Math.min(1, dt * 0.8);
    const speedMps = this.speedKph / 3.6;
    this.distanceM += speedMps * dt;
    this.atmosphere.update(speedMps, dt);
    this.cyclist.update(dt, this.speedKph * VISUAL_RPM_PER_KPH, speedMps, 0.6, 0);

    const kind = ENCOUNTER_KINDS[this.index];
    const dogOut = kind === 'dog' && this.sinceSec > DOG_OUT_OF_ZONE[0] && this.sinceSec < DOG_OUT_OF_ZONE[1];
    this.encounters.update({ dt, distanceM: this.distanceM, speedMps, inZone: !dogOut, ...this.atmosphere.look });
    ambientAudio.update(1, 0);

    this.state.setText(`${Math.round(this.speedKph)} km/h · ${kind === 'dog' ? (dogOut ? 'fuera de zona' : 'en zona') : ''}`.replace(/ · $/, ''));
    if (this.index < 0) return;
    if (this.encounters.current === undefined) {
      this.gapLeft -= dt;
      if (this.gapLeft <= 0) this.next();
    } else {
      this.sinceSec += dt;
      if (this.sinceSec > MAX_SEC) this.next();
    }
  }
}
