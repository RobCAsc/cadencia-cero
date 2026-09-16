import { SIM, type SimConfig } from '../config';
import { expandProgram, segmentIndexAt, type ExpandedSegment, type TrainingProgram } from './program';
import { RideSim } from './RideSim';
import type { RideSummary } from './types';
import { ceilingEffort, floorEffort } from './zones';

// El rider modelo con pulso de muñeca: sigue la zona prescrita, empieza a
// empujar cuando el juego avisa el tramo duro, y su pulso responde con
// retraso (τ 20 s al subir, 35 s al bajar). Es el juez de los programas: el
// test guardián lo pasa por todo el catálogo, y el editor de salidas lo pasa
// por lo que el rider diseña antes de dejarle guardarlo.

export const MODEL_RIDER = { hrMaxBpm: 185, hrRestBpm: 60 };
const TAU_UP_SEC = 20;
const TAU_DOWN_SEC = 35;

/** Apunta al centro de la zona prescrita (Z5 no tiene techo: 90-100 %). */
function targetEffort(seg: ExpandedSegment): number {
  const lo = floorEffort(seg.zoneMin);
  const hi = Math.min(1, ceilingEffort(seg.zoneMax));
  return (lo + hi) / 2;
}

export interface RiderModel {
  /** Puntos de esfuerzo por debajo del centro de la zona, siempre. */
  shortfall?: number;
  /** Esfuerzo fijo, ignorando el programa (quien no empuja en las oleadas). */
  flat?: number;
  cfg?: Partial<SimConfig>;
}

export interface ModelOutcome {
  summary: RideSummary;
  minGapM: number;
  inZoneFrac: number;
}

export function rideWithLaggedPulse(program: TrainingProgram, model: RiderModel = {}): ModelOutcome {
  const cfg: SimConfig = { ...SIM, ...model.cfg };
  const dt = cfg.maxDtSec;
  const segments = expandProgram(program);
  const totalSec = segments[segments.length - 1]?.endSec ?? 0;
  let clockMs = 0;
  const sim = new RideSim(program, cfg, () => clockMs, { inputMode: 'heartRate', rider: MODEL_RIDER });
  let effort = 0.15; // sentado en la bici, pulso apenas sobre el reposo
  let minGapM = Number.POSITIVE_INFINITY;

  for (let t = 0; t <= totalSec + 2; t += dt) {
    const i = segmentIndexAt(segments, t);
    const cur = segments[i]!;
    const next = segments[i + 1];
    // Anticipación: cuando el juego avisa un tramo más duro, el rider ya apunta a él.
    const aim =
      next && next.zombieSpeedKph > cur.zombieSpeedKph && cur.endSec - t <= cfg.surgeWarningSec
        ? next
        : cur;
    const target = model.flat ?? Math.max(0, targetEffort(aim) - (model.shortfall ?? 0));
    const tau = target > effort ? TAU_UP_SEC : TAU_DOWN_SEC;
    effort += (target - effort) * (1 - Math.exp(-dt / tau));

    clockMs += dt * 1000;
    sim.pushHeartRate({
      bpm: MODEL_RIDER.hrRestBpm + effort * (MODEL_RIDER.hrMaxBpm - MODEL_RIDER.hrRestBpm),
      timestampMs: clockMs,
    });
    const events = sim.update(dt);
    minGapM = Math.min(minGapM, sim.state.gapM);
    const finished = events.find((e) => e.type === 'finished');
    if (finished?.type === 'finished') {
      return {
        summary: finished.summary,
        minGapM,
        inZoneFrac: finished.summary.inZoneSec / finished.summary.durationSec,
      };
    }
  }
  throw new Error(`${program.id}: el programa no terminó`);
}
