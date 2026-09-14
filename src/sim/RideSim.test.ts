import { beforeEach, describe, expect, it } from 'vitest';
import { SIM, type CatchConfig, type SimConfig, type SpeedTable } from '../config';
import { RideSim } from './RideSim';
import type { TrainingProgram } from './program';
import type { SimEvent } from './types';

// Tabla trivial para tests: velocidad (km/h) = cadencia (rpm), nivel único.
const TABLE_RPM_EQ_KPH: SpeedTable = {
  cadenceBreakpoints: [0, 100],
  kphByLevel: [[0, 100]],
};

const cfg = (over: Partial<SimConfig> = {}, catchOver: Partial<CatchConfig> = {}): SimConfig => ({
  ...SIM,
  speed: TABLE_RPM_EQ_KPH,
  startResistance: 1,
  hordeWakeSec: 0, // la horda arranca a su ritmo salvo que el test pida lo contrario
  ...over,
  catch: { ...SIM.catch, ...catchOver },
});

/** Estos tests ejercitan la entrada original: la cadencia. */
const CADENCE = { inputMode: 'cadence' } as const;

const prog = (segments: TrainingProgram['segments']): TrainingProgram => ({
  id: 'test',
  name: 'test',
  target: 'test',
  segments,
});

const steady = (durationSec: number, kph: number): TrainingProgram =>
  prog([{ kind: 'steady', durationSec, zone: [0, 5], zombieSpeedKph: kph }]);

let clockMs = 0;
const now = () => clockMs;

beforeEach(() => {
  clockMs = 0;
});

/** Un tick pedaleando: muestra fresca + update. */
function pedalStep(sim: RideSim, rpm: number, step = 0.1): SimEvent[] {
  clockMs += step * 1000;
  sim.pushCadence({ rpm, timestampMs: clockMs });
  return sim.update(step);
}

function pedalFor(sim: RideSim, sec: number, rpm: number, step = 0.1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < Math.round(sec / step); k++) events.push(...pedalStep(sim, rpm, step));
  return events;
}

/** Ticks sin muestras nuevas: el sensor está en silencio. */
function coastFor(sim: RideSim, sec: number, step = 0.1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < Math.round(sec / step); k++) {
    clockMs += step * 1000;
    events.push(...sim.update(step));
  }
  return events;
}

describe('RideSim: la integral del gap', () => {
  it('integra gap y distancia con velocidad constante', () => {
    const sim = new RideSim(steady(1000, 14), cfg({ initialGapM: 50 }), now, CADENCE);
    pedalFor(sim, 10, 20); // 20 rpm → 20 km/h vs horda a 14
    expect(sim.state.gapM).toBeCloseTo(50 + ((20 - 14) / 3.6) * 10, 1);
    expect(sim.state.distanceM).toBeCloseTo((20 / 3.6) * 10, 1);
    expect(sim.state.timesCaught).toBe(0);
  });

  it('la horda despierta: parada al arrancar, a su ritmo al cabo de hordeWakeSec', () => {
    const sim = new RideSim(steady(1000, 20), cfg({ hordeWakeSec: 10, initialGapM: 50 }), now, CADENCE);
    pedalStep(sim, 0);
    expect(sim.state.zombieSpeedKph).toBe(0); // en el primer tick aún no ha despertado
    pedalFor(sim, 4.9, 0);
    expect(sim.state.zombieSpeedKph).toBeCloseTo(10, 0);
    pedalFor(sim, 6, 0);
    expect(sim.state.zombieSpeedKph).toBe(20);
    // Parado y con la horda despertando se pierde menos que con la horda a tope.
    expect(sim.state.gapM).toBeGreaterThan(50 - (20 / 3.6) * 11);
  });

  it('clampa dt a maxDtSec y no avanza con dt <= 0', () => {
    const sim = new RideSim(steady(1000, 14), cfg(), now, CADENCE);
    sim.update(5);
    expect(sim.state.elapsedSec).toBe(SIM.maxDtSec);
    sim.update(0);
    sim.update(-1);
    expect(sim.state.elapsedSec).toBe(SIM.maxDtSec);
  });

  it('clampa el gap a gapMaxM: la prescripción no se puede "bancar"', () => {
    const sim = new RideSim(steady(1000, 14), cfg(), now, CADENCE);
    pedalFor(sim, 60, 100); // 100 km/h sostenidos
    expect(sim.state.gapM).toBe(SIM.gapMaxM);
  });
});

describe('RideSim: regla de staleness (el detalle de correctitud del input)', () => {
  it('cerea la cadencia ~3 s después de la última muestra, con un solo evento', () => {
    const sim = new RideSim(steady(1000, 5), cfg(), now, CADENCE);
    pedalStep(sim, 90);
    expect(sim.state.cadenceRpm).toBe(90);
    expect(sim.state.cadenceStale).toBe(false);

    let events = coastFor(sim, 2.8); // edad ≈ 2.9 s, aún fresca
    expect(sim.state.cadenceRpm).toBe(90);
    expect(events.filter((e) => e.type === 'staleCadence')).toHaveLength(0);

    events = coastFor(sim, 0.3); // edad ≈ 3.2 s → vieja
    expect(sim.state.cadenceRpm).toBe(0);
    expect(sim.state.cadenceStale).toBe(true);
    expect(events.filter((e) => e.type === 'staleCadence')).toHaveLength(1);

    // Silencio prolongado: no se repite el evento.
    events = coastFor(sim, 5);
    expect(events.filter((e) => e.type === 'staleCadence')).toHaveLength(0);
  });

  it('una muestra fresca revive la cadencia', () => {
    const sim = new RideSim(steady(1000, 5), cfg(), now, CADENCE);
    pedalStep(sim, 90);
    coastFor(sim, 4);
    expect(sim.state.cadenceRpm).toBe(0);
    pedalStep(sim, 85);
    expect(sim.state.cadenceRpm).toBe(85);
    expect(sim.state.cadenceStale).toBe(false);
  });

  it('una muestra con timestamp viejo NO cuenta como fresca', () => {
    const sim = new RideSim(steady(1000, 5), cfg(), now, CADENCE);
    clockMs = 60_000;
    sim.pushCadence({ rpm: 90, timestampMs: clockMs - 10_000 });
    sim.update(0.1);
    expect(sim.state.cadenceRpm).toBe(0);
    expect(sim.state.cadenceStale).toBe(true);
  });
});

describe('RideSim: ser atrapado es un revés, nunca el final', () => {
  it('al contacto: salud -20, knockback a 12 m, gracia de 5 s con horda al 60%', () => {
    // Horda a 36 km/h (10 m/s), rider parado, gap inicial 5 m → contacto en 0.5 s.
    const sim = new RideSim(steady(1000, 36), cfg({ initialGapM: 5 }), now, CADENCE);
    const events = coastFor(sim, 0.5); // contacto exactamente en t = 0.5
    const caught = events.filter((e) => e.type === 'caught');
    expect(caught).toHaveLength(1);
    expect(caught[0]).toMatchObject({ healthPct: 80 });
    expect(sim.state.gapM).toBe(SIM.catch.knockbackGapM);
    expect(sim.state.healthPct).toBe(80);
    expect(sim.state.distanceM).toBe(0); // penalización con piso en 0

    // Primer tick de gracia: la horda tropieza al 60%.
    coastFor(sim, 0.1);
    expect(sim.state.zombieSpeedKph).toBeCloseTo(36 * SIM.catch.stumbleSpeedFactor, 10);

    // Dentro de la gracia no hay segundo catch, aunque el gap llegue a 0.
    coastFor(sim, 4.8);
    expect(sim.state.timesCaught).toBe(1);
    // La gracia expira a los 5 s exactos → siguiente contacto.
    coastFor(sim, 0.3);
    expect(sim.state.timesCaught).toBe(2);
  });

  it('la penalización de distancia se descuenta del odómetro', () => {
    const sim = new RideSim(steady(1000, 36), cfg({ initialGapM: 5 }), now, CADENCE);
    pedalFor(sim, 10, 80); // 80 km/h: abre gap y acumula distancia
    let before = sim.state.distanceM;
    expect(before).toBeGreaterThan(200);

    for (let k = 0; k < 400; k++) {
      before = sim.state.distanceM;
      const events = coastFor(sim, 0.1);
      if (events.some((e) => e.type === 'caught')) {
        // En el tick del catch la cadencia efectiva es 0: no se suma distancia.
        expect(sim.state.distanceM).toBeCloseTo(before - SIM.catch.distancePenaltyM, 6);
        return;
      }
    }
    throw new Error('nunca lo atraparon');
  });

  it('con salud 0 el ride sigue: healthDepleted una sola vez, catches siguen contando', () => {
    const sim = new RideSim(steady(2000, 36), cfg({ initialGapM: 1 }), now, CADENCE);
    const events = coastFor(sim, 32); // catches ~cada 5 s desde t≈0.1
    const caught = events.filter((e) => e.type === 'caught');
    expect(caught.length).toBe(7);
    expect(caught.map((e) => (e.type === 'caught' ? e.healthPct : -1))).toEqual([
      80, 60, 40, 20, 0, 0, 0,
    ]);
    expect(events.filter((e) => e.type === 'healthDepleted')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'finished')).toHaveLength(0);
    expect(sim.state.phase).toBe('riding');
    expect(sim.state.timesCaught).toBe(7);
  });
});

describe('RideSim: segmentos y fin de sesión', () => {
  it('emite segmentChanged al entrar a cada segmento (incluido el primero)', () => {
    const sim = new RideSim(
      prog([
        { kind: 'steady', durationSec: 2, zone: [0, 5], zombieSpeedKph: 10 },
        { kind: 'steady', durationSec: 3, zone: [0, 5], zombieSpeedKph: 12 },
      ]),
      cfg(),
      now,
      CADENCE,
    );
    const first = pedalStep(sim, 30);
    expect(first.filter((e) => e.type === 'segmentChanged')).toMatchObject([{ index: 0 }]);
    const rest = pedalFor(sim, 2.2, 30);
    expect(rest.filter((e) => e.type === 'segmentChanged')).toMatchObject([{ index: 1 }]);
  });

  it('avisa la oleada una sola vez, surgeWarningSec antes', () => {
    const sim = new RideSim(
      prog([
        { kind: 'steady', durationSec: 10, zone: [0, 5], zombieSpeedKph: 10 },
        { kind: 'surge', durationSec: 10, zone: [0, 5], zombieSpeedKph: 30 },
      ]),
      cfg({ zombieRampSec: 0, zombieRampUpSec: 0, surgeWarningSec: 5 }),
      now,
      CADENCE,
    );
    const events = pedalFor(sim, 11, 50);
    const warnings = events.filter((e) => e.type === 'surgeWarning');
    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    if (w?.type !== 'surgeWarning') throw new Error('unreachable');
    expect(w.toKph).toBe(30);
    expect(w.inSec).toBeGreaterThan(4.5);
    expect(w.inSec).toBeLessThanOrEqual(5);
  });

  it('completar el programa es la única forma de terminar', () => {
    const sim = new RideSim(
      prog([
        { kind: 'steady', durationSec: 2, zone: [0, 5], zombieSpeedKph: 10 },
        { kind: 'cooldown', durationSec: 3, zone: [0, 5], zombieSpeedKph: 8 },
      ]),
      cfg(),
      now,
      CADENCE,
    );
    const events = pedalFor(sim, 5.2, 30);
    const finished = events.filter((e) => e.type === 'finished');
    expect(finished).toHaveLength(1);
    const f = finished[0];
    if (f?.type !== 'finished') throw new Error('unreachable');
    expect(f.summary.durationSec).toBeGreaterThanOrEqual(5);
    expect(f.summary.durationSec).toBeLessThanOrEqual(5.15);
    expect(f.summary.distanceM).toBeCloseTo((30 / 3.6) * f.summary.durationSec, 1);
    expect(f.summary.avgCadenceRpm).toBeCloseTo(30, 6);
    expect(f.summary.timesCaught).toBe(0);
    expect(sim.state.phase).toBe('finished');

    // Tras terminar, el sim queda congelado.
    const elapsed = sim.state.elapsedSec;
    expect(sim.update(0.1)).toHaveLength(0);
    expect(sim.state.elapsedSec).toBe(elapsed);
  });
});
