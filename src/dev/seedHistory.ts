import type { SessionRecord } from '../sim/history';
import { weekStartMs } from '../sim/progress';

// Historial de mentira para ver el campamento poblado sin pedalear cinco
// semanas: tres salidas por semana, una semana floja en medio (para ver el
// perdón de la racha), reposo que baja poco a poco. Solo desde el panel dev.

const DAY = 86_400_000;

interface Template {
  programId: string;
  programName: string;
  target: string;
  durationSec: number;
  kph: number;
  zoneWeights: number[];
  timesCaught: number;
}

const TEMPLATES: Template[] = [
  { programId: 'fondo', programName: 'Fondo', target: 'aerobic', durationSec: 1980, kph: 17, zoneWeights: [1, 2, 6, 3, 0, 0], timesCaught: 1 },
  { programId: 'oleadas', programName: 'Oleadas', target: 'anaerobic', durationSec: 1380, kph: 19, zoneWeights: [1, 2, 3, 3, 2, 1], timesCaught: 3 },
  { programId: 'recuperacion', programName: 'Recuperación', target: 'recovery', durationSec: 1200, kph: 13, zoneWeights: [3, 5, 3, 0, 0, 0], timesCaught: 0 },
];

function record(startedAtMs: number, t: Template, restBpm: number, seed: number, progress01: number): SessionRecord {
  const wsum = t.zoneWeights.reduce((a, b) => a + b, 0);
  const zoneSec = t.zoneWeights.map((w) => (t.durationSec * w) / wsum);
  const wobble = 0.9 + ((seed * 37) % 20) / 100; // 0.9..1.1 determinista
  const hasSurges = t.programId === 'oleadas';
  return {
    // Los tres números de forma mejoran con las semanas: reposo baja,
    // recuperación sube, precisión de zona sube.
    preRideRestBpm: Math.round(restBpm + 5 - progress01 * 3 + ((seed * 13) % 3)),
    ...(hasSurges ? { recoveryDrops: [12, 14, 15].map((d) => Math.round(d + progress01 * 9 + ((seed * 7) % 3))) } : {}),
    inZoneSec: Math.round(t.durationSec * (0.55 + progress01 * 0.3)),
    id: `${startedAtMs}-${t.programId}`,
    startedAtMs,
    programId: t.programId,
    programName: t.programName,
    target: t.target,
    inputMode: 'heartRate',
    completed: true,
    plannedSec: t.durationSec,
    durationSec: t.durationSec,
    distanceM: (t.kph * wobble * t.durationSec) / 3.6,
    timesCaught: t.timesCaught,
    avgHeartRateBpm: 128 + (seed % 9),
    peakHeartRateBpm: 158 + (seed % 12),
    avgEffortFrac: 0.6,
    zoneSec,
    hrRestBpm: restBpm,
  };
}

/**
 * Cinco semanas de calendario hacia atrás más la actual: lunes, miércoles y
 * viernes a las 9; la de hace dos semanas solo tiene el lunes (para ver el
 * perdón de la racha) y de la actual solo entran los días ya pasados.
 */
export function seedHistory(nowMs: number): SessionRecord[] {
  const out: SessionRecord[] = [];
  let seed = 1;
  for (let weeksAgo = 5; weeksAgo >= 0; weeksAgo--) {
    const weekStart = weekStartMs(nowMs) - weeksAgo * 7 * DAY;
    const rides = weeksAgo === 2 ? 1 : 3;
    const restBpm = 66 - (5 - weeksAgo);
    for (let r = 0; r < rides; r++) {
      const startedAtMs = weekStart + r * 2 * DAY + 9 * 3_600_000;
      if (startedAtMs > nowMs) continue;
      out.push(record(startedAtMs, TEMPLATES[r % TEMPLATES.length]!, restBpm, seed++, (5 - weeksAgo) / 5));
    }
  }
  return out.sort((a, b) => a.startedAtMs - b.startedAtMs);
}
