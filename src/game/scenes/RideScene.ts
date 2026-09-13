import Phaser from 'phaser';
import { RENDER, RIDER, type InputMode, type RiderProfile } from '../../config';
import type { CadenceSource } from '../../input/CadenceSource';
import type { HeartRateSource } from '../../input/HeartRateSource';
import type { TrainingProgram } from '../../sim/program';
import { HIIT_30_30 } from '../../sim/programs/hiit-30-30';
import { RideSim } from '../../sim/RideSim';
import type { RideSummary, SimEvent, SimState } from '../../sim/types';
import { Cyclist } from '../actors/Cyclist';
import { Horde } from '../actors/Horde';
import { gameAudio } from '../audio';
import { Effects, ensureVignette } from '../effects';
import { proximityAudio } from '../proximityAudio';
import { formatMMSS } from '../format';
import { CueBanner } from '../hud/CueBanner';
import { Hud } from '../hud/Hud';
import { ResistanceControl } from '../hud/ResistanceControl';
import { Atmosphere } from '../atmosphere';
import { FONT_MONO, FONT_SANS, UI } from '../theme';
import { releaseWakeLock } from '../wakeLock';

/**
 * En modo pulso no hay cadencia real que mover las bielas: se anima una
 * cadencia plausible a partir de la velocidad (ancla de la tabla: 26 km/h
 * a 80 rpm). Es puro decorado; el sim no lo sabe ni le importa.
 */
const VISUAL_RPM_PER_KPH = 80 / 26;

/**
 * La escena del ride. Posee un RideSim nuevo por sesión, lo avanza una vez por
 * frame y dibuja TODO como función del estado del sim: el render nunca guarda
 * verdad propia sobre el juego.
 */
export class RideScene extends Phaser.Scene {
  private sim!: RideSim;
  private atmosphere!: Atmosphere;
  private cyclist!: Cyclist;
  private horde!: Horde;
  private effects!: Effects;
  private hud!: Hud;
  private banner!: CueBanner;
  private resistanceCtl: ResistanceControl | undefined;
  private vignette!: Phaser.GameObjects.Rectangle;
  private finishedShown = false;

  constructor() {
    super('RideScene');
  }

  create(): void {
    const program =
      (this.registry.get('selectedProgram') as TrainingProgram | undefined) ?? HIIT_30_30;
    const inputMode = (this.registry.get('inputMode') as InputMode | undefined) ?? 'heartRate';
    const rider = (this.registry.get('riderProfile') as RiderProfile | undefined) ?? RIDER;
    this.sim = new RideSim(program, undefined, undefined, { inputMode, rider });

    this.atmosphere = new Atmosphere(this);

    this.cyclist = new Cyclist(this);
    this.horde = new Horde(this);
    this.effects = new Effects(this);
    ensureVignette(this);
    this.add.image(0, 0, 'fx-vignette').setOrigin(0, 0).setDepth(5);
    proximityAudio.start();

    this.hud = new Hud(this);
    this.banner = new CueBanner(this, (finalPip) => gameAudio.playPip(finalPip));
    // La resistencia declarada solo mueve al ciclista en modo cadencia; en
    // modo pulso el esfuerzo ya la absorbe y el control sobra.
    this.resistanceCtl =
      inputMode === 'cadence'
        ? new ResistanceControl(this, (delta) => this.adjustResistance(delta))
        : undefined;

    // Viñeta roja persistente cuando la salud llega a 0; el ride sigue igual.
    this.vignette = this.add
      .rectangle(RENDER.width / 2, RENDER.height / 2, RENDER.width, RENDER.height, 0xe74c3c)
      .setAlpha(0)
      .setDepth(20);
    this.finishedShown = false;

    // Las dos entradas se escuchan siempre; el sim decide cuál mueve al ciclista.
    const cadence = this.registry.get('cadenceSource') as CadenceSource;
    const heartRate = this.registry.get('heartRateSource') as HeartRateSource;
    const unsubscribeCadence = cadence.onSample((sample) => this.sim.pushCadence(sample));
    const unsubscribeHeartRate = heartRate.onSample((sample) => this.sim.pushHeartRate(sample));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribeCadence();
      unsubscribeHeartRate();
      proximityAudio.stop();
    });
  }

  update(_time: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    for (const event of this.sim.update(dt)) this.handleEvent(event, false);
    this.draw(this.sim.state, dt);
  }

  adjustResistance(delta: number): void {
    this.sim.setResistance(this.sim.state.resistanceLevel + delta);
  }

  /**
   * Herramienta dev: avanza al siguiente segmento por el camino real del sim
   * (muestras sintéticas + update), sin API especial. Si el rider "está parado",
   * los catches del salto se aplican de verdad.
   */
  fastForwardToNextSegment(): void {
    const start = this.sim.state.segment.index;
    let guard = 0;
    while (
      this.sim.state.phase === 'riding' &&
      this.sim.state.segment.index === start &&
      guard++ < 20000
    ) {
      const state = this.sim.state;
      const timestampMs = performance.now();
      this.sim.pushCadence({ rpm: state.cadenceRpm, timestampMs });
      if (!state.heartRateStale) this.sim.pushHeartRate({ bpm: state.heartRateBpm, timestampMs });
      for (const event of this.sim.update(0.1)) this.handleEvent(event, true);
    }
  }

  private handleEvent(event: SimEvent, fastForward: boolean): void {
    switch (event.type) {
      case 'caught':
        // Durante el salto dev el estado se aplica igual, sin el show.
        if (!fastForward) {
          this.cameras.main.shake(500, 0.01);
          this.cameras.main.flash(300, 192, 0, 0);
          gameAudio.playCatch();
          this.hud.pulseHealth();
          this.horde.lunge();
          this.effects.burstBlood();
        }
        break;
      case 'segmentChanged':
        if (event.segment.kind === 'surge') {
          this.banner.showNotice('¡¡OLEADA!!', 2500, UI.danger);
        } else if (event.segment.cueResistance !== undefined && this.resistanceCtl) {
          this.banner.showNotice(`Resistencia → ${event.segment.cueResistance}`, 4000, UI.info);
        }
        break;
      case 'staleHeartRate':
        if (!fastForward) this.banner.showNotice('Sin señal de la pulsera', 3000, UI.warn);
        break;
      case 'healthDepleted':
        this.vignette.setAlpha(0.16);
        break;
      case 'finished':
        proximityAudio.stop();
        this.showFinished(event.summary);
        break;
      default:
        break; // staleCadence y surgeWarning se leen del estado en la HUD/banner
    }
  }

  private showFinished(summary: RideSummary): void {
    if (this.finishedShown) return;
    this.finishedShown = true;
    releaseWakeLock(); // sesión terminada: la pantalla ya puede dormirse
    gameAudio.playFinish();

    const cx = RENDER.width / 2;
    // El dim se traga los clics para que la HUD de abajo quede inerte.
    this.add
      .rectangle(cx, RENDER.height / 2, RENDER.width, RENDER.height, 0x05050a, 0.78)
      .setDepth(30)
      .setInteractive();
    this.add
      .text(cx, 170, '¡SOBREVIVISTE!', {
        fontFamily: FONT_SANS,
        fontSize: '64px',
        fontStyle: 'bold',
        color: UI.good,
      })
      .setOrigin(0.5)
      .setDepth(31);
    const effortLine =
      this.sim.state.inputMode === 'heartRate'
        ? `Pulso medio:     ${Math.round(summary.avgHeartRateBpm)} bpm`
        : `Cadencia media:  ${Math.round(summary.avgCadenceRpm)} rpm`;
    this.add
      .text(
        cx,
        330,
        [
          `Distancia:       ${(summary.distanceM / 1000).toFixed(2)} km`,
          `Tiempo:          ${formatMMSS(summary.durationSec)}`,
          `Veces alcanzado: ${summary.timesCaught}`,
          effortLine,
        ].join('\n'),
        { fontFamily: FONT_MONO, fontSize: '30px', color: UI.textBright, lineSpacing: 14 },
      )
      .setOrigin(0.5)
      .setDepth(31);

    const button = this.add
      .rectangle(cx, 520, 260, 76, UI.button)
      .setDepth(31)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(cx, 520, 'Volver', { fontFamily: FONT_SANS, fontSize: '32px', color: UI.textBright })
      .setOrigin(0.5)
      .setDepth(32);
    button.on('pointerover', () => button.setFillStyle(UI.buttonHover));
    button.on('pointerout', () => button.setFillStyle(UI.button));
    button.on('pointerdown', () => this.scene.start('StartScene'));
  }

  private draw(state: SimState, dt: number): void {
    this.atmosphere.update(state.playerSpeedKph / 3.6, dt);

    const crankRpm =
      state.inputMode === 'heartRate' ? state.playerSpeedKph * VISUAL_RPM_PER_KPH : state.cadenceRpm;
    this.cyclist.update(dt, crankRpm, state.playerSpeedKph / 3.6);
    this.horde.update(dt, state.gapM, state.zombieSpeedKph / 3.6, state.caughtGraceSec > 0);
    this.effects.update(state.playerSpeedKph / 3.6);
    proximityAudio.update(state.gapM, dt);

    // La cámara se acerca un pelín cuando los tienes encima.
    const camera = this.cameras.main;
    const targetZoom = state.gapM < 20 ? 1 + ((20 - state.gapM) / 20) * 0.045 : 1;
    camera.setZoom(camera.zoom + (targetZoom - camera.zoom) * Math.min(1, dt * 3));

    this.hud.update(state);
    this.banner.update(state);
    this.resistanceCtl?.update(state.resistanceLevel);
  }
}
