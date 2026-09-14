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
} from './riderProfile';
import type { RideSummary } from './types';

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

  it('un pico sostenido mayor que el máximo lo sube; uno menor solo se anota', () => {
    const base = withAnchor(defaultRiderProfile(33), 144); // máx 180
    const low = withObservedPeak(base, 170);
    expect(low.raised).toBe(false);
    expect(low.profile).toMatchObject({ hrMaxBpm: 180, observedPeakBpm: 170 });
    const high = withObservedPeak(base, 187);
    expect(high.raised).toBe(true);
    expect(high.profile).toMatchObject({ hrMaxBpm: 187, hrMaxSource: 'observed', observedPeakBpm: 187 });
  });

  it('un ancla posterior no baja un máximo observado mayor', () => {
    const observed = withObservedPeak(defaultRiderProfile(33), 190).profile;
    const p = withAnchor(observed, 130); // derivaría 160
    expect(p.hrMaxBpm).toBe(190);
    expect(p.anchorBpm).toBe(130);
  });

  it('descarta picos implausibles', () => {
    expect(withObservedPeak(defaultRiderProfile(33), 240).raised).toBe(false);
  });

  it('garantiza un rango mínimo entre reposo y máximo', () => {
    const p = withManualMax(defaultRiderProfile(33), 70);
    expect(p.hrMaxBpm - p.hrRestBpm).toBeGreaterThanOrEqual(40);
  });

  it('la intensidad se acota y se traduce en escala de esfuerzo', () => {
    expect(withIntensity(defaultRiderProfile(), 25).intensityPct).toBe(10);
    expect(toSimRider(withIntensity(defaultRiderProfile(), -10)).effortScale).toBeCloseTo(0.9);
    expect(toSimRider(defaultRiderProfile()).effortScale).toBe(1);
  });
});

describe('consejo de calibración', () => {
  it('atrapado en tramos suaves → bajar (más intensidad)', () => {
    expect(calibrationAdvice(summary({ timesCaught: 3, timesCaughtInEasy: 2 }))).toBe('lower');
    expect(applyAdvice(defaultRiderProfile(), 'lower').intensityPct).toBe(5);
  });

  it('sin capturas y esfuerzo medio bajo → subir (menos intensidad)', () => {
    expect(calibrationAdvice(summary({ avgEffortFrac: 0.4 }))).toBe('raise');
    expect(applyAdvice(defaultRiderProfile(), 'raise').intensityPct).toBe(-5);
  });

  it('una sesión normal no toca nada', () => {
    expect(calibrationAdvice(summary({ timesCaught: 2, timesCaughtInEasy: 1 }))).toBe('ok');
    expect(calibrationAdvice(summary())).toBe('ok');
  });
});
