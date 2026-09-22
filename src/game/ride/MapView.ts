import Phaser from 'phaser';
import { RENDER } from '../../config';
import type { SessionRecord } from '../../sim/history';
import type { ExpandedSegment } from '../../sim/program';
import { asymptoticPx } from '../../sim/rideMap';
import { routeOverview, todayWindow, type RouteOverview, type TodayWindow } from '../../sim/routeMap';
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
  REFUGE_ICON,
  stamp,
  type IconName,
} from '../ui/paper';

/**
 * La vista de mapa: el diario de la Ruta durante la salida. Arriba, la Ruta
 * entera desde el km 0 hasta el siguiente refugio: los refugios encendidos
 * con la fecha en que los alcanzaste, el siguiente apagado con lo que falta
 * y en cuántas salidas, cada salida pasada como un tramo con su fecha, las
 * marcas donde las ganaste. Abajo, el trozo de hoy ampliado: la noche y la
 * marea detrás de ti, tu regla (la salida más larga), el fantasma, el
 * refugio que enciendes hoy, el amanecer donde acaba. Y la salida tramo a
 * tramo con los números, porque la salida sigue corriendo. Todo son datos
 * que ya existen, puestos en un sitio; nada de esto es historia.
 */

const DEPTH = 25;
const W = 1180;
const H = 650;
const NIGHT = 0x14101e;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const km1 = (km: number): string => km.toFixed(1).replace('.', ',');
const shortDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}`;
};

export interface MapViewOptions {
  programName: string;
  segments: readonly ExpandedSegment[];
  /** Las salidas guardadas: de ellas sale la Ruta. */
  sessions: readonly SessionRecord[];
  /** Cuándo empezó la salida de hoy. */
  startedAtMs: number;
  onClose: () => void;
}

export interface MapViewExtras {
  ghostDeltaM?: number;
}

interface TextOpts {
  bold?: boolean;
  mono?: boolean;
  align?: 'left' | 'center' | 'right';
  alpha?: number;
  list?: Phaser.GameObjects.GameObject[];
}

/** Una carretera a mano: puntos equiespaciados de un Path, para poner cosas a lo largo. */
class Road {
  readonly points: Phaser.Math.Vector2[];
  readonly length: number;

  constructor(readonly path: Phaser.Curves.Path, divisions = 300) {
    this.points = path.getSpacedPoints(divisions);
    let len = 0;
    for (let i = 1; i < this.points.length; i++) len += Phaser.Math.Distance.BetweenPoints(this.points[i - 1]!, this.points[i]!);
    this.length = Math.max(1, len);
  }

  index(frac: number): number {
    return Math.round(Math.min(1, Math.max(0, frac)) * (this.points.length - 1));
  }

  at(frac: number): Phaser.Math.Vector2 {
    const f = Math.min(1, Math.max(0, frac)) * (this.points.length - 1);
    const i = Math.floor(f);
    const k = f - i;
    const a = this.points[i]!;
    const b = this.points[Math.min(i + 1, this.points.length - 1)]!;
    return new Phaser.Math.Vector2(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
  }

  /** Un punto a tantos píxeles por delante (o detrás, negativo) de una fracción, siguiendo la carretera. */
  atPx(frac: number, dpx: number): Phaser.Math.Vector2 {
    return this.at(frac + dpx / this.length);
  }

  pxToFrac(px: number): number {
    return px / this.length;
  }

  /** La carretera en sí: doble línea y eje discontinuo. */
  draw(g: Phaser.GameObjects.Graphics, width: number): void {
    g.lineStyle(width + 4, INK_HEX, 0.55);
    this.path.draw(g, 96);
    g.lineStyle(width, PAPER_DARK, 1);
    this.path.draw(g, 96);
    g.lineStyle(1.2, INK_HEX, 0.6);
    for (let i = 0; i + 1 < this.points.length; i += 2) g.lineBetween(this.points[i]!.x, this.points[i]!.y, this.points[i + 1]!.x, this.points[i + 1]!.y);
  }

  stroke(g: Phaser.GameObjects.Graphics, f0: number, f1: number, width: number, color: number, alpha: number): void {
    const i0 = this.index(f0);
    const i1 = this.index(f1);
    if (i1 <= i0) return;
    g.lineStyle(width, color, alpha);
    g.beginPath();
    g.moveTo(this.points[i0]!.x, this.points[i0]!.y);
    for (let i = i0 + 1; i <= i1; i++) g.lineTo(this.points[i]!.x, this.points[i]!.y);
    g.strokePath();
  }

  dashed(g: Phaser.GameObjects.Graphics, f0: number, f1: number, width: number, color: number, alpha: number): void {
    const i0 = this.index(f0);
    const i1 = this.index(f1);
    g.lineStyle(width, color, alpha);
    for (let i = i0; i + 2 <= i1; i += 4) g.lineBetween(this.points[i]!.x, this.points[i]!.y, this.points[i + 2]!.x, this.points[i + 2]!.y);
  }

  dots(g: Phaser.GameObjects.Graphics, f0: number, f1: number, r: number, color: number, alpha: number): void {
    const i0 = this.index(f0);
    const i1 = this.index(f1);
    g.fillStyle(color, alpha);
    for (let i = i0; i <= i1; i += 3) g.fillCircle(this.points[i]!.x, this.points[i]!.y, r);
  }
}

export class MapView {
  private readonly left: number;
  private readonly top: number;
  private readonly objects: Phaser.GameObjects.GameObject[];
  private routeObjects: Phaser.GameObjects.GameObject[] = [];
  private todayObjects: Phaser.GameObjects.GameObject[] = [];
  private profileObjects: Phaser.GameObjects.GameObject[] = [];
  private readonly sessions: readonly SessionRecord[];
  private readonly startedAtMs: number;
  private readonly programName: string;
  private overview!: RouteOverview;
  private routeRoad!: Road;
  private todayWin!: TodayWindow;
  private todayRoad!: Road;
  private litCount = -1;
  private stampObj: Phaser.GameObjects.Container | undefined;
  private stampText = '';
  // Capas dinámicas.
  private readonly subtitle: Phaser.GameObjects.Text;
  private readonly routeHeading: Phaser.GameObjects.Text;
  private readonly routeDyn: Phaser.GameObjects.Graphics;
  private readonly nextLabel: Phaser.GameObjects.Text;
  private readonly todayHeading: Phaser.GameObjects.Text;
  private readonly todayNight: Phaser.GameObjects.Graphics;
  private readonly todayDyn: Phaser.GameObjects.Graphics;
  private readonly tideLabel: Phaser.GameObjects.Text;
  private readonly ghostLabel: Phaser.GameObjects.Text;
  private readonly riderLabel: Phaser.GameObjects.Text;
  private readonly sunLabel: Phaser.GameObjects.Text;
  private readonly refugeLabels: Phaser.GameObjects.Text[] = [];
  private todayRefuges: Array<{ km: number; x: number; y: number }> = [];
  private readonly profileDyn: Phaser.GameObjects.Graphics;
  private readonly nowLine: Phaser.GameObjects.Text;
  private readonly gapText: Phaser.GameObjects.Text;
  private readonly bpmText: Phaser.GameObjects.Text;
  private readonly bpmCaption: Phaser.GameObjects.Text;
  private segments: readonly ExpandedSegment[] = [];
  private totalSec = 1;
  /** Velocidad suavizada para proyectar el amanecer: la instantánea baila y el sol con ella. */
  private projKph = 0;
  private lastElapsedSec = -1;
  // Geometría.
  private readonly RY: number;
  private readonly HY: number;
  private readonly SX: number;
  private readonly SY: number;
  private readonly SW = 640;
  private readonly SH = 34;

  constructor(
    private readonly scene: Phaser.Scene,
    opts: MapViewOptions,
  ) {
    this.sessions = opts.sessions;
    this.startedAtMs = opts.startedAtMs;
    this.programName = opts.programName;
    const panel = paperPanel(scene, W, H, DEPTH, 'Mapa de la Ruta');
    this.left = panel.left;
    this.top = panel.top;
    this.objects = [...panel.objects];
    // Un toque fuera de los botones devuelve a la carretera.
    panel.objects[0]?.on('pointerdown', opts.onClose);
    const { left, top } = this;
    this.RY = top + 92;
    this.HY = top + 300;
    this.SX = left + 36;
    this.SY = top + 540;

    this.subtitle = this.text(panel.cx, top + 74, '', 15, INK_MUTED, { align: 'center' });
    const fixed = scene.add.graphics().setDepth(DEPTH + 2);
    this.objects.push(fixed);
    icon(fixed, 'compass', left + W - 60, top + 132, 40, INK_HEX, 0.7);
    this.routeHeading = heading(scene, left + 36, this.RY, '', 12, INK_MUTED, DEPTH + 2);
    this.todayHeading = heading(scene, left + 36, this.HY, '', 12, INK_MUTED, DEPTH + 2);
    this.objects.push(this.routeHeading, this.todayHeading);

    // Los números del momento.
    const NX = left + 760;
    const NY = top + 532;
    icon(fixed, 'zombie', NX + 14, NY + 22, 28, INK_RED_HEX);
    icon(fixed, 'heart', NX + 194, NY + 22, 26, INK_RED_HEX);
    this.gapText = this.text(NX + 34, NY, '', 34, INK_GREEN, { bold: true, mono: true });
    this.text(NX + 36, NY + 40, 'de ventaja', 12, INK_MUTED);
    this.bpmText = this.text(NX + 214, NY, '', 34, INK, { bold: true, mono: true });
    this.bpmCaption = this.text(NX + 216, NY + 40, '', 12, INK_MUTED);

    this.routeDyn = scene.add.graphics().setDepth(DEPTH + 3);
    this.todayNight = scene.add.graphics().setDepth(DEPTH + 1);
    this.todayDyn = scene.add.graphics().setDepth(DEPTH + 3);
    this.profileDyn = scene.add.graphics().setDepth(DEPTH + 3);
    this.objects.push(this.routeDyn, this.todayNight, this.todayDyn, this.profileDyn);
    this.nextLabel = this.text(0, 0, '', 11, INK_MUTED, { mono: true, align: 'right' });
    this.tideLabel = this.text(0, 0, '', 12, INK_RED, { bold: true, align: 'center' });
    this.ghostLabel = this.text(0, 0, 'última vez', 10, INK_DIM);
    this.riderLabel = this.text(0, 0, 'tú', 13, INK, { bold: true, align: 'center' });
    this.sunLabel = this.text(0, 0, '', 11, INK_GOLD, { align: 'center' });
    for (let i = 0; i < 2; i++) this.refugeLabels.push(this.text(0, 0, '', 11, INK_GOLD, { mono: true, align: 'center' }));
    this.nowLine = this.text(this.SX, this.SY + this.SH + 20, '', 12, INK_MUTED);

    this.setSegments(opts.segments);
    const back = makeTextButton(scene, left + W - 166, top + H - 31, 260, 38, 'Volver a la carretera', opts.onClose, DEPTH + 2, 18);
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
    list.push(heading(this.scene, SX, SY - 20, 'La salida', 11, INK_MUTED, DEPTH + 2));
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
      if (seg.grade !== undefined && seg.grade > 0) this.text(sx + sw / 2, SY + SH - sh - 13, '▲', 10, INK_MUTED, { align: 'center', list });
      if (sw >= 22) this.text(sx + sw / 2, SY + SH + 5, `${Math.round(seg.durationSec / 60)}'`, 10, INK_DIM, { align: 'center', mono: true, list });
    }
    g.fillStyle(INK_HEX, 1);
    g.fillRect(SX, SY + SH, SW, 2);
  }

  update(state: SimState, extras: MapViewExtras = {}): void {
    const todayKm = state.distanceM / 1000;
    const remaining = Math.max(0, state.totalSec - state.elapsedSec);
    const beforeKm = this.overview?.beforeKm ?? this.routeBeforeKm();
    const kmNow = beforeKm + todayKm;
    // El amanecer se proyecta con una velocidad que cambia despacio: arranca
    // en la media de la salida y sigue a la instantánea con τ de minuto y medio.
    if (this.lastElapsedSec < 0) {
      const avgKph = state.elapsedSec > 30 ? (todayKm / state.elapsedSec) * 3600 : state.playerSpeedKph;
      this.projKph = avgKph > 0 ? avgKph : state.playerSpeedKph;
    } else {
      const dt = Math.max(0, state.elapsedSec - this.lastElapsedSec);
      this.projKph += (state.playerSpeedKph - this.projKph) * (1 - Math.exp(-dt / 90));
    }
    this.lastElapsedSec = state.elapsedSec;
    const kmEnd = kmNow + (remaining * (this.projKph / 3.6)) / 1000;

    // La Ruta se rehace cuando enciendes un refugio o el mapa se queda corto;
    // la ventana de hoy, si la salida se sale de ella.
    const needsRoute = !this.overview || kmEnd > this.overview.toKm || this.overview.refuges.filter((r) => r.km <= kmNow).length !== this.litCount;
    if (needsRoute) this.buildRoute(todayKm, kmEnd);
    if (!this.todayWin || kmNow > this.todayWin.toKm - 0.25 || kmEnd > this.todayWin.toKm - 0.1) this.buildToday(beforeKm, kmNow, kmEnd);
    const o = this.overview;

    setIfChanged(this.subtitle, `${this.programName} · ${formatMMSS(state.elapsedSec)} / ${formatMMSS(state.totalSec)} · ${km1(todayKm)} km hoy`);
    const stampText = `km ${km1(kmNow)}`;
    if (stampText !== this.stampText) {
      this.stampText = stampText;
      this.stampObj?.destroy();
      this.stampObj = stamp(this.scene, this.left + W - 120, this.top + 52, stampText, INK_RED, DEPTH + 2, 14);
    }
    const lit = o.refuges.filter((r) => r.km <= kmNow).length;
    setIfChanged(
      this.routeHeading,
      `LA RUTA · ${km1(kmNow)} KM · ${lit === 0 ? 'NINGÚN REFUGIO AÚN' : lit === 1 ? '1 REFUGIO ENCENDIDO' : `${lit} REFUGIOS ENCENDIDOS`}`,
    );
    setIfChanged(this.todayHeading, `HOY · KM ${km1(beforeKm)} → ${km1(Math.max(kmNow, kmEnd))} · LA NOCHE DETRÁS`);

    // ---- la Ruta: lo de hoy, la proyección, tú ----
    const rr = this.routeRoad;
    const fr = (km: number): number => Math.min(1, Math.max(0, km / o.toKm));
    const g = this.routeDyn;
    g.clear();
    rr.stroke(g, fr(beforeKm), fr(kmNow), 8, INK_GOLD_HEX, 0.9);
    rr.dots(g, fr(kmNow), fr(kmEnd), 2, INK_GOLD_HEX, 0.6);
    const me = rr.at(fr(kmNow));
    g.fillStyle(INK_GOLD_HEX, 0.35);
    g.fillCircle(me.x, me.y, 14);
    icon(g, 'bike', me.x, me.y - 2, 22, INK_HEX);
    icon(g, 'zombie', me.x - 22, me.y - 2, 14, INK_RED_HEX, 0.8);
    const next = o.next;
    const nextRemaining = Math.max(0, next.refuge.km - kmNow);
    const est = next.ridesEstimate;
    setIfChanged(this.nextLabel, `km ${next.refuge.km} · faltan ${km1(nextRemaining)} km${est !== undefined ? ` · ${est === 1 ? 'una salida' : `unas ${est} salidas`}` : ''}`);

    // ---- hoy: la noche, la marea, la regla, el fantasma, tú, el amanecer ----
    const tr = this.todayRoad;
    const tw = this.todayWin;
    const fNow = tw.frac(kmNow);
    const tidePx = asymptoticPx(state.gapM, 45, 110);
    const fTide = fNow - tr.pxToFrac(tidePx);
    const n = this.todayNight;
    n.clear();
    tr.stroke(n, 0, fTide, 40, NIGHT, 0.45);
    const d = this.todayDyn;
    d.clear();
    tr.stroke(d, tw.frac(beforeKm), fNow, 10, INK_GOLD_HEX, 0.6);
    for (let k = 0; k < 14; k++) {
      const p = tr.atPx(fTide, -80 + k * 6);
      d.fillStyle(INK_RED_HEX, 0.12 + (k / 14) * 0.5);
      d.fillCircle(p.x, p.y, 9 + (k / 14) * 8);
    }
    // La marea se mueve aunque la ventaja no cambie: los zombis se bambolean.
    const wobble = this.scene.time.now / 1000;
    [0, -10, -20, -30, -44].forEach((dpx, i) => {
      const p = tr.atPx(fTide, dpx);
      icon(d, 'zombie', p.x, p.y - 4 + Math.sin(wobble * 3 + i) * 1.5, 18 - i * 2, INK_RED_HEX, 0.9 - i * 0.12);
    });
    const tideAt = tr.atPx(fTide, -26);
    this.tideLabel.setPosition(tideAt.x, tideAt.y + 30);
    setIfChanged(this.tideLabel, `la marea · ${Math.round(state.gapM)} m`);
    if (extras.ghostDeltaM !== undefined) {
      const delta = extras.ghostDeltaM;
      const off = asymptoticPx(Math.abs(delta), 45, 60);
      const p = tr.atPx(fNow, delta >= 0 ? -off : off);
      icon(d, 'bike', p.x, p.y - 2, 22, INK_HEX, 0.4);
      this.ghostLabel.setPosition(p.x + 14, p.y - 30).setVisible(true);
    } else {
      this.ghostLabel.setVisible(false);
    }
    const you = tr.at(fNow);
    d.fillStyle(INK_GOLD_HEX, 0.35);
    d.fillCircle(you.x, you.y, 18);
    // La bici pedalea: las ruedas giran con los metros, aunque en el papel avance despacio.
    drawRollingBike(d, you.x, you.y - 2, 30, INK_HEX, (state.distanceM / 4) * Math.PI * 2);
    this.riderLabel.setPosition(you.x, you.y + 22);
    tr.dots(d, fNow, tw.frac(kmEnd), 2.5, INK_GOLD_HEX, 0.6);
    const end = tr.at(tw.frac(kmEnd));
    icon(d, 'sun', end.x, end.y - 34, 20, INK_GOLD_HEX);
    this.sunLabel.setPosition(end.x, end.y - 60);
    setIfChanged(this.sunLabel, `amanecer · km ${km1(kmEnd)}`);
    this.todayRefuges.forEach((r, i) => {
      const label = this.refugeLabels[i];
      if (!label) return;
      label.setPosition(r.x, r.y).setVisible(true);
      if (kmNow >= r.km) {
        label.setColor(INK_GOLD);
        setIfChanged(label, 'encendido hoy');
      } else {
        label.setColor(INK_MUTED);
        setIfChanged(label, `faltan ${km1(r.km - kmNow)} km`);
      }
    });
    for (let i = this.todayRefuges.length; i < this.refugeLabels.length; i++) this.refugeLabels[i]!.setVisible(false);

    // ---- el perfil y los números ----
    const { SX, SY, SW, SH } = this;
    const p = this.profileDyn;
    p.clear();
    const px = SX + SW * Math.min(1, state.elapsedSec / this.totalSec);
    p.fillStyle(INK_HEX, 0.18);
    p.fillRect(SX, SY - 4, Math.max(0, px - SX), SH + 8);
    p.fillStyle(INK_HEX, 1);
    p.fillRect(px - 1, SY - 8, 2, SH + 16);
    icon(p, 'bike', px, SY - 16, 14, INK_HEX);
    const seg = state.segment;
    const nextSeg = seg.next;
    const nowText = `ahora ${segName(seg.kind, seg.grade)} ${zoneLabel(seg.zoneMin, seg.zoneMax)}`;
    const nextText = nextSeg ? ` · en ${formatMMSS(seg.remainingSec)} ${segName(nextSeg.kind)} ${zoneLabel(nextSeg.zoneMin, nextSeg.zoneMax)}` : ' · último tramo';
    setIfChanged(this.nowLine, `${nowText}${nextText} · faltan ${formatMMSS(remaining)}`);
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
    for (const o of [...this.objects, ...this.routeObjects, ...this.todayObjects, ...this.profileObjects]) o.destroy();
  }

  // ---- la Ruta entera --------------------------------------------------------

  private routeBeforeKm(): number {
    return this.sessions.reduce((acc, s) => acc + s.distanceM, 0) / 1000;
  }

  private buildRoute(todayKm: number, plannedEndKm: number): void {
    this.routeObjects.forEach((o) => o.destroy());
    this.routeObjects = [];
    const list = this.routeObjects;
    this.overview = routeOverview(this.sessions, todayKm, plannedEndKm, this.startedAtMs);
    const o = this.overview;
    this.litCount = o.refuges.filter((r) => r.km <= o.totalKm).length;
    const { left, RY } = this;
    const X0 = left + 70;
    const X1 = left + W - 150;
    const dx = (X1 - X0) / 960;
    const path = new Phaser.Curves.Path(X0, RY + 120);
    path.cubicBezierTo(X0 + 400 * dx, RY + 110, X0 + 150 * dx, RY + 60, X0 + 260 * dx, RY + 160);
    path.cubicBezierTo(X0 + 760 * dx, RY + 100, X0 + 520 * dx, RY + 70, X0 + 640 * dx, RY + 150);
    path.cubicBezierTo(X1, RY + 90, X0 + 860 * dx, RY + 60, X0 + 940 * dx, RY + 130);
    const road = new Road(path);
    this.routeRoad = road;
    const fr = (km: number): number => Math.min(1, Math.max(0, km / o.toKm));

    const g = this.scene.add.graphics().setDepth(DEPTH + 2);
    list.push(g);
    road.draw(g, 12);
    // Los refugios de abajo ocupan sitio bajo la carretera: las fechas y las marcas lo respetan.
    const belowX = o.refuges.filter((_, i) => i % 2 === 1).map((r) => road.at(fr(r.km)).x);
    // Cada salida pasada, un tramo dorado con su fecha si cabe.
    o.rides.forEach((ride, i) => {
      if (ride.today) return;
      road.stroke(g, fr(ride.fromKm), fr(ride.toKm), 8, INK_GOLD_HEX, i % 2 === 0 ? 0.55 : 0.35);
      const a = road.at(fr(ride.fromKm));
      const b = road.at(fr(ride.toKm));
      const m = road.at(fr((ride.fromKm + ride.toKm) / 2));
      if (Math.abs(b.x - a.x) >= 34 && !belowX.some((x) => Math.abs(x - m.x) < 44)) {
        this.text(m.x, m.y + 11, shortDate(ride.startedAtMs), 10, INK_DIM, { align: 'center', mono: true, list });
      }
    });
    // Km 0.
    const p0 = road.at(0);
    icon(g, 'flag', p0.x, p0.y - 20, 18, INK_HEX, 0.6);
    this.text(p0.x, p0.y + 11, 'km 0', 10, INK_DIM, { align: 'center', mono: true, list });
    // Los refugios: encendidos con su fecha, el siguiente apagado con lo que falta.
    const refugeX: Array<{ x: number; above: boolean }> = [];
    o.refuges.forEach((r, i) => {
      const p = road.at(fr(r.km));
      const above = i % 2 === 0;
      const iy = above ? p.y - 44 : p.y + 44;
      refugeX.push({ x: p.x, above });
      if (r.reached) {
        g.fillStyle(0xffc85a, 0.22);
        g.fillCircle(p.x, iy, 34);
        g.fillStyle(0xffc85a, 0.18);
        g.fillCircle(p.x, iy, 20);
      }
      g.fillStyle(PAPER, 1);
      g.fillCircle(p.x, p.y, 5);
      g.lineStyle(1.5, INK_HEX, 1);
      g.strokeCircle(p.x, p.y, 5);
      const name: IconName = REFUGE_ICON[r.name] ?? 'house';
      icon(g, name, p.x, iy, 30, r.reached ? INK_HEX : 0x9a8f80);
      if (name === 'lighthouse' && r.reached) {
        g.fillStyle(INK_GOLD_HEX, 0.3);
        g.fillTriangle(p.x, iy - 10, p.x + 34, iy - 22, p.x + 34, iy + 2);
      }
      this.text(p.x, iy + (above ? -46 : 22), r.name, 14, r.reached ? INK : INK_MUTED, { align: 'center', bold: true, list });
      if (r.reached) {
        icon(g, 'check', p.x + 40, iy - 10, 14, INK_GREEN_HEX);
        const when = r.reachedToday ? 'hoy' : r.reachedAtMs !== undefined ? shortDate(r.reachedAtMs) : '';
        this.text(p.x, iy + (above ? -30 : 38), `encendido · ${when}`, 11, INK_GOLD, { align: 'center', mono: true, list });
      } else if (r.km === o.next.refuge.km) {
        this.nextLabel.setPosition(p.x - 6, iy + (above ? -30 : 38)).setVisible(true);
      }
    });
    if (!o.refuges.some((r) => !r.reached && r.km === o.next.refuge.km)) this.nextLabel.setVisible(false);
    // Las marcas, donde las ganaste: las que caen juntas comparten trofeo y
    // apilan sus títulos; van al lado de la carretera libre de refugios.
    const groups: Array<{ x: number; y: number; titles: string[] }> = [];
    for (const m of [...o.marks].sort((a, b) => a.km - b.km)) {
      const p = road.at(fr(m.km));
      const last = groups[groups.length - 1];
      if (last && Math.abs(last.x - p.x) < 28) last.titles.push(m.title);
      else groups.push({ x: p.x, y: p.y, titles: [m.title] });
    }
    for (const grp of groups) {
      const crowdedAbove = refugeX.some((r) => r.above && Math.abs(r.x - grp.x) < 60);
      const crowdedBelow = refugeX.some((r) => !r.above && Math.abs(r.x - grp.x) < 60);
      const above = crowdedBelow || !crowdedAbove;
      const ty = above ? grp.y - 26 : grp.y + 34;
      icon(g, 'trophy', grp.x, ty, 18, INK_GOLD_HEX);
      const shown = grp.titles.slice(0, 3);
      shown.forEach((title, i) => {
        const ly = above ? ty - 24 - (shown.length - 1 - i) * 11 : ty + 12 + i * 11;
        this.text(grp.x, ly, shortTitle(title), 10, INK_GOLD, { align: 'center', list });
      });
      if (grp.titles.length > 3) this.text(grp.x + 14, ty - 6, `+${grp.titles.length - 3}`, 10, INK_GOLD, { list });
    }
  }

  // ---- hoy, ampliado ----------------------------------------------------------

  private buildToday(beforeKm: number, kmNow: number, kmEnd: number): void {
    this.todayObjects.forEach((o) => o.destroy());
    this.todayObjects = [];
    const list = this.todayObjects;
    const o = this.overview;
    this.todayWin = todayWindow(beforeKm, kmNow, kmEnd);
    const tw = this.todayWin;
    const { left, HY } = this;
    const X0 = left + 70;
    const X1 = left + W - 60;
    const dx = (X1 - X0) / 1050;
    const path = new Phaser.Curves.Path(X0, HY + 92);
    path.cubicBezierTo(X1, HY + 70, X0 + 300 * dx, HY + 52, X0 + 600 * dx, HY + 130);
    const road = new Road(path);
    this.todayRoad = road;

    const g = this.scene.add.graphics().setDepth(DEPTH + 2);
    list.push(g);
    road.draw(g, 14);
    // Marcas de km: con ellas se ve avanzar al ciclista.
    const startX = road.at(tw.frac(beforeKm)).x;
    for (let km = Math.ceil(tw.fromKm * 2) / 2; km <= tw.toKm; km += 0.5) {
      const p = road.at(tw.frac(km));
      const whole = Math.abs(km - Math.round(km)) < 1e-6;
      g.lineStyle(1.5, INK_HEX, whole ? 0.7 : 0.4);
      g.lineBetween(p.x, p.y + (whole ? 8 : 5), p.x, p.y + (whole ? 13 : 10));
      if (whole && Math.abs(p.x - startX) > 46) this.text(p.x, p.y + 12, `${Math.round(km)}`, 9, INK_DIM, { align: 'center', mono: true, list });
    }
    // Tu regla: la salida más larga desde donde empezaste hoy; si no cabe, apunta al borde.
    if (o.longestRideKm > 0) {
      const endKm = beforeKm + o.longestRideKm;
      const fits = endKm <= tw.toKm;
      road.dashed(g, tw.frac(beforeKm), fits ? tw.frac(endKm) : 1, 2, INK_HEX, 0.55);
      const e = road.at(fits ? tw.frac(endKm) : 1);
      this.text(e.x - 4, e.y + 24, `tu más larga: ${km1(o.longestRideKm)} km${fits ? '' : ' →'}`, 11, INK_MUTED, { align: 'right', list });
    }
    // Donde empezaste hoy.
    const s = road.at(tw.frac(beforeKm));
    g.lineStyle(2, INK_GOLD_HEX, 1);
    g.lineBetween(s.x, s.y - 14, s.x, s.y + 14);
    this.text(s.x, s.y + 24, `salida de hoy · km ${km1(beforeKm)}`, 11, INK_GOLD, { align: 'center', bold: true, list });
    // Los refugios que caen en el trozo de hoy.
    this.todayRefuges = [];
    o.refuges
      .filter((r) => r.km >= tw.fromKm && r.km <= tw.toKm)
      .slice(0, 2)
      .forEach((r) => {
        const p = road.at(tw.frac(r.km));
        const iy = p.y - 44;
        g.fillStyle(0xffc85a, 0.22);
        g.fillCircle(p.x, iy, 36);
        icon(g, REFUGE_ICON[r.name] ?? 'house', p.x, iy, 30, INK_HEX);
        g.fillStyle(PAPER, 1);
        g.fillCircle(p.x, p.y, 6);
        g.lineStyle(1.5, INK_HEX, 1);
        g.strokeCircle(p.x, p.y, 6);
        this.text(p.x, iy - 48, r.name, 14, INK, { align: 'center', bold: true, list });
        this.todayRefuges.push({ km: r.km, x: p.x, y: iy - 32 });
      });
  }

  private text(x: number, y: number, str: string, size: number, color: string, o: TextOpts = {}): Phaser.GameObjects.Text {
    const t = this.scene.add
      .text(x, y, str, { fontFamily: o.mono ? FONT_MONO : FONT_SANS, fontSize: `${size}px`, color, ...(o.bold ? { fontStyle: 'bold' } : {}) })
      .setOrigin(o.align === 'center' ? 0.5 : o.align === 'right' ? 1 : 0, 0)
      .setDepth(DEPTH + 3)
      .setAlpha(o.alpha ?? 1);
    (o.list ?? this.objects).push(t);
    return t;
  }
}

/** La bici del mapa con las ruedas girando: radios a un ángulo que avanza con la distancia. */
function drawRollingBike(g: Phaser.GameObjects.Graphics, cx: number, cy: number, size: number, color: number, angle: number): void {
  const s = size / 2;
  const lw = Math.max(1.5, size / 11);
  g.lineStyle(lw, color, 1);
  g.fillStyle(color, 1);
  const wheels: Array<[number, number]> = [
    [cx - s * 0.6, cy + s * 0.35],
    [cx + s * 0.6, cy + s * 0.35],
  ];
  for (const [wx, wy] of wheels) {
    g.strokeCircle(wx, wy, s * 0.42);
    for (let k = 0; k < 3; k++) {
      const a = angle + (k * Math.PI * 2) / 3;
      g.lineBetween(wx, wy, wx + Math.cos(a) * s * 0.38, wy + Math.sin(a) * s * 0.38);
    }
  }
  g.beginPath();
  g.moveTo(cx - s * 0.6, cy + s * 0.35);
  g.lineTo(cx - s * 0.15, cy - s * 0.3);
  g.lineTo(cx + s * 0.35, cy - s * 0.3);
  g.lineTo(cx + s * 0.6, cy + s * 0.35);
  g.moveTo(cx - s * 0.15, cy - s * 0.3);
  g.lineTo(cx + s * 0.05, cy + s * 0.35);
  g.lineTo(cx + s * 0.6, cy + s * 0.35);
  g.moveTo(cx + s * 0.35, cy - s * 0.3);
  g.lineTo(cx + s * 0.25, cy - s * 0.65);
  g.strokePath();
}

function segName(kind: string, grade?: number): string {
  if (grade !== undefined && grade > 0) return `cuesta ▲ ${grade} %`;
  return (KIND_ES[kind] ?? kind).toLowerCase();
}

/** El título de una marca, corto para el mapa. */
function shortTitle(title: string): string {
  return title.length > 22 ? `${title.slice(0, 21)}…` : title;
}

function setIfChanged(t: Phaser.GameObjects.Text, s: string): void {
  if (t.text !== s) t.setText(s);
}
