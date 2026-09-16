import Phaser from 'phaser';
import { RENDER, SIM } from '../../config';
import type { ExpandedSegment } from '../../sim/program';
import type { SimState } from '../../sim/types';
import { talkTestCue, zoneLabel, zoneOf } from '../../sim/zones';
import { formatMMSS } from '../format';
import { FONT_MONO, FONT_SANS, KIND_COLOR, UI, ZONE_COLOR } from '../theme';
import { makeTextButton, type TapButton } from '../uiButton';
import { KIND_ES } from './KindNames';

export { KIND_ES };

const HEALTH_W = 256;
const ZONE_X = 24;
const ZONE_Y = 130;
const ZONE_W = 300;
const ZONE_H = 14;
const ZONE_GAP = 3;
const TIMELINE_X = 340;
const TIMELINE_Y = 170;
const TIMELINE_W = 600;
const TIMELINE_H = 26;
const QUIT_ARM_MS = 3000;
const GOLD = '#d9b06a';

export interface HudOptions {
  segments: readonly ExpandedSegment[];
  onQuit: () => void;
}

export interface HudExtras {
  /** Tu ventaja menos la del fantasma en este minuto (positivo = vas por delante de la última vez). */
  ghostDeltaM?: number;
}

/**
 * Lectura del estado, nada más: el gap gigante al centro es el protagonista.
 * Alrededor, lo que el rider necesita para entrenar bien: en qué zona va y
 * cuál le pide el tramo, dónde está dentro de la sesión, y una salida digna
 * si hoy no puede más (terminar enfría y guarda la salida; nunca la borra).
 */
export class Hud {
  private readonly gapText: Phaser.GameObjects.Text;
  private readonly gapLabel: Phaser.GameObjects.Text;
  private readonly hordeSpeedText: Phaser.GameObjects.Text;
  private readonly ghostText: Phaser.GameObjects.Text;
  private readonly cadenceText: Phaser.GameObjects.Text;
  private readonly statsText: Phaser.GameObjects.Text;
  private readonly rightText: Phaser.GameObjects.Text;
  private readonly healthFill: Phaser.GameObjects.Rectangle;
  private readonly healthBg: Phaser.GameObjects.Rectangle;
  private readonly zoneBar: Phaser.GameObjects.Graphics;
  private readonly zoneCaption: Phaser.GameObjects.Text;
  private readonly timeline: Phaser.GameObjects.Graphics;
  private readonly playhead: Phaser.GameObjects.Graphics;
  private readonly quitButton: TapButton;
  private segments: readonly ExpandedSegment[];
  private totalSec: number;
  private maxKph: number;
  private quitArmedUntil = 0;
  private cooling = false;

  constructor(
    private readonly scene: Phaser.Scene,
    opts: HudOptions,
  ) {
    this.segments = opts.segments;
    const last = opts.segments[opts.segments.length - 1];
    this.totalSec = last ? last.endSec : 1;
    this.maxKph = Math.max(1, ...opts.segments.map((s) => s.zombieSpeedKph));

    const cx = RENDER.width / 2;
    this.gapText = scene.add
      .text(cx, 18, '', { fontFamily: FONT_MONO, fontSize: '84px', fontStyle: 'bold', color: UI.good })
      .setOrigin(0.5, 0)
      .setDepth(10);
    this.gapLabel = scene.add
      .text(cx, 112, 'de ventaja', { fontFamily: FONT_SANS, fontSize: '20px', color: UI.textMuted })
      .setOrigin(0.5, 0)
      .setDepth(10);
    this.hordeSpeedText = scene.add
      .text(cx, 140, '', { fontFamily: FONT_SANS, fontSize: '16px', color: UI.textDim })
      .setOrigin(0.5, 0)
      .setDepth(10);
    this.ghostText = scene.add
      .text(cx, 206, '', { fontFamily: FONT_SANS, fontSize: '16px', color: GOLD })
      .setOrigin(0.5, 0)
      .setDepth(10);

    this.cadenceText = scene.add
      .text(24, 16, '', { fontFamily: FONT_MONO, fontSize: '40px', color: UI.textBright })
      .setDepth(10);
    this.statsText = scene.add
      .text(24, 68, '', { fontFamily: FONT_MONO, fontSize: '24px', color: UI.textMuted, lineSpacing: 6 })
      .setDepth(10);

    // Barra de zonas: Z1..Z5, la tuya encendida, la del tramo enmarcada.
    this.zoneBar = scene.add.graphics().setDepth(10);
    this.zoneCaption = scene.add
      .text(ZONE_X, ZONE_Y + ZONE_H + 8, '', { fontFamily: FONT_SANS, fontSize: '15px', color: UI.textMuted, wordWrap: { width: 300 } })
      .setDepth(10);

    // Línea de tiempo del programa: el perfil de la horda con un cabezal.
    this.timeline = scene.add.graphics().setDepth(10);
    this.drawTimeline();
    this.playhead = scene.add.graphics().setDepth(11);

    this.rightText = scene.add
      .text(RENDER.width - 24, 16, '', {
        fontFamily: FONT_MONO,
        fontSize: '24px',
        color: UI.textMuted,
        align: 'right',
        lineSpacing: 6,
      })
      .setOrigin(1, 0)
      .setDepth(10);

    this.quitButton = makeTextButton(scene, RENDER.width - 24 - 90, 138, 180, 44, 'Terminar', () => this.onQuitTap(opts.onQuit), 10, 18);
    this.quitButton.rect.setAlpha(0.7);

    scene.add
      .text(24, RENDER.height - 86, 'Salud', { fontFamily: FONT_SANS, fontSize: '18px', color: UI.textMuted })
      .setDepth(10);
    this.healthBg = scene.add
      .rectangle(24, RENDER.height - 60, HEALTH_W + 4, 22, 0x2c3242)
      .setOrigin(0, 0)
      .setDepth(10);
    this.healthFill = scene.add
      .rectangle(26, RENDER.height - 58, HEALTH_W, 18, 0x2ecc71)
      .setOrigin(0, 0)
      .setDepth(10);
  }

  /** Los tramos cambian con el enfriamiento, el empujón o el resto en suave: la línea de tiempo se rehace. */
  setSegments(segments: readonly ExpandedSegment[]): void {
    this.segments = segments;
    const last = segments[segments.length - 1];
    this.totalSec = last ? last.endSec : 1;
    this.maxKph = Math.max(1, ...segments.map((s) => s.zombieSpeedKph));
    this.drawTimeline();
  }

  update(state: SimState, extras: HudExtras = {}): void {
    this.gapText.setText(`${Math.round(state.gapM)} m`);
    this.gapText.setColor(
      state.gapM < RENDER.gapDangerM ? UI.danger : state.gapM < RENDER.gapWarnM ? UI.warn : UI.good,
    );
    // Con la horda encima el número late.
    const pulse =
      state.gapM < RENDER.gapDangerM
        ? 1 + 0.06 * Math.abs(Math.sin((this.scene.time.now / 1000) * Math.PI * 1.6))
        : 1;
    this.gapText.setScale(pulse);
    // Lo que le pasa a la ventaja, dicho: enfriando, pulso pasado del máximo,
    // por encima del techo de zona, o nada.
    if (state.coolingDown) {
      this.gapLabel.setText('enfriando · la horda se queda');
      this.gapLabel.setColor(UI.info);
    } else if (state.easeOff) {
      this.gapLabel.setText('AFLOJA · pulso sobre tu máximo');
      this.gapLabel.setColor(UI.danger);
    } else if (state.aboveZone) {
      this.gapLabel.setText('ventaja congelada');
      this.gapLabel.setColor(UI.warn);
    } else {
      this.gapLabel.setText('de ventaja');
      this.gapLabel.setColor(UI.textMuted);
    }
    this.hordeSpeedText.setText(
      state.coolingDown || state.easeOff
        ? 'horda parada'
        : state.elapsedSec < SIM.hordeWakeSec && state.zombieSpeedKph < state.segment.zombieSpeedKph * 0.95
          ? 'la horda despierta…'
          : `horda a ${state.zombieSpeedKph.toFixed(0)} km/h`,
    );
    if (extras.ghostDeltaM === undefined) {
      this.ghostText.setText('');
    } else {
      const d = Math.round(extras.ghostDeltaM);
      this.ghostText.setText(d >= 0 ? `fantasma: vas ${d} m por delante de la última vez` : `fantasma: ${-d} m por detrás de la última vez`);
      this.ghostText.setColor(d >= 0 ? GOLD : UI.textMuted);
    }

    const feel = state.inputMode === 'feel';
    const heartRate = state.inputMode === 'heartRate' || (!feel && state.heartRateBpm > 0);
    if (feel) {
      this.cadenceText.setText('por sensación');
      this.cadenceText.setColor(UI.textMuted);
      this.statsText.setText(
        `${state.playerSpeedKph.toFixed(1)} km/h\n${(state.distanceM / 1000).toFixed(2)} km`,
      );
    } else if (state.inputMode === 'heartRate') {
      // El pulso es la entrada: va donde iba la cadencia, con el esfuerzo al lado.
      const bpm = state.heartRateBpm > 0 ? `${Math.round(state.heartRateBpm)}` : '––';
      this.cadenceText.setText(`♥ ${bpm}`);
      this.cadenceText.setColor(state.heartRateStale ? UI.textDim : UI.danger);
      this.statsText.setText(
        `${state.playerSpeedKph.toFixed(1)} km/h · ${Math.round(state.effortFrac * 100)} %\n${(state.distanceM / 1000).toFixed(2)} km`,
      );
    } else {
      this.cadenceText.setText(`${Math.round(state.cadenceRpm)} rpm`);
      this.cadenceText.setColor(state.cadenceStale ? UI.textDim : UI.textBright);
      this.statsText.setText(
        `${state.playerSpeedKph.toFixed(1)} km/h\n${(state.distanceM / 1000).toFixed(2)} km`,
      );
    }
    this.drawZones(state, heartRate, feel);
    this.drawPlayhead(state.elapsedSec);

    const seg = state.segment;
    const segName =
      seg.kind === 'surge' && seg.waveNumber !== undefined
        ? `Oleada ${seg.waveNumber}/${seg.waveTotal}`
        : seg.grade !== undefined && seg.grade > 0
          ? `Cuesta ▲ ${seg.grade} %`
          : (KIND_ES[seg.kind] ?? seg.kind);
    const nextLine = seg.next
      ? `Sigue: ${KIND_ES[seg.next.kind] ?? seg.next.kind} · ${zoneLabel(seg.next.zoneMin, seg.next.zoneMax)}`
      : 'Último tramo';
    this.rightText.setText(
      `${formatMMSS(state.elapsedSec)} / ${formatMMSS(state.totalSec)}\n${segName} · ${formatMMSS(seg.remainingSec)}\n${nextLine}`,
    );

    if (state.coolingDown && !this.cooling) {
      this.cooling = true;
      this.quitArmedUntil = 0;
      this.quitButton.label.setText('Saltar enfriamiento');
      this.quitButton.label.setColor(UI.textBright);
      this.quitButton.rect.setAlpha(0.7);
    }
    if (!this.cooling && this.quitArmedUntil > 0 && this.scene.time.now > this.quitArmedUntil) this.disarmQuit();

    const frac = Math.max(0, Math.min(1, state.healthPct / SIM.maxHealth));
    this.healthFill.setScale(frac, 1);
    this.healthFill.setFillStyle(frac > 0.6 ? 0x2ecc71 : frac > 0.3 ? 0xf39c12 : 0xe74c3c);
  }

  pulseHealth(): void {
    this.scene.tweens.add({
      targets: [this.healthFill, this.healthBg],
      alpha: { from: 1, to: 0.25 },
      duration: 110,
      yoyo: true,
      repeat: 3,
    });
  }

  hideQuit(): void {
    this.quitButton.rect.setVisible(false).disableInteractive();
    this.quitButton.label.setVisible(false);
  }

  // ---- zonas ----------------------------------------------------------------

  private drawZones(state: SimState, show: boolean, feel: boolean): void {
    const g = this.zoneBar;
    g.clear();
    const { zoneMin, zoneMax } = state.segment;
    if (feel) {
      // Sin pulso que mande, la guía es la prueba del habla.
      this.zoneCaption.setText(`El tramo pide ${zoneLabel(zoneMin, zoneMax)}: ${talkTestCue(zoneMin, zoneMax)}`);
      this.zoneCaption.setColor(UI.info);
      this.zoneCaption.setY(ZONE_Y);
      return;
    }
    if (!show) {
      this.zoneCaption.setText('');
      return;
    }
    const zone = zoneOf(state.effortFrac);
    // La zona prescrita por el tramo viene del programa: se enmarca entera.
    const segW = (ZONE_W - ZONE_GAP * 4) / 5;
    for (let z = 1; z <= 5; z++) {
      const x = ZONE_X + (z - 1) * (segW + ZONE_GAP);
      const color = ZONE_COLOR[z] ?? 0xffffff;
      g.fillStyle(color, z === zone ? 1 : 0.28);
      g.fillRect(x, ZONE_Y, segW, ZONE_H);
    }
    if (zoneMax >= 1) {
      const from = Math.max(1, zoneMin);
      const x0 = ZONE_X + (from - 1) * (segW + ZONE_GAP);
      const x1 = ZONE_X + (zoneMax - 1) * (segW + ZONE_GAP) + segW;
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeRect(x0 - 1, ZONE_Y - 1, x1 - x0 + 2, ZONE_H + 2);
    }
    // Marcador del esfuerzo actual: un triángulo bajo la barra, entre el 50 y el 100 %.
    if (state.heartRateBpm > 0) {
      const frac = Math.max(0, Math.min(1, (state.effortFrac - 0.5) / 0.5));
      const mx = ZONE_X + frac * ZONE_W;
      g.fillStyle(0xffffff, state.heartRateStale ? 0.35 : 1);
      g.fillTriangle(mx - 6, ZONE_Y + ZONE_H + 7, mx + 6, ZONE_Y + ZONE_H + 7, mx, ZONE_Y + ZONE_H + 1);
    }
    const mine = zone === 0 ? 'suave' : `Z${zone}`;
    let verdict = '';
    let color: string = UI.textMuted;
    if (state.heartRateBpm > 0) {
      if (state.easeOff) {
        verdict = ' · AFLOJA';
        color = UI.danger;
      } else if (state.aboveZone) {
        verdict = ' · afloja';
        color = UI.warn;
      } else if (zone < zoneMin) {
        verdict = ' · sube';
      } else {
        verdict = ' · bien';
        color = UI.good;
      }
    }
    // La racha en zona: feedback inmediato de precisión, a partir de medio minuto.
    const run = state.inZoneRunSec >= 30 ? ` · ${formatMMSS(state.inZoneRunSec)} seguidos en zona` : '';
    this.zoneCaption.setText(`Vas en ${mine} · el tramo pide ${zoneLabel(zoneMin, zoneMax)}${verdict}${run}`);
    this.zoneCaption.setColor(color);
    this.zoneCaption.setY(ZONE_Y + ZONE_H + 12);
  }

  // ---- línea de tiempo --------------------------------------------------------

  private drawTimeline(): void {
    const g = this.timeline;
    g.clear();
    g.fillStyle(0x0b0e18, 0.55);
    g.fillRect(TIMELINE_X - 4, TIMELINE_Y - 4, TIMELINE_W + 8, TIMELINE_H + 8);
    for (const seg of this.segments) {
      if (seg.durationSec <= 0) continue;
      const x = TIMELINE_X + (TIMELINE_W * seg.startSec) / this.totalSec;
      const w = Math.max(1, (TIMELINE_W * seg.durationSec) / this.totalSec - 1);
      const h = Math.max(3, (TIMELINE_H - 4) * (seg.zombieSpeedKph / this.maxKph));
      g.fillStyle(KIND_COLOR[seg.kind] ?? 0xffffff, 0.8);
      g.fillRect(x, TIMELINE_Y + TIMELINE_H - h, w, h);
    }
    g.fillStyle(0x3a4152, 1);
    g.fillRect(TIMELINE_X, TIMELINE_Y + TIMELINE_H, TIMELINE_W, 2);
  }

  private drawPlayhead(elapsedSec: number): void {
    const g = this.playhead;
    g.clear();
    const x = TIMELINE_X + (TIMELINE_W * Math.min(1, elapsedSec / this.totalSec));
    // Lo ya pedaleado se apaga un poco; el cabezal marca dónde vas.
    g.fillStyle(0x05060e, 0.45);
    g.fillRect(TIMELINE_X, TIMELINE_Y - 2, Math.max(0, x - TIMELINE_X), TIMELINE_H + 4);
    g.fillStyle(0xffffff, 0.95);
    g.fillRect(x - 1, TIMELINE_Y - 4, 2, TIMELINE_H + 8);
    g.fillTriangle(x - 5, TIMELINE_Y - 9, x + 5, TIMELINE_Y - 9, x, TIMELINE_Y - 3);
  }

  // ---- terminar -----------------------------------------------------------------

  private onQuitTap(onQuit: () => void): void {
    // Enfriando, el botón salta el enfriamiento y acaba ya.
    if (this.cooling) {
      onQuit();
      return;
    }
    if (this.quitArmedUntil > 0 && this.scene.time.now <= this.quitArmedUntil) {
      this.disarmQuit();
      onQuit();
      return;
    }
    // Primer toque: pide confirmación tres segundos; el segundo enfría.
    this.quitArmedUntil = this.scene.time.now + QUIT_ARM_MS;
    this.quitButton.label.setText('¿Terminar? Enfría 2 min');
    this.quitButton.label.setColor(UI.warn);
    this.quitButton.rect.setAlpha(1);
  }

  private disarmQuit(): void {
    this.quitArmedUntil = 0;
    this.quitButton.label.setText('Terminar');
    this.quitButton.label.setColor(UI.textBright);
    this.quitButton.rect.setAlpha(0.7);
  }
}
