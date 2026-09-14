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
  /** De dónde salió el reposo: por defecto, del minuto de calma (mediana), o a mano. */
  hrRestSource?: 'default' | 'ritual' | 'manual' | 'measured';
  hrMaxBpm: number;
  /**
   * Cómo se obtuvo el máximo: por edad, derivado de la escalera (dos anclas),
   * del ritmo cómodo (una ancla, perfiles viejos), pico observado, o a mano.
   */
  hrMaxSource: 'age' | 'step' | 'anchor' | 'observed' | 'manual';
  /** Pulso del ritmo cómodo (hablas sin problema), si se midió. */
  anchorBpm?: number;
  /** Pulso del ritmo fuerte (no puedes hablar), si se hizo la escalera. */
  hardBpm?: number;
  /** Mayor pico sostenido visto en sesión. */
  observedPeakBpm?: number;
  /** Ajuste del día, en puntos porcentuales de esfuerzo (−10..+10). */
  intensityPct: number;
}

/** El ritmo cómodo (media hora hablando) como ancla única: perfiles viejos. */
export const ANCHOR_EFFORT = 0.7;
/**
 * La escalera: dos anclas del habla. "Hablas sin problema" ≈ primer umbral
 * ventilatorio (~65 % de reserva); "no puedes hablar" ≈ segundo (~85 %). Dos
 * puntos ajustan mucho mejor que uno, y el de arriba es el menos ambiguo.
 */
export const STEP_EASY_EFFORT = 0.65;
export const STEP_HARD_EFFORT = 0.85;
/** El máximo derivado no se aleja más que esto de la estimación por edad: un día flojo no descalibra todo. */
export const MAX_AGE_TOLERANCE_BPM = 15;
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

/**
 * Máximo a partir de las dos anclas de la escalera, ponderando más la de
 * arriba, y acotado a la estimación por edad ± tolerancia.
 */
export function hrMaxFromStepTest(
  ageYears: number,
  hrRestBpm: number,
  easyBpm: number,
  hardBpm: number,
): number {
  const fromEasy = hrRestBpm + (easyBpm - hrRestBpm) / STEP_EASY_EFFORT;
  const fromHard = hrRestBpm + (hardBpm - hrRestBpm) / STEP_HARD_EFFORT;
  const fitted = 0.4 * fromEasy + 0.6 * fromHard;
  const byAge = hrMaxFromAge(ageYears);
  return Math.round(Math.min(byAge + MAX_AGE_TOLERANCE_BPM, Math.max(byAge - MAX_AGE_TOLERANCE_BPM, fitted)));
}

export function defaultRiderProfile(ageYears = 33): StoredRiderProfile {
  return {
    ageYears,
    hrRestBpm: 60,
    hrRestSource: 'default',
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

/** Cambiar la edad mueve el máximo mientras siga siendo una estimación (o acote la escalera). */
export function withAge(p: StoredRiderProfile, ageYears: number): StoredRiderProfile {
  const age = Math.min(99, Math.max(10, Math.round(ageYears)));
  const next = { ...p, ageYears: age };
  if (p.hrMaxSource === 'age') next.hrMaxBpm = hrMaxFromAge(age);
  return rederiveMax(next);
}

/** Los máximos derivados se recalculan con reposo y edad nuevos; los demás no se tocan. */
function rederiveMax(p: StoredRiderProfile): StoredRiderProfile {
  const next = { ...p };
  if (p.hrMaxSource === 'step' && p.anchorBpm !== undefined && p.hardBpm !== undefined) {
    next.hrMaxBpm = hrMaxFromStepTest(p.ageYears, p.hrRestBpm, p.anchorBpm, p.hardBpm);
  } else if (p.hrMaxSource === 'anchor' && p.anchorBpm !== undefined) {
    next.hrMaxBpm = hrMaxFromAnchor(p.hrRestBpm, p.anchorBpm);
  }
  return ensureRange(next);
}

export function withRest(
  p: StoredRiderProfile,
  hrRestBpm: number,
  source: NonNullable<StoredRiderProfile['hrRestSource']> = 'manual',
): StoredRiderProfile {
  return rederiveMax({ ...p, hrRestBpm: Math.round(hrRestBpm), hrRestSource: source });
}

/**
 * El reposo del minuto de calma (mediana de las últimas lecturas) manda,
 * salvo que el rider lo haya fijado a mano.
 */
export function withRitualRest(p: StoredRiderProfile, medianBpm: number): StoredRiderProfile {
  if (p.hrRestSource === 'manual') return p;
  return withRest(p, medianBpm, 'ritual');
}

export function withManualMax(p: StoredRiderProfile, hrMaxBpm: number): StoredRiderProfile {
  return ensureRange({ ...p, hrMaxBpm: Math.round(hrMaxBpm), hrMaxSource: 'manual' });
}

/** El ritmo cómodo medido (una ancla) manda sobre la edad, pero no sobre un pico observado mayor. */
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

/**
 * La escalera (dos anclas) manda sobre la edad y sobre el ritmo cómodo; un
 * pico observado mayor sigue mandando sobre todo, porque es un hecho.
 */
export function withStepTest(p: StoredRiderProfile, easyBpm: number, hardBpm: number): StoredRiderProfile {
  const easy = Math.round(easyBpm);
  const hard = Math.round(hardBpm);
  const derived = hrMaxFromStepTest(p.ageYears, p.hrRestBpm, easy, hard);
  const next: StoredRiderProfile = { ...p, anchorBpm: easy, hardBpm: hard };
  if (p.observedPeakBpm !== undefined && p.observedPeakBpm > derived) {
    next.hrMaxBpm = p.observedPeakBpm;
    next.hrMaxSource = 'observed';
    return ensureRange(next);
  }
  next.hrMaxBpm = derived;
  next.hrMaxSource = 'step';
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

/** Fracción de la salida por encima del techo de zona a partir de la cual el juego fue demasiado fácil. */
export const TOO_EASY_ABOVE_FRACTION = 0.5;

/**
 * Lectura del resumen de sesión en clave de calibración. Los tramos suaves
 * (calentamiento, recuperación, vuelta a la calma) son fáciles por diseño:
 * que te atrapen ahí dice que las zonas están altas, no que flojeaste. Y al
 * revés: pasar media salida por encima del techo sin que te alcancen dice
 * que las zonas están bajas, aunque el esfuerzo medio parezca alto.
 */
export function calibrationAdvice(summary: RideSummary): CalibrationAdvice {
  if (summary.timesCaughtInEasy >= 2) return 'lower';
  if (summary.timesCaught === 0 && summary.avgEffortFrac > 0 && summary.avgEffortFrac < 0.45) {
    return 'raise';
  }
  if (
    summary.timesCaught === 0 &&
    summary.durationSec > 0 &&
    summary.aboveZoneSec / summary.durationSec > TOO_EASY_ABOVE_FRACTION
  ) {
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
