import type { TrainingProgram } from '../program';

// Intervalos en pirámide: oleadas que crecen 30-60-90 y bajan, menos zona
// cuanto más largas. Sin repeat: el perfil se escribe a mano.
export const PIRAMIDE: TrainingProgram = {
  id: 'piramide',
  name: 'Pirámide',
  target: 'mixed',
  segments: [
    { kind: 'warmup', durationSec: 300, zone: [0, 2], cueResistance: 2 },
    { kind: 'surge', durationSec: 30, zone: 5 },
    { kind: 'recover', durationSec: 60, zone: [1, 2] },
    { kind: 'surge', durationSec: 60, zone: [4, 5] },
    { kind: 'recover', durationSec: 90, zone: [1, 2] },
    { kind: 'surge', durationSec: 90, zone: 4 },
    { kind: 'recover', durationSec: 120, zone: [1, 2] },
    { kind: 'surge', durationSec: 60, zone: [4, 5] },
    { kind: 'recover', durationSec: 90, zone: [1, 2] },
    { kind: 'surge', durationSec: 30, zone: 5 },
    { kind: 'cooldown', durationSec: 180, zone: [0, 1] },
  ],
};
