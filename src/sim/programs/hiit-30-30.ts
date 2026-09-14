import type { TrainingProgram } from '../program';

// Oleadas: la horda carga en Z5 y te deja recuperar en Z1-Z2. Pasarse en la
// recuperación no da ventaja: el descanso también es la prescripción.
export const HIIT_30_30: TrainingProgram = {
  id: 'hiit-30-30',
  name: 'Oleadas',
  target: 'anaerobic',
  segments: [
    { kind: 'warmup', durationSec: 300, zone: [0, 2], cueResistance: 2 },
    { kind: 'surge', durationSec: 30, zone: 5 },
    { kind: 'recover', durationSec: 90, zone: [1, 2] },
    { kind: 'repeat', times: 8, fromIndex: 1 },
  ],
};
