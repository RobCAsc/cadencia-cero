import { describe, expect, it } from 'vitest';
import {
  applyAdvice,
  calibrationAdvice,
  defaultRiderProfile,
  hrMaxFromAge,
  hrMaxFromAnchor,
  toSimRider,
  withAge,
  withAnchor,
  withIntensity,
  withManualMax,
  withObservedPeak,
  withRest,
  hrMaxFromStepTest,
  MAX_AGE_TOLERANCE_BPM,
  MIN_RESERVE_BPM,
  PEAK_RAISE_PER_RIDE_BPM,
  reserveWarning,
  STEP_RETEST_DAYS,
  stepTestDue,
  withMaxFromAge,
  withRitualRest,
  withStepTest,
  zoneWidthBpm,
} from './riderProfile';
import type { RideSummary } from './types';

const DAY_MS = 86_400_000;

const summary = (over: Partial<RideSummary> = {}): RideSummary => ({
  durationSec: 1200,
  distanceM: 6000,
  timesCaught: 0,
  timesCaughtInEasy: 0,
  avgCadenceRpm: 0,
  avgHeartRateBpm: 130,
  peakHeartRateBpm: 160,
  avgEffortFrac: 0.6,
  zoneSec: [0, 0, 1200, 0, 0, 0],
  inZoneSec: 1200,
  aboveZoneSec: 0,
  recoveryDrops: [],
  gapTrace: [],
  ...over,
});

describe('perfil del rider', () => {
  it('siembra el máximo por edad con Tanaka', () => {
    expect(hrMaxFromAge(33)).toBe(185);
    expect(defaultRiderProfile(33)).toMatchObject({ hrMaxBpm: 185, hrRestBpm: 60, hrMaxSource: 'age' });
  });

  it('cambiar la edad mueve el máximo solo mientras sea una estimación', () => {
    const byAge = withAge(defaultRiderProfile(33), 40);
    expect(byAge.hrMaxBpm).toBe(180);
    const anchored = withAnchor(defaultRiderProfile(33), 145);
    expect(withAge(anchored, 40).hrMaxBpm).toBe(anchored.hrMaxBpm);
  });

  it('el ritmo cómodo ancla el 70 % y deriva el máximo', () => {
    expect(hrMaxFromAnchor(60, 144)).toBe(180);
    const p = withAnchor(defaultRiderProfile(33), 144);
    expect(p).toMatchObject({ anchorBpm: 144, hrMaxBpm: 180, hrMaxSource: 'anchor' });
  });

  it('medir el reposo recalcula el máximo derivado del ancla', () => {
    const p = withRest(withAnchor(defaultRiderProfile(33), 144), 54);
    expect(p.hrMaxBpm).toBe(hrMaxFromAnchor(54, 144));
  });

  it('un pico sostenido mayor que el máximo lo sube, pero como mucho tres latidos por salida; uno menor solo se anota', () => {
    const base = withAnchor(defaultRiderProfile(33), 144); // máx 180
    const low = withObservedPeak(base, 170);
    expect(low.raised).toBe(false);
    expect(low.profile).toMatchObject({ hrMaxBpm: 180, observedPeakBpm: 170 });
    const high = withObservedPeak(base, 187);
    expect(high.raised).toBe(true);
    expect(high.profile).toMatchObject({
      hrMaxBpm: 180 + PEAK_RAISE_PER_RIDE_BPM,
      hrMaxSource: 'observed',
      observedPeakBpm: 187,
    });
    const small = withObservedPeak(base, 182);
    expect(small.profile.hrMaxBpm).toBe(182); // por debajo del tope, sube lo que hay
  });

  it('un pico de un día en que uno se pasó no endurece la siguiente salida: sin permiso solo se anota', () => {
    const base = withAnchor(defaultRiderProfile(33), 144); // máx 180
    const denied = withObservedPeak(base, 195, { allowRaise: false });
    expect(denied.raised).toBe(false);
    expect(denied.profile).toMatchObject({ hrMaxBpm: 180, hrMaxSource: 'anchor', observedPeakBpm: 195 });
  });

  it('un ancla posterior no baja un máximo observado mayor', () => {
    const observed = withObservedPeak(defaultRiderProfile(33), 190).profile; // 185 → 188
    const p = withAnchor(observed, 130); // derivaría 160
    expect(p.hrMaxBpm).toBe(188);
    expect(p.anchorBpm).toBe(130);
  });

  it('descarta picos implausibles', () => {
    expect(withObservedPeak(defaultRiderProfile(33), 240).raised).toBe(false);
  });

  it('garantiza una reserva mínima entre reposo y máximo, y avisa cuando es estrecha', () => {
    const p = withManualMax(defaultRiderProfile(33), 70);
    expect(p.hrMaxBpm - p.hrRestBpm).toBe(MIN_RESERVE_BPM);
    // Reposo 69 y máximo 120: la reserva de 51 se sube a 60, y aun así avisa (zonas de 6).
    const narrow = withManualMax(withRest(defaultRiderProfile(33), 69), 120);
    expect(narrow.hrMaxBpm).toBe(69 + MIN_RESERVE_BPM);
    expect(zoneWidthBpm(narrow)).toBe(6);
    expect(reserveWarning(narrow)).toContain('cada zona mide 6');
    expect(reserveWarning(defaultRiderProfile(33))).toBeUndefined(); // reserva 125: zonas de 12,5
    // Volver a la edad deshace el ajuste a mano.
    const byAge = withMaxFromAge(narrow);
    expect(byAge).toMatchObject({ hrMaxBpm: 185, hrMaxSource: 'age' });
  });

  it('la intensidad se acota y se traduce en escala de esfuerzo', () => {
    expect(withIntensity(defaultRiderProfile(), 25).intensityPct).toBe(10);
    expect(toSimRider(withIntensity(defaultRiderProfile(), -10)).effortScale).toBeCloseTo(0.9);
    expect(toSimRider(defaultRiderProfile()).effortScale).toBe(1);
  });

  it('la escalera ajusta el máximo con dos anclas, ponderando la de arriba', () => {
    // Reposo 60: cómodo 141 (65 % de 185) y fuerte 166 (85 %) → 185 exacto.
    expect(hrMaxFromStepTest(33, 60, 141.25, 166.25)).toBe(185);
    // Cómodo alto y fuerte bajo se compensan; el fuerte pesa más.
    expect(hrMaxFromStepTest(33, 60, 150, 160)).toBe(Math.round(0.4 * (60 + 90 / 0.65) + 0.6 * (60 + 100 / 0.85)));
    const p = withStepTest(defaultRiderProfile(33), 135, 162);
    expect(p).toMatchObject({ anchorBpm: 135, hardBpm: 162, hrMaxSource: 'step' });
    expect(p.hrMaxBpm).toBe(hrMaxFromStepTest(33, 60, 135, 162));
  });

  it('la escalera se acota a la edad ± 15: un día flojo no descalibra todo', () => {
    expect(hrMaxFromStepTest(33, 60, 110, 125)).toBe(185 - MAX_AGE_TOLERANCE_BPM); // saldría ~140
    expect(hrMaxFromStepTest(33, 60, 170, 190)).toBe(185 + MAX_AGE_TOLERANCE_BPM); // saldría ~225
  });

  it('un máximo observado mayor sigue mandando sobre la escalera', () => {
    const observed = withObservedPeak(defaultRiderProfile(33), 192).profile; // 185 → 188
    const p = withStepTest(observed, 130, 150);
    expect(p.hrMaxBpm).toBe(188);
    expect(p.hrMaxSource).toBe('observed');
  });

  it('la escalera anota cuándo se hizo y con qué reposo, y dice cuándo toca repetirla', () => {
    const t0 = 1_800_000_000_000;
    const p = withStepTest(defaultRiderProfile(33), 135, 162, t0);
    expect(p).toMatchObject({ stepTestAtMs: t0, stepTestRestBpm: 60 });
    expect(stepTestDue(defaultRiderProfile(33), t0)).toBe('never');
    expect(stepTestDue(p, t0 + 10 * DAY_MS)).toBe('fresh');
    expect(stepTestDue(p, t0 + (STEP_RETEST_DAYS + 1) * DAY_MS)).toBe('stale');
    expect(stepTestDue(withRitualRest(p, 55), t0 + DAY_MS)).toBe('restDropped');
    expect(stepTestDue(withRitualRest(p, 57), t0 + DAY_MS)).toBe('fresh');
  });

  it('el reposo del minuto de calma manda salvo que esté fijado a mano, y recalcula la escalera', () => {
    const stepped = withStepTest(defaultRiderProfile(33), 135, 162);
    const ritual = withRitualRest(stepped, 54);
    expect(ritual).toMatchObject({ hrRestBpm: 54, hrRestSource: 'ritual' });
    expect(ritual.hrMaxBpm).toBe(hrMaxFromStepTest(33, 54, 135, 162));
    const manual = withRest(stepped, 58); // a mano
    expect(withRitualRest(manual, 50)).toMatchObject({ hrRestBpm: 58, hrRestSource: 'manual' });
  });
});

describe('consejo de calibración', () => {
  it('atrapado en tramos suaves → bajar (más intensidad)', () => {
    expect(calibrationAdvice(summary({ timesCaught: 3, timesCaughtInEasy: 2 }))).toBe('lower');
    expect(applyAdvice(defaultRiderProfile(), 'lower').intensityPct).toBe(5);
  });

  it('sin capturas y esfuerzo medio bajo → subir (menos intensidad), solo si al rider le pareció fácil', () => {
    expect(calibrationAdvice(summary({ avgEffortFrac: 0.4 }), 'easy')).toBe('raise');
    expect(calibrationAdvice(summary({ avgEffortFrac: 0.4 }), 'right')).toBe('ok');
    expect(calibrationAdvice(summary({ avgEffortFrac: 0.4 }))).toBe('ok');
    expect(applyAdvice(defaultRiderProfile(), 'raise').intensityPct).toBe(-5);
  });

  it('una sesión normal no toca nada', () => {
    expect(calibrationAdvice(summary({ timesCaught: 2, timesCaughtInEasy: 1 }), 'right')).toBe('ok');
    expect(calibrationAdvice(summary(), 'right')).toBe('ok');
    expect(calibrationAdvice(summary(), 'easy')).toBe('ok');
  });

  it('media salida por encima del techo sin capturas → subir, aunque el esfuerzo medio sea alto, con el rider de acuerdo', () => {
    expect(calibrationAdvice(summary({ avgEffortFrac: 0.7, aboveZoneSec: 700, durationSec: 1200 }), 'easy')).toBe('raise');
    expect(calibrationAdvice(summary({ avgEffortFrac: 0.7, aboveZoneSec: 700, durationSec: 1200 }))).toBe('ok');
    expect(calibrationAdvice(summary({ avgEffortFrac: 0.7, aboveZoneSec: 500, durationSec: 1200 }), 'easy')).toBe('ok');
    expect(calibrationAdvice(summary({ timesCaught: 1, aboveZoneSec: 900, durationSec: 1200 }), 'easy')).toBe('ok');
  });

  it('"demasiado" habiendo seguido la zona → bajar; "demasiado" sin haberla seguido no dice nada de las zonas', () => {
    expect(calibrationAdvice(summary({ inZoneSec: 800 }), 'hard')).toBe('lower');
    expect(calibrationAdvice(summary({ inZoneSec: 300 }), 'hard')).toBe('ok');
    // Las capturas en tramos suaves mandan aunque el rider no conteste.
    expect(calibrationAdvice(summary({ timesCaught: 3, timesCaughtInEasy: 2 }))).toBe('lower');
  });
});
