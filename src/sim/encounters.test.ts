import { describe, expect, it } from 'vitest';
import {
  describeEncounter,
  describeEncounters,
  ENCOUNTER_KINDS,
  ENCOUNTER_SPECS,
  encounterWindows,
  PLAN_DEFAULTS,
  planRide,
  type EncounterKind,
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

const oleadas = expandProgram(OLEADAS);
const fondo = expandProgram(FONDO);
/** Una salida normal de 35 minutos: calentamiento, fondo largo y vuelta a la calma. */
const ride35 = expandProgram({
  id: 'r35',
  name: 'r35',
  target: 'aerobic',
  segments: [
    { kind: 'warmup', durationSec: 300, zone: [0, 2] },
    { kind: 'steady', durationSec: 1500, zone: 2 },
    { kind: 'cooldown', durationSec: 300, zone: [0, 1] },
  ],
});
const tenMinutes = expandProgram({
  id: 'ten',
  name: 'ten',
  target: 'aerobic',
  segments: [
    { kind: 'warmup', durationSec: 180, zone: [0, 1] },
    { kind: 'steady', durationSec: 420, zone: 2 },
  ],
});

describe('los encuentros de la carretera', () => {
  it('cada salida saca varios de la bolsa según lo que dura, sin repetir; lo que no sale se queda', () => {
    const plan = planRide(ride35, lcg(7), undefined);
    expect(plan.encounters.length).toBe(5);
    expect(new Set(plan.encounters.map((e) => e.kind)).size).toBe(5);
    expect(plan.bag.length).toBe(ENCOUNTER_KINDS.length - 5);
    for (const e of plan.encounters) expect(plan.bag).not.toContain(e.kind);
    expect(planRide(oleadas, lcg(7), undefined).encounters.length).toBe(3);
    expect(planRide(tenMinutes, lcg(7), undefined).encounters.length).toBe(1);
    expect(planRide([], lcg(7), ['owl'])).toEqual({ encounters: [], bag: ['owl'] });
  });

  it('nunca cae en una oleada ni en sus 15 s de aviso, ni en el arranque ni en el final, y guardan distancia entre sí', () => {
    const total = oleadas[oleadas.length - 1]!.endSec;
    let planned = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { encounters } = planRide(oleadas, lcg(seed), undefined);
      planned += encounters.length;
      encounters.forEach((plan, i) => {
        const end = plan.atSec + ENCOUNTER_SPECS[plan.kind].durationSec;
        expect(plan.atSec).toBeGreaterThanOrEqual(PLAN_DEFAULTS.startQuietSec);
        expect(end).toBeLessThanOrEqual(total - PLAN_DEFAULTS.endQuietSec);
        for (const seg of oleadas) {
          if (seg.kind !== 'surge') continue;
          const forbiddenFrom = seg.startSec - PLAN_DEFAULTS.warningSec;
          const overlaps = plan.atSec < seg.endSec && end > forbiddenFrom;
          expect(overlaps, `${plan.kind} en ${plan.atSec}s pisa la oleada de ${seg.startSec}s`).toBe(false);
        }
        const next = encounters[i + 1];
        if (next) expect(next.atSec - end).toBeGreaterThanOrEqual(PLAN_DEFAULTS.minGapSec);
      });
    }
    expect(planned).toBeGreaterThan(400);
  });

  it('la bolsa da la vuelta: ninguno se repite antes de que salgan todos, y en cinco salidas están los dieciséis', () => {
    let bag: EncounterKind[] | undefined;
    const order: EncounterKind[] = [];
    for (let ride = 0; ride < 5; ride++) {
      const plan = planRide(ride35, lcg(100 + ride), bag);
      order.push(...plan.encounters.map((e) => e.kind));
      bag = plan.bag;
    }
    // En la primera vuelta no se repite ninguno (como mucho uno, si alguno no cupo en su salida y esperó).
    const firstCycle = order.slice(0, ENCOUNTER_KINDS.length);
    expect(new Set(firstCycle).size).toBeGreaterThanOrEqual(ENCOUNTER_KINDS.length - 1);
    expect(new Set(order).size).toBe(ENCOUNTER_KINDS.length);
  });

  it('lo que no cabe en esta salida se queda en la bolsa para la siguiente', () => {
    const short = expandProgram({
      id: 's',
      name: 's',
      target: 'aerobic',
      segments: [
        { kind: 'warmup', durationSec: 60, zone: [0, 1] },
        { kind: 'cooldown', durationSec: 60, zone: [0, 1] },
      ],
    });
    const plan = planRide(short, lcg(3), ['train', 'owl', 'cat']);
    expect(plan.encounters.map((e) => e.kind)).toEqual(['owl']);
    expect(plan.bag).toEqual(['train', 'cat']);
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
    const segments = expandProgram({
      id: 's',
      name: 's',
      target: 'aerobic',
      segments: [
        { kind: 'warmup', durationSec: 60, zone: [0, 1] },
        { kind: 'cooldown', durationSec: 60, zone: [0, 1] },
      ],
    });
    expect(encounterWindows('train', segments)).toEqual([]);
    expect(encounterWindows('horses', segments)).toEqual([]);
    expect(encounterWindows('dog', segments)).toEqual([]);
    expect(encounterWindows('owl', segments).length).toBeGreaterThan(0);
  });

  it('el resumen lo cuenta con el km de la Ruta: uno entero, varios en lista', () => {
    expect(describeEncounter('deer', 104.26)).toBe('Un ciervo cruzó la carretera en el km 104,3');
    expect(describeEncounter('train', 12)).toContain('km 12,0');
    expect(describeEncounter('dog', 3)).toBe('Un perro te salió al paso en el km 3,0');
    expect(describeEncounter('horses', 3)).toBe('Una manada de caballos al galope en el km 3,0');
    expect(describeEncounters([])).toBe('');
    expect(describeEncounters([{ kind: 'owl', km: 2.5 }])).toBe('Una lechuza te vio pasar en el km 2,5');
    expect(
      describeEncounters([
        { kind: 'deer', km: 1 },
        { kind: 'owl', km: 2.5 },
        { kind: 'campfire', km: 4.06 },
      ]),
    ).toBe('Viste un ciervo cruzando (km 1,0), una lechuza (km 2,5), una hoguera (km 4,1)');
  });
});
