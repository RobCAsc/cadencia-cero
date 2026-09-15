import type { TrainingProgram } from '../program';

// Fuerza sin sensor: cuatro cuestas de tres minutos en Z2-Z3 con la consigna
// de subir resistencia y bajar cadencia, y llanos de dos minutos en Z1-Z2 para
// girar ligero. El pulso sigue mandando (la horda corre por la zona); la
// resistencia es una consigna que el rider cumple con la mano, porque la bici
// no la sabe medir. Es el estímulo muscular que un plan solo de pulso no da.
export const CUESTAS: TrainingProgram = {
  id: 'cuestas',
  name: 'Cuestas',
  target: 'strength',
  segments: [
    { kind: 'warmup', durationSec: 300, zone: [0, 2], cueResistance: 2 },
    {
      kind: 'steady',
      durationSec: 180,
      zone: [2, 3],
      cueResistance: 5,
      cue: 'Cuesta: sube resistencia, cadencia baja',
    },
    { kind: 'recover', durationSec: 120, zone: [1, 2], cueResistance: 2, cue: 'Llano: baja resistencia, gira ligero' },
    { kind: 'repeat', times: 4, fromIndex: 1 },
    { kind: 'cooldown', durationSec: 180, zone: [0, 1] },
  ],
};
