import Phaser from 'phaser';
import { RENDER } from '../../config';
import type { ExpandedSegment } from '../../sim/program';
import { asymptoticPx, routeWindow, type RouteWindow } from '../../sim/rideMap';
import type { SimState } from '../../sim/types';
import { zoneLabel, zoneOf } from '../../sim/zones';
import { formatMMSS } from '../format';
import { KIND_ES } from '../hud/KindNames';
import { FONT_MONO, FONT_SANS, KIND_COLOR } from '../theme';
import { makeTextButton } from '../uiButton';
import {
  heading,
  icon,
  INK,
  INK_DIM,
  INK_GOLD,
  INK_GOLD_HEX,
  INK_GREEN,
  INK_GREEN_HEX,
  INK_HEX,
  INK_MUTED,
  INK_RED,
  INK_RED_HEX,
  PAPER,
  PAPER_DARK,
  paperPanel,
  stamp,
} from '../ui/paper';

/**
 * La vista de mapa: el papel de la Ruta durante la salida. La carretera a
 * mano con los refugios que caen en la ventana, el trozo de hoy en dorado,
 * tú en tu km, la horda detrás y el fantasma; debajo, la salida tramo a
 * tramo con el cabezal. La salida sigue corriendo: la ventaja y el pulso se
 * ven aquí. Un toque fuera del botón devuelve a la carretera.
 */

const DEPTH = 25;
const W = 1180;
const H = 650;
const BEHIND_KM = 5;
const AHEAD_KM = 10;
const ROAD_POINTS = 240;
const km1 = (km: number): string => km.toFixed(1).replace('.', ',');

export interface MapViewOptions {
  programName: string;
  segments: readonly ExpandedSegment[];
  /** Km de la Ruta antes de hoy: donde empieza el trozo de hoy. */
  kmBeforeToday: number;
  onClose: () => void;
}

export interface MapViewExtras {
  ghostDeltaM?: number;
}

interface TextOpts {
  bold?: boolean;
  mono?: boolean;
  align?: 'left' | 'center' | 'right';
  list?: Phaser.GameObjects.GameObject[];
}

export class MapView {
  private readonly left: number;
  private readonly top: number;
  private readonly objects: Phaser.GameObjects.GameObject[];
  private routeObjects: Phaser.GameObjects.GameObject[] = [];
  private profileObjects: Phaser.GameObjects.GameObject[] = [];
  private readonly subtitle: Phaser.GameObjects.Text;
  private stampObj: Phaser.GameObjects.Container | undefined;
  private stampText = '';
  private readonly underlay: Phaser.GameObjects.Graphics;
  private readonly actors: Phaser.GameObjects.Graphics;
  private readonly profileDyn: Phaser.GameObjects.Graphics;
  private readonly hordeLabel: Phaser.GameObjects.Text;
  private readonly ghostLabel: Phaser.GameObjects.Text;
  private readonly riderLabel: Phaser.GameObjects.Text;
  private readonly sunLabel: Phaser.GameObjects.Text;
  private readonly refugeLabel: Phaser.GameObjects.Text;
  private readonly nowLine: Phaser.GameObjects.Text;
  private readonly gapText: Phaser.GameObjects.Text;
  private readonly bpmText: Phaser.GameObjects.Text;
  private readonly bpmCaption: Phaser.GameObjects.Text;
  private window!: RouteWindow;
  private points: Phaser.Math.Vector2[] = [];
  private pathLen = 1;
  /** Dónde va la etiqueta "faltan X km" del siguiente refugio de la ventana. */
  private nextRefugeAnchor: { km: number; x: number; y: number } | undefined;
  private segments: readonly ExpandedSegment[] = [];
  private totalSec = 1;
  private readonly kmBeforeToday: number;
  private readonly programName: string;
  // El perfil de la salida, abajo a la izquierda.
  private readonly SX: number;
  private readonly SY: number;
  private readonly SW = 700;
  private readonly SH = 44;

  constructor(
    private readonly scene: Phaser.Scene,
    opts: MapViewOptions,
  ) {
    this.kmBeforeToday = opts.kmBeforeToday;
    this.programName = opts.programName;
    const panel = paperPanel(scene, W, H, DEPTH, 'Mapa de la Ruta');
    this.left = panel.left;
    this.top = panel.top;
    this.objects = [...panel.objects];
    // Un toque fuera de los botones devuelve a la carretera.
    panel.objects[0]?.on('pointerdown', opts.onClose);
    const { left, top } = this;
    this.SX = left + 36;
    this.SY = top + 496;

    this.subtitle = this.text(panel.cx, top + 74, '', 15, INK_MUTED, { align: 'center' });
    const fixed = scene.add.graphics().setDepth(DEPTH + 2);
    this.objects.push(fixed);
    icon(fixed, 'compass', left + W - 70, top + 440, 40, INK_HEX, 0.7);
    // Los números del momento.
    const NX = left + 800;
    const NY = top + 490;
    icon(fixed, 'zombie', NX + 14, NY + 22, 28, INK_RED_HEX);
    icon(fixed, 'heart', NX + 174, NY + 22, 26, INK_RED_HEX);
    this.gapText = this.text(NX + 34, NY, '', 34, INK_GREEN, { bold: true, mono: true });
    this.text(NX + 36, NY + 40, 'de ventaja', 12, INK_MUTED);
    this.bpmText = this.text(NX + 194, NY, '', 34, INK, { bold: true, mono: true });
    this.bpmCaption = this.text(NX + 196, NY + 40, '', 12, INK_MUTED);

    this.underlay = scene.add.graphics().setDepth(DEPTH + 1);
    this.actors = scene.add.graphics().setDepth(DEPTH + 3);
    this.profileDyn = scene.add.graphics().setDepth(DEPTH + 3);
    this.objects.push(this.underlay, this.actors, this.profileDyn);
    this.hordeLabel = this.text(0, 0, '', 12, INK_RED, { bold: true, align: 'center' });
    this.ghostLabel = this.text(0, 0, 'última vez', 11, INK_DIM);
    this.riderLabel = this.text(0, 0, 'tú', 13, INK, { bold: true, align: 'center' });
    this.sunLabel = this.text(0, 0, 'amanecer', 11, INK_GOLD, { align: 'center' });
    this.refugeLabel = this.text(0, 0, '', 12, INK_GOLD, { bold: true, mono: true, align: 'center' });
    this.nowLine = this.text(this.SX, this.SY + this.SH + 22, '', 13, INK_MUTED);

    this.buildRoute(opts.kmBeforeToday);
    this.setSegments(opts.segments);

    const back = makeTextButton(scene, left + W - 166, top + H - 36, 260, 40, 'Volver a la carretera', opts.onClose, DEPTH + 2, 18);
    this.objects.push(back.rect, back.label);
  }

  /** Los tramos cambian con el enfriamiento, el empujón o el resto en suave: el perfil se rehace. */
  setSegments(segments: readonly ExpandedSegment[]): void {
    this.segments = segments;
    const last = segments[segments.length - 1];
    this.totalSec = last ? last.endSec : 1;
    this.profileObjects.forEach((o) => o.destroy());
    this.profileObjects = [];
    const { SX, SY, SW, SH } = this;
    const list = this.profileObjects;
    list.push(heading(this.scene, SX, SY - 22, 'La salida de hoy', 12, INK_MUTED, DEPTH + 2));
    const g = this.scene.add.graphics().setDepth(DEPTH + 2);
    list.push(g);
    const maxKph = Math.max(1, ...segments.map((s) => s.zombieSpeedKph));
    for (const seg of segments) {
      if (seg.durationSec <= 0) continue;
      const sx = SX + (SW * seg.startSec) / this.totalSec;
      const sw = (SW * seg.durationSec) / this.totalSec;
      const sh = SH * (0.35 + 0.65 * (seg.zombieSpeedKph / maxKph));
      g.fillStyle(KIND_COLOR[seg.kind] ?? 0xffffff, 0.9);
      g.fillRect(sx, SY + SH - sh, Math.max(1, sw - 1), sh);
      g.lineStyle(1, INK_HEX, 0.4);
      g.strokeRect(sx + 0.5, SY + SH - sh + 0.5, Math.max(1, sw - 2), sh - 1);
      if (seg.grade !== undefined && seg.grade > 0) this.text(sx + sw / 2, SY + SH - sh - 14, '▲', 11, INK_MUTED, { align: 'center', list });
      if (sw >= 22) this.text(sx + sw / 2, SY + SH + 6, `${Math.round(seg.durationSec / 60)}'`, 11, INK_DIM, { align: 'center', mono: true, list });
    }
    g.fillStyle(INK_HEX, 1);
    g.fillRect(SX, SY + SH, SW, 2);
  }

  update(state: SimState, extras: MapViewExtras = {}): void {
    const kmNow = this.kmBeforeToday + state.distanceM / 1000;
    if (kmNow > this.window.toKm - 0.5) this.buildRoute(kmNow);
    setIfChanged(
      this.subtitle,
      `${this.programName} · ${formatMMSS(state.elapsedSec)} / ${formatMMSS(state.totalSec)} · ${km1(state.distanceM / 1000)} km hoy`,
    );
    const stampText = `km ${km1(kmNow)}`;
    if (stampText !== this.stampText) {
      this.stampText = stampText;
      this.stampObj?.destroy();
      this.stampObj = stamp(this.scene, this.left + W - 120, this.top + 52, stampText, INK_RED, DEPTH + 2, 14);
    }

    // El trozo de hoy: hecho en dorado, y a puntos hasta donde calculo que acabas.
    const remaining = Math.max(0, state.totalSec - state.elapsedSec);
    const kmEnd = kmNow + (remaining * (state.playerSpeedKph / 3.6)) / 1000;
    const u = this.underlay;
    u.clear();
    const i0 = this.index(this.window.frac(this.kmBeforeToday));
    const i1 = this.index(this.window.frac(kmNow));
    const i2 = this.index(this.window.frac(kmEnd));
    u.lineStyle(30, INK_GOLD_HEX, 0.28);
    for (let i = i0; i < i1; i++) u.lineBetween(this.points[i]!.x, this.points[i]!.y, this.points[i + 1]!.x, this.points[i + 1]!.y);
    u.fillStyle(INK_GOLD_HEX, 0.45);
    for (let i = i1; i <= i2; i += 3) u.fillCircle(this.points[i]!.x, this.points[i]!.y, 3);

    // Los actores: el amanecer estimado, la horda, el fantasma y tú.
    const a = this.actors;
    a.clear();
    const fracNow = this.window.frac(kmNow);
    const end = this.at(this.window.frac(kmEnd));
    icon(a, 'sun', end.x + 10, end.y + 30, 18, INK_GOLD_HEX);
    this.sunLabel.setPosition(end.x + 10, end.y + 42);
    const hordeOff = 20 + 70 * Math.min(1, state.gapM / 100);
    for (let k = 0; k < 3; k++) {
      const p = this.atPx(fracNow, -(hordeOff + k * 12));
      icon(a, 'zombie', p.x, p.y - 2, 22 - k * 2, INK_RED_HEX);
    }
    const h0 = this.atPx(fracNow, -hordeOff);
    this.hordeLabel.setPosition(h0.x - 10, h0.y + 24);
    setIfChanged(this.hordeLabel, `la horda · ${Math.round(state.gapM)} m`);
    if (extras.ghostDeltaM !== undefined) {
      const d = extras.ghostDeltaM;
      const off = asymptoticPx(Math.abs(d), 45, 60);
      const p = this.atPx(fracNow, d >= 0 ? -off : off);
      icon(a, 'bike', p.x, p.y - 2, 24, INK_HEX, 0.45);
      this.ghostLabel.setPosition(p.x + 18, p.y - 8).setVisible(true);
    } else {
      this.ghostLabel.setVisible(false);
    }
    const me = this.at(fracNow);
    a.fillStyle(INK_GOLD_HEX, 0.35);
    a.fillCircle(me.x, me.y, 18);
    icon(a, 'bike', me.x, me.y - 2, 30, INK_HEX);
    this.riderLabel.setPosition(me.x - 4, me.y + 22);
    if (this.nextRefugeAnchor) {
      this.refugeLabel.setPosition(this.nextRefugeAnchor.x, this.nextRefugeAnchor.y).setVisible(true);
      setIfChanged(this.refugeLabel, `faltan ${km1(Math.max(0, this.nextRefugeAnchor.km - kmNow))} km`);
    } else {
      this.refugeLabel.setVisible(false);
    }

    // El perfil: lo pedaleado sombreado, el cabezal, y lo que viene en una línea.
    const { SX, SY, SW, SH } = this;
    const p = this.profileDyn;
    p.clear();
    const px = SX + SW * Math.min(1, state.elapsedSec / this.totalSec);
    p.fillStyle(INK_HEX, 0.18);
    p.fillRect(SX, SY - 4, Math.max(0, px - SX), SH + 8);
    p.fillStyle(INK_HEX, 1);
    p.fillRect(px - 1, SY - 10, 2, SH + 20);
    icon(p, 'bike', px, SY - 18, 16, INK_HEX);
    const seg = state.segment;
    const next = seg.next;
    const nowText = `ahora ${segName(seg.kind, seg.grade)} ${zoneLabel(seg.zoneMin, seg.zoneMax)}`;
    const nextText = next ? ` · en ${formatMMSS(seg.remainingSec)} ${segName(next.kind)} ${zoneLabel(next.zoneMin, next.zoneMax)}` : ' · último tramo';
    setIfChanged(this.nowLine, `${nowText}${nextText} · faltan ${formatMMSS(remaining)}`);

    // Los números.
    setIfChanged(this.gapText, `${Math.round(state.gapM)} m`);
    this.gapText.setColor(state.gapM < RENDER.gapDangerM ? INK_RED : state.gapM < RENDER.gapWarnM ? INK_GOLD : INK_GREEN);
    if (state.inputMode === 'heartRate') {
      setIfChanged(this.bpmText, state.heartRateBpm > 0 ? `${Math.round(state.heartRateBpm)}` : '––');
      const zone = zoneOf(state.effortFrac);
      const verdict = state.easeOff ? 'AFLOJA' : state.aboveZone ? 'afloja' : state.settling ? 'bajando' : zone < seg.zoneMin ? 'sube' : 'bien';
      setIfChanged(this.bpmCaption, state.heartRateBpm > 0 ? `${zone === 0 ? 'suave' : `Z${zone}`} · ${verdict}` : 'sin pulso');
    } else {
      setIfChanged(this.bpmText, `${state.playerSpeedKph.toFixed(0)}`);
      setIfChanged(this.bpmCaption, 'km/h');
    }
  }

  destroy(): void {
    this.stampObj?.destroy();
    for (const o of [...this.objects, ...this.routeObjects, ...this.profileObjects]) o.destroy();
  }

  // ---- la carretera -----------------------------------------------------------

  /** La ventana de la Ruta alrededor de donde vas, con sus refugios; se rehace al salir de ella. */
  private buildRoute(kmNow: number): void {
    this.routeObjects.forEach((o) => o.destroy());
    this.routeObjects = [];
    this.window = routeWindow(kmNow, BEHIND_KM, AHEAD_KM);
    const { left, top } = this;
    const list = this.routeObjects;
    // La misma carretera a mano del tablón, más larga: cuatro curvas.
    const path = new Phaser.Curves.Path(left + 60, top + 362);
    path.cubicBezierTo(left + 378, top + 382, left + 178, top + 262, left + 278, top + 432);
    path.cubicBezierTo(left + 638, top + 262, left + 458, top + 302, left + 508, top + 232);
    path.cubicBezierTo(left + 958, top + 362, left + 758, top + 292, left + 838, top + 422);
    path.cubicBezierTo(left + 1098, top + 177, left + 1038, top + 322, left + 1058, top + 232);
    this.points = path.getSpacedPoints(ROAD_POINTS);
    this.pathLen = 0;
    for (let i = 1; i < this.points.length; i++) this.pathLen += Phaser.Math.Distance.BetweenPoints(this.points[i - 1]!, this.points[i]!);

    const g = this.scene.add.graphics().setDepth(DEPTH + 2);
    list.push(g);
    g.lineStyle(18, INK_HEX, 0.55);
    path.draw(g, 96);
    g.lineStyle(14, PAPER_DARK, 1);
    path.draw(g, 96);
    g.lineStyle(1.2, INK_HEX, 0.6);
    for (let i = 0; i + 1 < this.points.length; i += 2) g.lineBetween(this.points[i]!.x, this.points[i]!.y, this.points[i + 1]!.x, this.points[i + 1]!.y);

    if (this.window.fromKm === 0) {
      const p0 = this.at(0);
      icon(g, 'flag', p0.x, p0.y - 22, 20, INK_GOLD_HEX);
      this.text(p0.x, p0.y - 46, 'km 0', 12, INK_DIM, { align: 'center', mono: true, list });
    }
    this.nextRefugeAnchor = undefined;
    this.window.refuges.forEach((r, i) => {
      const p = this.at(r.frac);
      g.fillStyle(PAPER, 1);
      g.fillCircle(p.x, p.y, 6);
      g.lineStyle(1.5, INK_HEX, 1);
      g.strokeCircle(p.x, p.y, 6);
      const above = i % 2 === 0;
      const iy = above ? p.y - 40 : p.y + 36;
      icon(g, 'house', p.x, iy, 24, r.reached ? 0x9a8f80 : INK_HEX);
      this.text(p.x, iy + (above ? -40 : 18), r.name, 14, r.reached ? INK_DIM : INK, { align: 'center', bold: !r.reached, list });
      this.text(p.x, iy + (above ? -24 : 34), `km ${r.km}`, 12, INK_DIM, { align: 'center', mono: true, list });
      if (r.reached) icon(g, 'check', p.x + 20, iy - 4, 14, INK_GREEN_HEX);
      // "faltan X km": entre la casita y la carretera si está arriba; bajo el km si está abajo.
      if (!r.reached && !this.nextRefugeAnchor) this.nextRefugeAnchor = { km: r.km, x: p.x, y: iy + (above ? 14 : 50) };
    });
    // Donde empieza lo de hoy.
    const s = this.at(this.window.frac(this.kmBeforeToday));
    g.lineStyle(2, INK_GOLD_HEX, 1);
    g.lineBetween(s.x, s.y - 12, s.x, s.y + 12);
    this.text(s.x - 8, s.y + 26, 'salida de hoy', 12, INK_GOLD, { align: 'center', bold: true, list });
  }

  private index(frac: number): number {
    return Math.round(Math.min(1, Math.max(0, frac)) * (this.points.length - 1));
  }

  private at(frac: number): Phaser.Math.Vector2 {
    const f = Math.min(1, Math.max(0, frac)) * (this.points.length - 1);
    const i = Math.floor(f);
    const k = f - i;
    const a = this.points[i]!;
    const b = this.points[Math.min(i + 1, this.points.length - 1)]!;
    return new Phaser.Math.Vector2(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
  }

  /** Un punto a tantos píxeles por delante (o detrás, negativo) de una fracción, siguiendo la carretera. */
  private atPx(frac: number, dpx: number): Phaser.Math.Vector2 {
    return this.at(frac + dpx / this.pathLen);
  }

  private text(x: number, y: number, str: string, size: number, color: string, o: TextOpts = {}): Phaser.GameObjects.Text {
    const t = this.scene.add
      .text(x, y, str, { fontFamily: o.mono ? FONT_MONO : FONT_SANS, fontSize: `${size}px`, color, ...(o.bold ? { fontStyle: 'bold' } : {}) })
      .setOrigin(o.align === 'center' ? 0.5 : o.align === 'right' ? 1 : 0, 0)
      .setDepth(DEPTH + 3);
    (o.list ?? this.objects).push(t);
    return t;
  }
}

function segName(kind: string, grade?: number): string {
  if (grade !== undefined && grade > 0) return `cuesta ▲ ${grade} %`;
  return (KIND_ES[kind] ?? kind).toLowerCase();
}

function setIfChanged(t: Phaser.GameObjects.Text, s: string): void {
  if (t.text !== s) t.setText(s);
}
