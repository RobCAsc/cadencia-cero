import Phaser from 'phaser';
import { RENDER, RIDER, type InputMode, type RiderProfile } from '../../config';
import type { CadenceSource } from '../../input/CadenceSource';
import type { HeartRateSource } from '../../input/HeartRateSource';
import { toSessionRecord, type SessionRecord } from '../../sim/history';
import { expandProgram, totalDurationSec, type TrainingProgram } from '../../sim/program';
import { applyAdjustments, PROGRAM_CATALOG } from '../../sim/programs/catalog';
import { OLEADAS } from '../../sim/programs/oleadas';
import { RideSim } from '../../sim/RideSim';
import { preRideRestReadings } from '../../sim/progress';
import {
  applyAdvice,
  calibrationAdvice,
  toSimRider,
  withObservedPeak,
  withRitualRest,
  type StoredRiderProfile,
} from '../../sim/riderProfile';
import type { RideSummary, SimEvent, SimState } from '../../sim/types';
import { saveRiderProfile } from '../../storage/riderStore';
import { saveSession } from '../../storage/sessionStore';
import { Cyclist } from '../actors/Cyclist';
import { Horde } from '../actors/Horde';
import { ambientAudio } from '../ambientAudio';
import { gameAudio } from '../audio';
import { bikeAudio } from '../bikeAudio';
import { Effects, ensureVignette } from '../effects';
import { proximityAudio } from '../proximityAudio';
import { CueBanner } from '../hud/CueBanner';
import { Hud } from '../hud/Hud';
import { ResistanceControl } from '../hud/ResistanceControl';
import { Atmosphere } from '../atmosphere';
import { CalmPanel } from '../ride/CalmPanel';
import { FinishPanel } from '../ride/FinishPanel';
import { UI } from '../theme';
import { releaseWakeLock } from '../wakeLock';

/**
 * En modo pulso no hay cadencia real que mover las bielas: se anima una
 * cadencia plausible a partir de la velocidad (ancla de la tabla: 26 km/h
 * a 80 rpm). Es puro decorado; el sim no lo sabe ni le importa.
 */
const VISUAL_RPM_PER_KPH = 80 / 26;

const sign = (pct: number): string => `${pct > 0 ? '+' : ''}${pct} %`;

/** Datos con los que se puede (re)arrancar la escena. */
interface RideSceneData {
  /** Sin el minuto de calma (ya se hizo antes de cambiar de programa). */
  skipCalm?: boolean;
  preRideRestBpm?: number;
}

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
  private program!: TrainingProgram;
  private startedAtMs = 0;
  private calm: CalmPanel | undefined;
  private preRideRestBpm: number | undefined;

  constructor() {
    super('RideScene');
  }

  create(data?: RideSceneData): void {
    const program =
      (this.registry.get('selectedProgram') as TrainingProgram | undefined) ?? OLEADAS;
    const inputMode = (this.registry.get('inputMode') as InputMode | undefined) ?? 'heartRate';
    const rider = (this.registry.get('riderProfile') as RiderProfile | undefined) ?? RIDER;
    this.sim = new RideSim(program, undefined, undefined, { inputMode, rider });
    this.program = program;
    this.startedAtMs = Date.now();
    this.preRideRestBpm = data?.preRideRestBpm;
    this.calm = undefined;

    this.atmosphere = new Atmosphere(this);

    this.cyclist = new Cyclist(this);
    this.horde = new Horde(this);
    this.effects = new Effects(this);
    ensureVignette(this);
    this.add.image(0, 0, 'fx-vignette').setOrigin(0, 0).setDepth(5);
    proximityAudio.start();
    ambientAudio.start();
    bikeAudio.start();

    this.hud = new Hud(this, { segments: expandProgram(program), onQuit: () => this.quitRide() });
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
    // Entrada en fundido: la noche aparece, no se enciende.
    this.cameras.main.fadeIn(900, 5, 6, 14);

    // Las dos entradas se escuchan siempre; el sim decide cuál mueve al ciclista.
    const cadence = this.registry.get('cadenceSource') as CadenceSource;
    const heartRate = this.registry.get('heartRateSource') as HeartRateSource;
    const unsubscribeCadence = cadence.onSample((sample) => this.sim.pushCadence(sample));
    const unsubscribeHeartRate = heartRate.onSample((sample) => this.sim.pushHeartRate(sample));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribeCadence();
      unsubscribeHeartRate();
      this.calm?.destroy();
      proximityAudio.stop();
      ambientAudio.stop();
      bikeAudio.stop();
    });

    // El ritual: un minuto de calma antes de salir. Solo en modo pulso, y
    // solo una vez (al cambiar a suave la escena se reinicia sin él).
    if (inputMode === 'heartRate' && !data?.skipCalm) {
      this.calm = new CalmPanel(this, {
        source: heartRate,
        history: (this.registry.get('sessionHistory') as SessionRecord[] | undefined) ?? [],
        onStart: (restBpm) => this.beginRide(restBpm),
        onEasier: (restBpm) => this.switchToEasier(restBpm),
      });
    }
  }

  update(_time: number, deltaMs: number): void {
    const dt = deltaMs / 1000;
    if (this.calm) {
      // Durante el minuto de calma el sim no corre: la horda espera lejos.
      this.calm.update();
      this.draw(this.sim.state, dt);
      return;
    }
    // Tras terminar (o cortar) la salida el sim ya no avanza; el mundo sigue
    // respirando bajo el resumen.
    if (!this.finishedShown) for (const event of this.sim.update(dt)) this.handleEvent(event, false);
    this.draw(this.sim.state, dt);
  }

  private beginRide(restBpm: number | undefined): void {
    this.calm = undefined;
    this.preRideRestBpm = restBpm;
    this.startedAtMs = Date.now(); // el minuto de calma no es tiempo de salida
    if (restBpm !== undefined) this.learnRestFromRitual(restBpm);
  }

  /**
   * El reposo del perfil sale del minuto de calma: con tres lecturas ya hay
   * mediana y sustituye al valor por defecto (nunca a uno fijado a mano).
   */
  private learnRestFromRitual(todayBpm: number): void {
    const stored = this.registry.get('riderProfileStored') as StoredRiderProfile | undefined;
    if (!stored) return;
    const history = (this.registry.get('sessionHistory') as SessionRecord[] | undefined) ?? [];
    const readings = [...preRideRestReadings(history), todayBpm].slice(-7);
    if (readings.length < 3) return;
    const sorted = [...readings].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    const next = withRitualRest(stored, Math.round(median));
    if (next === stored) return;
    saveRiderProfile(next);
    this.registry.set('riderProfileStored', next);
    this.registry.set('riderProfile', toSimRider(next));
  }

  /** El reposo vino alto: hoy toca suave. Se reinicia la escena con recuperación corta. */
  private switchToEasier(restBpm: number): void {
    this.calm = undefined;
    const entry = PROGRAM_CATALOG.find((e) => e.program.id === 'recuperacion');
    if (entry) {
      this.registry.set(
        'selectedProgram',
        applyAdjustments(entry.program, entry.adjustments, { warmupMin: 3, mainMin: 12 }),
      );
    }
    const data: RideSceneData = { skipCalm: true, preRideRestBpm: restBpm };
    this.scene.restart(data);
  }

  /**
   * Cortar la salida antes del final: se guarda lo pedaleado (una salida
   * corta cuenta para el hábito si pasó de cinco minutos) y se muestra el
   * resumen sin celebración ni calibración.
   */
  private quitRide(): void {
    if (this.finishedShown) return;
    const summary = this.sim.summary();
    const record = this.recordSession(summary, false);
    proximityAudio.stop();
    bikeAudio.stop();
    this.showFinished(summary, record, false);
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
          proximityAudio.bite();
        }
        break;
      case 'segmentChanged':
        if (!fastForward) bikeAudio.shift();
        if (event.segment.kind === 'surge') {
          this.banner.showNotice('¡¡OLEADA!!', 2500, UI.danger);
          if (!fastForward) proximityAudio.charge();
        } else if (event.segment.cueResistance !== undefined && this.resistanceCtl) {
          this.banner.showNotice(`Resistencia → ${event.segment.cueResistance}`, 4000, UI.info);
        }
        break;
      case 'staleHeartRate':
        if (!fastForward) this.banner.showNotice('Sin señal de la pulsera', 3000, UI.warn);
        break;
      case 'surgeWarning':
        // Un relámpago anuncia la oleada; la cuenta atrás la lleva el banner.
        if (!fastForward) {
          this.atmosphere.lightning();
          gameAudio.playThunder();
        }
        break;
      case 'healthDepleted':
        this.vignette.setAlpha(0.16);
        break;
      case 'finished': {
        proximityAudio.stop();
        bikeAudio.stop();
        const record = this.recordSession(event.summary, true);
        this.showFinished(event.summary, record, true);
        break;
      }
      default:
        break; // staleCadence y surgeWarning se leen del estado en la HUD/banner
    }
  }

  /**
   * La sesión al historial: al registry para la pantalla de campamento de
   * inmediato, y a IndexedDB para la próxima vez. Un fallo de disco no toca
   * el ride.
   */
  private recordSession(summary: RideSummary, completed: boolean): SessionRecord {
    const stored = this.registry.get('riderProfileStored') as StoredRiderProfile | undefined;
    const record = toSessionRecord({
      startedAtMs: this.startedAtMs,
      program: this.program,
      plannedSec: totalDurationSec(expandProgram(this.program)),
      inputMode: this.sim.state.inputMode,
      completed,
      summary,
      hrRestBpm: stored?.hrRestBpm ?? RIDER.hrRestBpm,
      preRideRestBpm: this.preRideRestBpm,
    });
    const history = (this.registry.get('sessionHistory') as SessionRecord[] | undefined) ?? [];
    this.registry.set('sessionHistory', [...history.filter((r) => r.id !== record.id), record]);
    void saveSession(record);
    return record;
  }

  private showFinished(summary: RideSummary, record: SessionRecord, completed: boolean): void {
    if (this.finishedShown) return;
    this.finishedShown = true;
    this.hud.hideQuit();
    releaseWakeLock(); // sesión terminada: la pantalla ya puede dormirse
    if (completed) gameAudio.playFinish();

    const heartRateMode = this.sim.state.inputMode === 'heartRate';
    const calibrationNote = heartRateMode && completed ? this.applyCalibration(summary) : undefined;
    new FinishPanel(this, {
      summary,
      record,
      history: (this.registry.get('sessionHistory') as SessionRecord[] | undefined) ?? [],
      completed,
      heartRateMode,
      calibrationNote,
      onBack: () => this.scene.start('StartScene'),
    });
  }

  /**
   * La calibración se aprende de cada sesión: un pico sostenido por encima del
   * máximo lo sube, y ser atrapado en tramos suaves (o no acercarse nunca con
   * esfuerzo bajo) mueve la intensidad un punto. Devuelve la nota para el
   * resumen, o undefined si no hubo cambios.
   */
  private applyCalibration(summary: RideSummary): string | undefined {
    const stored = this.registry.get('riderProfileStored') as StoredRiderProfile | undefined;
    if (!stored) return undefined;
    const notes: string[] = [];
    const { profile: withPeak, raised } = withObservedPeak(stored, summary.peakHeartRateBpm);
    if (raised) notes.push(`Máximo actualizado a ${withPeak.hrMaxBpm} bpm por el pico de hoy.`);
    const advice = calibrationAdvice(summary);
    const next = applyAdvice(withPeak, advice);
    if (advice === 'lower' && next.intensityPct !== withPeak.intensityPct) {
      notes.push(
        `Te alcanzaron ${summary.timesCaughtInEasy} veces en tramos suaves: intensidad a ${sign(next.intensityPct)}.`,
      );
    } else if (advice === 'raise' && next.intensityPct !== withPeak.intensityPct) {
      notes.push(`Sin apuros y esfuerzo bajo: intensidad a ${sign(next.intensityPct)}.`);
    }
    if (notes.length === 0) return undefined;
    saveRiderProfile(next);
    this.registry.set('riderProfileStored', next);
    this.registry.set('riderProfile', toSimRider(next));
    return notes.join('\n');
  }

  private draw(state: SimState, dt: number): void {
    // La noche avanza con el programa: anochecer al salir, amanecer al terminar.
    const progress = state.totalSec > 0 ? state.elapsedSec / state.totalSec : 0;
    const night01 = Math.max(0, Math.min((progress - 0.05) / 0.15, (0.9 - progress) / 0.1, 1));
    this.atmosphere.setProgress(progress);
    this.atmosphere.update(state.playerSpeedKph / 3.6, dt);

    const crankRpm =
      state.inputMode === 'heartRate' ? state.playerSpeedKph * VISUAL_RPM_PER_KPH : state.cadenceRpm;
    const closeness = Math.max(0, Math.min(1, 1 - state.gapM / 40));
    const danger01 = Math.max(0, Math.min(1, 1 - state.gapM / 15));
    this.atmosphere.setDread(closeness);
    this.cyclist.update(dt, crankRpm, state.playerSpeedKph / 3.6, state.effortFrac);
    this.horde.update(dt, state.gapM, state.zombieSpeedKph, state.caughtGraceSec > 0);
    this.effects.update(state.playerSpeedKph / 3.6, dt, night01, danger01);
    this.effects.updateHorde(this.horde.screenX, this.horde.run01);
    proximityAudio.update(state.gapM, this.horde.run01, dt);
    bikeAudio.update(state.playerSpeedKph);
    ambientAudio.update(night01, Math.max(0, Math.min(1, (progress - 0.88) / 0.12)));

    // La cámara se acerca un pelín cuando los tienes encima y se balancea
    // con cada pedalada.
    const camera = this.cameras.main;
    const targetZoom = state.gapM < 20 ? 1 + ((20 - state.gapM) / 20) * 0.045 : 1;
    camera.setZoom(camera.zoom + (targetZoom - camera.zoom) * Math.min(1, dt * 3));
    camera.scrollY = crankRpm > 5 ? Math.sin(this.cyclist.crank * 2) * 1.3 : 0;

    this.hud.update(state);
    this.banner.update(state);
    this.resistanceCtl?.update(state.resistanceLevel);
  }
}
