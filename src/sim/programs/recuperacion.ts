import type { TrainingProgram } from '../program';

// Rodaje regenerativo: Z1 y nada más. Subir de zona aquí no suma ventaja.
export const RECUPERACION: TrainingProgram = {
  id: 'recuperacion',
  name: 'Recuperación',
  target: 'recovery',
  segments: [
    { kind: 'warmup', durationSec: 180, zone: [0, 1], cueResistance: 1 },
    { kind: 'steady', durationSec: 900, zone: 1, cueResistance: 2 },
    { kind: 'cooldown', durationSec: 120, zone: 0 },
  ],
};
