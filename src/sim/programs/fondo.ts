import type { TrainingProgram } from '../program';

// Base aerobia: Z2 sostenida con un tramo de tempo en Z3 al medio.
export const FONDO: TrainingProgram = {
  id: 'fondo',
  name: 'Fondo',
  target: 'aerobic',
  segments: [
    { kind: 'warmup', durationSec: 300, zone: [0, 1], cueResistance: 2 },
    { kind: 'steady', durationSec: 600, zone: 2, cueResistance: 3 },
    { kind: 'steady', durationSec: 300, zone: 3 },
    { kind: 'steady', durationSec: 600, zone: 2 },
    { kind: 'cooldown', durationSec: 180, zone: [0, 1] },
  ],
};
