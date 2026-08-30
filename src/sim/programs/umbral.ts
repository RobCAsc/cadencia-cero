import type { TrainingProgram } from '../program';

// Sesión de umbral del contrato: un perseguidor sosteniendo presión 20 minutos.
export const UMBRAL: TrainingProgram = {
  id: 'umbral',
  name: 'Umbral',
  target: 'threshold',
  segments: [
    { kind: 'warmup', durationSec: 300, zombieSpeedKph: 14, cueResistance: 2 },
    { kind: 'steady', durationSec: 1200, zombieSpeedKph: 24, cueResistance: 4 },
    { kind: 'cooldown', durationSec: 180, zombieSpeedKph: 10 },
  ],
};
