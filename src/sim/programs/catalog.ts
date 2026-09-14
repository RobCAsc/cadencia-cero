import type { TrainingProgram } from '../program';
import { FONDO } from './fondo';
import { OLEADAS } from './oleadas';
import { PIRAMIDE } from './piramide';
import { PRIMERA_SALIDA } from './primera-salida';
import { RECUPERACION } from './recuperacion';
import { UMBRAL } from './umbral';

/**
 * Ajustes ligeros por programa: perillas acotadas sobre el JSON base, no un
 * editor. La semántica es genérica por id:
 * - 'repeats': ejecuciones totales de los bloques repeat del programa.
 * - 'warmupMin': duración del calentamiento, en minutos.
 */
export interface AdjustmentSpec {
  id: 'repeats' | 'warmupMin';
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit: string;
}

export interface CatalogEntry {
  program: TrainingProgram;
  /** Una línea para la tarjeta del selector. */
  description: string;
  adjustments: readonly AdjustmentSpec[];
}

const warmupMin = (defaultValue: number): AdjustmentSpec => ({
  id: 'warmupMin',
  label: 'Calentamiento',
  min: 2,
  max: 10,
  step: 1,
  defaultValue,
  unit: 'min',
});

export const PROGRAM_CATALOG: readonly CatalogEntry[] = [
  {
    program: PRIMERA_SALIDA,
    description: 'Doce minutos para conocer la bici y la horda. Sin oleadas.',
    adjustments: [],
  },
  {
    program: RECUPERACION,
    description: 'Gira las piernas con la horda lejos. Sin exigencia.',
    adjustments: [warmupMin(3)],
  },
  {
    program: FONDO,
    description: 'Ritmo aerobio sostenido con un tramo de tempo al medio.',
    adjustments: [warmupMin(5)],
  },
  {
    program: UMBRAL,
    description: 'Un perseguidor sosteniendo presión veinte minutos.',
    adjustments: [warmupMin(5)],
  },
  {
    program: OLEADAS,
    description: 'La horda carga un minuto en Z4-Z5; recuperas dos. Anaerobio.',
    adjustments: [
      { id: 'repeats', label: 'Oleadas', min: 3, max: 10, step: 1, defaultValue: 6, unit: '' },
      warmupMin(5),
    ],
  },
  {
    program: PIRAMIDE,
    description: 'Oleadas que crecen 1-1½-2 min y bajan. Intervalos mixtos.',
    adjustments: [warmupMin(5)],
  },
];

/**
 * Aplica los ajustes al programa base y devuelve un programa nuevo (el base no
 * se muta). Valores fuera de rango se clampan y se snapean al step; ids que el
 * programa no usa se ignoran.
 */
export function applyAdjustments(
  program: TrainingProgram,
  specs: readonly AdjustmentSpec[],
  values: Readonly<Record<string, number>>,
): TrainingProgram {
  let segments = program.segments.map((segment) => ({ ...segment }));

  for (const spec of specs) {
    const raw = values[spec.id] ?? spec.defaultValue;
    const snapped = Math.round((raw - spec.min) / spec.step) * spec.step + spec.min;
    const value = Math.min(spec.max, Math.max(spec.min, snapped));

    if (spec.id === 'repeats') {
      segments = segments.map((segment) =>
        segment.kind === 'repeat' ? { ...segment, times: value } : segment,
      );
    } else {
      const index = segments.findIndex((segment) => segment.kind === 'warmup');
      const warmup = segments[index];
      if (warmup && warmup.kind === 'warmup') {
        segments[index] = { ...warmup, durationSec: value * 60 };
      }
    }
  }

  return { ...program, segments };
}
