import type { TrainingProgram } from '../program';

// Sesión de umbral: un perseguidor sosteniendo presión veinte minutos en Z3-Z4.
export const UMBRAL: TrainingProgram = {
  id: 'umbral',
  name: 'Umbral',
  target: 'threshold',
  segments: [
    { kind: 'warmup', durationSec: 300, zone: [0, 2], cueResistance: 2 },
    { kind: 'steady', durationSec: 1200, zone: [3, 4], cueResistance: 4 },
    { kind: 'cooldown', durationSec: 180, zone: [0, 1] },
  ],
};
