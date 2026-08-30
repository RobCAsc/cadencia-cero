import type { TrainingProgram } from '../program';

// Base aerobia: ritmo sostenido con un tramo de tempo en el medio.
export const FONDO: TrainingProgram = {
  id: 'fondo',
  name: 'Fondo',
  target: 'aerobic',
  segments: [
    { kind: 'warmup', durationSec: 300, zombieSpeedKph: 12, cueResistance: 2 },
    { kind: 'steady', durationSec: 600, zombieSpeedKph: 16, cueResistance: 3 },
    { kind: 'steady', durationSec: 300, zombieSpeedKph: 19 },
    { kind: 'steady', durationSec: 600, zombieSpeedKph: 16 },
    { kind: 'cooldown', durationSec: 180, zombieSpeedKph: 10 },
  ],
};
