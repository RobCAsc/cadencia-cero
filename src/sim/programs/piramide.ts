import type { TrainingProgram } from '../program';

// Intervalos en pirámide: oleadas que crecen 30-60-90 y bajan, menos pico
// cuanto más largas. Sin repeat: el perfil se escribe a mano.
export const PIRAMIDE: TrainingProgram = {
  id: 'piramide',
  name: 'Pirámide',
  target: 'mixed',
  segments: [
    { kind: 'warmup', durationSec: 300, zombieSpeedKph: 14, cueResistance: 2 },
    { kind: 'surge', durationSec: 30, zombieSpeedKph: 30 },
    { kind: 'recover', durationSec: 60, zombieSpeedKph: 12 },
    { kind: 'surge', durationSec: 60, zombieSpeedKph: 28 },
    { kind: 'recover', durationSec: 90, zombieSpeedKph: 12 },
    { kind: 'surge', durationSec: 90, zombieSpeedKph: 26 },
    { kind: 'recover', durationSec: 120, zombieSpeedKph: 12 },
    { kind: 'surge', durationSec: 60, zombieSpeedKph: 28 },
    { kind: 'recover', durationSec: 90, zombieSpeedKph: 12 },
    { kind: 'surge', durationSec: 30, zombieSpeedKph: 30 },
    { kind: 'cooldown', durationSec: 180, zombieSpeedKph: 10 },
  ],
};
