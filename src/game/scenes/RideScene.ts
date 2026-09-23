import Phaser from 'phaser';
import { RENDER, RIDER, SIM, type InputMode, type RiderProfile } from '../../config';
import type { CadenceSource } from '../../input/CadenceSource';
import type { HeartRateSource } from '../../input/HeartRateSource';
import { planRide, type EncounterPlan } from '../../sim/encounters';
import { toSessionRecord, type EncounterRecord, type SessionRecord } from '../../sim/history';
import { expandProgram, totalDurationSec, type TrainingProgram } from '../../sim/program';
import { applyAdjustments, PROGRAM_CATALOG } from '../../sim/programs/catalog';
import { OLEADAS } from '../../sim/programs/oleadas';
import { RideSim } from '../../sim/RideSim';
import { nextRefuge, preRideRestReadings, readiness, routeProgress, weekStartMs, type PlanPhase } from '../../sim/progress';
import { refugesAround } from '../../sim/routeMap';
import {
  applyAdvice,
  calibrationAdvice,
  toSimRider,
  withObservedPeak,
  withRitualRest,
  type StoredRiderProfile,
} from '../../sim/riderProfile';
import type { RideRpe, RideSummary, SimEvent, SimState } from '../../sim/types';
import { loadPlanState, savePlanState } from '../../storage/planStore';
import { saveRiderProfile } from '../../storage/riderStore';
import { saveSession } from '../../storage/sessionStore';
import { Cyclist } from '../actors/Cyclist';
import { Ghost } from '../actors/Ghost';
import { Horde } from '../actors/Horde';
import { ambientAudio } from '../ambientAudio';
import { gameAudio } from '../audio';
import { bikeAudio } from '../bikeAudio';
import { Effects, ensureVignette } from '../effects';
import { Encounters } from '../encounters';
import { gapToPx, slopeForGrade } from '../gapMapping';
import { lcg } from '../rng';
import { proximityAudio } from '../proximityAudio';
import { CueBanner } from '../hud/CueBanner';
import { Hud } from '../hud/Hud';
import { OfferBanner } from '../hud/OfferBanner';
import { ResistanceControl } from '../hud/ResistanceControl';
import { Atmosphere } from '../atmosphere';
import { CalmPanel } from '../ride/CalmPanel';
import { FinishPanel } from '../ride/FinishPanel';
import { MapView } from '../ride/MapView';
import { UI } from '../theme';
import { releaseWakeLock } from '../wakeLock';

/**
 * En modo pulso no hay cadencia real que mover las bielas: se anima una
 * cadencia plausible a partir de la velocidad (ancla de la tabla: 26 km/h
 * a 80 rpm). Es puro decorado; el sim no lo sabe ni le importa.
 */
const VISUAL_RPM_PER_KPH = 80 / 26;
const GOLD = '#d9b06a';
/** El empujón se ofrece pasado este punto de la salida, una vez, solo en los fondos. */
const PUSH_OFFER_AT = 0.4;
const OFFER_MS = 15000;
const SAFETY_NOTE =
  'Si notas dolor en el pecho, mareo o falta de aire desproporcionada, para y consulta. Agua y ventilador a mano.';

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
  private ghost!: Ghost;
  private horde!: Horde;
  private effects!: Effects;
  private hud!: Hud;
  private banner!: CueBanner;
  private offer!: OfferBanner;
  private resistanceCtl: ResistanceControl | undefined;
  private vignette!: Phaser.GameObjects.Rectangle;
  private finishedShown = false;
  private program!: TrainingProgram;
  private startedAtMs = 0;
  private calm: CalmPanel | undefined;
  /** La vista de mapa, mientras está abierta. */
  private mapView: MapView | undefined;
  /** Km de la Ruta antes de hoy: donde empieza el trozo de hoy en el mapa. */
  private kmBeforeToday = 0;
  /** Los encuentros de la salida: sacados de la bolsa al arrancar, disparados a su hora, contados en el resumen. */
  private encounters!: Encounters;
  private encounterPlans: EncounterPlan[] = [];
  private encounterNext = 0;
  private encountersSeen: EncounterRecord[] = [];
  /** El km del frame anterior, para saber cuándo se cruza un refugio. */
  private lastKmNow = -1;
  private preRideRestBpm: number | undefined;
  /** Dónde ibas la última vez con este programa, cada gapTraceStepSec. */
  private ghostTrace: readonly number[] | undefined;
  private quitting = false;
  private pushOffered = false;
  /** El reposo del día no venía alto: se puede ofrecer el empujón. */
  private readinessOk = true;
  /** Lo que el rider contesta en el resumen; se guarda con la sesión al responder. */
  private rpe: RideRpe | undefined;
  private note: string | undefined;

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
    this.quitting = false;
    this.pushOffered = false;
    this.readinessOk = true;
    this.rpe = undefined;
    this.note = undefined;
    this.ghostTrace = this.findGhostTrace(program, inputMode);
    this.mapView = undefined;
    this.kmBeforeToday = routeProgress(this.history()).totalKm;
    this.lastKmNow = -1;

    this.atmosphere = new Atmosphere(this);
    // Los encuentros de hoy, sacados de la bolsa: varios por salida, sin repetir, nunca en una oleada.
    this.encounters = new Encounters(this, this.atmosphere.encounterLayers);
    const ride = planRide(this.sim.currentSegments, lcg(Date.now()), loadPlanState().encounterBag);
    this.encounterPlans = ride.encounters;
    this.encounterNext = 0;
    this.encountersSeen = [];
    savePlanState({ encounterBag: ride.bag });

    this.ghost = new Ghost(this);
    this.cyclist = new Cyclist(this);
    this.horde = new Horde(this, program.target);
    this.effects = new Effects(this);
    ensureVignette(this);
    this.add.image(0, 0, 'fx-vignette').setOrigin(0, 0).setDepth(5);
    proximityAudio.start();
    ambientAudio.start();
    bikeAudio.start();

    this.hud = new Hud(this, {
      segments: expandProgram(program),
      onQuit: () => this.onQuitTap(),
      onMap: () => this.toggleMap(),
    });
    this.banner = new CueBanner(this, (finalPip) => gameAudio.playPip(finalPip));
    this.offer = new OfferBanner(this);
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
      this.encounters.destroy();
      proximityAudio.stop();
      ambientAudio.stop();
      bikeAudio.stop();
    });

    // El ritual: un minuto de calma antes de salir. Solo en modo pulso, y
    // solo una vez (al cambiar a suave la escena se reinicia sin él).
    if (inputMode === 'heartRate' && !data?.skipCalm) {
      this.calm = new CalmPanel(this, {
        source: heartRate,
        history: this.history(),
        safetyNote: this.safetyNoteForThisWeek(),
        why: loadPlanState().why,
        onStart: (restBpm) => this.beginRide(restBpm),
        onEasier: (restBpm) => this.switchToEasier(restBpm),
        onRest: () => this.scene.start('StartScene'),
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
    if (!this.finishedShown) {
      for (const event of this.sim.update(dt)) this.handleEvent(event, false);
      this.offer.update();
      this.maybeOfferPush(this.sim.state);
    }
    this.draw(this.sim.state, dt);
  }

  private history(): SessionRecord[] {
    return (this.registry.get('sessionHistory') as SessionRecord[] | undefined) ?? [];
  }

  /**
   * El fantasma: la última salida completa con este mismo programa y la
   * misma duración, o la mejor (menos capturas, y a igualdad más ventaja
   * media) si el rider lo eligió así.
   */
  private findGhostTrace(program: TrainingProgram, inputMode: InputMode): readonly number[] | undefined {
    if (inputMode === 'feel') return undefined;
    const plannedSec = totalDurationSec(expandProgram(program));
    const candidates = this.history().filter(
      (r) =>
        r.programId === program.id &&
        r.completed &&
        r.plannedSec === plannedSec &&
        r.inputMode !== 'feel' &&
        r.gapTrace !== undefined &&
        r.gapTrace.length > 0,
    );
    if (candidates.length === 0) return undefined;
    if (loadPlanState().ghostMode !== 'best') return candidates[candidates.length - 1]?.gapTrace;
    const meanGap = (r: SessionRecord) => (r.gapTrace ?? []).reduce((a, b) => a + b, 0) / Math.max(1, r.gapTrace?.length ?? 1);
    const best = candidates.reduce((a, b) =>
      b.timesCaught < a.timesCaught || (b.timesCaught === a.timesCaught && meanGap(b) > meanGap(a)) ? b : a,
    );
    return best.gapTrace;
  }

  /** El aviso de seguridad, una vez por semana en el ritual. */
  private safetyNoteForThisWeek(): string | undefined {
    const week = weekStartMs(Date.now());
    if (loadPlanState().safetyNoteWeekMs === week) return undefined;
    savePlanState({ safetyNoteWeekMs: week });
    return SAFETY_NOTE;
  }

  private beginRide(restBpm: number | undefined): void {
    this.calm = undefined;
    this.preRideRestBpm = restBpm;
    this.startedAtMs = Date.now(); // el minuto de calma no es tiempo de salida
    if (restBpm !== undefined) {
      const verdict = readiness(this.history(), restBpm).state;
      this.readinessOk = verdict === 'normal' || verdict === 'unknown';
      this.learnRestFromRitual(restBpm);
    }
  }

  /**
   * El reposo del perfil sale del minuto de calma: con tres lecturas ya hay
   * mediana y sustituye al valor por defecto (nunca a uno fijado a mano).
   */
  private learnRestFromRitual(todayBpm: number): void {
    const stored = this.registry.get('riderProfileStored') as StoredRiderProfile | undefined;
    if (!stored) return;
    const readings = [...preRideRestReadings(this.history()), todayBpm].slice(-7);
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
   * Terminar no corta en seco: el primer toque confirmado cambia lo que queda
   * por dos minutos de enfriamiento con la horda parada; el siguiente acaba
   * ya. Lo pedaleado se guarda siempre (una salida corta cuenta para el
   * hábito si pasó de cinco minutos).
   */
  private onQuitTap(): void {
    if (this.finishedShown) return;
    if (!this.sim.state.coolingDown) {
      this.quitting = true;
      this.offer.hide();
      this.sim.beginCooldown();
      this.segmentsChanged();
      return;
    }
    this.sim.endNow();
  }

  adjustResistance(delta: number): void {
    this.sim.setResistance(this.sim.state.resistanceLevel + delta);
  }

  /** Los tramos vigentes cambiaron (enfriamiento, empujón, resto en suave): la HUD y el mapa los siguen. */
  private segmentsChanged(): void {
    const segments = this.sim.currentSegments;
    this.hud.setSegments(segments);
    this.mapView?.setSegments(segments);
  }

  /** La vista de mapa: un toque la abre, otro (o "Volver a la carretera") la cierra. */
  private toggleMap(): void {
    if (this.finishedShown || this.calm) return;
    if (this.mapView) {
      this.closeMap();
      return;
    }
    this.mapView = new MapView(this, {
      programName: this.program.name,
      segments: this.sim.currentSegments,
      sessions: this.history(),
      startedAtMs: this.startedAtMs,
      onClose: () => this.closeMap(),
    });
  }

  private closeMap(): void {
    this.mapView?.destroy();
    this.mapView = undefined;
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

  /**
   * El empujón opcional: en los fondos, una vez, pasado el 40 % de la salida,
   * sin capturas y con el reposo del día normal. Aceptarlo mete un minuto en
   * Z3 a cambio de ruta; rechazarlo no cuesta nada.
   */
  private maybeOfferPush(state: SimState): void {
    if (this.pushOffered || this.offer.isOpen || this.program.id !== 'fondo') return;
    if (state.inputMode === 'feel' || !state.pushAvailable || state.timesCaught > 0 || !this.readinessOk) return;
    if (state.elapsedSec < state.totalSec * PUSH_OFFER_AT) return;
    this.pushOffered = true;
    this.offer.show({
      text: `¿Un empujón? Un minuto en Z3 por ${SIM.push.bonusM} m de Ruta. La horda no acelera.`,
      yesLabel: 'Sí, vamos',
      noLabel: 'Hoy no',
      durationMs: OFFER_MS,
      onYes: () => {
        if (!this.sim.insertPush()) return;
        this.segmentsChanged();
        // La cuenta atrás: el pulso necesita ese tiempo para llegar a Z3.
        this.banner.showNotice(`Empujón en ${SIM.push.countdownSec} s: sube el ritmo`, SIM.push.countdownSec * 1000, GOLD);
      },
    });
  }

  /** El resto de la salida en suave, con la línea de tiempo al día. */
  private easeRest(): void {
    this.sim.easeRemaining();
    this.segmentsChanged();
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
        } else if (!fastForward && event.segment.cue) {
          // La consigna del tramo, en cualquier modo: cuestas, empujón, enfriamiento.
          this.banner.showNotice(event.segment.cue, 4500, event.segment.kind === 'push' ? GOLD : UI.info);
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
      case 'overMax':
        if (!fastForward) this.banner.showNotice('AFLOJA: pulso sobre tu máximo. La horda se para.', 5000, UI.danger);
        break;
      case 'sustainedHigh': {
        // Dos minutos muy alto: en arranque y base el resto va en suave; en
        // rotación es un aviso, porque las oleadas piden exactamente eso.
        const phase = this.registry.get('planPhase') as PlanPhase | undefined;
        if (phase === undefined || phase === 'arranque' || phase === 'base') {
          this.easeRest();
          if (!fastForward) this.banner.showNotice('Dos minutos muy alto: el resto de la salida va en suave.', 6000, UI.warn);
        } else if (!fastForward) {
          this.banner.showNotice('Dos minutos muy alto: baja un punto.', 5000, UI.warn);
        }
        break;
      }
      case 'healthDepleted':
        this.vignette.setAlpha(0.16);
        if (!fastForward && !this.sim.state.eased && !this.sim.state.coolingDown) {
          this.offer.show({
            text: 'Salud a cero. ¿El resto de la salida en suave, con la horda lejos?',
            yesLabel: 'Sí, en suave',
            noLabel: 'No, sigo',
            durationMs: OFFER_MS,
            onYes: () => this.easeRest(),
          });
        }
        break;
      case 'pushDone':
        if (!fastForward) this.banner.showNotice(`Empujón completado: +${event.bonusM} m de Ruta`, 4000, GOLD);
        break;
      case 'pushMissed':
        if (!fastForward) {
          this.banner.showNotice(
            `Empujón: ${Math.round(event.zoneSec)} s en Z3, hacían falta ${SIM.push.minZoneSec}. Nada perdido.`,
            5000,
            UI.info,
          );
        }
        break;
      case 'finished': {
        proximityAudio.stop();
        bikeAudio.stop();
        const completed = !this.quitting;
        const record = this.recordSession(event.summary, completed);
        this.showFinished(event.summary, record, completed);
        break;
      }
      default:
        break; // staleCadence se lee del estado en la HUD
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
      rpe: this.rpe,
      note: this.note,
      encounters: this.encountersSeen,
    });
    const history = this.history();
    this.registry.set('sessionHistory', [...history.filter((r) => r.id !== record.id), record]);
    void saveSession(record);
    return record;
  }

  private showFinished(summary: RideSummary, record: SessionRecord, completed: boolean): void {
    if (this.finishedShown) return;
    this.finishedShown = true;
    this.hud.hideQuit();
    this.closeMap();
    this.offer.hide();
    releaseWakeLock(); // sesión terminada: la pantalla ya puede dormirse
    if (completed) gameAudio.playFinish();

    const mode = this.sim.state.inputMode;
    new FinishPanel(this, {
      summary,
      record,
      history: this.history(),
      completed,
      mode,
      onRpe: (rpe) => {
        // La respuesta se guarda con la sesión, y la calibración aprende con ella.
        this.rpe = rpe;
        this.recordSession(summary, completed);
        return mode === 'heartRate' && completed ? this.applyCalibration(summary, rpe) : undefined;
      },
      onNote: (note) => {
        this.note = note;
        this.recordSession(summary, completed);
      },
      onNextRide: (dayStartMs) => savePlanState({ nextRideDayMs: dayStartMs }),
      onBack: () => this.scene.start('StartScene'),
    });
  }

  /**
   * La calibración se aprende de cada sesión, con el rider de acuerdo: un
   * pico sostenido sube el máximo despacio y solo si la salida fue limpia y
   * no le pareció demasiado; ser atrapado en tramos suaves (o "demasiado"
   * habiendo seguido la zona) baja la exigencia; "fácil" sin apuros la sube.
   * Devuelve la nota para el resumen, o undefined si no hubo cambios.
   */
  private applyCalibration(summary: RideSummary, rpe: RideRpe): string | undefined {
    const stored = this.registry.get('riderProfileStored') as StoredRiderProfile | undefined;
    if (!stored) return undefined;
    const notes: string[] = [];
    const { profile: withPeak, raised } = withObservedPeak(stored, summary.peakHeartRateBpm, {
      allowRaise: summary.timesCaught === 0 && rpe !== 'hard',
    });
    if (raised) notes.push(`Máximo actualizado a ${withPeak.hrMaxBpm} bpm por el pico de hoy.`);
    const advice = calibrationAdvice(summary, rpe);
    const next = applyAdvice(withPeak, advice);
    if (advice === 'lower' && next.intensityPct !== withPeak.intensityPct) {
      notes.push(
        summary.timesCaughtInEasy >= 2
          ? `Te alcanzaron ${summary.timesCaughtInEasy} veces en tramos suaves: intensidad a ${sign(next.intensityPct)}.`
          : `Seguiste la zona y fue demasiado: intensidad a ${sign(next.intensityPct)}.`,
      );
    } else if (advice === 'raise' && next.intensityPct !== withPeak.intensityPct) {
      notes.push(`Sin apuros y te pareció fácil: intensidad a ${sign(next.intensityPct)}.`);
    }
    if (notes.length === 0 && withPeak === stored) return undefined;
    saveRiderProfile(next);
    this.registry.set('riderProfileStored', next);
    this.registry.set('riderProfile', toSimRider(next));
    return notes.length > 0 ? notes.join('\n') : undefined;
  }

  private draw(state: SimState, dt: number): void {
    // La noche avanza con el programa: anochecer al salir, amanecer al terminar.
    const progress = state.totalSec > 0 ? state.elapsedSec / state.totalSec : 0;
    const night01 = Math.max(0, Math.min((progress - 0.05) / 0.15, (0.9 - progress) / 0.1, 1));
    this.atmosphere.setProgress(progress);
    // El terreno se empina en las cuestas: la consigna de resistencia, hecha visible.
    this.atmosphere.setSlope(slopeForGrade(state.segment.grade ?? 0));
    // Los refugios de la Ruta que la salida cruza aparecen en el paisaje y
    // pasan con él; al cruzarlos, se encienden.
    const kmNow = this.kmBeforeToday + state.distanceM / 1000;
    const nearby = refugesAround(kmNow, 0.6);
    this.atmosphere.setLandmarks(nearby);
    if (this.lastKmNow >= 0 && !this.finishedShown) {
      for (const r of nearby) {
        if (r.km > this.lastKmNow && r.km <= kmNow) this.banner.showNotice(`Refugio ${r.name}: encendido`, 4500, GOLD);
      }
    }
    this.lastKmNow = kmNow;
    this.atmosphere.update(state.playerSpeedKph / 3.6, dt);
    const slope = this.atmosphere.slope;
    // Los encuentros de hoy salen a su hora, de uno en uno, si la carretera está tranquila;
    // el que pierde su momento (una captura, la calma) no vuelve.
    const plan = this.encounterPlans[this.encounterNext];
    if (plan && !this.calm && !this.finishedShown && state.elapsedSec >= plan.atSec) {
      if (state.elapsedSec >= plan.atSec + 10) {
        this.encounterNext++;
      } else if (state.caughtGraceSec <= 0 && this.encounters.current === undefined) {
        const refuge = nextRefuge(kmNow);
        this.encounters.start(plan.kind, {
          distanceM: state.distanceM,
          speedMps: state.playerSpeedKph / 3.6,
          sign: { refuge: refuge.name, kmLeft: Math.round(refuge.km - kmNow) },
        });
        this.encountersSeen.push({ kind: plan.kind, km: kmNow });
        this.encounterNext++;
      }
    }
    this.encounters.update({
      dt,
      distanceM: state.distanceM,
      speedMps: state.playerSpeedKph / 3.6,
      inZone: state.inZoneRunSec > 0,
      ...this.atmosphere.look,
    });

    const crankRpm =
      state.inputMode === 'cadence' ? state.cadenceRpm : state.playerSpeedKph * VISUAL_RPM_PER_KPH;
    const closeness = Math.max(0, Math.min(1, 1 - state.gapM / 40));
    const danger01 = Math.max(0, Math.min(1, 1 - state.gapM / 15));
    this.atmosphere.setDread(closeness);
    this.cyclist.update(dt, crankRpm, state.playerSpeedKph / 3.6, state.effortFrac, slope);
    this.horde.update(dt, state.gapM, state.zombieSpeedKph, state.caughtGraceSec > 0, slope);
    this.effects.update(state.playerSpeedKph / 3.6, dt, night01, danger01, slope);
    this.effects.updateHorde(this.horde.screenX, this.horde.run01, slope);
    // Con la ventaja congelada, asentándose o la horda parada, el latido no
    // debe empujar a apretar más: la horda no gana.
    const hordeCalm = state.aboveZone || state.settling || state.easeOff || state.coolingDown || state.hordeFading;
    proximityAudio.update(state.gapM, this.horde.run01, dt, hordeCalm);
    bikeAudio.update(state.playerSpeedKph);
    ambientAudio.update(night01, Math.max(0, Math.min(1, (progress - 0.88) / 0.12)));

    // El fantasma: la ventaja que llevabas la última vez en este mismo
    // minuto, puesta en la carretera respecto a la horda de hoy.
    let ghostDeltaM: number | undefined;
    const ghostGap = this.ghostTrace?.[Math.floor(state.elapsedSec / SIM.gapTraceStepSec)];
    if (ghostGap !== undefined && !this.calm) {
      const hordeX = RENDER.playerX - gapToPx(state.gapM);
      const x = Math.max(hordeX + 40, Math.min(RENDER.width - 40, hordeX + gapToPx(ghostGap)));
      this.ghost.update(dt, x, state.playerSpeedKph / 3.6, slope);
      ghostDeltaM = state.gapM - ghostGap;
    } else {
      this.ghost.update(dt, undefined, 0, slope);
    }

    // La cámara se acerca un pelín cuando los tienes encima y se balancea
    // con cada pedalada.
    const camera = this.cameras.main;
    const targetZoom = state.gapM < 20 ? 1 + ((20 - state.gapM) / 20) * 0.045 : 1;
    camera.setZoom(camera.zoom + (targetZoom - camera.zoom) * Math.min(1, dt * 3));
    camera.scrollY = crankRpm > 5 ? Math.sin(this.cyclist.crank * 2) * 1.3 : 0;

    // La Ruta sigue durante la salida: el siguiente refugio y lo que falta hasta él.
    const refuge = nextRefuge(kmNow);
    this.hud.update(state, { ghostDeltaM, refuge: { name: refuge.name, distanceM: (refuge.km - kmNow) * 1000 } });
    this.mapView?.update(state, { ghostDeltaM });
    this.banner.update(state);
    this.resistanceCtl?.update(state.resistanceLevel);
  }
}
