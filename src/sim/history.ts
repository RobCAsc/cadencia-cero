import type { InputMode } from '../config';
import type { EncounterKind } from './encounters';
import type { RideRpe, RideSummary } from './types';

/** Lo que pasó en la carretera sin que nadie lo prescribiera, y en qué km de la Ruta. */
export interface EncounterRecord {
  kind: EncounterKind;
  km: number;
}

/**
 * Una salida guardada en la tablet. Es la unidad del hábito: todo lo que la
 * pantalla de campamento calcula (meta semanal, racha, Ruta, récords) sale de
 * una lista de estos y de nada más.
 */
export interface SessionRecord {
  /** Clave del almacén: instante de inicio + programa. */
  id: string;
  /** Epoch ms (Date.now()) al arrancar la sesión. */
  startedAtMs: number;
  programId: string;
  programName: string;
  target: string;
  inputMode: InputMode;
  /** false si se abandonó antes del final del programa. */
  completed: boolean;
  /** Duración prescrita por el programa. */
  plannedSec: number;
  durationSec: number;
  distanceM: number;
  timesCaught: number;
  avgHeartRateBpm: number;
  peakHeartRateBpm: number;
  avgEffortFrac: number;
  /** Segundos por zona: índice 0 = suave, 1..5 = Z1..Z5. */
  zoneSec: number[];
  /** Segundos dentro de la zona prescrita (opcional: los registros viejos no lo traen). */
  inZoneSec?: number;
  /** Segundos por encima del techo del tramo. */
  aboveZoneSec?: number;
  /** Caídas de pulso (bpm) en el minuto tras cada oleada. */
  recoveryDrops?: number[];
  /** Reposo del perfil ese día: su tendencia es el indicador de salud más honesto. */
  hrRestBpm: number;
  /** Reposo medido en el ritual de un minuto antes de salir (si se hizo). */
  preRideRestBpm?: number;
  /** Capturas en tramos suaves (los registros viejos no lo traen). */
  timesCaughtInEasy?: number;
  /** Cómo le pareció al rider, si contestó. */
  rpe?: RideRpe;
  /** Una palabra del rider sobre el día ("cansado", "dormí mal", "genial"). */
  note?: string;
  /** Mejor racha de segundos seguidos dentro de la zona prescrita. */
  bestInZoneRunSec?: number;
  /** Ventaja cada pocos segundos: el fantasma para la próxima vez con el mismo programa. */
  gapTrace?: number[];
  /** Pulso en los mismos instantes que gapTrace, para diagnosticar una salida. */
  hrTrace?: number[];
  /** Segundos con la pulsera callada durante la salida. */
  staleHeartRateSec?: number;
  /** El encuentro de la salida, si lo hubo: el resumen lo cuenta en una línea. */
  encounter?: EncounterRecord;
}

export interface SessionInput {
  startedAtMs: number;
  program: { id: string; name: string; target: string };
  plannedSec: number;
  inputMode: InputMode;
  completed: boolean;
  summary: RideSummary;
  hrRestBpm: number;
  preRideRestBpm?: number;
  rpe?: RideRpe;
  note?: string;
  encounter?: EncounterRecord;
}

export function toSessionRecord(input: SessionInput): SessionRecord {
  const s = input.summary;
  return {
    id: `${input.startedAtMs}-${input.program.id}`,
    startedAtMs: input.startedAtMs,
    programId: input.program.id,
    programName: input.program.name,
    target: input.program.target,
    inputMode: input.inputMode,
    completed: input.completed,
    plannedSec: input.plannedSec,
    durationSec: s.durationSec,
    distanceM: s.distanceM,
    timesCaught: s.timesCaught,
    timesCaughtInEasy: s.timesCaughtInEasy,
    ...(input.rpe !== undefined ? { rpe: input.rpe } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.encounter ? { encounter: { ...input.encounter } } : {}),
    ...(s.gapTrace.length > 0 ? { gapTrace: [...s.gapTrace] } : {}),
    ...(s.hrTrace.length > 0 ? { hrTrace: [...s.hrTrace] } : {}),
    staleHeartRateSec: Math.round(s.staleHeartRateSec),
    bestInZoneRunSec: s.bestInZoneRunSec,
    avgHeartRateBpm: s.avgHeartRateBpm,
    peakHeartRateBpm: s.peakHeartRateBpm,
    avgEffortFrac: s.avgEffortFrac,
    zoneSec: [...s.zoneSec],
    inZoneSec: s.inZoneSec,
    aboveZoneSec: s.aboveZoneSec,
    recoveryDrops: [...s.recoveryDrops],
    hrRestBpm: input.hrRestBpm,
    ...(input.preRideRestBpm !== undefined ? { preRideRestBpm: input.preRideRestBpm } : {}),
  };
}

/**
 * Una salida cuenta para el hábito si duró lo bastante como para ser
 * entrenamiento y no un arranque fallido. Cinco minutos es el umbral: menos
 * que eso no mueve la fisiología, pero tampoco se castiga borrándolo.
 */
export const MIN_COUNTABLE_SEC = 300;

export function isCountable(record: SessionRecord): boolean {
  return record.durationSec >= MIN_COUNTABLE_SEC;
}
