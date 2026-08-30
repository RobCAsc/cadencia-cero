// Un programa de entrenamiento ES el perfil de velocidad del antagonista.
// Los tipos calcan el esquema JSON del contrato: en Fase 2 esto se carga con
// fetch en lugar de un import y nada más cambia.

export type SpeedSegmentKind = 'warmup' | 'surge' | 'recover' | 'steady' | 'cooldown';

export interface SpeedSegment {
  kind: SpeedSegmentKind;
  durationSec: number;
  zombieSpeedKph: number;
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
  startSec: number;
  endSec: number;
  /** Índice del segmento en el programa original. */
  sourceIndex: number;
  waveNumber?: number;
  waveTotal?: number;
}

export function expandProgram(program: TrainingProgram): ExpandedSegment[] {
  const flat: Array<SpeedSegment & { sourceIndex: number }> = [];

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
        block.forEach((s, j) => {
          flat.push({ ...(s as SpeedSegment), sourceIndex: seg.fromIndex + j });
        });
      }
    } else {
      if (!(seg.durationSec > 0)) {
        throw new Error(`programa ${program.id}, segmento ${i}: durationSec debe ser > 0`);
      }
      flat.push({ ...seg, sourceIndex: i });
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
