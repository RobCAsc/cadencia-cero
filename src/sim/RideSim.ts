import { RIDER, SIM, type InputMode, type RiderProfile, type SimConfig } from '../config';
import { effortFraction, playerSpeedFromEffort } from './effortTable';
import {
  expandProgram,
  hordeSpeedForZone,
  segmentIndexAt,
  totalDurationSec,
  zombieSpeedAt,
  type ExpandedSegment,
  type TrainingProgram,
} from './program';
import { playerSpeedKph } from './speedTable';
import type { CadenceSample, HeartRateSample, RideSummary, SimEvent, SimState } from './types';
import { ceilingEffort, emptyZoneSec, floorEffort, zoneOf, zoneRange, type ZoneRange } from './zones';

export interface RideSimOptions {
  /** Qué entrada mueve al ciclista. Por defecto el pulso, la entrada real del proyecto. */
  inputMode?: InputMode;
  rider?: RiderProfile;
}

const EASY_KINDS = new Set(['warmup', 'recover', 'cooldown']);

/**
 * El núcleo del juego: gap += (playerSpeed - zombieSpeed) * dt.
 * TypeScript puro y determinista: sin Phaser, sin DOM, sin timers propios.
 * El bucle de render lo avanza con update(dt); los tests lo avanzan igual.
 */
export class RideSim {
  private segments: ExpandedSegment[];
  private totalSec: number;
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

  // Reglas de parada: pulso por encima del máximo del perfil (la horda se
  // congela y se pide aflojar) y muy alto sostenido (la escena decide si
  // cambiar a suave). Solo con lectura fresca y solo en modo pulso.
  private overMaxSec = 0;
  private easeOff = false;
  private highSec = 0;
  private sustainedHighNotified = false;

  /** Enfriamiento tras "Terminar": la horda se para y el programa acaba en dos minutos. */
  private coolingDown = false;
  /** El resto de la salida cambiado a suave (salud a cero, pulso muy alto sostenido). */
  private eased = false;
  /** El empujón opcional: uno por salida. */
  private pushUsed = false;
  private push: { endSec: number; caughtBefore: number } | undefined;

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
  /** Ventaja muestreada cada gapTraceStepSec: el fantasma de la próxima vez. */
  private readonly gapTrace: number[] = [];
  private nextTraceSec = 0;
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

  /**
   * "Terminar" no corta en seco: lo que queda del programa se sustituye por
   * un enfriamiento con la horda parada. Cortar justo después de una oleada
   * es cuando más fácil es marearse; el camino fácil tiene que ser enfriar.
   */
  beginCooldown(durationSec: number = this.cfg.quitCooldownSec): void {
    if (this.ridePhase !== 'riding' || this.coolingDown) return;
    const idx = segmentIndexAt(this.segments, this.elapsedSec);
    const cur = this.segments[idx];
    if (!cur) return;
    const t = this.elapsedSec;
    const truncated: ExpandedSegment = { ...cur, durationSec: t - cur.startSec, endSec: t };
    const cooldown: ExpandedSegment = {
      kind: 'cooldown',
      durationSec,
      zone: [0, 1],
      zoneMin: 0,
      zoneMax: 1,
      zombieSpeedKph: 0,
      cue: 'Enfriamiento: gira suave, la horda se queda',
      startSec: t,
      endSec: t + durationSec,
      sourceIndex: -1,
    };
    this.segments = [...this.segments.slice(0, idx), truncated, cooldown];
    this.totalSec = cooldown.endSec;
    this.coolingDown = true;
    this.push = undefined;
  }

  /**
   * Lo que queda del programa, en suave: un tramo Z0-Z1 con la horda al paso
   * de esa zona y la vuelta a la calma al final. Es "cambiar a suave" sin
   * perder la salida: con la salud a cero, o con el pulso muy alto sostenido
   * en las fases de arranque y base.
   */
  easeRemaining(cooldownSec: number = this.cfg.quitCooldownSec): void {
    if (this.ridePhase !== 'riding' || this.coolingDown || this.eased) return;
    const idx = segmentIndexAt(this.segments, this.elapsedSec);
    const cur = this.segments[idx];
    if (!cur) return;
    const t = this.elapsedSec;
    const remaining = this.totalSec - t;
    this.eased = true;
    this.push = undefined;
    this.pushUsed = true;
    if (remaining <= cooldownSec) {
      this.beginCooldown(remaining);
      return;
    }
    const easyKph = hordeSpeedForZone(0, 1, this.cfg.effort);
    const truncated: ExpandedSegment = { ...cur, durationSec: t - cur.startSec, endSec: t };
    const easy: ExpandedSegment = {
      kind: 'recover',
      durationSec: remaining - cooldownSec,
      zone: [0, 1],
      zoneMin: 0,
      zoneMax: 1,
      zombieSpeedKph: easyKph,
      cue: 'Suave hasta el final: gira sin apretar',
      startSec: t,
      endSec: this.totalSec - cooldownSec,
      sourceIndex: -1,
    };
    const cooldown: ExpandedSegment = {
      kind: 'cooldown',
      durationSec: cooldownSec,
      zone: [0, 1],
      zoneMin: 0,
      zoneMax: 1,
      zombieSpeedKph: easyKph,
      startSec: easy.endSec,
      endSec: this.totalSec,
      sourceIndex: -1,
    };
    this.segments = [...this.segments.slice(0, idx), truncated, easy, cooldown];
  }

  /** Acabar ya, saltándose el enfriamiento (segundo toque en Terminar). */
  endNow(): void {
    if (this.ridePhase !== 'riding') return;
    const idx = segmentIndexAt(this.segments, this.elapsedSec);
    const cur = this.segments[idx];
    if (!cur) return;
    const t = Math.max(this.elapsedSec, cur.startSec + 0.001);
    this.segments = [...this.segments.slice(0, idx), { ...cur, durationSec: t - cur.startSec, endSec: t }];
    this.totalSec = t;
  }

  /**
   * El empujón opcional: un tramo corto en la zona dada, insertado ahora
   * dentro de un tramo continuo. Completarlo sin ser alcanzado suma ruta.
   * Uno por salida; la escena decide cuándo y si ofrecerlo.
   */
  insertPush(
    durationSec: number = this.cfg.push.durationSec,
    zone: ZoneRange = this.cfg.push.zone,
  ): boolean {
    if (this.ridePhase !== 'riding' || this.coolingDown || this.pushUsed) return false;
    const idx = segmentIndexAt(this.segments, this.elapsedSec);
    const cur = this.segments[idx];
    if (!cur || cur.kind !== 'steady') return false;
    const t = this.elapsedSec;
    const [zoneMin, zoneMax] = zoneRange(zone);
    const before: ExpandedSegment = { ...cur, durationSec: t - cur.startSec, endSec: t };
    const push: ExpandedSegment = {
      kind: 'push',
      durationSec,
      zone,
      zoneMin,
      zoneMax,
      zombieSpeedKph: hordeSpeedForZone(zoneMin, zoneMax, this.cfg.effort),
      cue: 'Empujón: un minuto en Z3',
      startSec: t,
      endSec: t + durationSec,
      sourceIndex: -1,
    };
    const after: ExpandedSegment = {
      ...cur,
      durationSec: cur.endSec - t,
      startSec: t + durationSec,
      endSec: cur.endSec + durationSec,
    };
    const rest = this.segments
      .slice(idx + 1)
      .map((s) => ({ ...s, startSec: s.startSec + durationSec, endSec: s.endSec + durationSec }));
    this.segments = [...this.segments.slice(0, idx), before, push, after, ...rest];
    this.totalSec += durationSec;
    this.pushUsed = true;
    this.push = { endSec: push.endSec, caughtBefore: this.timesCaught };
    return true;
  }

  update(dtSec: number): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.ridePhase === 'finished') return events;

    const dt = Math.min(Math.max(dtSec, 0), this.cfg.maxDtSec);
    if (dt <= 0) return events;

    const rpm = this.updateCadence(dt, events);
    const bpm = this.updateHeartRate(dt, events);
    this.updateSafety(dt, events);

    this.caughtGraceSec = Math.max(0, this.caughtGraceSec - dt);

    const curSeg = this.segments[segmentIndexAt(this.segments, this.elapsedSec)];
    const feel = this.inputMode === 'feel';

    let zKph = zombieSpeedAt(this.segments, this.elapsedSec, this.cfg.zombieRampSec, this.cfg.zombieRampUpSec);
    // La horda despierta: parada al principio, a su ritmo al cabo de hordeWakeSec.
    if (this.cfg.hordeWakeSec > 0 && !feel) zKph *= Math.min(1, this.elapsedSec / this.cfg.hordeWakeSec);
    if (this.caughtGraceSec > 0) zKph *= this.cfg.catch.stumbleSpeedFactor;
    // Por sensación: el ciclista va al paso prescrito y la horda no gana nunca.
    // Enfriando o con el pulso pasado del máximo, la horda se para.
    const pKph = feel
      ? zKph
      : this.inputMode === 'heartRate'
        ? playerSpeedFromEffort(this.effortFrac, this.cfg.effort)
        : playerSpeedKph(this.resistanceLevel, rpm, this.cfg.speed);
    if (this.coolingDown || this.easeOff) zKph = 0;

    // Zona prescrita por el tramo: bajo el piso te alcanzan (la horda corre a
    // esa velocidad); sobre el techo la ventaja se congela. Recuperar bien es
    // entrenar, y pasarse en un tramo suave no debe rendir.
    const above = !feel && curSeg !== undefined && this.effortFrac >= ceilingEffort(curSeg.zoneMax);
    const inZone = feel
      ? curSeg !== undefined
      : curSeg !== undefined && !above && this.effortFrac >= floorEffort(curSeg.zoneMin);
    this.aboveZone = above;

    // El juego entero es esta integral.
    let nextGap = this.gapM + ((pKph - zKph) / 3.6) * dt;
    if (above || this.easeOff) nextGap = Math.min(nextGap, this.gapM);
    this.gapM = Math.max(0, Math.min(nextGap, this.cfg.gapMaxM));

    if (this.gapM <= 0 && this.caughtGraceSec <= 0) {
      this.timesCaught += 1;
      if (curSeg && EASY_KINDS.has(curSeg.kind)) this.timesCaughtInEasy += 1;
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
    // Por sensación se da por hecha la zona prescrita: no hay pulso que la
    // contradiga (o no vale, como con betabloqueantes).
    const zone = feel ? (curSeg?.zoneMin ?? 0) : zoneOf(this.effortFrac);
    this.zoneSec[zone] = (this.zoneSec[zone] ?? 0) + dt;
    if (inZone) this.inZoneSec += dt;
    if (above) this.aboveZoneSec += dt;
    this.effectiveRpm = rpm;
    this.lastPlayerKph = pKph;
    this.lastZombieKph = zKph;
    if (this.elapsedSec >= this.nextTraceSec) {
      this.gapTrace.push(Math.round(this.gapM));
      this.nextTraceSec += this.cfg.gapTraceStepSec;
    }

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
      // El empujón completado sin captura suma ruta.
      if (prev?.kind === 'push' && this.push) {
        if (this.timesCaught === this.push.caughtBefore) {
          this.distanceM += this.cfg.push.bonusM;
          events.push({ type: 'pushDone', bonusM: this.cfg.push.bonusM });
        }
        this.push = undefined;
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
   * Reglas de parada, solo con pulso fresco. Pasado el máximo del perfil
   * durante overMaxSec la horda se congela y se pide aflojar (se suelta unos
   * latidos por debajo, para no parpadear). Muy alto sostenido durante
   * sustainedHighSec avisa una vez: la escena decide si cambiar a suave.
   */
  private updateSafety(dt: number, events: SimEvent[]): void {
    const stale = this.hrSampleAgeSec > this.cfg.staleHeartRateSec;
    if (this.inputMode !== 'heartRate' || stale || this.smoothedBpm <= 0) {
      this.overMaxSec = 0;
      this.highSec = 0;
      return;
    }
    const max = this.rider.hrMaxBpm;
    const safety = this.cfg.safety;
    this.overMaxSec = this.smoothedBpm > max ? this.overMaxSec + dt : 0;
    if (!this.easeOff && this.overMaxSec >= safety.overMaxSec) {
      this.easeOff = true;
      events.push({ type: 'overMax' });
    } else if (this.easeOff && this.smoothedBpm <= max - safety.overMaxReleaseBpm) {
      this.easeOff = false;
    }
    this.highSec = this.smoothedBpm >= max * safety.sustainedHighFrac ? this.highSec + dt : 0;
    if (!this.sustainedHighNotified && this.highSec >= safety.sustainedHighSec) {
      this.sustainedHighNotified = true;
      events.push({ type: 'sustainedHigh', sec: this.highSec });
    }
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
      easeOff: this.easeOff,
      coolingDown: this.coolingDown,
      eased: this.eased,
      pushAvailable:
        this.ridePhase === 'riding' && !this.coolingDown && !this.pushUsed && seg.kind === 'steady',
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
        cue: seg.cue,
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

  /** Los tramos vigentes (cambian con el enfriamiento y el empujón). */
  get currentSegments(): readonly ExpandedSegment[] {
    return this.segments;
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
      gapTrace: [...this.gapTrace],
    };
  }
}
