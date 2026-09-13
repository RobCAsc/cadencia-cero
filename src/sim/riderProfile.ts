import type { RiderProfile } from '../config';
import type { RideSummary } from './types';

/**
 * Perfil del rider tal como se guarda en la tablet. El sim solo ve la parte
 * numérica (RiderProfile); esto añade de dónde salió cada número, porque la
 * calibración se corrige con el tiempo y hay que saber qué sobreescribir.
 */
export interface StoredRiderProfile {
  ageYears: number;
  hrRestBpm: number;
  hrMaxBpm: number;
  /** Cómo se obtuvo el máximo: por edad, derivado del ritmo cómodo, o pico observado. */
  hrMaxSource: 'age' | 'anchor' | 'observed' | 'manual';
  /** Pulso del ritmo cómodo (ancla del 70 % de esfuerzo), si se midió. */
  anchorBpm?: number;
  /** Mayor pico sostenido visto en sesión. */
  observedPeakBpm?: number;
  /** Ajuste del día, en puntos porcentuales de esfuerzo (−10..+10). */
  intensityPct: number;
}

/** El ritmo cómodo (media hora hablando) es el techo de la zona de fondo. */
export const ANCHOR_EFFORT = 0.7;
export const INTENSITY_MIN = -10;
export const INTENSITY_MAX = 10;
/** Un pico por encima de esto es ruido del sensor, no fisiología. */
const PLAUSIBLE_MAX_BPM = 220;

/** Tanaka (2001): acierta mejor que 220 − edad, con error típico de ~10 bpm. */
export function hrMaxFromAge(ageYears: number): number {
  return Math.round(208 - 0.7 * ageYears);
}

/** Máximo implícito para que el ancla medida caiga en ANCHOR_EFFORT. */
export function hrMaxFromAnchor(hrRestBpm: number, anchorBpm: number): number {
  return Math.round(hrRestBpm + (anchorBpm - hrRestBpm) / ANCHOR_EFFORT);
}

export function defaultRiderProfile(ageYears = 33): StoredRiderProfile {
  return {
    ageYears,
    hrRestBpm: 60,
    hrMaxBpm: hrMaxFromAge(ageYears),
    hrMaxSource: 'age',
    intensityPct: 0,
  };
}

/** La parte que consume la simulación. */
export function toSimRider(p: StoredRiderProfile): RiderProfile {
  return {
    hrMaxBpm: p.hrMaxBpm,
    hrRestBpm: p.hrRestBpm,
    effortScale: 1 + p.intensityPct / 100,
  };
}

/** Cambiar la edad solo mueve el máximo mientras siga siendo una estimación. */
export function withAge(p: StoredRiderProfile, ageYears: number): StoredRiderProfile {
  const age = Math.min(99, Math.max(10, Math.round(ageYears)));
  const next = { ...p, ageYears: age };
  if (p.hrMaxSource === 'age') next.hrMaxBpm = hrMaxFromAge(age);
  return next;
}

export function withRest(p: StoredRiderProfile, hrRestBpm: number): StoredRiderProfile {
  const rest = Math.round(hrRestBpm);
  const next = { ...p, hrRestBpm: rest };
  // El ancla sigue valiendo; el máximo derivado se recalcula con el nuevo reposo.
  if (p.hrMaxSource === 'anchor' && p.anchorBpm !== undefined) {
    next.hrMaxBpm = hrMaxFromAnchor(rest, p.anchorBpm);
  }
  return ensureRange(next);
}

export function withManualMax(p: StoredRiderProfile, hrMaxBpm: number): StoredRiderProfile {
  return ensureRange({ ...p, hrMaxBpm: Math.round(hrMaxBpm), hrMaxSource: 'manual' });
}

/** El ritmo cómodo medido manda sobre la edad, pero no sobre un pico observado mayor. */
export function withAnchor(p: StoredRiderProfile, anchorBpm: number): StoredRiderProfile {
  const anchor = Math.round(anchorBpm);
  const derived = hrMaxFromAnchor(p.hrRestBpm, anchor);
  const next: StoredRiderProfile = { ...p, anchorBpm: anchor };
  if (p.hrMaxSource === 'observed' && p.observedPeakBpm !== undefined && p.observedPeakBpm > derived) {
    return ensureRange(next);
  }
  next.hrMaxBpm = derived;
  next.hrMaxSource = 'anchor';
  return ensureRange(next);
}

export function withIntensity(p: StoredRiderProfile, intensityPct: number): StoredRiderProfile {
  return {
    ...p,
    intensityPct: Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, Math.round(intensityPct))),
  };
}

/**
 * Un pico sostenido por encima del máximo actual lo sube: así el máximo se
 * aprende de las oleadas sin una prueba de agotamiento.
 */
export function withObservedPeak(
  p: StoredRiderProfile,
  peakBpm: number,
): { profile: StoredRiderProfile; raised: boolean } {
  const peak = Math.round(peakBpm);
  if (peak <= 0 || peak > PLAUSIBLE_MAX_BPM) return { profile: p, raised: false };
  const observed = Math.max(p.observedPeakBpm ?? 0, peak);
  const next: StoredRiderProfile = { ...p, observedPeakBpm: observed };
  if (peak > p.hrMaxBpm) {
    next.hrMaxBpm = peak;
    next.hrMaxSource = 'observed';
    return { profile: next, raised: true };
  }
  return { profile: next, raised: false };
}

export type CalibrationAdvice = 'lower' | 'raise' | 'ok';

/**
 * Lectura del resumen de sesión en clave de calibración. Los tramos suaves
 * (calentamiento, recuperación, vuelta a la calma) son fáciles por diseño:
 * que te atrapen ahí dice que las zonas están altas, no que flojeaste.
 */
export function calibrationAdvice(summary: RideSummary): CalibrationAdvice {
  if (summary.timesCaughtInEasy >= 2) return 'lower';
  if (summary.timesCaught === 0 && summary.avgEffortFrac > 0 && summary.avgEffortFrac < 0.45) {
    return 'raise';
  }
  return 'ok';
}

/** Aplica el consejo como ±5 puntos de intensidad, sin tocar la fisiología. */
export function applyAdvice(p: StoredRiderProfile, advice: CalibrationAdvice): StoredRiderProfile {
  if (advice === 'lower') return withIntensity(p, p.intensityPct + 5);
  if (advice === 'raise') return withIntensity(p, p.intensityPct - 5);
  return p;
}

function ensureRange(p: StoredRiderProfile): StoredRiderProfile {
  // El sim exige máx > reposo; garantizamos un rango mínimo utilizable.
  if (p.hrMaxBpm - p.hrRestBpm < 40) return { ...p, hrMaxBpm: p.hrRestBpm + 40 };
  return p;
}
