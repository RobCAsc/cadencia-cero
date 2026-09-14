import { EFFORT, type EffortTable } from '../config';
import { playerSpeedFromEffort } from './effortTable';
import { floorEffort, zoneRange, type ZoneRange } from './zones';

// Un programa de entrenamiento ES el perfil del antagonista. Con el pulso como
// único sensor, lo que se prescribe es una ZONA cardíaca por tramo: la horda
// corre a la velocidad que exige el piso de esa zona (bajar de ahí es que te
// alcancen) y por encima del techo la ventaja no crece (pasarse en un tramo
// suave no es entrenar mejor). Los tipos calcan el esquema JSON del contrato.

export type SpeedSegmentKind = 'warmup' | 'surge' | 'recover' | 'steady' | 'cooldown';

export interface SpeedSegment {
  kind: SpeedSegmentKind;
  durationSec: number;
  /** Zona prescrita: una (2) o un rango inclusivo ([1, 2]). 0 = suave, bajo Z1. */
  zone: ZoneRange;
  /** Velocidad explícita de la horda; si falta se deriva del piso de la zona. */
  zombieSpeedKph?: number;
  /** Sugerencia de resistencia para el rider al entrar al segmento. */
  cueResistance?: number;
}

export interface RepeatSegment {
  kind: 'repeat';
  /** Ejecuciones TOTALES del bloque (ya corrió una vez inline). */
  times: number;
  /** Índice del primer segmento del bloque en el array original. */
  fromIndex: number;
}

export type ProgramSegment = SpeedSegment | RepeatSegment;

export interface TrainingProgram {
  id: string;
  name: string;
  target: string;
  segments: ProgramSegment[];
}

export interface ExpandedSegment extends SpeedSegment {
  /** Velocidad de la horda ya resuelta (explícita o derivada de la zona). */
  zombieSpeedKph: number;
  zoneMin: number;
  zoneMax: number;
  startSec: number;
  endSec: number;
  /** Índice del segmento en el programa original. */
  sourceIndex: number;
  waveNumber?: number;
  waveTotal?: number;
}

/** Velocidad de la horda que exige el piso de una zona, según la tabla de esfuerzo. */
export function hordeSpeedForZone(zone: number, table: EffortTable = EFFORT): number {
  return playerSpeedFromEffort(floorEffort(zone), table);
}

function resolveZone(program: TrainingProgram, index: number, seg: SpeedSegment): [number, number] {
  const [min, max] = zoneRange(seg.zone);
  const ok = (z: number) => Number.isInteger(z) && z >= 0 && z <= 5;
  if (!ok(min) || !ok(max) || min > max) {
    throw new Error(`programa ${program.id}, segmento ${index}: zona inválida ${JSON.stringify(seg.zone)}`);
  }
  return [min, max];
}

export function expandProgram(program: TrainingProgram, table: EffortTable = EFFORT): ExpandedSegment[] {
  const flat: Array<SpeedSegment & { sourceIndex: number; zoneMin: number; zoneMax: number; zombieSpeedKph: number }> = [];

  const resolve = (seg: SpeedSegment, index: number) => {
    if (!(seg.durationSec > 0)) {
      throw new Error(`programa ${program.id}, segmento ${index}: durationSec debe ser > 0`);
    }
    const [zoneMin, zoneMax] = resolveZone(program, index, seg);
    return {
      ...seg,
      sourceIndex: index,
      zoneMin,
      zoneMax,
      zombieSpeedKph: seg.zombieSpeedKph ?? hordeSpeedForZone(zoneMin, table),
    };
  };

  program.segments.forEach((seg, i) => {
    if (seg.kind === 'repeat') {
      if (!Number.isInteger(seg.times) || seg.times < 1) {
        throw new Error(`programa ${program.id}, repeat en ${i}: times debe ser entero >= 1`);
      }
      if (!Number.isInteger(seg.fromIndex) || seg.fromIndex < 0 || seg.fromIndex >= i) {
        throw new Error(`programa ${program.id}, repeat en ${i}: fromIndex fuera de rango`);
      }
      const block = program.segments.slice(seg.fromIndex, i);
      if (block.some((s) => s.kind === 'repeat')) {
        throw new Error(`programa ${program.id}, repeat en ${i}: no se admiten repeat anidados`);
      }
      for (let n = 1; n < seg.times; n++) {
        block.forEach((s, j) => flat.push(resolve(s as SpeedSegment, seg.fromIndex + j)));
      }
    } else {
      flat.push(resolve(seg, i));
    }
  });

  if (flat.length === 0) {
    throw new Error(`programa ${program.id}: sin segmentos de velocidad`);
  }

  const waveTotal = flat.filter((s) => s.kind === 'surge').length;
  let t = 0;
  let wave = 0;
  return flat.map((s) => {
    const startSec = t;
    t += s.durationSec;
    const expanded: ExpandedSegment = { ...s, startSec, endSec: t };
    if (s.kind === 'surge') {
      wave += 1;
      expanded.waveNumber = wave;
      expanded.waveTotal = waveTotal;
    }
    return expanded;
  });
}

export function totalDurationSec(segments: readonly ExpandedSegment[]): number {
  const last = segments[segments.length - 1];
  return last ? last.endSec : 0;
}

/** Índice del segmento que contiene t; clampa al último para t >= total. */
export function segmentIndexAt(segments: readonly ExpandedSegment[], tSec: number): number {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg && tSec < seg.endSec) return i;
  }
  return segments.length - 1;
}

/**
 * Velocidad de la horda en t. Al entrar a cada segmento (salvo el primero) la
 * velocidad llega en rampa lineal de rampSec desde la del segmento anterior:
 * un escalón 12→32 se lee como teletransporte; la rampa da una pedalada de
 * margen sin tocar la prescripción.
 */
export function zombieSpeedAt(
  segments: readonly ExpandedSegment[],
  tSec: number,
  rampSec: number,
): number {
  const t = Math.max(0, tSec);
  const i = segmentIndexAt(segments, t);
  const seg = segments[i];
  if (!seg) return 0;
  const into = t - seg.startSec;
  if (i === 0 || rampSec <= 0 || into >= rampSec) return seg.zombieSpeedKph;
  const prev = segments[i - 1];
  if (!prev) return seg.zombieSpeedKph;
  return prev.zombieSpeedKph + (seg.zombieSpeedKph - prev.zombieSpeedKph) * (into / rampSec);
}
