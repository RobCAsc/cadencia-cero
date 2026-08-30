import type { TrainingProgram } from '../program';

// Rodaje regenerativo: perseguidor lento y lejano, presión mínima constante.
export const RECUPERACION: TrainingProgram = {
  id: 'recuperacion',
  name: 'Recuperación',
  target: 'recovery',
  segments: [
    { kind: 'warmup', durationSec: 180, zombieSpeedKph: 9, cueResistance: 1 },
    { kind: 'steady', durationSec: 900, zombieSpeedKph: 12, cueResistance: 2 },
    { kind: 'cooldown', durationSec: 120, zombieSpeedKph: 8 },
  ],
};
