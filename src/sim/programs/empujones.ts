import type { TrainingProgram } from '../program';

// Los primeros esfuerzos de quien ya tiene dos semanas de base: dos minutos
// en Z3, tres veces, con dos de recuperación. La horda aprieta pero no
// sprinta; el objetivo es enseñar al cuerpo (y al rider) a subir y bajar.
export const EMPUJONES: TrainingProgram = {
  id: 'empujones',
  name: 'Empujones',
  target: 'tempo',
  segments: [
    { kind: 'warmup', durationSec: 300, zone: [0, 2], cueResistance: 2 },
    { kind: 'surge', durationSec: 120, zone: 3 },
    { kind: 'recover', durationSec: 120, zone: [1, 2] },
    { kind: 'repeat', times: 3, fromIndex: 1 },
    { kind: 'cooldown', durationSec: 120, zone: [0, 1] },
  ],
};
