import { describe, expect, it } from 'vitest';
import {
  describeEncounter,
  ENCOUNTER_KINDS,
  ENCOUNTER_SPECS,
  encounterWindows,
  PLAN_DEFAULTS,
  planEncounter,
} from './encounters';
import { expandProgram, type TrainingProgram } from './program';
import { OLEADAS } from './programs/oleadas';
import { FONDO } from './programs/fondo';

/** LCG con la semilla dispersada: con semillas pequeñas y seguidas la primera tirada sale siempre baja. */
function lcg(seed: number): () => number {
  let s = Math.imul(seed, 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Un rnd que devuelve la secuencia dada y luego 0.5. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++]! : 0.5);
}

const oleadas = expandProgram(OLEADAS);
const fondo = expandProgram(FONDO);

describe('los encuentros de la carretera', () => {
  it('la mitad de las salidas no tienen ninguno, y la otra mitad uno', () => {
    expect(planEncounter(oleadas, seq(0.6))).toBeUndefined();
    expect(planEncounter(oleadas, seq(0.4))).toBeDefined();
    expect(planEncounter([], seq(0))).toBeUndefined();
  });

  it('nunca cae en una oleada ni en sus 15 s de aviso, ni en el arranque ni en el final', () => {
    const total = oleadas[oleadas.length - 1]!.endSec;
    let planned = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const plan = planEncounter(oleadas, lcg(seed));
      if (!plan) continue;
      planned++;
      const end = plan.atSec + ENCOUNTER_SPECS[plan.kind].durationSec;
      expect(plan.atSec).toBeGreaterThanOrEqual(PLAN_DEFAULTS.startQuietSec);
      expect(end).toBeLessThanOrEqual(total - PLAN_DEFAULTS.endQuietSec);
      for (const seg of oleadas) {
        if (seg.kind !== 'surge') continue;
        // Ni dentro de la oleada ni empezando en los 15 s antes.
        const forbiddenFrom = seg.startSec - PLAN_DEFAULTS.warningSec;
        const overlaps = plan.atSec < seg.endSec && end > forbiddenFrom;
        expect(overlaps, `${plan.kind} en ${plan.atSec}s pisa la oleada de ${seg.startSec}s`).toBe(false);
      }
    }
    expect(planned).toBeGreaterThan(150);
    expect(planned).toBeLessThan(250);
  });

  it('con el tiempo todos los tipos salen', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 600; seed++) {
      const plan = planEncounter(fondo, lcg(seed));
      if (plan) seen.add(plan.kind);
    }
    expect([...seen].sort()).toEqual([...ENCOUNTER_KINDS].sort());
  });

  it('las luciérnagas solo en tramos suaves; sin tramo suave, no hay luciérnagas', () => {
    for (const w of encounterWindows('fireflies', oleadas)) {
      const seg = oleadas.find((s) => w.fromSec >= s.startSec && w.fromSec < s.endSec)!;
      expect(seg.zoneMax).toBeLessThanOrEqual(2);
    }
    const hard: TrainingProgram = {
      id: 'x',
      name: 'x',
      target: 'aerobic',
      segments: [{ kind: 'steady', durationSec: 1200, zone: 3 }],
    };
    expect(encounterWindows('fireflies', expandProgram(hard))).toEqual([]);
    expect(encounterWindows('deer', expandProgram(hard)).length).toBe(1);
  });

  it('los murciélagos y la lluvia de estrellas solo con la noche cerrada', () => {
    const total = fondo[fondo.length - 1]!.endSec;
    for (const kind of ['bats', 'meteors'] as const) {
      const windows = encounterWindows(kind, fondo);
      expect(windows.length).toBeGreaterThan(0);
      for (const w of windows) {
        expect(w.fromSec).toBeGreaterThanOrEqual(PLAN_DEFAULTS.night[0] * total);
        expect(w.toSec + ENCOUNTER_SPECS[kind].durationSec).toBeLessThanOrEqual(PLAN_DEFAULTS.night[1] * total);
      }
    }
  });

  it('un encuentro largo no cabe en una salida corta', () => {
    const short: TrainingProgram = {
      id: 's',
      name: 's',
      target: 'aerobic',
      segments: [
        { kind: 'warmup', durationSec: 60, zone: [0, 1] },
        { kind: 'cooldown', durationSec: 60, zone: [0, 1] },
      ],
    };
    const segments = expandProgram(short);
    expect(encounterWindows('train', segments)).toEqual([]);
    expect(encounterWindows('horses', segments)).toEqual([]);
    expect(encounterWindows('dog', segments)).toEqual([]);
    expect(encounterWindows('owl', segments).length).toBeGreaterThan(0);
  });

  it('el resumen lo cuenta con el km de la Ruta', () => {
    expect(describeEncounter('deer', 104.26)).toBe('Un ciervo cruzó la carretera en el km 104,3');
    expect(describeEncounter('train', 12)).toContain('km 12,0');
    expect(describeEncounter('dog', 3)).toBe('Un perro te salió al paso en el km 3,0');
    expect(describeEncounter('horses', 3)).toBe('Una manada de caballos al galope en el km 3,0');
  });
});
