import { describe, expect, it } from 'vitest';
import type { SessionRecord } from './history';
import {
  brokenRecords,
  personalRecords,
  recentWeeks,
  recommendToday,
  REFUGES,
  routeProgress,
  streakWeeks,
  summarizeWeek,
  weekStartMs,
} from './progress';

// Miércoles 16 de septiembre de 2026, mediodía (hora local).
const NOW = new Date(2026, 8, 16, 12, 0, 0).getTime();
const DAY = 86_400_000;

let seq = 0;
/** Una salida hace `daysAgo` días; 20 min completos en Z2 salvo que se diga otra cosa. */
function ride(daysAgo: number, over: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  const startedAtMs = NOW - daysAgo * DAY;
  return {
    id: `${startedAtMs}-${seq}`,
    startedAtMs,
    programId: 'fondo',
    programName: 'Fondo',
    target: 'aerobic',
    inputMode: 'heartRate',
    completed: true,
    plannedSec: 1200,
    durationSec: 1200,
    distanceM: 6000,
    timesCaught: 1,
    avgHeartRateBpm: 130,
    peakHeartRateBpm: 150,
    avgEffortFrac: 0.62,
    zoneSec: [0, 0, 1200, 0, 0, 0],
    hrRestBpm: 60,
    ...over,
  };
}

describe('weekStartMs', () => {
  it('devuelve el lunes a las 00:00 local', () => {
    const monday = new Date(2026, 8, 14, 0, 0, 0).getTime();
    expect(weekStartMs(NOW)).toBe(monday);
    expect(weekStartMs(monday)).toBe(monday);
    expect(weekStartMs(new Date(2026, 8, 20, 23, 59).getTime())).toBe(monday); // domingo
    expect(weekStartMs(new Date(2026, 8, 21, 0, 0).getTime())).not.toBe(monday); // lunes siguiente
  });
});

describe('summarizeWeek', () => {
  it('cuenta salidas, minutos en zona y distancia de la semana', () => {
    const sessions = [ride(0), ride(1), ride(9)]; // dos esta semana, una la anterior
    const week = summarizeWeek(sessions, weekStartMs(NOW));
    expect(week.sessions).toBe(2);
    expect(week.activeMin).toBeCloseTo(40);
    expect(week.distanceKm).toBeCloseTo(12);
    expect(week.met).toBe(false);
  });

  it('una salida de menos de cinco minutos no cuenta como salida pero sí suma minutos', () => {
    const week = summarizeWeek([ride(0, { durationSec: 200, zoneSec: [0, 0, 200, 0, 0, 0] })], weekStartMs(NOW));
    expect(week.sessions).toBe(0);
    expect(week.activeMin).toBeCloseTo(200 / 60);
  });

  it('la meta se cumple por salidas o por minutos', () => {
    expect(summarizeWeek([ride(0), ride(1), ride(2)], weekStartMs(NOW)).met).toBe(true);
    const long = ride(0, { durationSec: 9000, zoneSec: [0, 0, 9000, 0, 0, 0] });
    expect(summarizeWeek([long], weekStartMs(NOW)).met).toBe(true);
  });
});

describe('recentWeeks', () => {
  it('devuelve N semanas, la actual al final', () => {
    const weeks = recentWeeks([ride(0), ride(8)], NOW, 3);
    expect(weeks).toHaveLength(3);
    expect(weeks[2]?.weekStartMs).toBe(weekStartMs(NOW));
    expect(weeks[2]?.sessions).toBe(1);
    expect(weeks[1]?.sessions).toBe(1);
    expect(weeks[0]?.sessions).toBe(0);
  });
});

describe('streakWeeks', () => {
  const metWeek = (weeksAgo: number) => [
    ride(weeksAgo * 7 + 0),
    ride(weeksAgo * 7 + 1),
    ride(weeksAgo * 7 + 2),
  ];

  it('sin sesiones es 0', () => {
    expect(streakWeeks([], NOW)).toBe(0);
  });

  it('cuenta semanas seguidas cumplidas incluyendo la actual si ya está', () => {
    expect(streakWeeks([...metWeek(0), ...metWeek(1), ...metWeek(2)], NOW)).toBe(3);
  });

  it('la semana en curso sin cumplir no rompe la racha', () => {
    expect(streakWeeks([ride(0), ...metWeek(1), ...metWeek(2)], NOW)).toBe(2);
  });

  it('perdona una semana fallada entre dos cumplidas, solo una vez', () => {
    expect(streakWeeks([...metWeek(1), ...metWeek(3)], NOW)).toBe(2);
    expect(streakWeeks([...metWeek(1), ...metWeek(3), ...metWeek(5)], NOW)).toBe(2);
  });

  it('no perdona si detrás del hueco no hay nada', () => {
    expect(streakWeeks([...metWeek(1), ride(20)], NOW)).toBe(1);
  });
});

describe('routeProgress', () => {
  it('sin kilómetros apunta al primer refugio', () => {
    const route = routeProgress([]);
    expect(route.reached).toBe(0);
    expect(route.next).toEqual(REFUGES[0]);
    expect(route.progress01).toBe(0);
    expect(route.remainingKm).toBe(10);
  });

  it('suma todas las salidas y avanza entre refugios', () => {
    const route = routeProgress([ride(0, { distanceM: 12_000 }), ride(1, { distanceM: 5_500 })]);
    expect(route.totalKm).toBeCloseTo(17.5);
    expect(route.reached).toBe(1);
    expect(route.last?.name).toBe('El puente');
    expect(route.next.name).toBe('La gasolinera');
    expect(route.progress01).toBeCloseTo(0.5);
    expect(route.remainingKm).toBeCloseTo(7.5);
  });

  it('más allá de la lista sigue habiendo refugios cada 500 km', () => {
    const route = routeProgress([ride(0, { distanceM: 1_900_000 })]);
    expect(route.reached).toBe(REFUGES.length + 1);
    expect(route.next.km).toBe(2200);
  });
});

describe('personalRecords y brokenRecords', () => {
  it('resume récords y tendencia del reposo', () => {
    const sessions = [
      ride(30, { hrRestBpm: 66, durationSec: 900, distanceM: 4000 }),
      ride(10, { hrRestBpm: 62, timesCaught: 0 }),
      ride(0, { hrRestBpm: 60, durationSec: 1500, distanceM: 8000 }),
    ];
    const r = personalRecords(sessions);
    expect(r.rides).toBe(3);
    expect(r.longestRideSec).toBe(1500);
    expect(r.longestRideKm).toBe(8);
    expect(r.cleanRides).toBe(1);
    expect(r.lowestRestBpm).toBe(60);
    expect(r.restBpmChange).toBe(-6);
  });

  it('la primera salida es récord por definición', () => {
    expect(brokenRecords([], ride(0))).toEqual(['Primera salida en la Ruta']);
  });

  it('detecta primera salida limpia, más larga y mayor distancia', () => {
    const before = [ride(3), ride(2)];
    const latest = ride(0, { timesCaught: 0, durationSec: 1800, distanceM: 9000, zoneSec: [0, 0, 1800, 0, 0, 0] });
    const broken = brokenRecords(before, latest);
    expect(broken).toContain('Primera salida sin ser alcanzado');
    expect(broken).toContain('Tu salida más larga');
    expect(broken).toContain('Tu mayor distancia');
    expect(broken).toContain('Tu mejor cardio en una salida');
    expect(brokenRecords(before, ride(0))).toEqual([]);
  });

  it('una salida que no cuenta no rompe récords', () => {
    expect(brokenRecords([ride(1)], ride(0, { durationSec: 100, distanceM: 99_000 }))).toEqual([]);
  });
});

describe('recommendToday', () => {
  it('quien empieza recibe la primera salida dos veces', () => {
    expect(recommendToday([], NOW).programId).toBe('primera-salida');
    expect(recommendToday([ride(2)], NOW).programId).toBe('primera-salida');
  });

  it('en el arranque alterna recuperación y fondo con calentamiento corto', () => {
    const two = [ride(6), ride(4)];
    expect(recommendToday(two, NOW)).toMatchObject({ programId: 'recuperacion', values: { warmupMin: 3 } });
    expect(recommendToday([...two, ride(2)], NOW)).toMatchObject({ programId: 'fondo' });
  });

  it('con base hecha, la semana rota fondo → oleadas → recuperación', () => {
    const base = [ride(30), ride(28), ride(26), ride(24), ride(22), ride(20)];
    expect(recommendToday(base, NOW).programId).toBe('fondo');
    const one = [...base, ride(2, { target: 'aerobic' })];
    expect(recommendToday(one, NOW)).toMatchObject({ programId: 'oleadas', values: { repeats: 4 } });
    const two = [...one, ride(1, { target: 'anaerobic' })];
    expect(recommendToday(two, NOW).programId).toBe('recuperacion');
  });

  it('no encadena dos duras ni exige nada si ya saliste hoy', () => {
    const base = [ride(30), ride(28), ride(26), ride(24), ride(22), ride(20)];
    const hardYesterday = [...base, ride(1, { target: 'anaerobic' })];
    expect(recommendToday(hardYesterday, NOW).programId).toBe('fondo');
    const today = [...base, ride(0)];
    expect(recommendToday(today, NOW).programId).toBe('recuperacion');
  });
});
