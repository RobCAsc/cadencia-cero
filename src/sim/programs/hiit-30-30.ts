import type { TrainingProgram } from '../program';

// El programa hardcodeado de Fase 0, con la misma forma que el JSON de Fase 2.
export const HIIT_30_30: TrainingProgram = {
  id: 'hiit-30-30',
  name: 'Oleadas',
  target: 'anaerobic',
  segments: [
    { kind: 'warmup', durationSec: 300, zombieSpeedKph: 14, cueResistance: 2 },
    { kind: 'surge', durationSec: 30, zombieSpeedKph: 32 },
    { kind: 'recover', durationSec: 90, zombieSpeedKph: 12 },
    { kind: 'repeat', times: 8, fromIndex: 1 },
  ],
};
