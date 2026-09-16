import { describe, expect, it } from 'vitest';
import type { SessionRecord } from './history';
import { marks, newMarks } from './marks';

// Miércoles 16 de septiembre de 2026, mediodía (hora local).
const NOW = new Date(2026, 8, 16, 12, 0, 0).getTime();
const DAY = 86_400_000;

let seq = 0;
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

const achieved = (list: ReturnType<typeof marks>) => list.filter((m) => m.achievedAtMs !== undefined).map((m) => m.id);

describe('marcas de forma', () => {
  it('sin salidas, ninguna conseguida y todas listadas', () => {
    const all = marks([]);
    expect(all).toHaveLength(11);
    expect(achieved(all)).toEqual([]);
  });

  it('sin ser alcanzado, media hora limpia y oleadas aguantadas salen de la primera salida que lo cumple', () => {
    const sessions = [
      ride(10),
      ride(8, { timesCaught: 0, zoneSec: [0, 0, 1200, 0, 0, 0] }), // limpia, 20 min: no llega a la media hora
      ride(6, { timesCaught: 0, durationSec: 2100, zoneSec: [0, 100, 2000, 0, 0, 0] }),
      ride(4, { programId: 'oleadas', target: 'anaerobic', timesCaught: 0, recoveryDrops: [18, 22, 24] }),
    ];
    const all = marks(sessions);
    const by = Object.fromEntries(all.map((m) => [m.id, m.achievedAtMs]));
    expect(by['first-clean']).toBe(sessions[1]!.startedAtMs);
    expect(by['fondo-30']).toBe(sessions[2]!.startedAtMs);
    expect(by['oleadas-clean']).toBe(sessions[3]!.startedAtMs);
    expect(by['recovery-20']).toBe(sessions[3]!.startedAtMs);
  });

  it('el reposo cinco latidos más bajo compara la mediana reciente con las tres primeras lecturas', () => {
    const rests = [68, 66, 67, 66, 65, 64, 62, 61, 60, 61];
    const sessions = rests.map((bpm, i) => ride(30 - i * 3, { preRideRestBpm: bpm }));
    const mark = marks(sessions).find((m) => m.id === 'rest-5')!;
    // Base 67; la mediana de las últimas 7 llega a 62 en la décima lectura.
    expect(mark.achievedAtMs).toBe(sessions[9]!.startedAtMs);
    expect(marks(sessions.slice(0, 7)).find((m) => m.id === 'rest-5')!.achievedAtMs).toBeUndefined();
  });

  it('150 minutos en una semana y las rachas se fechan al final de la semana que las cumple', () => {
    // NOW es miércoles: 3, 5 y 7 días atrás caen en la semana anterior (lunes a domingo).
    const week = (weeksAgo: number) => [ride((weeksAgo - 1) * 7 + 3), ride((weeksAgo - 1) * 7 + 5), ride((weeksAgo - 1) * 7 + 7)];
    const four = [...week(4), ...week(3), ...week(2), ...week(1)];
    const all = marks(four);
    const by = Object.fromEntries(all.map((m) => [m.id, m.achievedAtMs]));
    expect(by['streak-4']).toBeDefined();
    expect(by['streak-10']).toBeUndefined();
    expect(by['active-150']).toBeUndefined(); // 60 min por semana
    // Lunes y martes de la semana de NOW: 90 + 60 minutos en la misma semana.
    const big = [ride(2, { durationSec: 5400, zoneSec: [0, 0, 5400, 0, 0, 0] }), ride(1, { durationSec: 3600, zoneSec: [0, 0, 3600, 0, 0, 0] })];
    expect(marks(big).find((m) => m.id === 'active-150')!.achievedAtMs).toBe(big[1]!.startedAtMs + 3600 * 1000);
  });

  it('las salidas se cuentan a 25, 50 y 100, y newMarks anuncia solo las nuevas', () => {
    const many = Array.from({ length: 25 }, (_, i) => ride(60 - i * 2));
    expect(marks(many).find((m) => m.id === 'rides-25')!.achievedAtMs).toBe(many[24]!.startedAtMs);
    const before = many.slice(0, 24);
    const fresh = newMarks(before, many);
    expect(fresh.map((m) => m.id)).toEqual(['rides-25']);
  });
});
