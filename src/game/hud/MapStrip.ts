import Phaser from 'phaser';
import type { ExpandedSegment } from '../../sim/program';
import { aheadSegments, asymptoticPx, etaSec } from '../../sim/rideMap';
import type { SimState } from '../../sim/types';
import { formatMMSS } from '../format';
import { FONT_MONO, FONT_SANS, KIND_COLOR, UI } from '../theme';
import { icon } from '../ui/paper';

/**
 * La tira de mapa de la HUD: la carretera vista desde arriba con el rider
 * fijo. A su izquierda, lo que hay detrás en metros (la horda, el fantasma);
 * a su derecha, lo que viene en minutos (los tramos con su color, las cuestas
 * rayadas, el refugio, el amanecer). Sustituye a la barra de tramos: es la
 * misma información, más lo de alrededor, en un dibujo.
 */

export interface MapStripExtras {
  /** Tu ventaja menos la del fantasma (positivo: vas por delante de la última vez). */
  ghostDeltaM?: number;
  /** El siguiente refugio de la Ruta y lo que falta hasta él. */
  refuge?: { name: string; distanceM: number };
}

/** Minutos de carretera por delante que caben en la tira. */
const AHEAD_SEC = 900;
const TICK_SEC = 120;
/** Píxeles reservados a lo que hay detrás del rider. */
const BEHIND_PX = 180;
const BEHIND_HALF_M = 45;
const BEHIND_MAX_PX = 170;
const ROAD = 0x2a303f;
const GOLD = 0xd9b06a;
const GOLD_HEX = '#d9b06a';
const GHOST = 0xc8d7f0;
const HORDE_DOTS: ReadonlyArray<readonly [number, number]> = [[-14, -8], [-4, 6], [6, -6], [12, 8], [-9, 10], [2, -12]];
const MAX_CLIMB_LABELS = 6;

export class MapStrip {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly rightLabel: Phaser.GameObjects.Text;
  private readonly hordeLabel: Phaser.GameObjects.Text;
  private readonly ghostLabel: Phaser.GameObjects.Text;
  private readonly refugeLabel: Phaser.GameObjects.Text;
  private readonly sunLabel: Phaser.GameObjects.Text;
  private readonly tickLabels: Phaser.GameObjects.Text[] = [];
  private readonly climbLabels: Phaser.GameObjects.Text[] = [];
  private segments: readonly ExpandedSegment[];
  /** La x del rider: lo de detrás a la izquierda, lo que viene a la derecha. */
  private readonly rx: number;
  private readonly pxPerSec: number;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly x: number,
    private readonly y: number,
    private readonly w: number,
    private readonly h: number,
    depth: number,
    segments: readonly ExpandedSegment[],
  ) {
    this.segments = segments;
    this.rx = x + BEHIND_PX;
    this.pxPerSec = (w - BEHIND_PX) / AHEAD_SEC;
    this.g = scene.add.graphics().setDepth(depth);
    const small = (tx: number, ty: number, color: string, align: 'left' | 'center' | 'right' = 'left', mono = false, size = 12) =>
      scene.add
        .text(tx, ty, '', { fontFamily: mono ? FONT_MONO : FONT_SANS, fontSize: `${size}px`, color })
        .setOrigin(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0)
        .setDepth(depth + 1);
    this.rightLabel = small(x + w, y - 16, UI.textDim, 'right', true);
    this.hordeLabel = small(0, y - 22, UI.danger, 'left', true).setFontStyle('bold');
    this.ghostLabel = small(0, y + h + 18, GOLD_HEX, 'right', true);
    this.refugeLabel = small(0, y + h + 18, UI.warn, 'center');
    this.sunLabel = small(0, y + h + 18, UI.textDim, 'center');
    this.sunLabel.setText('amanecer');
    for (let k = 1; k * TICK_SEC < AHEAD_SEC; k++) {
      const t = small(this.rx + k * TICK_SEC * this.pxPerSec, y + h + 5, UI.textDim, 'center', true, 10);
      t.setText(`+${(k * TICK_SEC) / 60}'`);
      this.tickLabels.push(t);
    }
    for (let i = 0; i < MAX_CLIMB_LABELS; i++) {
      this.climbLabels.push(small(0, 0, '#ffffff', 'left').setFontStyle('bold').setVisible(false));
    }
  }

  /** Los tramos cambian con el enfriamiento, el empujón o el resto en suave. */
  setSegments(segments: readonly ExpandedSegment[]): void {
    this.segments = segments;
  }

  update(state: SimState, extras: MapStripExtras = {}): void {
    const g = this.g;
    const { x, y, w, h, rx } = this;
    const mid = y + h / 2;
    g.clear();

    // El asfalto, más oscuro detrás del rider.
    g.fillStyle(ROAD, 1);
    g.fillRoundedRect(x, y, w, h, 8);
    g.fillStyle(0x000000, 0.25);
    g.fillRect(x, y, rx - x, h);

    // Lo que viene, en minutos: cada tramo con su color; las cuestas, rayadas.
    let climbs = 0;
    for (const s of aheadSegments(this.segments, state.elapsedSec, AHEAD_SEC)) {
      const sx = rx + s.offsetSec * this.pxPerSec;
      const sw = s.durationSec * this.pxPerSec;
      g.fillStyle(KIND_COLOR[s.kind] ?? 0xffffff, 0.55);
      g.fillRect(sx, y + 6, Math.max(1, sw - 2), h - 12);
      if (s.grade !== undefined && s.grade > 0) {
        g.lineStyle(2, 0xffffff, 0.28);
        for (let hx = sx + 2; hx + 12 <= sx + sw - 2; hx += 12) g.lineBetween(hx, y + h - 6, hx + 12, y + 6);
        const label = this.climbLabels[climbs];
        if (label && sw >= 60) {
          climbs += 1;
          icon(g, 'mountain', sx + sw / 2 - 22, mid, 16, 0xffffff);
          label.setPosition(sx + sw / 2 - 10, mid - 8).setText(`▲ ${s.grade} %`).setVisible(true);
        }
      }
    }
    for (let i = climbs; i < this.climbLabels.length; i++) this.climbLabels[i]!.setVisible(false);

    // La línea central, el marco y las marcas de minutos.
    g.fillStyle(0xffffff, 0.35);
    for (let dx = x + 8; dx < x + w - 10; dx += 20) g.fillRect(dx, mid - 1, 10, 2);
    for (let k = 1; k * TICK_SEC < AHEAD_SEC; k++) g.fillRect(rx + k * TICK_SEC * this.pxPerSec, y + h, 1, 4);
    g.lineStyle(1, 0xffffff, 0.14);
    g.strokeRoundedRect(x + 0.5, y + 0.5, w - 1, h - 1, 8);

    // El amanecer, cuando ya cabe en la tira.
    const remaining = Math.max(0, state.totalSec - state.elapsedSec);
    const sunX = rx + remaining * this.pxPerSec;
    if (sunX <= x + w) {
      icon(g, 'sun', sunX, mid, 20, GOLD);
      this.sunLabel.setPosition(sunX, y + h + 18).setVisible(true);
    } else {
      this.sunLabel.setVisible(false);
    }
    setIfChanged(this.rightLabel, `quedan ${formatMMSS(remaining)}`);

    // El refugio que viene: a la distancia que tardas en llegar a este paso;
    // si no cabe (o estás parado), pegado al borde.
    if (extras.refuge) {
      const eta = etaSec(extras.refuge.distanceM, state.playerSpeedKph);
      const fx = eta !== undefined ? rx + eta * this.pxPerSec : Number.POSITIVE_INFINITY;
      const km = (extras.refuge.distanceM / 1000).toFixed(1).replace('.', ',');
      if (fx <= x + w - 12) {
        icon(g, 'house', fx, mid, 18, 0xf39c12);
        this.refugeLabel.setOrigin(0.5, 0).setPosition(fx, y + h + 18).setAlpha(1);
      } else {
        icon(g, 'house', x + w - 14, mid, 16, 0xf39c12, 0.5);
        this.refugeLabel.setOrigin(1, 0).setPosition(x + w, y + h + 18).setAlpha(0.6);
      }
      setIfChanged(this.refugeLabel, `${extras.refuge.name} · ${km} km`);
      this.refugeLabel.setVisible(true);
    } else {
      this.refugeLabel.setVisible(false);
    }

    // La horda detrás, a escala asintótica como en la carretera.
    const hx = rx - asymptoticPx(state.gapM, BEHIND_HALF_M, BEHIND_MAX_PX);
    g.fillStyle(0xe74c3c, 0.16);
    g.fillCircle(hx, mid, 30);
    g.fillStyle(0xe74c3c, 0.22);
    g.fillCircle(hx, mid, 18);
    g.fillStyle(0xe74c3c, 1);
    for (const [dx, dy] of HORDE_DOTS) g.fillCircle(hx + dx, mid + dy, 3.2);
    icon(g, 'zombie', hx, y - 12, 18, 0xe74c3c);
    this.hordeLabel.setPosition(hx + 12, y - 22);
    setIfChanged(this.hordeLabel, `${Math.round(state.gapM)} m`);

    // El fantasma: detrás si vas por delante de la última vez, delante si no.
    if (extras.ghostDeltaM !== undefined) {
      const d = extras.ghostDeltaM;
      const off = asymptoticPx(Math.abs(d), BEHIND_HALF_M, BEHIND_MAX_PX);
      const gx = d >= 0 ? rx - off : rx + off;
      g.fillStyle(GHOST, 0.85);
      g.fillCircle(gx, mid, 5);
      icon(g, 'bike', gx, y + h + 26, 14, GHOST, 0.7);
      this.ghostLabel.setPosition(gx - 10, y + h + 18).setColor(d >= 0 ? GOLD_HEX : UI.textMuted).setVisible(true);
      setIfChanged(this.ghostLabel, `${d >= 0 ? '+' : '−'}${Math.round(Math.abs(d))} m`);
    } else {
      this.ghostLabel.setVisible(false);
    }

    // El rider, fijo: una línea, un halo y su bici.
    g.fillStyle(0xffffff, 0.35);
    g.fillRect(rx - 1, y - 6, 2, h + 12);
    g.fillStyle(0x78a0ff, 0.25);
    g.fillCircle(rx, mid, 16);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(rx, mid, 6);
    icon(g, 'bike', rx, y - 14, 22, 0xffffff);
  }

}

/** Cambiar el texto de un Text cuesta un rasterizado: solo cuando cambia. */
function setIfChanged(t: Phaser.GameObjects.Text, s: string): void {
  if (t.text !== s) t.setText(s);
}
