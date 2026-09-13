// Todos los tunables del juego viven aquí. Datos puros, cero imports:
// retunear el juego es editar este archivo y nada más.

export interface SpeedTable {
  /** Cadencias (rpm) de cada columna, ascendentes. */
  cadenceBreakpoints: readonly number[];
  /** km/h por nivel de resistencia (fila 0 = nivel 1) y columna de cadencia. */
  kphByLevel: ReadonlyArray<readonly number[]>;
}

// Tabla a mano para una spin bike de freno por fricción y volante de 6 kg.
// Ancla de calibración: nivel 3 a 80 rpm = 26 km/h. Se retunea contra
// esfuerzo percibido en Fase 1; no es física, no pretende serlo.
export const SPEED: SpeedTable = {
  cadenceBreakpoints: [0, 40, 60, 70, 80, 90, 100, 110, 120],
  kphByLevel: [
    [0, 8.0, 12.5, 15.0, 18.0, 20.5, 23.0, 25.0, 27.0], // N1
    [0, 10.0, 15.5, 18.5, 22.0, 25.0, 27.5, 30.0, 32.0], // N2
    [0, 12.0, 18.5, 22.0, 26.0, 29.5, 32.5, 35.0, 37.0], // N3
    [0, 13.5, 21.0, 25.0, 29.0, 32.5, 36.0, 39.0, 41.5], // N4
    [0, 15.0, 23.0, 27.5, 32.0, 35.5, 39.0, 42.0, 44.5], // N5
    [0, 16.0, 25.0, 29.5, 34.5, 38.5, 42.0, 45.0, 47.5], // N6
    [0, 17.0, 26.5, 31.5, 37.0, 41.0, 44.5, 47.5, 50.0], // N7
    [0, 18.0, 28.0, 33.5, 39.0, 43.0, 47.0, 50.0, 52.5], // N8
  ],
};

export interface EffortTable {
  /** Fracción de reserva cardíaca (Karvonen: (pulso−reposo)/(máx−reposo)), ascendente. */
  effortBreakpoints: readonly number[];
  /** km/h para cada columna. */
  kph: readonly number[];
}

// Modo pulso: el esfuerzo cardíaco mueve al ciclista. Calibrado para que cada
// zona (Z1 50-60 %, Z2 60-70 %, Z3 70-80 %, Z4 80-90 %, Z5 90-100 %) rinda un
// poco más que la horda del programa que la prescribe: recuperación 9-12 km/h,
// fondo 16-19, umbral 24, oleadas 26-32. Se retunea pedaleando de verdad.
// Margen de calibración: los tramos suaves (horda a 9-12) se aguantan ya al
// 45 % de esfuerzo, para que un máximo mal estimado se sienta como tensión y
// no como injusticia.
export const EFFORT: EffortTable = {
  effortBreakpoints: [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  kph: [0, 5, 10, 14, 18, 22, 27, 32, 38],
};

export interface RiderProfile {
  hrMaxBpm: number;
  hrRestBpm: number;
  /** Ajuste del día sobre la fracción de esfuerzo (1 = sin ajuste). */
  effortScale?: number;
}

/** Fallback si no hay perfil guardado (33 años por Tanaka). */
export const RIDER: RiderProfile = {
  hrMaxBpm: 185,
  hrRestBpm: 60,
  effortScale: 1,
};

/** Qué entrada mueve al ciclista. El pulso es la entrada real del proyecto. */
export type InputMode = 'heartRate' | 'cadence';

export interface CatchConfig {
  healthCost: number;
  knockbackGapM: number;
  distancePenaltyM: number;
  graceSec: number;
  /** Factor de velocidad de la horda mientras "se tropieza" tras atraparte. */
  stumbleSpeedFactor: number;
}

export interface SimConfig {
  speed: SpeedTable;
  /** Sin muestra de cadencia en este tiempo → cadencia 0 (la regla vive en el bucle). */
  staleCadenceSec: number;
  effort: EffortTable;
  /**
   * Sin muestra de pulso en este tiempo → la lectura caduca. A diferencia de
   * la cadencia, el silencio de una pulsera es un dropout, no un rider parado:
   * el pulso retenido decae hacia el reposo en vez de caer a cero.
   */
  staleHeartRateSec: number;
  heartRateDecayBpmPerSec: number;
  /** Constante de tiempo del suavizado del pulso (quita el jitter óptico). */
  heartRateSmoothingSec: number;
  /** Ventana del pico sostenido (para aprender el máximo sin contar picos de ruido). */
  heartRatePeakWindowSec: number;
  maxDtSec: number;
  initialGapM: number;
  /** Clamp del gap: prescripción sobre acumulación de ventaja. */
  gapMaxM: number;
  /** Rampa lineal de velocidad zombi al entrar a cada segmento. */
  zombieRampSec: number;
  startResistance: number;
  maxHealth: number;
  /** Aviso de oleada este tiempo antes de un segmento más rápido. */
  surgeWarningSec: number;
  catch: CatchConfig;
}

export const SIM: SimConfig = {
  speed: SPEED,
  staleCadenceSec: 3,
  effort: EFFORT,
  staleHeartRateSec: 5,
  heartRateDecayBpmPerSec: 2,
  heartRateSmoothingSec: 2,
  heartRatePeakWindowSec: 5,
  maxDtSec: 0.25,
  initialGapM: 50,
  gapMaxM: 150,
  zombieRampSec: 2,
  startResistance: 2,
  maxHealth: 100,
  surgeWarningSec: 5,
  catch: {
    healthCost: 20,
    knockbackGapM: 12,
    distancePenaltyM: 25,
    graceSec: 5,
    stumbleSpeedFactor: 0.6,
  },
};

export const FAKE = {
  sampleIntervalMs: 500,
  jitterRpm: 1.5,
  /** Las bandas reales notifican a 1 Hz. */
  heartRateIntervalMs: 1000,
  jitterBpm: 1,
} as const;

export const RENDER = {
  width: 1280,
  height: 720,
  /** Línea del suelo donde apoyan los pies. */
  groundY: 640,
  playerX: 860,
  playerW: 40,
  playerH: 70,
  /** Mapeo asintótico gap → px: gapPxMax · g / (g + gapHalfM). */
  gapPxMax: 760,
  gapHalfM: 45,
  groundPxPerMeter: 40,
  farFactor: 0.25,
  nearFactor: 0.55,
  /** Umbrales de color del gap en la HUD. */
  gapDangerM: 10,
  gapWarnM: 30,
} as const;
