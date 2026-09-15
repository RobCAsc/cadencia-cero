import type { InputMode } from '../config';
import type { ExpandedSegment, SpeedSegmentKind } from './program';

/** Una muestra de cadencia, venga del sensor BLE o del slider falso. */
export interface CadenceSample {
  rpm: number;
  /** Dominio de performance.now(); una muestra vieja no cuenta como fresca. */
  timestampMs: number;
}

/** Una muestra de pulso, venga de la pulsera BLE o del slider falso. */
export interface HeartRateSample {
  bpm: number;
  /** Dominio de performance.now(); una muestra vieja no cuenta como fresca. */
  timestampMs: number;
}

export interface SegmentNextInfo {
  kind: SpeedSegmentKind;
  zombieSpeedKph: number;
  zoneMin: number;
  zoneMax: number;
  inSec: number;
}

export interface SegmentInfo {
  index: number;
  kind: SpeedSegmentKind;
  /** Velocidad nominal del segmento actual (sin rampa ni tropiezo). */
  zombieSpeedKph: number;
  /** Zona prescrita (0 = suave). Bajo zoneMin te alcanzan; sobre zoneMax la ventaja no crece. */
  zoneMin: number;
  zoneMax: number;
  remainingSec: number;
  /** Consigna del tramo para el rider (resistencia, enfriamiento, empujón). */
  cue?: string;
  waveNumber?: number;
  waveTotal?: number;
  next?: SegmentNextInfo;
}

/** Cómo le pareció la salida al rider, preguntado al terminar. */
export type RideRpe = 'easy' | 'right' | 'hard';

export interface SimState {
  elapsedSec: number;
  totalSec: number;
  distanceM: number;
  gapM: number;
  healthPct: number;
  inputMode: InputMode;
  /** Cadencia efectiva: 0 si la última muestra está vieja. */
  cadenceRpm: number;
  cadenceStale: boolean;
  /** Pulso efectivo (suavizado, retenido y decayendo si la pulsera calla). */
  heartRateBpm: number;
  heartRateStale: boolean;
  /** Fracción de reserva cardíaca 0..1 con la que se calcula la velocidad en modo pulso. */
  effortFrac: number;
  /** Por encima del techo de zona del tramo: la ventaja está congelada. */
  aboveZone: boolean;
  /** Pulso pasado del máximo del perfil: la horda está congelada y toca aflojar. */
  easeOff: boolean;
  /** Enfriamiento tras Terminar: la horda parada, el programa acaba en breve. */
  coolingDown: boolean;
  /** El resto de la salida va en suave (salud a cero, pulso muy alto sostenido). */
  eased: boolean;
  /** Se puede insertar el empujón opcional ahora (tramo continuo, aún no usado). */
  pushAvailable: boolean;
  playerSpeedKph: number;
  /** Velocidad efectiva de la horda (con rampa y tropiezo aplicados). */
  zombieSpeedKph: number;
  resistanceLevel: number;
  segment: SegmentInfo;
  caughtGraceSec: number;
  timesCaught: number;
  phase: 'riding' | 'finished';
}

export interface RideSummary {
  durationSec: number;
  distanceM: number;
  timesCaught: number;
  /** Capturas en tramos suaves (calentamiento, recuperación, vuelta a la calma). */
  timesCaughtInEasy: number;
  avgCadenceRpm: number;
  avgHeartRateBpm: number;
  /** Mayor pulso sostenido (ventana de unos segundos) de la sesión. */
  peakHeartRateBpm: number;
  avgEffortFrac: number;
  /** Segundos en cada zona cardíaca: índice 0 = suave (bajo Z1), 1..5 = Z1..Z5. */
  zoneSec: readonly number[];
  /** Segundos dentro de la zona prescrita por el tramo (la "precisión de zona"). */
  inZoneSec: number;
  /** Segundos por encima del techo del tramo (ventaja congelada). */
  aboveZoneSec: number;
  /**
   * Recuperación cardíaca: cuánto bajó el pulso (bpm) en el minuto siguiente
   * a cada oleada. Sube con el entrenamiento; es el indicador de forma más
   * honesto que da un pulsómetro solo.
   */
  recoveryDrops: readonly number[];
  /** Ventaja (m) cada gapTraceStepSec: con ella la próxima vez corre tu fantasma. */
  gapTrace: readonly number[];
}

export type SimEvent =
  | { type: 'caught'; healthPct: number }
  | { type: 'segmentChanged'; index: number; segment: ExpandedSegment }
  | { type: 'surgeWarning'; inSec: number; toKph: number }
  | { type: 'overMax' }
  | { type: 'sustainedHigh'; sec: number }
  | { type: 'pushDone'; bonusM: number }
  | { type: 'staleCadence' }
  | { type: 'staleHeartRate' }
  | { type: 'healthDepleted' }
  | { type: 'finished'; summary: RideSummary };
