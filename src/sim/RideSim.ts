import { SIM, type SimConfig } from '../config';
import {
  expandProgram,
  segmentIndexAt,
  totalDurationSec,
  zombieSpeedAt,
  type ExpandedSegment,
  type TrainingProgram,
} from './program';
import { playerSpeedKph } from './speedTable';
import type { CadenceSample, RideSummary, SimEvent, SimState } from './types';

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

  private elapsedSec = 0;
  private distanceM = 0;
  private gapM: number;
  private healthPct: number;
  private resistanceLevel: number;

  private latestRpm = 0;
  private sampleAgeSec = Number.POSITIVE_INFINITY;
  private staleNotified = false;
  private effectiveRpm = 0;
  private lastPlayerKph = 0;
  private lastZombieKph = 0;

  private caughtGraceSec = 0;
  private timesCaught = 0;
  private healthDepletedNotified = false;

  private cadenceRpmSec = 0; // ∫ rpm dt, para la cadencia media del resumen
  private lastSegmentIndex = -1;
  private warnedSegmentIndex = -1;
  private ridePhase: 'riding' | 'finished' = 'riding';

  constructor(
    program: TrainingProgram,
    cfg: SimConfig = SIM,
    now: () => number = () => performance.now(),
  ) {
    this.segments = expandProgram(program);
    this.totalSec = totalDurationSec(this.segments);
    this.cfg = cfg;
    this.now = now;
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

  setResistance(level: number): void {
    const max = this.cfg.speed.kphByLevel.length;
    this.resistanceLevel = Math.min(max, Math.max(1, Math.round(level)));
  }

  update(dtSec: number): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.ridePhase === 'finished') return events;

    const dt = Math.min(Math.max(dtSec, 0), this.cfg.maxDtSec);
    if (dt <= 0) return events;

    // La regla de staleness vive aquí, en el bucle — no en el callback BLE.
    // Un sensor parado deja de notificar; sin esto la última cadencia queda
    // congelada y la horda no alcanza a nadie nunca.
    this.sampleAgeSec += dt;
    const stale = this.sampleAgeSec > this.cfg.staleCadenceSec;
    const rpm = stale ? 0 : this.latestRpm;
    if (stale && this.latestRpm > 0 && !this.staleNotified) {
      this.staleNotified = true;
      events.push({ type: 'staleCadence' });
    }

    this.caughtGraceSec = Math.max(0, this.caughtGraceSec - dt);

    const pKph = playerSpeedKph(this.resistanceLevel, rpm, this.cfg.speed);
    let zKph = zombieSpeedAt(this.segments, this.elapsedSec, this.cfg.zombieRampSec);
    if (this.caughtGraceSec > 0) zKph *= this.cfg.catch.stumbleSpeedFactor;

    // El juego entero es esta integral.
    this.gapM = Math.max(0, Math.min(this.gapM + ((pKph - zKph) / 3.6) * dt, this.cfg.gapMaxM));

    if (this.gapM <= 0 && this.caughtGraceSec <= 0) {
      this.timesCaught += 1;
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
    this.effectiveRpm = rpm;
    this.lastPlayerKph = pKph;
    this.lastZombieKph = zKph;

    const segIdx = segmentIndexAt(this.segments, this.elapsedSec);
    if (segIdx !== this.lastSegmentIndex) {
      this.lastSegmentIndex = segIdx;
      const segment = this.segments[segIdx];
      if (segment) events.push({ type: 'segmentChanged', index: segIdx, segment });
    }

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
      cadenceRpm: this.effectiveRpm,
      cadenceStale: this.sampleAgeSec > this.cfg.staleCadenceSec,
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
        remainingSec,
        waveNumber: seg.waveNumber,
        waveTotal: seg.waveTotal,
        next: next
          ? { kind: next.kind, zombieSpeedKph: next.zombieSpeedKph, inSec: remainingSec }
          : undefined,
      },
    };
  }

  private summary(): RideSummary {
    return {
      durationSec: this.elapsedSec,
      distanceM: this.distanceM,
      timesCaught: this.timesCaught,
      avgCadenceRpm: this.elapsedSec > 0 ? this.cadenceRpmSec / this.elapsedSec : 0,
    };
  }
}
