import { RIDER, SIM, type InputMode, type RiderProfile, type SimConfig } from '../config';
import { effortFraction, playerSpeedFromEffort } from './effortTable';
import {
  expandProgram,
  segmentIndexAt,
  totalDurationSec,
  zombieSpeedAt,
  type ExpandedSegment,
  type TrainingProgram,
} from './program';
import { playerSpeedKph } from './speedTable';
import type { CadenceSample, HeartRateSample, RideSummary, SimEvent, SimState } from './types';
import { ceilingEffort, emptyZoneSec, floorEffort, zoneOf } from './zones';

export interface RideSimOptions {
  /** Qué entrada mueve al ciclista. Por defecto el pulso, la entrada real del proyecto. */
  inputMode?: InputMode;
  rider?: RiderProfile;
}

/**
 * El núcleo del juego: gap += (playerSpeed - zombieSpeed) * dt.
 * TypeScript puro y determinista: sin Phaser, sin DOM, sin timers propios.
 * El bucle de render lo avanza con update(dt); los tests lo avanzan igual.
 */
export class RideSim {
  private readonly segments: readonly ExpandedSegment[];
  private readonly totalSec: number;
  private readonly cfg: SimConfig;
  private readonly now: () => number;
  private readonly inputMode: InputMode;
  private readonly rider: RiderProfile;

  private elapsedSec = 0;
  private distanceM = 0;
  private gapM: number;
  private healthPct: number;
  private resistanceLevel: number;

  private latestRpm = 0;
  private sampleAgeSec = Number.POSITIVE_INFINITY;
  private staleNotified = false;
  private effectiveRpm = 0;

  private latestBpm = 0;
  private hrSampleAgeSec = Number.POSITIVE_INFINITY;
  private hrStaleNotified = false;
  /** Última lectura retenida; decae hacia el reposo si la pulsera calla. */
  private heldBpm = 0;
  private smoothedBpm = 0;
  private effortFrac = 0;

  private lastPlayerKph = 0;
  private lastZombieKph = 0;

  private caughtGraceSec = 0;
  private timesCaught = 0;
  private timesCaughtInEasy = 0;
  private healthDepletedNotified = false;

  private cadenceRpmSec = 0; // ∫ rpm dt, para la cadencia media del resumen
  private heartRateBpmSec = 0; // ∫ bpm dt, para el pulso medio del resumen
  private effortFracSec = 0; // ∫ esfuerzo dt
  private readonly zoneSec = emptyZoneSec(); // segundos por zona cardíaca
  private inZoneSec = 0; // dentro de la zona prescrita por el tramo
  private aboveZoneSec = 0; // por encima del techo del tramo
  private aboveZone = false;
  /** Medición en curso de la recuperación tras una oleada. */
  private recovery: { endSec: number; peakBpm: number } | undefined;
  private readonly recoveryDrops: number[] = [];
  private peakEmaBpm = 0; // pulso con ventana lenta: un pico de un segundo no cuenta
  private peakBpm = 0;
  private lastSegmentIndex = -1;
  private warnedSegmentIndex = -1;
  private ridePhase: 'riding' | 'finished' = 'riding';

  constructor(
    program: TrainingProgram,
    cfg: SimConfig = SIM,
    now: () => number = () => performance.now(),
    opts: RideSimOptions = {},
  ) {
    this.segments = expandProgram(program);
    this.totalSec = totalDurationSec(this.segments);
    this.cfg = cfg;
    this.now = now;
    this.inputMode = opts.inputMode ?? 'heartRate';
    this.rider = opts.rider ?? RIDER;
    this.gapM = cfg.initialGapM;
    this.healthPct = cfg.maxHealth;
    this.resistanceLevel = cfg.startResistance;
  }

  pushCadence(sample: CadenceSample): void {
    this.latestRpm = Math.max(0, sample.rpm);
    // Una muestra entregada tarde no cuenta como fresca.
    this.sampleAgeSec = Math.max(0, (this.now() - sample.timestampMs) / 1000);
    if (this.sampleAgeSec <= this.cfg.staleCadenceSec) this.staleNotified = false;
  }

  pushHeartRate(sample: HeartRateSample): void {
    if (sample.bpm <= 0) return;
    this.latestBpm = sample.bpm;
    this.hrSampleAgeSec = Math.max(0, (this.now() - sample.timestampMs) / 1000);
    if (this.hrSampleAgeSec <= this.cfg.staleHeartRateSec) {
      this.heldBpm = sample.bpm;
      this.hrStaleNotified = false;
    }
  }

  setResistance(level: number): void {
    const max = this.cfg.speed.kphByLevel.length;
    this.resistanceLevel = Math.min(max, Math.max(1, Math.round(level)));
  }

  update(dtSec: number): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.ridePhase === 'finished') return events;

    const dt = Math.min(Math.max(dtSec, 0), this.cfg.maxDtSec);
    if (dt <= 0) return events;

    const rpm = this.updateCadence(dt, events);
    const bpm = this.updateHeartRate(dt, events);

    this.caughtGraceSec = Math.max(0, this.caughtGraceSec - dt);

    const pKph =
      this.inputMode === 'heartRate'
        ? playerSpeedFromEffort(this.effortFrac, this.cfg.effort)
        : playerSpeedKph(this.resistanceLevel, rpm, this.cfg.speed);
    let zKph = zombieSpeedAt(
      this.segments,
      this.elapsedSec,
      this.cfg.zombieRampSec,
      this.cfg.zombieRampUpSec,
    );
    if (this.caughtGraceSec > 0) zKph *= this.cfg.catch.stumbleSpeedFactor;

    // Zona prescrita por el tramo: bajo el piso te alcanzan (la horda corre a
    // esa velocidad); sobre el techo la ventaja se congela. Recuperar bien es
    // entrenar, y pasarse en un tramo suave no debe rendir.
    const curSeg = this.segments[segmentIndexAt(this.segments, this.elapsedSec)];
    const above = curSeg !== undefined && this.effortFrac >= ceilingEffort(curSeg.zoneMax);
    const inZone = curSeg !== undefined && !above && this.effortFrac >= floorEffort(curSeg.zoneMin);
    this.aboveZone = above;

    // El juego entero es esta integral.
    let nextGap = this.gapM + ((pKph - zKph) / 3.6) * dt;
    if (above) nextGap = Math.min(nextGap, this.gapM);
    this.gapM = Math.max(0, Math.min(nextGap, this.cfg.gapMaxM));

    if (this.gapM <= 0 && this.caughtGraceSec <= 0) {
      this.timesCaught += 1;
      const kind = curSeg?.kind;
      if (kind === 'warmup' || kind === 'recover' || kind === 'cooldown') this.timesCaughtInEasy += 1;
      this.healthPct = Math.max(0, this.healthPct - this.cfg.catch.healthCost);
      this.gapM = this.cfg.catch.knockbackGapM;
      this.distanceM = Math.max(0, this.distanceM - this.cfg.catch.distancePenaltyM);
      this.caughtGraceSec = this.cfg.catch.graceSec;
      events.push({ type: 'caught', healthPct: this.healthPct });
      if (this.healthPct <= 0 && !this.healthDepletedNotified) {
        this.healthDepletedNotified = true;
        events.push({ type: 'healthDepleted' });
      }
    }

    this.distanceM += (pKph / 3.6) * dt;
    this.elapsedSec += dt;
    this.cadenceRpmSec += rpm * dt;
    this.heartRateBpmSec += bpm * dt;
    this.effortFracSec += this.effortFrac * dt;
    const zone = zoneOf(this.effortFrac);
    this.zoneSec[zone] = (this.zoneSec[zone] ?? 0) + dt;
    if (inZone) this.inZoneSec += dt;
    if (above) this.aboveZoneSec += dt;
    this.effectiveRpm = rpm;
    this.lastPlayerKph = pKph;
    this.lastZombieKph = zKph;

    const segIdx = segmentIndexAt(this.segments, this.elapsedSec);
    if (segIdx !== this.lastSegmentIndex) {
      const prev = this.segments[this.lastSegmentIndex];
      this.lastSegmentIndex = segIdx;
      const segment = this.segments[segIdx];
      if (segment) events.push({ type: 'segmentChanged', index: segIdx, segment });
      // Al salir de una oleada empieza la medición de la recuperación; otra
      // oleada antes del minuto la cancela.
      if (segment?.kind === 'surge') {
        this.recovery = undefined;
      } else if (prev?.kind === 'surge' && this.smoothedBpm > 0) {
        this.recovery = { endSec: this.elapsedSec, peakBpm: this.smoothedBpm };
      }
    }
    this.measureRecovery();

    // Aviso de oleada: una sola vez, cuando falte <= surgeWarningSec para un
    // segmento más rápido que el actual.
    const cur = this.segments[segIdx];
    const next = this.segments[segIdx + 1];
    if (cur && next && next.zombieSpeedKph > cur.zombieSpeedKph && this.warnedSegmentIndex !== segIdx + 1) {
      const inSec = cur.endSec - this.elapsedSec;
      if (inSec <= this.cfg.surgeWarningSec) {
        this.warnedSegmentIndex = segIdx + 1;
        events.push({ type: 'surgeWarning', inSec, toKph: next.zombieSpeedKph });
      }
    }

    // Completar el programa es la única manera de terminar. Ser atrapado nunca
    // termina la sesión: cortar el workout en el pico del estímulo es anti-meta.
    if (this.elapsedSec >= this.totalSec) {
      this.ridePhase = 'finished';
      events.push({ type: 'finished', summary: this.summary() });
    }

    return events;
  }

  /**
   * Recuperación cardíaca: el pico se busca durante los primeros segundos
   * tras la oleada (el pulso óptico llega tarde), y la caída se mide al
   * minuto. Solo con lectura fresca en ambos momentos.
   */
  private measureRecovery(): void {
    const r = this.recovery;
    if (!r) return;
    const since = this.elapsedSec - r.endSec;
    const stale = this.hrSampleAgeSec > this.cfg.staleHeartRateSec;
    if (since <= this.cfg.recoveryPeakWindowSec) {
      if (!stale) r.peakBpm = Math.max(r.peakBpm, this.smoothedBpm);
      return;
    }
    if (since >= this.cfg.recoveryWindowSec) {
      if (!stale && this.smoothedBpm > 0) this.recoveryDrops.push(Math.round(r.peakBpm - this.smoothedBpm));
      this.recovery = undefined;
    }
  }

  /**
   * La regla de staleness vive aquí, en el bucle — no en el callback BLE.
   * Un sensor parado deja de notificar; sin esto la última cadencia queda
   * congelada y la horda no alcanza a nadie nunca.
   */
  private updateCadence(dt: number, events: SimEvent[]): number {
    this.sampleAgeSec += dt;
    const stale = this.sampleAgeSec > this.cfg.staleCadenceSec;
    const rpm = stale ? 0 : this.latestRpm;
    if (stale && this.latestRpm > 0 && !this.staleNotified) {
      this.staleNotified = true;
      events.push({ type: 'staleCadence' });
    }
    return rpm;
  }

  /**
   * El pulso no cae a cero cuando la pulsera calla: su silencio es un dropout
   * (reconexión BLE), no un rider parado. La lectura retenida decae hacia el
   * reposo, y el suavizado exponencial quita el jitter del sensor óptico.
   */
  private updateHeartRate(dt: number, events: SimEvent[]): number {
    this.hrSampleAgeSec += dt;
    const stale = this.hrSampleAgeSec > this.cfg.staleHeartRateSec;
    if (stale) {
      if (this.latestBpm > 0 && !this.hrStaleNotified) {
        this.hrStaleNotified = true;
        events.push({ type: 'staleHeartRate' });
      }
      this.heldBpm = Math.max(
        this.rider.hrRestBpm,
        this.heldBpm - this.cfg.heartRateDecayBpmPerSec * dt,
      );
    }
    if (this.latestBpm <= 0) {
      this.smoothedBpm = 0;
    } else if (this.smoothedBpm <= 0) {
      this.smoothedBpm = this.heldBpm; // primera lectura: sin arrancar desde cero
    } else {
      const tau = this.cfg.heartRateSmoothingSec;
      const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
      this.smoothedBpm += (this.heldBpm - this.smoothedBpm) * k;
    }
    this.effortFrac = effortFraction(this.smoothedBpm, this.rider);

    // Pico sostenido: solo con lectura fresca, y a través de una ventana lenta.
    if (!stale && this.smoothedBpm > 0) {
      const tauPeak = this.cfg.heartRatePeakWindowSec;
      const kp = tauPeak > 0 ? 1 - Math.exp(-dt / tauPeak) : 1;
      this.peakEmaBpm = this.peakEmaBpm <= 0 ? this.smoothedBpm : this.peakEmaBpm + (this.smoothedBpm - this.peakEmaBpm) * kp;
      this.peakBpm = Math.max(this.peakBpm, this.peakEmaBpm);
    }
    return this.smoothedBpm;
  }

  get state(): SimState {
    const idx = segmentIndexAt(this.segments, this.elapsedSec);
    const seg = this.segments[idx];
    if (!seg) throw new Error('programa sin segmentos');
    const next = this.segments[idx + 1];
    const remainingSec = Math.max(0, seg.endSec - this.elapsedSec);
    return {
      elapsedSec: this.elapsedSec,
      totalSec: this.totalSec,
      distanceM: this.distanceM,
      gapM: this.gapM,
      healthPct: this.healthPct,
      inputMode: this.inputMode,
      cadenceRpm: this.effectiveRpm,
      cadenceStale: this.sampleAgeSec > this.cfg.staleCadenceSec,
      heartRateBpm: this.smoothedBpm,
      heartRateStale: this.hrSampleAgeSec > this.cfg.staleHeartRateSec,
      effortFrac: this.effortFrac,
      aboveZone: this.aboveZone,
      playerSpeedKph: this.lastPlayerKph,
      zombieSpeedKph: this.lastZombieKph,
      resistanceLevel: this.resistanceLevel,
      caughtGraceSec: this.caughtGraceSec,
      timesCaught: this.timesCaught,
      phase: this.ridePhase,
      segment: {
        index: idx,
        kind: seg.kind,
        zombieSpeedKph: seg.zombieSpeedKph,
        zoneMin: seg.zoneMin,
        zoneMax: seg.zoneMax,
        remainingSec,
        waveNumber: seg.waveNumber,
        waveTotal: seg.waveTotal,
        next: next
          ? {
              kind: next.kind,
              zombieSpeedKph: next.zombieSpeedKph,
              zoneMin: next.zoneMin,
              zoneMax: next.zoneMax,
              inSec: remainingSec,
            }
          : undefined,
      },
    };
  }

  /**
   * Resumen de lo pedaleado hasta ahora. Al terminar viaja en el evento
   * 'finished'; a mitad de sesión sirve para guardar una salida abandonada.
   */
  summary(): RideSummary {
    const t = this.elapsedSec;
    return {
      durationSec: t,
      distanceM: this.distanceM,
      timesCaught: this.timesCaught,
      timesCaughtInEasy: this.timesCaughtInEasy,
      avgCadenceRpm: t > 0 ? this.cadenceRpmSec / t : 0,
      avgHeartRateBpm: t > 0 ? this.heartRateBpmSec / t : 0,
      peakHeartRateBpm: this.peakBpm,
      avgEffortFrac: t > 0 ? this.effortFracSec / t : 0,
      zoneSec: [...this.zoneSec],
      inZoneSec: this.inZoneSec,
      aboveZoneSec: this.aboveZoneSec,
      recoveryDrops: [...this.recoveryDrops],
    };
  }
}
