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

/**
 * Zonas cardíacas por fracción de reserva: cada entrada es el límite inferior
 * de Z1..Z5. Por debajo de Z1 es "suave" (zona 0): cuenta como tiempo pero
 * no como cardio. Z2 en adelante es lo que la OMS llama actividad moderada.
 */
export const ZONES = {
  lowerBounds: [0.5, 0.6, 0.7, 0.8, 0.9],
  /** Primera zona que cuenta como minutos de cardio. */
  activeFromZone: 2,
  /**
   * Piso de la zona 0 ("suave") cuando un tramo la prescribe: la horda no
   * puede ir a cero, así que un tramo suave la pone a este esfuerzo (~7 km/h).
   */
  easyFloorEffort: 0.35,
  /**
   * La horda corre esta fracción por DENTRO de la zona prescrita (0 = en el
   * piso, 0.5 = en el centro). En el borde bajo de la zona pierdes terreno
   * despacio; en el centro estás a salvo. Con 0 el juego se queda inerte:
   * cualquier pedaleo por encima del piso deja la ventaja clavada en el tope.
   */
  hordeFraction: 0.35,
} as const;

/**
 * Meta semanal del hábito. Dos puertas y basta con cruzar una: salidas por
 * semana (la que sostiene a quien empieza) o minutos en Z2+ (los 150 min de
 * actividad moderada que recomienda la OMS). La racha cuenta semanas, no
 * días: una racha diaria castiga al principiante y rompe el hábito que
 * pretende crear.
 */
export const HABIT = {
  sessionsPerWeek: 3,
  activeMinPerWeek: 150,
} as const;

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

/**
 * Qué entrada mueve al ciclista. El pulso es la entrada real del proyecto.
 * 'feel' es el modo por sensación: para quien no puede fiarse del pulso
 * (medicación, cribado con avisos): los tramos van por tiempo, el ciclista
 * sigue el paso prescrito y la guía es la prueba del habla, sin horda que
 * persiga por pulso.
 */
export type InputMode = 'heartRate' | 'cadence' | 'feel';

export interface SafetyConfig {
  /** Pulso por encima del máximo del perfil durante este tiempo → la horda se congela y se pide aflojar. */
  overMaxSec: number;
  /** Se suelta cuando el pulso baja esto por debajo del máximo (histéresis). */
  overMaxReleaseBpm: number;
  /** Fracción del máximo que cuenta como "muy alto"... */
  sustainedHighFrac: number;
  /** ...y cuánto tiempo seguido dispara el aviso (la escena cambia a suave en arranque y base). */
  sustainedHighSec: number;
}

export interface PushConfig {
  /** El empujón opcional de los fondos: duración y zona. */
  durationSec: number;
  zone: number | readonly [number, number];
  /** Ruta extra por completarlo sin ser alcanzado. */
  bonusM: number;
  /**
   * Cuenta atrás entre aceptar y empezar: el pulso necesita ese tiempo para
   * llegar, igual que el aviso de una oleada. La horda NO acelera en el
   * empujón: solo sube el techo del rider.
   */
  countdownSec: number;
  /** Segundos en la zona del empujón (o más arriba) que ganan el bono. */
  minZoneSec: number;
}

export interface CatchConfig {
  healthCost: number;
  knockbackGapM: number;
  distancePenaltyM: number;
  graceSec: number;
  /** Factor de velocidad de la horda mientras "se tropieza" tras atraparte. */
  stumbleSpeedFactor: number;
  /**
   * Segundos pedaleando en la zona prescrita que recuperan lo que cuesta una
   * captura (un corazón). Una captura es un tropiezo, no una herida: la salud
   * vuelve entrenando bien.
   */
  healthRegenSec: number;
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
  /**
   * Recuperación cardíaca: tras una oleada, el pico se busca durante este
   * tiempo (el pulso óptico sigue subiendo unos segundos después de parar)...
   */
  recoveryPeakWindowSec: number;
  /** ...y la caída se mide a este tiempo del final de la oleada (el minuto clásico). */
  recoveryWindowSec: number;
  maxDtSec: number;
  initialGapM: number;
  /**
   * La horda "despierta": arranca parada y llega a su velocidad en este
   * tiempo. Cubre el minuto que tarda el pulso en subir desde el reposo, y
   * permite empezar por debajo del tope para que la ventaja se GANE.
   */
  hordeWakeSec: number;
  /** Clamp del gap: prescripción sobre acumulación de ventaja. */
  gapMaxM: number;
  /** Rampa lineal de la horda al FRENAR al entrar a un segmento más lento. */
  zombieRampSec: number;
  /**
   * Rampa al ACELERAR (entrar a un tramo más duro). Larga a propósito: el
   * pulso óptico tarda 10-30 s en reflejar el esfuerzo, y la horda tiene que
   * llegar al ritmo al que llega tu corazón, no antes.
   */
  zombieRampUpSec: number;
  startResistance: number;
  maxHealth: number;
  /**
   * Aviso este tiempo antes de un tramo más duro. Con pulso como entrada hay
   * que empezar a empujar ANTES de que la horda acelere: el aviso es la señal.
   */
  surgeWarningSec: number;
  catch: CatchConfig;
  safety: SafetyConfig;
  push: PushConfig;
  /** Enfriamiento que sustituye al resto del programa al pulsar Terminar. */
  quitCooldownSec: number;
  /** Cada cuánto se muestrea la ventaja (y el pulso) para el fantasma y el diagnóstico. */
  gapTraceStepSec: number;
  /**
   * Ventana de asentamiento: al entrar a un tramo con techo más bajo, el
   * techo baja en rampa durante este tiempo en vez de caer de golpe. Un
   * pulso de muñeca baja con τ ≈ 35 s; sin la ventana, salir de un Z3 a un
   * Z2 congelaba la ventaja justo cuando la horda estaba más cerca (2026-09-17).
   */
  zoneSettleSec: number;
  /**
   * Tolerancia en latidos en el piso y el techo de la zona: lo que un sensor
   * óptico no distingue. Tres latidos bajo el piso cuestan lo que el borde.
   */
  zoneEdgeBpm: number;
}

export const SIM: SimConfig = {
  speed: SPEED,
  staleCadenceSec: 3,
  effort: EFFORT,
  staleHeartRateSec: 5,
  heartRateDecayBpmPerSec: 2,
  heartRateSmoothingSec: 2,
  heartRatePeakWindowSec: 5,
  recoveryPeakWindowSec: 20,
  recoveryWindowSec: 60,
  maxDtSec: 0.25,
  // Se empieza a mitad del tope: la ventaja se gana pedaleando bien y se ve
  // subir. La horda despierta despacio para que el retraso del pulso al
  // arrancar no cueste la salida: con 45 s, quien salía a 81 bpm tenía la
  // horda a 6 m al minuto de calor (2026-09-17).
  initialGapM: 50,
  hordeWakeSec: 90,
  // Tope del colchón. Con 150 m, quien se salta las oleadas y recupera "bien"
  // rellena en la recuperación lo que perdió en la oleada y nunca es
  // atrapado; con 100 m el intervalo se hace cumplir (ver catalog.pulse.test).
  gapMaxM: 100,
  zombieRampSec: 2,
  zombieRampUpSec: 12,
  startResistance: 2,
  maxHealth: 100,
  surgeWarningSec: 15,
  catch: {
    healthCost: 20,
    knockbackGapM: 12,
    distancePenaltyM: 25,
    graceSec: 5,
    stumbleSpeedFactor: 0.6,
    healthRegenSec: 180,
  },
  // Reglas de parada: el juego nunca pide más que el techo de la zona, y si
  // el pulso se pasa del máximo del perfil la horda se congela hasta que
  // afloja. Muy alto sostenido dos minutos es aviso, no premio.
  safety: {
    overMaxSec: 30,
    overMaxReleaseBpm: 3,
    sustainedHighFrac: 0.95,
    sustainedHighSec: 120,
  },
  push: {
    durationSec: 60,
    zone: 3,
    bonusM: 200,
    countdownSec: 15,
    minZoneSec: 20,
  },
  quitCooldownSec: 120,
  gapTraceStepSec: 5,
  zoneSettleSec: 45,
  zoneEdgeBpm: 3,
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
