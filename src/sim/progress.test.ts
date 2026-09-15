import { describe, expect, it } from 'vitest';
import type { SessionRecord } from './history';
import {
  brokenRecords,
  empujonesClean,
  healthTrends,
  lastTwoTooHard,
  metWeeks,
  nextRideOptions,
  nextRideStatus,
  personalRecords,
  preRideRestReadings,
  readiness,
  recentWeeks,
  recommendToday,
  REFUGES,
  restBaseline,
  routeProgress,
  streakWeeks,
  streakWeeksBefore,
  summarizeWeek,
  weeklyReview,
  weeklyReviewDue,
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

  it('streakWeeksBefore no cuenta la semana en curso ni perdona en la cabeza', () => {
    expect(streakWeeksBefore([...metWeek(0), ...metWeek(1), ...metWeek(2)], NOW)).toBe(2);
    expect(streakWeeksBefore([...metWeek(0), ride(8), ...metWeek(2)], NOW)).toBe(0);
    expect(streakWeeksBefore([...metWeek(1), ...metWeek(3)], NOW)).toBe(2); // hueco en medio: sí
    expect(streakWeeksBefore([], NOW)).toBe(0);
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

/** Unos Empujones completos sin captura en los tramos suaves: la evidencia que pide la rotación. */
const CLEAN_EMPUJONES: Partial<SessionRecord> = {
  programId: 'empujones',
  programName: 'Empujones',
  target: 'tempo',
  timesCaught: 1,
  timesCaughtInEasy: 0,
};

describe('recommendToday: el plan por fases', () => {
  const metWeek = (weeksAgo: number) => [
    ride(weeksAgo * 7 + 0),
    ride(weeksAgo * 7 + 1, CLEAN_EMPUJONES),
    ride(weeksAgo * 7 + 2),
  ];
  /** n salidas repartidas en semanas pasadas (cada dos días desde hace una semana), con unos Empujones limpios. */
  const spread = (n: number) => Array.from({ length: n }, (_, i) => ride(7 + i * 2, i === 1 ? CLEAN_EMPUJONES : {}));

  it('quien empieza recibe la primera salida dos veces', () => {
    expect(recommendToday([], NOW)).toMatchObject({ phase: 'arranque', programId: 'primera-salida' });
    expect(recommendToday([ride(2)], NOW).programId).toBe('primera-salida');
  });

  it('arranque (salidas 2-5): alterna recuperación y fondo, cortos, y el volumen sube con cada salida', () => {
    const two = [ride(6), ride(4)];
    expect(recommendToday(two, NOW)).toMatchObject({
      phase: 'arranque',
      programId: 'recuperacion',
      values: { warmupMin: 3, mainMin: 10 },
    });
    expect(recommendToday([...two, ride(2)], NOW)).toMatchObject({
      phase: 'arranque',
      programId: 'fondo',
      values: { warmupMin: 3, mainMin: 13 },
    });
    expect(recommendToday([...two, ride(2), ride(1)], NOW)).toMatchObject({
      programId: 'recuperacion',
      values: { mainMin: 12 },
    });
  });

  it('base (salidas 6-11): fondo más largo, luego los primeros empujones, luego recuperación', () => {
    const base = spread(6);
    expect(recommendToday(base, NOW)).toMatchObject({ phase: 'base', programId: 'fondo', values: { mainMin: 16 } });
    const one = [...base, ride(2, { target: 'aerobic' })];
    expect(recommendToday(one, NOW)).toMatchObject({ phase: 'base', programId: 'empujones' });
    const two = [...one, ride(1, { target: 'tempo' })];
    expect(recommendToday(two, NOW).programId).toBe('recuperacion');
  });

  it('rotación (12+): fondo → oleadas → recuperación, con oleadas que crecen 4 → 6 → 8', () => {
    const twelve = spread(12);
    expect(recommendToday(twelve, NOW)).toMatchObject({ phase: 'rotacion', programId: 'fondo', values: { mainMin: 22 } });
    const one = [...twelve, ride(2, { target: 'aerobic' })];
    expect(recommendToday(one, NOW)).toMatchObject({ programId: 'oleadas', values: { repeats: 4 } });
    expect(recommendToday([...spread(20), ride(2, { target: 'aerobic' })], NOW).values).toMatchObject({ repeats: 6 });
    expect(recommendToday([...spread(32), ride(2, { target: 'aerobic' })], NOW).values).toMatchObject({ repeats: 8 });
    const two = [...one, ride(1, { target: 'anaerobic' })];
    expect(recommendToday(two, NOW).programId).toBe('recuperacion');
  });

  it('descarga: tras cuatro semanas cumplidas seguidas, la siguiente afloja', () => {
    const four = [...metWeek(1), ...metWeek(2), ...metWeek(3), ...metWeek(4)];
    expect(recommendToday(four, NOW)).toMatchObject({ phase: 'descarga', programId: 'fondo', values: { mainMin: 15 } });
    expect(recommendToday([...four, ride(1)], NOW)).toMatchObject({ phase: 'descarga', programId: 'recuperacion' });
    // Con tres cumplidas no hay descarga; con la semana pasada fallada, tampoco.
    expect(recommendToday([...metWeek(1), ...metWeek(2), ...metWeek(3)], NOW).phase).toBe('base');
    const broken = [ride(8), ...metWeek(2), ...metWeek(3), ...metWeek(4), ...metWeek(5)];
    expect(recommendToday(broken, NOW).phase).toBe('rotacion');
  });

  it('no encadena dos duras ni exige nada si ya saliste hoy', () => {
    const twelve = spread(12);
    const hardYesterday = [...twelve, ride(1, { target: 'anaerobic' })];
    expect(recommendToday(hardYesterday, NOW).programId).toBe('fondo');
    const today = [...twelve, ride(0)];
    expect(recommendToday(today, NOW)).toMatchObject({ programId: 'recuperacion', values: { mainMin: 10 } });
  });

  it('la rotación se gana: sin dos semanas cumplidas o sin unos Empujones limpios, sigue en base', () => {
    // Doce salidas apretadas en una sola semana cumplida: falta la segunda.
    const oneWeek = Array.from({ length: 12 }, (_, i) => ride(3 + (i % 7), i === 1 ? CLEAN_EMPUJONES : {})); // lunes a domingo pasados
    expect(metWeeks(oneWeek, NOW)).toBe(1);
    const held = recommendToday(oneWeek, NOW);
    expect(held.phase).toBe('base');
    expect(held.reason).toContain('dos semanas cumplidas');
    // Doce salidas en varias semanas pero sin Empujones limpios.
    const noEmpujones = Array.from({ length: 12 }, (_, i) => ride(7 + i * 2));
    expect(empujonesClean(noEmpujones)).toBe(false);
    const held2 = recommendToday(noEmpujones, NOW);
    expect(held2.phase).toBe('base');
    expect(held2.reason).toContain('Empujones');
    // Con las dos cosas, rotación.
    expect(recommendToday(spread(12), NOW).phase).toBe('rotacion');
    // Unos Empujones con capturas en los tramos suaves no valen como evidencia.
    const caughtInEasy = Array.from({ length: 12 }, (_, i) =>
      ride(7 + i * 2, i === 1 ? { ...CLEAN_EMPUJONES, timesCaughtInEasy: 2 } : {}),
    );
    expect(empujonesClean(caughtInEasy)).toBe(false);
  });

  it('dos salidas seguidas "demasiado" repiten la fase anterior con menos volumen', () => {
    const twelve = spread(12);
    const tired = [...twelve.slice(0, -2), ...twelve.slice(-2).map((s) => ({ ...s, rpe: 'hard' as const }))];
    expect(lastTwoTooHard(tired)).toBe(true);
    const r = recommendToday(tired, NOW);
    expect(r.phase).toBe('base');
    expect(r.reason).toContain('demasiado');
    expect(r.values.mainMin).toBe(Math.round(22 * 0.8));
    // Una sola "demasiado" no cambia nada.
    const once = [...twelve.slice(0, -1), { ...twelve[11]!, rpe: 'hard' as const }];
    expect(lastTwoTooHard(once)).toBe(false);
    expect(recommendToday(once, NOW).phase).toBe('rotacion');
  });

  it('el volumen sigue creciendo: tope 25 en base, 35 en rotación y 45 con ocho semanas cumplidas seguidas', () => {
    expect(recommendToday(spread(11), NOW).values.mainMin).toBe(21);
    const eleven = Array.from({ length: 11 }, (_, i) => ride(7 + i * 2)); // sin Empujones: se queda en base
    expect(recommendToday([...eleven, ...Array.from({ length: 10 }, (_, i) => ride(30 + i * 2))], NOW).values.mainMin).toBe(25);
    expect(recommendToday(spread(30), NOW).values.mainMin).toBe(35);
    // Ocho semanas cumplidas seguidas antes de esta (la novena sería descarga; la décima no).
    const ten = Array.from({ length: 10 }, (_, w) => metWeek(w + 1)).flat();
    const r = recommendToday(ten, NOW);
    expect(streakWeeksBefore(ten, NOW)).toBe(10);
    expect(r.phase).toBe('rotacion');
    expect(r.values.mainMin).toBe(40); // 10 + 30 salidas, tope 45
    const thirteen = Array.from({ length: 13 }, (_, w) => metWeek(w + 1)).flat();
    expect(recommendToday(thirteen, NOW).values.mainMin).toBe(45);
  });

  it('cuestas cada tercera semana desde la salida 18; umbral y pirámide con más base, por semanas', () => {
    // Semana +2: índice de semana ≡ 2 (mod 3) → la primera de la semana son cuestas.
    const cuestas = recommendToday(spread(20), NOW + 14 * DAY);
    expect(cuestas).toMatchObject({ phase: 'rotacion', programId: 'cuestas', values: { mainMin: 4 } });
    expect(recommendToday(spread(16), NOW + 14 * DAY).programId).toBe('fondo'); // antes de la 18, no
    // Semana +3: índice ≡ 1 (mod 2) → la dura es la pirámide (con 24 salidas).
    const piramide = recommendToday([...spread(24), ride(-19, { target: 'aerobic' })], NOW + 21 * DAY);
    expect(piramide.programId).toBe('piramide');
    // Semana +5: índice ≡ 3 (mod 4) → la dura es el umbral.
    const umbral = recommendToday([...spread(24), ride(-33, { target: 'aerobic' })], NOW + 35 * DAY);
    expect(umbral.programId).toBe('umbral');
  });
});

describe('la próxima salida con día', () => {
  it('ofrece mañana, pasado y el siguiente, con su nombre', () => {
    const options = nextRideOptions(NOW); // miércoles
    expect(options.map((o) => o.label)).toEqual(['Mañana, jueves', 'El viernes', 'El sábado']);
    expect(new Date(options[0]!.dayStartMs).getHours()).toBe(0);
  });

  it('el campamento dice si es hoy, si viene o si pasó', () => {
    const [tomorrow, friday] = nextRideOptions(NOW);
    expect(nextRideStatus(undefined, NOW).state).toBe('none');
    expect(nextRideStatus(tomorrow!.dayStartMs, NOW)).toEqual({ state: 'upcoming', label: 'Te esperan mañana.' });
    expect(nextRideStatus(friday!.dayStartMs, NOW)).toEqual({ state: 'upcoming', label: 'Te esperan el viernes.' });
    expect(nextRideStatus(tomorrow!.dayStartMs, NOW + DAY).state).toBe('today');
    expect(nextRideStatus(tomorrow!.dayStartMs, NOW + 3 * DAY)).toMatchObject({ state: 'missed' });
    expect(nextRideStatus(tomorrow!.dayStartMs, NOW + 3 * DAY).label).toContain('jueves');
  });
});

describe('la revisión semanal', () => {
  it('toca la primera vez que se abre la app en una semana nueva con algo que contar', () => {
    const sessions = [ride(3), ride(5), ride(8)];
    expect(weeklyReviewDue([], undefined, NOW)).toBe(false);
    expect(weeklyReviewDue(sessions, undefined, NOW)).toBe(true);
    expect(weeklyReviewDue(sessions, weekStartMs(NOW), NOW)).toBe(false);
    expect(weeklyReviewDue(sessions, weekStartMs(NOW - 7 * DAY), NOW)).toBe(true);
    // Tras un mes sin salir, lo primero no es una revisión.
    expect(weeklyReviewDue([ride(40)], undefined, NOW)).toBe(false);
  });

  it('resume la semana pasada contra la anterior, la racha, el reposo y el plan', () => {
    const sessions = [
      ride(16, { preRideRestBpm: 66 }),
      ride(14, { preRideRestBpm: 68 }),
      ride(12, { preRideRestBpm: 67 }),
      ride(9, { preRideRestBpm: 64 }),
      ride(7, { preRideRestBpm: 62 }),
      ride(5, { preRideRestBpm: 63 }),
    ];
    const review = weeklyReview(sessions, NOW);
    expect(review.lastWeek.sessions).toBe(3);
    expect(review.previousWeek.sessions).toBe(3);
    expect(review.restLastWeekBpm).toBe(63);
    expect(review.restPreviousWeekBpm).toBe(67);
    expect(review.streak).toBe(2);
    expect(review.plan.programId).toBeTruthy();
  });
});

describe('readiness: el reposo del ritual contra lo normal', () => {
  const withRest = (daysAgo: number, bpm: number) => ride(daysAgo, { preRideRestBpm: bpm });

  it('sin tres lecturas no hay normal', () => {
    expect(readiness([], 70).state).toBe('unknown');
    expect(readiness([withRest(4, 64), withRest(2, 66)], 80).state).toBe('unknown');
    expect(restBaseline([withRest(4, 64), withRest(2, 66)])).toBeUndefined();
  });

  it('la base es la mediana de las últimas siete lecturas', () => {
    const many = [90, 64, 66, 65, 70, 63, 66, 64, 65].map((bpm, i) => withRest(20 - i * 2, bpm));
    expect(restBaseline(many)).toBe(65); // el 90 antiguo queda fuera de las últimas siete
  });

  it('ocho latidos por encima es "elevado"; doce, descanso; menos, normal', () => {
    const base = [withRest(6, 64), withRest(4, 66), withRest(2, 65)];
    expect(readiness(base, 73)).toEqual({ state: 'elevated', baselineBpm: 65, deltaBpm: 8 });
    expect(readiness(base, 77)).toEqual({ state: 'rest', baselineBpm: 65, deltaBpm: 12 });
    expect(readiness(base, 71)).toEqual({ state: 'normal', baselineBpm: 65, deltaBpm: 6 });
    expect(readiness(base, 58).state).toBe('normal');
  });

  it('las salidas sin lectura no cuentan para la base', () => {
    expect(preRideRestReadings([ride(3), withRest(2, 60), ride(1)])).toEqual([60]);
  });
});

describe('healthTrends: reposo, recuperación cardíaca y precisión de zona', () => {
  it('sin datos, todo undefined', () => {
    const t = healthTrends([ride(3), ride(1)]);
    expect(t.restBpm).toEqual({ now: undefined, before: undefined });
    expect(t.recoveryBpm).toEqual({ now: undefined, before: undefined });
    expect(t.zonePrecision).toEqual({ now: undefined, before: undefined });
  });

  it('compara la ventana reciente con la anterior', () => {
    const sessions = Array.from({ length: 14 }, (_, i) =>
      ride(28 - i * 2, {
        preRideRestBpm: 70 - i, // baja de 70 a 57
        recoveryDrops: i < 4 ? undefined : [10 + i, 12 + i], // aparece con las oleadas, y crece
        inZoneSec: 1200 * (0.5 + i * 0.03), // de 50 % a 89 %
      }),
    );
    const t = healthTrends(sessions);
    // Reposo: mediana de las últimas 7 (63..57 → 60) vs. las 7 anteriores (70..64 → 67).
    expect(t.restBpm.now).toBe(60);
    expect(t.restBpm.before).toBe(67);
    // Recuperación: 10 salidas con caídas; últimas 5 (i 9..13) media de (11+i): 22; anteriores (i 4..8): 17.
    expect(t.recoveryBpm.now).toBeCloseTo(22);
    expect(t.recoveryBpm.before).toBeCloseTo(17);
    // Precisión: últimas 5 (i 9..13) → 0.5 + 0.03·11 = 0.83; anteriores (i 4..8) → 0.68.
    expect(t.zonePrecision.now).toBeCloseTo(0.83);
    expect(t.zonePrecision.before).toBeCloseTo(0.68);
  });

  it('con pocas salidas hay "ahora" pero no "antes"', () => {
    const t = healthTrends([
      ride(5, { recoveryDrops: [15], inZoneSec: 600 }),
      ride(3, { recoveryDrops: [17], inZoneSec: 600 }),
      ride(1),
    ]);
    expect(t.recoveryBpm).toEqual({ now: 16, before: undefined });
    expect(t.zonePrecision.now).toBeCloseTo(0.5);
    expect(t.zonePrecision.before).toBeUndefined();
  });
});
