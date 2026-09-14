import type { TrainingProgram } from '../program';

// La salida de quien empieza: doce minutos entre suave y Z1, con un solo
// empujón a Z1-Z2 en el medio para probar que el gap responde. El objetivo
// no es el estímulo, es volver mañana.
export const PRIMERA_SALIDA: TrainingProgram = {
  id: 'primera-salida',
  name: 'Primera salida',
  target: 'starter',
  segments: [
    { kind: 'warmup', durationSec: 180, zone: [0, 1], cueResistance: 1 },
    { kind: 'steady', durationSec: 240, zone: [0, 1], cueResistance: 2 },
    { kind: 'steady', durationSec: 60, zone: [1, 2] },
    { kind: 'steady', durationSec: 120, zone: [0, 1] },
    { kind: 'cooldown', durationSec: 120, zone: 0 },
  ],
};
