import Phaser from 'phaser';
import { RENDER, SIM } from '../../config';
import type { ExpandedSegment } from '../../sim/program';
import type { SimState } from '../../sim/types';
import { talkTestCue, zoneLabel, zoneOf } from '../../sim/zones';
import { formatMMSS } from '../format';
import { FONT_MONO, FONT_SANS, KIND_COLOR, UI, ZONE_COLOR } from '../theme';
import { makeTextButton, type TapButton } from '../uiButton';
import { makeIconButton, type IconButton } from '../ui/iconButton';
import { icon, type IconName } from '../ui/paper';
import { KIND_ES } from './KindNames';
import { MapStrip, type MapStripExtras } from './MapStrip';

export { KIND_ES };

/** El icono de cada tipo de tramo: lo que viene, sin leerlo. */
const KIND_ICON: Record<string, IconName> = {
  warmup: 'flame',
  steady: 'road',
  surge: 'zombie',
  recover: 'moon',
  cooldown: 'moon',
  push: 'bolt',
};
const HEARTS = 5;

const ZONE_X = 24;
const ZONE_Y = 130;
const ZONE_W = 300;
const ZONE_H = 14;
const ZONE_GAP = 3;
/** La tira de mapa: donde iba la barra de tramos, bajo el número de ventaja. */
const STRIP_X = 340;
const STRIP_Y = 172;
const STRIP_W = 620;
const STRIP_H = 44;
const QUIT_ARM_MS = 3000;

export interface HudOptions {
  segments: readonly ExpandedSegment[];
  onQuit: () => void;
  /** Abrir o cerrar la vista de mapa. */
  onMap?: () => void;
}

/** Lo que la HUD enseña y el sim no sabe: el fantasma y la Ruta. */
export type HudExtras = MapStripExtras;

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
  private readonly cadenceText: Phaser.GameObjects.Text;
  private readonly statsText: Phaser.GameObjects.Text;
  private readonly rightText: Phaser.GameObjects.Text;
  private readonly segmentTime: Phaser.GameObjects.Text;
  private readonly segmentGlyph: Phaser.GameObjects.Graphics;
  private readonly heartGlyph: Phaser.GameObjects.Graphics;
  private readonly gapGlyph: Phaser.GameObjects.Graphics;
  private readonly hearts: Phaser.GameObjects.Graphics;
  private lastHealthPct = -1;
  private readonly zoneBar: Phaser.GameObjects.Graphics;
  private readonly zoneCaption: Phaser.GameObjects.Text;
  private readonly strip: MapStrip;
  private readonly quitButton: TapButton;
  private readonly mapButton: IconButton;
  private quitArmedUntil = 0;
  private cooling = false;

  constructor(
    private readonly scene: Phaser.Scene,
    opts: HudOptions,
  ) {
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

    // Tu pulso: un corazón dibujado que late, y el número.
    this.heartGlyph = scene.add.graphics().setDepth(10);
    this.cadenceText = scene.add
      .text(66, 16, '', { fontFamily: FONT_MONO, fontSize: '40px', color: UI.textBright })
      .setDepth(10);
    this.statsText = scene.add
      .text(24, 68, '', { fontFamily: FONT_MONO, fontSize: '22px', color: UI.textMuted, lineSpacing: 6 })
      .setDepth(10);
    this.gapGlyph = scene.add.graphics().setDepth(10);

    // Barra de zonas: Z1..Z5, la tuya encendida, la del tramo enmarcada.
    this.zoneBar = scene.add.graphics().setDepth(10);
    this.zoneCaption = scene.add
      .text(ZONE_X, ZONE_Y + ZONE_H + 8, '', { fontFamily: FONT_SANS, fontSize: '15px', color: UI.textMuted, wordWrap: { width: 300 } })
      .setDepth(10);

    // La tira de mapa: lo de detrás en metros, lo que viene en minutos.
    this.strip = new MapStrip(scene, STRIP_X, STRIP_Y, STRIP_W, STRIP_H, 10, opts.segments);

    // El tramo: su icono y lo que le queda, grande; debajo, lo que sigue y el total.
    this.segmentGlyph = scene.add.graphics().setDepth(10);
    this.segmentTime = scene.add
      .text(RENDER.width - 24, 12, '', { fontFamily: FONT_MONO, fontSize: '44px', fontStyle: 'bold', color: UI.textBright })
      .setOrigin(1, 0)
      .setDepth(10);
    this.rightText = scene.add
      .text(RENDER.width - 24, 64, '', {
        fontFamily: FONT_MONO,
        fontSize: '18px',
        color: UI.textMuted,
        align: 'right',
        lineSpacing: 4,
      })
      .setOrigin(1, 0)
      .setDepth(10);

    this.quitButton = makeTextButton(scene, RENDER.width - 24 - 90, 138, 180, 44, 'Terminar', () => this.onQuitTap(opts.onQuit), 10, 18);
    this.quitButton.rect.setAlpha(0.7);
    // La vista de mapa, junto a Terminar.
    this.mapButton = makeIconButton(scene, RENDER.width - 24 - 180 - 8 - 48, 138, 96, 44, 'map', 'Mapa', () => opts.onMap?.(), 10, 16);
    this.mapButton.rect.setAlpha(0.7);

    // La salud: cinco corazones; cada captura apaga uno.
    this.hearts = scene.add.graphics().setDepth(10);
  }

  /** Los tramos cambian con el enfriamiento, el empujón o el resto en suave: la tira los sigue. */
  setSegments(segments: readonly ExpandedSegment[]): void {
    this.strip.setSegments(segments);
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
    // Lo que le pasa a la ventaja, con su icono: enfriando, pulso pasado del
    // máximo, por encima del techo de zona, o la horda a tantos metros.
    const gg = this.gapGlyph;
    gg.clear();
    const cx = RENDER.width / 2;
    if (state.coolingDown) {
      this.gapLabel.setText('enfriando');
      this.gapLabel.setColor(UI.info);
      icon(gg, 'snowflake', cx - this.gapLabel.width / 2 - 18, 124, 18, 0x7ec8ff);
    } else if (state.easeOff) {
      this.gapLabel.setText('AFLOJA');
      this.gapLabel.setColor(UI.danger);
      icon(gg, 'warning', cx - this.gapLabel.width / 2 - 20, 124, 20, 0xe74c3c);
    } else if (state.aboveZone) {
      this.gapLabel.setText('congelada');
      this.gapLabel.setColor(UI.warn);
      icon(gg, 'snowflake', cx - this.gapLabel.width / 2 - 18, 124, 16, 0xf39c12);
    } else if (state.settling) {
      // El pulso viene bajando de un tramo más duro: la ventaja sigue viva.
      this.gapLabel.setText(`bajando a ${zoneLabel(state.segment.zoneMin, state.segment.zoneMax)}`);
      this.gapLabel.setColor(UI.info);
      icon(gg, 'arrowDown', cx - this.gapLabel.width / 2 - 18, 124, 16, 0x7ec8ff);
    } else {
      this.gapLabel.setText('de ventaja');
      this.gapLabel.setColor(UI.textMuted);
      icon(gg, 'zombie', cx - this.gapLabel.width / 2 - 20, 124, 22, 0xe74c3c, 0.85);
    }
    this.hordeSpeedText.setText(
      state.coolingDown || state.easeOff
        ? 'horda parada'
        : state.hordeFading
          ? 'la horda se queda…'
          : state.elapsedSec < state.hordeWakeSec && state.zombieSpeedKph < state.segment.zombieSpeedKph * 0.95
            ? 'la horda despierta…'
            : `horda a ${state.zombieSpeedKph.toFixed(0)} km/h`,
    );
    const feel = state.inputMode === 'feel';
    const heartRate = state.inputMode === 'heartRate' || (!feel && state.heartRateBpm > 0);
    const hg = this.heartGlyph;
    hg.clear();
    if (feel) {
      this.cadenceText.setText('por sensación');
      this.cadenceText.setColor(UI.textMuted);
      this.cadenceText.setX(24);
      this.statsText.setText(
        `${state.playerSpeedKph.toFixed(1)} km/h\n${(state.distanceM / 1000).toFixed(2)} km`,
      );
    } else if (state.inputMode === 'heartRate') {
      // El pulso es la entrada: un corazón que late a tu ritmo, y el número.
      const bpm = state.heartRateBpm > 0 ? `${Math.round(state.heartRateBpm)}` : '––';
      const beat = state.heartRateBpm > 0 ? 1 + 0.12 * Math.max(0, Math.sin((this.scene.time.now / 1000) * Math.PI * 2 * (state.heartRateBpm / 60))) : 1;
      icon(hg, 'heart', 40, 38, 30 * beat, state.heartRateStale ? 0x5d6470 : 0xe74c3c);
      this.cadenceText.setText(bpm);
      this.cadenceText.setColor(state.heartRateStale ? UI.textDim : UI.textBright);
      this.cadenceText.setX(66);
      this.statsText.setText(
        `${state.playerSpeedKph.toFixed(1)} km/h · ${Math.round(state.effortFrac * 100)} %\n${(state.distanceM / 1000).toFixed(2)} km`,
      );
    } else {
      this.cadenceText.setText(`${Math.round(state.cadenceRpm)} rpm`);
      this.cadenceText.setColor(state.cadenceStale ? UI.textDim : UI.textBright);
      this.cadenceText.setX(24);
      this.statsText.setText(
        `${state.playerSpeedKph.toFixed(1)} km/h\n${(state.distanceM / 1000).toFixed(2)} km`,
      );
    }
    this.drawZones(state, heartRate, feel);
    this.strip.update(state, extras);

    const seg = state.segment;
    const segName =
      seg.kind === 'surge' && seg.waveNumber !== undefined
        ? `Oleada ${seg.waveNumber}/${seg.waveTotal}`
        : seg.grade !== undefined && seg.grade > 0
          ? `Cuesta ▲ ${seg.grade} %`
          : (KIND_ES[seg.kind] ?? seg.kind);
    const nextLine = seg.next
      ? `→ ${KIND_ES[seg.next.kind] ?? seg.next.kind} ${zoneLabel(seg.next.zoneMin, seg.next.zoneMax)}`
      : 'último tramo';
    // Lo que queda del tramo, grande, con su icono; el resto en pequeño.
    this.segmentTime.setText(formatMMSS(seg.remainingSec));
    const sg = this.segmentGlyph;
    sg.clear();
    const kindColor = KIND_COLOR[seg.kind] ?? 0xffffff;
    icon(sg, seg.grade !== undefined && seg.grade > 0 ? 'mountain' : (KIND_ICON[seg.kind] ?? 'road'), RENDER.width - 24 - this.segmentTime.width - 28, 36, 30, kindColor);
    this.rightText.setText(`${segName} · ${zoneLabel(seg.zoneMin, seg.zoneMax)}\n${nextLine}\n${formatMMSS(state.elapsedSec)} / ${formatMMSS(state.totalSec)}`);

    if (state.coolingDown && !this.cooling) {
      this.cooling = true;
      this.quitArmedUntil = 0;
      this.quitButton.label.setText('Saltar enfriamiento');
      this.quitButton.label.setColor(UI.textBright);
      this.quitButton.rect.setAlpha(0.7);
    }
    if (!this.cooling && this.quitArmedUntil > 0 && this.scene.time.now > this.quitArmedUntil) this.disarmQuit();

    if (state.healthPct !== this.lastHealthPct) {
      this.lastHealthPct = state.healthPct;
      this.drawHearts(state.healthPct);
    }
  }

  /** Cinco corazones: los que quedan encendidos, los perdidos apagados. */
  private drawHearts(healthPct: number): void {
    const g = this.hearts;
    g.clear();
    const alive = Math.round((healthPct / SIM.maxHealth) * HEARTS);
    for (let i = 0; i < HEARTS; i++) {
      const x = 40 + i * 38;
      const y = RENDER.height - 58;
      if (i < alive) icon(g, 'heart', x, y, 30, alive <= 2 ? 0xe74c3c : 0x2ecc71);
      else icon(g, 'heart', x, y, 30, 0x2c3242, 0.9);
    }
  }

  pulseHealth(): void {
    this.scene.tweens.add({
      targets: [this.hearts],
      alpha: { from: 1, to: 0.25 },
      duration: 110,
      yoyo: true,
      repeat: 3,
    });
  }

  hideQuit(): void {
    this.quitButton.rect.setVisible(false).disableInteractive();
    this.quitButton.label.setVisible(false);
    this.mapButton.rect.setVisible(false).disableInteractive();
    this.mapButton.gfx.setVisible(false);
    this.mapButton.label.setVisible(false);
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
      } else if (state.settling) {
        verdict = ' · bajando';
        color = UI.info;
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
