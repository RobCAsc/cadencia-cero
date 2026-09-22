import { beforeEach, describe, expect, it } from 'vitest';
import { SIM, type EffortTable, type SimConfig } from '../config';
import { RideSim } from './RideSim';
import { hordeSpeedForZone, type TrainingProgram } from './program';
import type { SimEvent } from './types';

// Las reglas de seguridad y las herramientas de la salida que no son la
// integral: pasarse del máximo congela la horda, muy alto sostenido avisa,
// Terminar enfría en vez de cortar, el empujón opcional se inserta y premia,
// el modo por sensación no persigue por pulso, y la ventaja deja rastro.

const EFFORT_LINEAR: EffortTable = { effortBreakpoints: [0, 1], kph: [0, 100] };
const rider = { hrMaxBpm: 160, hrRestBpm: 60 };

const cfg = (over: Partial<SimConfig> = {}): SimConfig => ({
  ...SIM,
  effort: EFFORT_LINEAR,
  heartRateSmoothingSec: 0,
  hordeWakeSec: 0,
  zoneEdgeBpm: 0, // los bordes exactos; la tolerancia se prueba en RideSim.heartRate.test
  ...over,
});

const program = (segments: TrainingProgram['segments']): TrainingProgram => ({
  id: 'test',
  name: 'test',
  target: 'test',
  segments,
});

/** Un fondo corto: calor, tramo continuo en Z2, vuelta a la calma. */
const fondo = (): TrainingProgram =>
  program([
    { kind: 'warmup', durationSec: 60, zone: [0, 1], zombieSpeedKph: 10 },
    { kind: 'steady', durationSec: 600, zone: 2, zombieSpeedKph: 30 },
    { kind: 'cooldown', durationSec: 60, zone: [0, 1], zombieSpeedKph: 10 },
  ]);

let clockMs = 0;
const now = () => clockMs;

beforeEach(() => {
  clockMs = 0;
});

const make = (p: TrainingProgram, over: Partial<SimConfig> = {}, inputMode: 'heartRate' | 'feel' = 'heartRate') =>
  new RideSim(p, cfg(over), now, { inputMode, rider });

function beatFor(sim: RideSim, sec: number, bpm: number, step = 0.1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < Math.round(sec / step); k++) {
    clockMs += step * 1000;
    sim.pushHeartRate({ bpm, timestampMs: clockMs });
    events.push(...sim.update(step));
  }
  return events;
}

describe('regla de parada: pulso por encima del máximo', () => {
  it('a los 30 s por encima del máximo la horda se congela y la ventaja no crece', () => {
    const sim = make(fondo());
    beatFor(sim, 60, 120); // calor: 60 km/h contra 10 → tope
    const events = beatFor(sim, 31, 165); // por encima de 160
    expect(events.some((e) => e.type === 'overMax')).toBe(true);
    expect(sim.state.easeOff).toBe(true);
    expect(sim.state.zombieSpeedKph).toBe(0);
    const gap = sim.state.gapM;
    beatFor(sim, 10, 165);
    expect(sim.state.gapM).toBeLessThanOrEqual(gap);
  });

  it('se suelta unos latidos por debajo del máximo, no justo en él', () => {
    const sim = make(fondo());
    beatFor(sim, 60, 120);
    beatFor(sim, 31, 165);
    beatFor(sim, 5, 159); // aún dentro de la histéresis
    expect(sim.state.easeOff).toBe(true);
    beatFor(sim, 5, 156);
    expect(sim.state.easeOff).toBe(false);
    expect(sim.state.zombieSpeedKph).toBeGreaterThan(0);
  });

  it('una lectura vieja no cuenta: sin pulsera no hay regla que aplicar', () => {
    const sim = make(fondo());
    beatFor(sim, 60, 120);
    clockMs += 1000;
    sim.pushHeartRate({ bpm: 170, timestampMs: clockMs });
    for (let k = 0; k < 400; k++) sim.update(0.1); // 40 s sin muestras nuevas
    expect(sim.state.easeOff).toBe(false);
  });

  it('muy alto sostenido dos minutos avisa una sola vez', () => {
    const sim = make(fondo());
    beatFor(sim, 60, 120);
    const first = beatFor(sim, 125, 153); // 95 % de 160 = 152
    expect(first.filter((e) => e.type === 'sustainedHigh')).toHaveLength(1);
    const again = beatFor(sim, 125, 153);
    expect(again.some((e) => e.type === 'sustainedHigh')).toBe(false);
  });
});

describe('Terminar enfría en vez de cortar', () => {
  it('sustituye lo que queda por dos minutos con la horda parada y termina', () => {
    const sim = make(fondo());
    beatFor(sim, 120, 130);
    sim.beginCooldown();
    expect(sim.state.coolingDown).toBe(true);
    expect(sim.state.totalSec).toBeCloseTo(120 + 120, 0);
    expect(sim.state.segment.kind).toBe('cooldown');
    const events = beatFor(sim, 121, 100);
    expect(sim.state.zombieSpeedKph).toBe(0);
    const finished = events.find((e) => e.type === 'finished');
    expect(finished).toBeDefined();
  });

  it('el segundo toque acaba ya', () => {
    const sim = make(fondo());
    beatFor(sim, 120, 130);
    sim.beginCooldown();
    beatFor(sim, 10, 100);
    sim.endNow();
    const events = beatFor(sim, 1, 100);
    expect(events.some((e) => e.type === 'finished')).toBe(true);
  });
});

describe('el resto en suave', () => {
  it('sustituye lo que queda por Z0-Z1 con la horda al paso de esa zona, y una vuelta a la calma al final', () => {
    const sim = make(fondo());
    beatFor(sim, 120, 130);
    const total = sim.state.totalSec;
    sim.easeRemaining(60);
    expect(sim.state.eased).toBe(true);
    expect(sim.state.totalSec).toBe(total); // no acorta: cambia
    expect(sim.state.segment).toMatchObject({ kind: 'recover', zoneMin: 0, zoneMax: 1 });
    expect(sim.state.pushAvailable).toBe(false);
    beatFor(sim, 15, 130); // pasada la rampa, la horda va al paso de Z0-Z1
    expect(sim.state.zombieSpeedKph).toBeCloseTo(hordeSpeedForZone(0, 1, EFFORT_LINEAR), 0);
    const events = beatFor(sim, total - 120 - 15 + 1, 100);
    expect(events.some((e) => e.type === 'finished')).toBe(true);
    expect(sim.currentSegments[sim.currentSegments.length - 1]?.kind).toBe('cooldown');
  });

  it('con menos que el enfriamiento por delante, solo enfría', () => {
    const sim = make(fondo());
    beatFor(sim, 690, 130);
    sim.easeRemaining(120);
    expect(sim.state.coolingDown).toBe(true);
  });
});

describe('el empujón opcional', () => {
  it('entra tras una cuenta atrás, la horda no acelera, y premia con los segundos en zona que pide el bono', () => {
    const sim = make(fondo());
    beatFor(sim, 120, 125); // en el steady Z2: 65 km/h contra 30
    expect(sim.state.pushAvailable).toBe(true);
    const before = sim.state.totalSec;
    expect(sim.insertPush(60, 3)).toBe(true);
    expect(sim.state.totalSec).toBe(before + 60);
    // La cuenta atrás corre dentro del tramo: el empujón es el siguiente, al paso de la horda de ahora.
    expect(sim.state.segment.kind).toBe('steady');
    expect(sim.state.segment.next).toMatchObject({ kind: 'push', zombieSpeedKph: 30 });
    expect(sim.state.segment.next?.inSec).toBeCloseTo(SIM.push.countdownSec, 1);
    expect(sim.state.pushAvailable).toBe(false);
    beatFor(sim, SIM.push.countdownSec + 0.05, 125);
    expect(sim.state.segment.kind).toBe('push');
    expect(sim.state.zombieSpeedKph).toBe(30);
    // El pulso tarda: 25 s todavía en Z2. La horda no gana.
    const gapAtStart = sim.state.gapM;
    beatFor(sim, 25, 125);
    expect(sim.state.gapM).toBeGreaterThanOrEqual(gapAtStart - 0.01);
    const distanceBefore = sim.state.distanceM;
    const events = beatFor(sim, 36, 135); // 75 %: Z3 durante 35 s ≥ minZoneSec
    const done = events.find((e) => e.type === 'pushDone');
    expect(done).toMatchObject({ type: 'pushDone', bonusM: SIM.push.bonusM });
    expect(sim.state.distanceM).toBeGreaterThan(distanceBefore + SIM.push.bonusM);
    expect(sim.state.segment.kind).toBe('steady');
  });

  it('si el pulso no llega a la zona los segundos que pide el bono: ni bono ni pérdida', () => {
    const sim = make(fondo());
    beatFor(sim, 120, 125);
    expect(sim.insertPush(60, 3)).toBe(true);
    beatFor(sim, SIM.push.countdownSec + 0.05, 125);
    const gapAtStart = sim.state.gapM;
    const distanceBefore = sim.state.distanceM;
    const events = beatFor(sim, 61, 125); // se queda en Z2 todo el minuto
    expect(events.find((e) => e.type === 'pushMissed')).toMatchObject({ type: 'pushMissed' });
    expect(events.some((e) => e.type === 'pushDone')).toBe(false);
    expect(sim.state.gapM).toBeGreaterThanOrEqual(gapAtStart - 0.01);
    // Solo lo pedaleado: 65 km/h durante 61 s, sin los 200 m del bono.
    expect(sim.state.distanceM).toBeCloseTo(distanceBefore + (65 / 3.6) * 61, -1);
  });

  it('no cabe si al tramo continuo no le queda cuenta atrás y cola', () => {
    const sim = make(fondo());
    beatFor(sim, 60 + 600 - SIM.push.countdownSec - 10, 125); // a 25 s del final del steady
    expect(sim.state.segment.kind).toBe('steady');
    expect(sim.state.pushAvailable).toBe(false);
    expect(sim.insertPush()).toBe(false);
  });

  it('solo uno por salida y solo en un tramo continuo', () => {
    const sim = make(fondo());
    beatFor(sim, 10, 100); // en el calor
    expect(sim.insertPush()).toBe(false);
    beatFor(sim, 120, 130);
    expect(sim.insertPush()).toBe(true);
    beatFor(sim, 70, 130);
    expect(sim.insertPush()).toBe(false);
  });
});

describe('modo por sensación', () => {
  it('el ciclista va al paso prescrito, la horda nunca gana y la zona prescrita se da por hecha', () => {
    const sim = make(fondo(), {}, 'feel');
    for (let k = 0; k < 700; k++) sim.update(0.1); // 70 s sin pulso alguno
    expect(sim.state.gapM).toBeCloseTo(SIM.initialGapM, 5);
    expect(sim.state.timesCaught).toBe(0);
    expect(sim.state.distanceM).toBeGreaterThan(0);
    const s = sim.summary();
    expect(s.zoneSec[0]! + s.zoneSec[1]!).toBeCloseTo(60, 0); // el calor cuenta en su zona
    expect(s.zoneSec[2]).toBeCloseTo(10, 0); // el tramo en Z2, sin pulsera que lo diga
    expect(s.inZoneSec).toBeCloseTo(70, 0);
  });
});

describe('la racha en zona', () => {
  it('cuenta los segundos seguidos dentro de la zona y guarda la mejor racha', () => {
    const sim = make(fondo());
    beatFor(sim, 60, 115); // calor Z0-Z1: 55 % → en zona
    expect(sim.state.inZoneRunSec).toBeCloseTo(60, 0);
    beatFor(sim, 20, 130); // steady Z2 pide 60-70 %: 70 % es techo → fuera
    expect(sim.state.inZoneRunSec).toBe(0);
    beatFor(sim, 30, 125); // 65 %: dentro
    expect(sim.state.inZoneRunSec).toBeCloseTo(30, 0);
    expect(sim.summary().bestInZoneRunSec).toBeCloseTo(60, 0);
  });
});

describe('la ventana de asentamiento', () => {
  /** Calor, un tempo en Z3 y vuelta a Z2 con la misma horda: solo cambia el techo. */
  const conTempo = (): TrainingProgram =>
    program([
      { kind: 'warmup', durationSec: 60, zone: [0, 1], zombieSpeedKph: 10 },
      { kind: 'steady', durationSec: 120, zone: 3, zombieSpeedKph: 30 },
      { kind: 'steady', durationSec: 600, zone: 2, zombieSpeedKph: 30 },
    ]);

  it('al bajar de Z3 a Z2 el techo baja en rampa: el pulso que viene bajando no congela la ventaja', () => {
    const sim = make(conTempo(), { gapMaxM: 1e6, zoneSettleSec: 45 });
    beatFor(sim, 180.05, 135); // 75 %: dentro del Z3 hasta el cambio
    expect(sim.state.segment.zoneMax).toBe(2);
    const gapAtChange = sim.state.gapM;
    // 10 s después, aún a 75 %: el techo efectivo va por el 78 % → asentando, no congelado, y la ventaja crece.
    beatFor(sim, 10, 135);
    expect(sim.state.settling).toBe(true);
    expect(sim.state.aboveZone).toBe(false);
    expect(sim.state.gapM).toBeGreaterThan(gapAtChange);
    // Quien no baja el pulso queda congelado cuando la rampa cruza su esfuerzo (22,5 s): pasarse sigue sin rendir.
    beatFor(sim, 30, 135);
    expect(sim.state.aboveZone).toBe(true);
    expect(sim.state.settling).toBe(false);
    const frozen = sim.state.gapM;
    beatFor(sim, 10, 135);
    expect(sim.state.gapM).toBeCloseTo(frozen, 5);
  });

  it('quien baja el pulso a Z2 dentro de la ventana nunca queda congelado', () => {
    const sim = make(conTempo(), { gapMaxM: 1e6 });
    beatFor(sim, 180.05, 135);
    const aboveBefore = sim.summary().aboveZoneSec;
    for (let k = 0; k < 40; k++) beatFor(sim, 1, 135 - k * 0.5); // 135 → 115 en 40 s (75 % → 65 %)
    expect(sim.summary().aboveZoneSec).toBeCloseTo(aboveBefore, 5);
    expect(sim.state.aboveZone).toBe(false);
    expect(sim.state.settling).toBe(false);
  });
});

describe('la salud vuelve pedaleando en zona', () => {
  it('una captura cuesta un corazón y tres minutos en zona lo devuelven; fuera de zona no vuelve', () => {
    const sim = make(fondo());
    beatFor(sim, 60, 115); // el calor, en zona, con la ventaja al tope
    beatFor(sim, 85, 85); // en el Z2: 25 km/h contra 30 (tras la rampa), te alcanzan hacia los 78 s
    expect(sim.state.timesCaught).toBe(1);
    expect(sim.state.healthPct).toBe(80);
    beatFor(sim, 5, 85); // gracia y por debajo de la zona: no cura
    expect(sim.state.healthPct).toBe(80);
    beatFor(sim, 90, 125); // 65 %: Z2, en zona → medio corazón
    expect(sim.state.healthPct).toBeCloseTo(90, 0);
    beatFor(sim, 100, 125);
    expect(sim.state.healthPct).toBe(SIM.maxHealth);
  });
});

describe('la ventaja deja rastro', () => {
  it('muestrea la ventaja y el pulso cada gapTraceStepSec, y cuenta los segundos con la pulsera callada', () => {
    const sim = make(fondo(), { gapTraceStepSec: 5 });
    beatFor(sim, 30, 120);
    for (let k = 0; k < 200; k++) {
      clockMs += 100;
      sim.update(0.1); // 20 s sin muestra
    }
    const s = sim.summary();
    expect(s.gapTrace.length).toBeGreaterThanOrEqual(6);
    expect(s.gapTrace[0]).toBeGreaterThanOrEqual(SIM.initialGapM);
    expect(s.hrTrace.length).toBe(s.gapTrace.length);
    expect(s.hrTrace[1]).toBe(120);
    expect(s.staleHeartRateSec).toBeCloseTo(20 - SIM.staleHeartRateSec, 0);
  });
});
