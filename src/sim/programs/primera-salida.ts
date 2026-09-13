import type { TrainingProgram } from '../program';

// La salida de quien empieza: doce minutos, horda muy lenta, un solo empujón
// suave en el medio para probar que el gap responde. El objetivo no es el
// estímulo, es volver mañana.
export const PRIMERA_SALIDA: TrainingProgram = {
  id: 'primera-salida',
  name: 'Primera salida',
  target: 'starter',
  segments: [
    { kind: 'warmup', durationSec: 180, zombieSpeedKph: 7, cueResistance: 1 },
    { kind: 'steady', durationSec: 240, zombieSpeedKph: 10, cueResistance: 2 },
    { kind: 'steady', durationSec: 60, zombieSpeedKph: 13 },
    { kind: 'steady', durationSec: 120, zombieSpeedKph: 10 },
    { kind: 'cooldown', durationSec: 120, zombieSpeedKph: 6 },
  ],
};
