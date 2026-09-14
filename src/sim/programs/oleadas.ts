import type { TrainingProgram } from '../program';

// Oleadas: la horda carga un minuto en Z4-Z5 y te deja recuperar dos en Z1-Z2.
// Un minuto y no treinta segundos a propósito: un pulso de muñeca tarda
// 10-30 s en reflejar el esfuerzo, y una oleada más corta no se puede juzgar.
// Pasarse en la recuperación no da ventaja: el descanso también es la
// prescripción.
export const OLEADAS: TrainingProgram = {
  id: 'oleadas',
  name: 'Oleadas',
  target: 'anaerobic',
  segments: [
    { kind: 'warmup', durationSec: 300, zone: [0, 2], cueResistance: 2 },
    { kind: 'surge', durationSec: 60, zone: [4, 5] },
    { kind: 'recover', durationSec: 120, zone: [1, 2] },
    { kind: 'repeat', times: 6, fromIndex: 1 },
  ],
};
