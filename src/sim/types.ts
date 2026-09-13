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
  inSec: number;
}

export interface SegmentInfo {
  index: number;
  kind: SpeedSegmentKind;
  /** Velocidad nominal del segmento actual (sin rampa ni tropiezo). */
  zombieSpeedKph: number;
  remainingSec: number;
  waveNumber?: number;
  waveTotal?: number;
  next?: SegmentNextInfo;
}

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
  avgCadenceRpm: number;
  avgHeartRateBpm: number;
}

export type SimEvent =
  | { type: 'caught'; healthPct: number }
  | { type: 'segmentChanged'; index: number; segment: ExpandedSegment }
  | { type: 'surgeWarning'; inSec: number; toKph: number }
  | { type: 'staleCadence' }
  | { type: 'staleHeartRate' }
  | { type: 'healthDepleted' }
  | { type: 'finished'; summary: RideSummary };
