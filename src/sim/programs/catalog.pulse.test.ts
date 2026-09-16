import { describe, expect, it } from 'vitest';
import type { TrainingProgram } from '../program';
import { playerSpeedFromEffort } from '../effortTable';
import { rideWithLaggedPulse } from '../modelRider';
import { floorEffort, zoneRange } from '../zones';
import { applyAdjustments, PROGRAM_CATALOG } from './catalog';

// El rider modelo (src/sim/modelRider.ts) con pulso de muñeca: sigue la zona
// prescrita, empieza a empujar cuando el juego avisa el tramo duro, y su
// pulso responde con retraso (τ 20 s al subir, 35 s al bajar). Ningún
// programa del catálogo debe atraparlo: si lo hace, el programa pide algo que
// un sensor óptico no puede reflejar a tiempo, y hay que retunear el
// programa, no al rider. Y al revés: quien no empuja en las oleadas TIENE que
// ser atrapado, o la prescripción de intervalos no existe. Estas dos cosas
// juntas fijan el tope del colchón (gapMaxM) y las rampas: si cambian los
// tunables, este archivo lo dice.

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
