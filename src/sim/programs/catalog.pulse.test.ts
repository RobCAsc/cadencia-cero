import { describe, expect, it } from 'vitest';
import { SIM, type SimConfig } from '../../config';
import { expandProgram, segmentIndexAt, type ExpandedSegment, type TrainingProgram } from '../program';
import { playerSpeedFromEffort } from '../effortTable';
import { RideSim } from '../RideSim';
import type { RideSummary } from '../types';
import { ceilingEffort, floorEffort, zoneRange } from '../zones';
import { applyAdjustments, PROGRAM_CATALOG } from './catalog';

// Un rider modelo con pulso de muñeca: sigue la zona prescrita, empieza a
// empujar cuando el juego avisa el tramo duro, y su pulso responde con retraso
// (τ 20 s al subir, 35 s al bajar). Ningún programa del catálogo debe
// atraparlo: si lo hace, el programa pide algo que un sensor óptico no puede
// reflejar a tiempo, y hay que retunear el programa, no al rider. Y al revés:
// quien no empuja en las oleadas TIENE que ser atrapado, o la prescripción de
// intervalos no existe. Estas dos cosas juntas fijan el tope del colchón
// (gapMaxM) y las rampas: si cambian los tunables, este archivo lo dice.

const rider = { hrMaxBpm: 185, hrRestBpm: 60 };
const TAU_UP_SEC = 20;
const TAU_DOWN_SEC = 35;
const DT = SIM.maxDtSec;

/** Apunta al centro de la zona prescrita (Z5 no tiene techo: 90-100 %). */
function targetEffort(seg: ExpandedSegment): number {
  const lo = floorEffort(seg.zoneMin);
  const hi = Math.min(1, ceilingEffort(seg.zoneMax));
  return (lo + hi) / 2;
}

interface RiderModel {
  /** Puntos de esfuerzo por debajo del centro de la zona, siempre. */
  shortfall?: number;
  /** Esfuerzo fijo, ignorando el programa (quien no empuja en las oleadas). */
  flat?: number;
  cfg?: Partial<SimConfig>;
}

interface Outcome {
  summary: RideSummary;
  minGapM: number;
  inZoneFrac: number;
}

function rideWithLaggedPulse(program: TrainingProgram, model: RiderModel = {}): Outcome {
  const cfg: SimConfig = { ...SIM, ...model.cfg };
  const segments = expandProgram(program);
  const totalSec = segments[segments.length - 1]?.endSec ?? 0;
  let clockMs = 0;
  const sim = new RideSim(program, cfg, () => clockMs, { inputMode: 'heartRate', rider });
  let effort = 0.15; // sentado en la bici, pulso apenas sobre el reposo
  let minGapM = Number.POSITIVE_INFINITY;

  for (let t = 0; t <= totalSec + 2; t += DT) {
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
    effort += (target - effort) * (1 - Math.exp(-DT / tau));

    clockMs += DT * 1000;
    sim.pushHeartRate({
      bpm: rider.hrRestBpm + effort * (rider.hrMaxBpm - rider.hrRestBpm),
      timestampMs: clockMs,
    });
    const events = sim.update(DT);
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

const catalogProgram = (id: string): TrainingProgram => {
  const entry = PROGRAM_CATALOG.find((e) => e.program.id === id);
  if (!entry) throw new Error(`falta ${id}`);
  return applyAdjustments(entry.program, entry.adjustments, {});
};

describe('el catálogo con un pulso de muñeca que responde con retraso', () => {
  for (const entry of PROGRAM_CATALOG) {
    it(`${entry.program.name}: un rider que sigue la zona nunca es atrapado`, () => {
      const out = rideWithLaggedPulse(catalogProgram(entry.program.id));
      expect(out.summary.timesCaught).toBe(0);
      expect(out.minGapM).toBeGreaterThan(30);
      expect(out.inZoneFrac).toBeGreaterThan(0.5);
    });
  }

  it('quien se queda en Z2 y no empuja en las oleadas es atrapado en Oleadas', () => {
    const out = rideWithLaggedPulse(catalogProgram('oleadas'), { flat: 0.65 });
    expect(out.summary.timesCaught).toBeGreaterThan(0);
  });

  it('quien va quince puntos por debajo de la zona todo el rato es atrapado en Oleadas', () => {
    const out = rideWithLaggedPulse(catalogProgram('oleadas'), { shortfall: 0.15 });
    expect(out.summary.timesCaught).toBeGreaterThan(0);
  });

  it('quien se queda en Z2 es atrapado también en Pirámide', () => {
    const out = rideWithLaggedPulse(catalogProgram('piramide'), { flat: 0.65 });
    expect(out.summary.timesCaught).toBeGreaterThan(0);
  });

  it('con la horda en el piso de la zona y el tope antiguo de 150 m, saltarse las oleadas salía gratis (documenta por qué existen la fracción y el tope)', () => {
    const base = catalogProgram('oleadas');
    const atFloor: TrainingProgram = {
      ...base,
      segments: base.segments.map((seg) =>
        seg.kind === 'repeat'
          ? seg
          : { ...seg, zombieSpeedKph: playerSpeedFromEffort(floorEffort(zoneRange(seg.zone)[0])) },
      ),
    };
    const out = rideWithLaggedPulse(atFloor, { flat: 0.65, cfg: { gapMaxM: 150, hordeWakeSec: 0 } });
    expect(out.summary.timesCaught).toBe(0);
  });
});
