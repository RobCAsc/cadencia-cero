import type { TrainingProgram } from '../program';
import { CUESTAS } from './cuestas';
import { EMPUJONES } from './empujones';
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
 * - 'mainMin': duración total de los tramos 'steady', en minutos, escalados
 *   en proporción (así el plan acorta o alarga una salida sin reescribirla).
 */
export interface AdjustmentSpec {
  id: 'repeats' | 'warmupMin' | 'mainMin';
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

const mainMin = (defaultValue: number, min: number, max: number): AdjustmentSpec => ({
  id: 'mainMin',
  label: 'Tramo principal',
  min,
  max,
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
    adjustments: [warmupMin(3), mainMin(15, 8, 30)],
  },
  {
    program: FONDO,
    description: 'Ritmo aerobio sostenido con un tramo de tempo al medio.',
    adjustments: [warmupMin(5), mainMin(25, 10, 45)],
  },
  {
    program: CUESTAS,
    description: 'Cuatro cuestas: resistencia arriba, cadencia baja. Fuerza en Z2-Z3.',
    adjustments: [
      { id: 'repeats', label: 'Cuestas', min: 3, max: 6, step: 1, defaultValue: 4, unit: '' },
      warmupMin(5),
      // El único 'steady' es la cuesta: mainMin es la duración de cada una.
      { id: 'mainMin', label: 'Cada cuesta', min: 2, max: 5, step: 1, defaultValue: 3, unit: 'min' },
    ],
  },
  {
    program: EMPUJONES,
    description: 'Dos minutos en Z3, tres veces. Los primeros esfuerzos.',
    adjustments: [
      { id: 'repeats', label: 'Empujones', min: 2, max: 6, step: 1, defaultValue: 3, unit: '' },
      warmupMin(5),
    ],
  },
  {
    program: UMBRAL,
    description: 'Un perseguidor sosteniendo presión veinte minutos.',
    adjustments: [warmupMin(5), mainMin(20, 10, 30)],
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
    } else if (spec.id === 'mainMin') {
      const steadySec = segments.reduce(
        (acc, segment) => acc + (segment.kind === 'steady' ? segment.durationSec : 0),
        0,
      );
      if (steadySec > 0) {
        const factor = (value * 60) / steadySec;
        segments = segments.map((segment) =>
          segment.kind === 'steady'
            ? { ...segment, durationSec: Math.round(segment.durationSec * factor) }
            : segment,
        );
      }
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
