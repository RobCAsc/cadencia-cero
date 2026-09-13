import { beforeEach, describe, expect, it } from 'vitest';
import { SIM, type EffortTable, type SimConfig } from '../config';
import { RideSim } from './RideSim';
import type { TrainingProgram } from './program';
import type { SimEvent } from './types';

// Tabla trivial: km/h = 100 · fracción de esfuerzo. Con reposo 60 y máx 160,
// cada bpm por encima del reposo vale 1 km/h.
const EFFORT_LINEAR: EffortTable = { effortBreakpoints: [0, 1], kph: [0, 100] };
const rider = { hrMaxBpm: 160, hrRestBpm: 60 };

const cfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  ...SIM,
  effort: EFFORT_LINEAR,
  heartRateSmoothingSec: 0, // sin suavizado salvo que el test lo pida
  ...over,
});

const steady = (durationSec: number, kph: number): TrainingProgram => ({
  id: 'test',
  name: 'test',
  target: 'test',
  segments: [{ kind: 'steady', durationSec, zombieSpeedKph: kph }],
});

let clockMs = 0;
const now = () => clockMs;

beforeEach(() => {
  clockMs = 0;
});

const make = (program: TrainingProgram, over: Partial<SimConfig> = {}) =>
  new RideSim(program, cfg(over), now, { inputMode: 'heartRate', rider });

/** Un tick con pulsera viva: muestra fresca + update. */
function beatStep(sim: RideSim, bpm: number, step = 0.1): SimEvent[] {
  clockMs += step * 1000;
  sim.pushHeartRate({ bpm, timestampMs: clockMs });
  return sim.update(step);
}

function beatFor(sim: RideSim, sec: number, bpm: number, step = 0.1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < Math.round(sec / step); k++) events.push(...beatStep(sim, bpm, step));
  return events;
}

/** Ticks sin muestras: la pulsera calla. */
function silenceFor(sim: RideSim, sec: number, step = 0.1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < Math.round(sec / step); k++) {
    clockMs += step * 1000;
    events.push(...sim.update(step));
  }
  return events;
}

describe('RideSim en modo pulso', () => {
  it('la velocidad sale del esfuerzo cardíaco, no de la cadencia', () => {
    const sim = make(steady(600, 10));
    beatFor(sim, 1, 100); // 40 bpm sobre el reposo → 40 % → 40 km/h
    expect(sim.state.playerSpeedKph).toBeCloseTo(40);
    expect(sim.state.effortFrac).toBeCloseTo(0.4);
    expect(sim.state.heartRateBpm).toBeCloseTo(100);
    expect(sim.state.cadenceRpm).toBe(0); // la cadencia no interviene
    expect(sim.state.inputMode).toBe('heartRate');
  });

  it('el gap integra (jugador − horda): sube en zona, baja por debajo', () => {
    const sim = make(steady(600, 30), { initialGapM: 50 });
    beatFor(sim, 10, 100); // 40 km/h vs 30 → +10 km/h · 10 s ≈ +27.8 m
    expect(sim.state.gapM).toBeCloseTo(50 + (10 / 3.6) * 10, 0);
    beatFor(sim, 10, 80); // 20 km/h vs 30 → −27.8 m
    expect(sim.state.gapM).toBeCloseTo(50, 0);
  });

  it('sin ninguna lectura el jugador está parado', () => {
    const sim = make(steady(600, 10));
    silenceFor(sim, 2);
    expect(sim.state.playerSpeedKph).toBe(0);
    expect(sim.state.heartRateBpm).toBe(0);
    expect(sim.state.heartRateStale).toBe(true);
  });

  it('si la pulsera calla, el pulso caduca y decae hacia el reposo en vez de caer a cero', () => {
    const sim = make(steady(600, 10), {
      staleHeartRateSec: 5,
      heartRateDecayBpmPerSec: 2,
    });
    beatFor(sim, 1, 120);
    expect(sim.state.playerSpeedKph).toBeCloseTo(60);

    const events = silenceFor(sim, 4.5); // aún fresco
    expect(events.find((e) => e.type === 'staleHeartRate')).toBeUndefined();
    expect(sim.state.heartRateStale).toBe(false);
    expect(sim.state.playerSpeedKph).toBeCloseTo(60);

    const more = silenceFor(sim, 10.5); // caduca a los 5 s; 10 s decayendo → −20 bpm
    expect(more.filter((e) => e.type === 'staleHeartRate')).toHaveLength(1);
    expect(sim.state.heartRateStale).toBe(true);
    expect(sim.state.heartRateBpm).toBeCloseTo(100, 0);
    expect(sim.state.playerSpeedKph).toBeCloseTo(40, 0);

    silenceFor(sim, 60); // nunca baja del reposo
    expect(sim.state.heartRateBpm).toBeCloseTo(60);
    expect(sim.state.playerSpeedKph).toBeCloseTo(0);
  });

  it('una muestra fresca tras el dropout recupera la lectura al instante', () => {
    const sim = make(steady(600, 10), { staleHeartRateSec: 5, heartRateDecayBpmPerSec: 2 });
    beatFor(sim, 1, 120);
    silenceFor(sim, 15);
    expect(sim.state.heartRateStale).toBe(true);
    const events = beatFor(sim, 0.1, 130);
    expect(sim.state.heartRateStale).toBe(false);
    expect(sim.state.heartRateBpm).toBeCloseTo(130);
    // Y si vuelve a caer, avisa otra vez.
    expect(events.find((e) => e.type === 'staleHeartRate')).toBeUndefined();
    expect(silenceFor(sim, 10).filter((e) => e.type === 'staleHeartRate')).toHaveLength(1);
  });

  it('una muestra entregada tarde no cuenta como fresca', () => {
    const sim = make(steady(600, 10), { staleHeartRateSec: 5 });
    beatFor(sim, 1, 120);
    clockMs += 20_000;
    sim.pushHeartRate({ bpm: 150, timestampMs: clockMs - 20_000 });
    sim.update(0.1);
    expect(sim.state.heartRateStale).toBe(true);
    expect(sim.state.heartRateBpm).toBeLessThan(150);
  });

  it('el suavizado exponencial sigue al pulso sin arrancar desde cero', () => {
    const sim = make(steady(600, 10), { heartRateSmoothingSec: 2 });
    beatFor(sim, 0.1, 100);
    expect(sim.state.heartRateBpm).toBeCloseTo(100); // primera lectura: directa
    beatFor(sim, 2, 140); // una constante de tiempo → ~63 % del salto
    expect(sim.state.heartRateBpm).toBeGreaterThan(120);
    expect(sim.state.heartRateBpm).toBeLessThan(130);
    beatFor(sim, 20, 140);
    expect(sim.state.heartRateBpm).toBeCloseTo(140, 0);
  });

  it('las muestras con bpm 0 se descartan', () => {
    const sim = make(steady(600, 10));
    beatFor(sim, 1, 100);
    beatFor(sim, 1, 0);
    expect(sim.state.heartRateBpm).toBeCloseTo(100);
  });

  it('el resumen trae el pulso medio', () => {
    const sim = make(steady(10, 1));
    beatFor(sim, 5, 100);
    const events = beatFor(sim, 6, 120);
    const finished = events.find((e) => e.type === 'finished');
    expect(finished?.type).toBe('finished');
    if (finished?.type === 'finished') {
      expect(finished.summary.avgHeartRateBpm).toBeCloseTo(110, 0);
      expect(finished.summary.avgCadenceRpm).toBe(0);
    }
  });

  it('en modo cadencia el pulso se registra pero no mueve al ciclista', () => {
    const sim = new RideSim(steady(600, 10), cfg(), now, { inputMode: 'cadence', rider });
    beatFor(sim, 1, 150);
    expect(sim.state.heartRateBpm).toBeCloseTo(150);
    expect(sim.state.playerSpeedKph).toBe(0);
  });
});
