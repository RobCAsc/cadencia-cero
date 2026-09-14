import type { TrainingProgram } from '../program';

// La salida de quien empieza: doce minutos en Z1 con un empujón a Z2 en el
// medio para probar que el gap responde. Corta y amable, pero viva: la horda
// va a un ritmo que hay que sostener, no a uno que cualquier pedaleo deja
// atrás. El objetivo no es el estímulo, es volver mañana con ganas.
export const PRIMERA_SALIDA: TrainingProgram = {
  id: 'primera-salida',
  name: 'Primera salida',
  target: 'starter',
  segments: [
    { kind: 'warmup', durationSec: 180, zone: [0, 1], cueResistance: 1 },
    { kind: 'steady', durationSec: 240, zone: 1, cueResistance: 2 },
    { kind: 'steady', durationSec: 60, zone: 2 },
    { kind: 'steady', durationSec: 120, zone: 1 },
    { kind: 'cooldown', durationSec: 120, zone: [0, 1] },
  ],
};
