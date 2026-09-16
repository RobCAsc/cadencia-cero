import Phaser from 'phaser';
import type { BandConnection } from '../../input/BandConnection';
import type { SessionRecord } from '../../sim/history';
import { expandProgram, totalDurationSec } from '../../sim/program';
import {
  applyAdjustments,
  PROGRAM_CATALOG,
  type CatalogEntry,
} from '../../sim/programs/catalog';
import {
  nextRideStatus,
  PHASE_ES,
  planPhase,
  programGate,
  recommendToday,
  seasonReport,
  seasonReportDue,
  weeklyReview,
  weeklyReviewDue,
  weekStartMs,
  type PlanPhase,
  type Recommendation,
} from '../../sim/progress';
import { blocksToProgram, programToBlocks, type Block } from '../../sim/programRules';
import { reserveWarning, stepTestDue, zoneWidthBpm, type StoredRiderProfile } from '../../sim/riderProfile';
import { loadPlanState, savePlanState, type PlanState } from '../../storage/planStore';
import { Atmosphere } from '../atmosphere';
import { gameAudio } from '../audio';
import { formatMMSS } from '../format';
import { Board } from '../start/Board';
import { BuilderPanel } from '../start/BuilderPanel';
import { Campfire } from '../start/Campfire';
import { MarksPanel } from '../start/MarksPanel';
import { hasCeremony, PhasePanel } from '../start/PhasePanel';
import { ProfilePanel } from '../start/ProfilePanel';
import { ProfilePreview } from '../start/ProfilePreview';
import { ReviewPanel } from '../start/ReviewPanel';
import { ScreeningPanel } from '../start/ScreeningPanel';
import { SeasonPanel } from '../start/SeasonPanel';
import { FONT_MONO, FONT_SANS, UI } from '../theme';
import { makeTapButton } from '../uiButton';
import { makeIconButton } from '../ui/iconButton';
import {
  board,
  heading,
  icon,
  INK,
  INK_DIM,
  INK_HEX,
  INK_MUTED,
  INK_RED,
  INK_RED_HEX,
  PAPER,
  PAPER_DARK,
  paper,
  stamp,
  type IconName,
} from '../ui/paper';
import { acquireWakeLock } from '../wakeLock';

const TARGET_COLOR: Record<string, number> = {
  starter: 0x5dade2,
  recovery: 0x2ecc71,
  aerobic: 0x16a085,
  tempo: 0x48c9b0,
  threshold: 0xf39c12,
  anaerobic: 0xe74c3c,
  mixed: 0x9b59b6,
  strength: 0xd9b06a,
  custom: 0xb08bd9,
};

/** El icono de cada tipo de salida: lo que te persigue, dicho sin palabras. */
const TARGET_ICON: Record<string, IconName> = {
  starter: 'bike',
  recovery: 'moon',
  aerobic: 'road',
  tempo: 'bolt',
  threshold: 'flame',
  anaerobic: 'zombie',
  mixed: 'skull',
  strength: 'mountain',
  custom: 'pencil',
};

/** Cuántos zombis (y de qué tamaño) dibuja el cartel de cada salida. */
const TARGET_HORDE: Record<string, { count: number; size: number; alpha: number }> = {
  starter: { count: 1, size: 26, alpha: 0.5 },
  recovery: { count: 1, size: 24, alpha: 0.4 },
  aerobic: { count: 2, size: 28, alpha: 0.7 },
  tempo: { count: 3, size: 28, alpha: 0.8 },
  threshold: { count: 1, size: 44, alpha: 0.95 },
  anaerobic: { count: 6, size: 28, alpha: 0.9 },
  mixed: { count: 5, size: 28, alpha: 0.85 },
  strength: { count: 3, size: 26, alpha: 0.75 },
  custom: { count: 3, size: 26, alpha: 0.7 },
};

/** La salida mínima de los días malos: tres de calor y siete suaves. Cuenta para la semana. */
const MINIMAL_RIDE = { warmupMin: 3, mainMin: 7 } as const;

/** El catálogo más la salida que el rider diseñó, si la hay. */
function catalogWithCustom(blocks: readonly Block[] | undefined): CatalogEntry[] {
  if (!blocks || blocks.length === 0) return [...PROGRAM_CATALOG];
  return [
    ...PROGRAM_CATALOG,
    {
      program: blocksToProgram(blocks),
      description: 'Tu salida, diseñada por ti y aprobada por el rider modelo.',
      adjustments: [],
    },
  ];
}

const LEFT_X = 56;
const LEFT_W = 464;
const RIGHT_X = 560;
const RIGHT_W = 664;
const BOARD_X = 36;
const BOARD_Y = 96;
const BOARD_W = 1208;
const BOARD_H = 604;
const POSTER_Y = 116;
const POSTER_H = 296;
const ADJUST_Y = 428;
const ADJUST_H = 108;
const CHIPS_Y = 556;
const CHIP_H = 46;
const CHIP_GAP = 6;

interface Chip {
  paper: Phaser.GameObjects.Graphics;
  hit: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  stripe: Phaser.GameObjects.Rectangle;
  glyph: Phaser.GameObjects.Graphics;
}

/** Configuración elegida, persistida en el registry mientras viva la sesión. */
interface StoredConfig {
  programId: string;
  values: Record<string, Record<string, number>>;
}

/** Nombre corto para los chips: con nueve programas, "Primera salida" y "Recuperación" no caben. */
const CHIP_LABEL: Record<string, string> = {
  'primera-salida': 'Primera',
  recuperacion: 'Recup.',
  empujones: 'Empuj.',
};

function chipLabel(entry: CatalogEntry): string {
  return CHIP_LABEL[entry.program.id] ?? entry.program.name;
}

/**
 * El campamento: un tablón de madera con lo que llevas (semana, Ruta, salud)
 * clavado a la izquierda y el cartel de la salida de hoy a la derecha, lista
 * con un toque. Los demás programas quedan a mano como pestañas. EMPEZAR es
 * el gesto que desbloquea fullscreen, wake lock y audio, el mismo gesto que
 * exige requestDevice().
 */
export class StartScene extends Phaser.Scene {
  private selectedIndex = 0;
  private recommendedIndex = 0;
  private recommendation!: Recommendation;
  private catalog: CatalogEntry[] = [...PROGRAM_CATALOG];
  private stored!: StoredConfig;
  private atmosphere!: Atmosphere;
  private campfire!: Campfire;
  private board!: Board;
  private preview!: ProfilePreview;
  private cardStamp: Phaser.GameObjects.Container | undefined;
  private cardName!: Phaser.GameObjects.Text;
  private cardDuration!: Phaser.GameObjects.Text;
  private cardReason!: Phaser.GameObjects.Text;
  private cardGate!: Phaser.GameObjects.Text;
  private cardHorde!: Phaser.GameObjects.Graphics;
  private editButton!: ReturnType<typeof makeIconButton>;
  private chips: Chip[] = [];
  private otherLabel: Phaser.GameObjects.Text | undefined;
  // Objetos de las filas de ajuste, destruidos y recreados al cambiar de
  // programa. Sin Container: el hit-test de Phaser no ve botones re-parentados.
  private adjustObjects: Phaser.GameObjects.GameObject[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private statusGlyph!: Phaser.GameObjects.Graphics;
  private nextRideText!: Phaser.GameObjects.Text;
  private profilePanel: ProfilePanel | undefined;
  /** Cribado, revisión u otro panel abierto: el campamento espera. */
  private overlayOpen = false;
  private reviewChecked = false;

  constructor() {
    super('StartScene');
  }

  create(): void {
    // La noche de fondo, atenuada para que el tablón respire.
    this.atmosphere = new Atmosphere(this, { frontFog: false, lamps: false });
    this.add.rectangle(0, 0, 1280, 720, 0x05060e, 0.6).setOrigin(0, 0);
    this.campfire = new Campfire(this);
    this.cameras.main.fadeIn(700, 5, 6, 14);

    const stored = this.registry.get('trainingConfig') as StoredConfig | undefined;
    this.stored = stored ?? { programId: 'primera-salida', values: {} };
    this.chips = [];
    this.otherLabel = undefined;
    this.adjustObjects = [];
    this.cardStamp = undefined;

    this.add.text(LEFT_X, 30, 'CADENCIA CERO', {
      fontFamily: FONT_SANS,
      fontSize: '40px',
      fontStyle: 'bold',
      color: UI.textBright,
    });
    this.add.text(LEFT_X + 318, 46, 'Campamento', {
      fontFamily: FONT_SANS,
      fontSize: '20px',
      color: UI.textMuted,
    });

    // Arriba a la derecha, los botones con icono; debajo, la pulsera y el perfil en una línea.
    makeIconButton(this, 1149, 54, 150, 42, 'band', 'Perfil', () => this.openProfile(), 10, 15);
    makeIconButton(this, 989, 54, 150, 42, 'clipboard', 'Antes de entrenar', () => this.openScreening(), 10, 13);
    makeIconButton(this, 829, 54, 150, 42, 'trophy', 'Marcas', () => this.openMarks(), 10, 15);
    makeIconButton(this, 669, 54, 150, 42, 'pencil', 'Diseñar', () => this.openBuilder(), 10, 15);
    this.statusGlyph = this.add.graphics().setDepth(10);
    this.statusText = this.add.text(1224, 84, '', { fontFamily: FONT_SANS, fontSize: '13px', color: UI.textDim }).setOrigin(1, 0.5);
    const band = this.registry.get('band') as BandConnection;
    const unsubscribeBand = band.onStatus(() => this.renderStatus());
    this.renderStatus();
    // El día comprometido para la próxima salida: la intención dicha en voz alta.
    this.nextRideText = this.add.text(LEFT_X, 80, '', { fontFamily: FONT_SANS, fontSize: '16px', color: UI.info });

    // El tablón, y encima los papeles.
    board(this, BOARD_X, BOARD_Y, BOARD_W, BOARD_H, 0);
    this.board = new Board(this, LEFT_X, POSTER_Y, LEFT_W);
    this.buildCard();
    this.catalog = catalogWithCustom(loadPlanState().customBlocks);
    this.rebuildChips();

    // EMPEZAR: un cartel verde con la bici. Y la salida mínima al lado.
    const startButton = this.add
      .rectangle(1074, 650, 300, 84, 0x1e8449)
      .setDepth(3)
      .setInteractive({ useHandCursor: true });
    const startGlyph = this.add.graphics().setDepth(4);
    icon(startGlyph, 'bike', 960, 650, 44, 0xecf0f1);
    this.add
      .text(1100, 650, 'EMPEZAR', {
        fontFamily: FONT_SANS,
        fontSize: '36px',
        fontStyle: 'bold',
        color: UI.textBright,
      })
      .setOrigin(0.5)
      .setDepth(4);
    startButton.on('pointerover', () => startButton.setFillStyle(0x27ae60));
    startButton.on('pointerout', () => startButton.setFillStyle(0x1e8449));
    startButton.on('pointerdown', () => this.startRide());
    const minimal = makeIconButton(this, 700, 650, 250, 56, 'clock', 'Solo diez minutos', () => this.startMinimal(), 3, 16);
    minimal.rect.setAlpha(0.85);

    // El historial llega de IndexedDB cuando llega (y cambia al sembrarlo o
    // borrarlo desde el panel dev): el campamento se rehace con él.
    const onHistory = () => this.refreshFromHistory();
    this.registry.events.on('changedata-sessionHistory', onHistory);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribeBand();
      this.registry.events.off('changedata-sessionHistory', onHistory);
    });
    this.refreshFromHistory();

    // Lo primero de todo, una vez: el cribado. Después, si toca, la revisión semanal.
    if (!loadPlanState().screening) this.openScreening();
    else this.maybeReview();
  }

  update(_time: number, deltaMs: number): void {
    this.atmosphere.update(0, deltaMs / 1000); // la niebla deriva sola
    this.campfire.update(deltaMs / 1000);
  }

  private history(): SessionRecord[] {
    return (this.registry.get('sessionHistory') as SessionRecord[] | undefined) ?? [];
  }

  /** Redibuja el progreso y vuelve a recomendar; la selección salta a lo recomendado. */
  private refreshFromHistory(): void {
    const sessions = this.history();
    const nowMs = Date.now();
    this.board.show(sessions, nowMs);
    this.recommendation = recommendToday(sessions, nowMs);
    // La fase la lee la salida: en arranque y base, el pulso muy alto sostenido cambia a suave solo.
    this.registry.set('planPhase', this.recommendation.phase);
    const next = nextRideStatus(loadPlanState().nextRideDayMs, nowMs);
    this.nextRideText.setText(next.label);
    this.nextRideText.setColor(next.state === 'today' ? UI.good : next.state === 'missed' ? UI.textMuted : UI.info);
    const index = this.catalog.findIndex((e) => e.program.id === this.recommendation.programId);
    this.recommendedIndex = index >= 0 ? index : 0;
    // Los chips que el plan aún reserva se atenúan; siguen siendo elegibles.
    this.chips.forEach((chip, i) => {
      const entry = this.catalog[i];
      const gated = entry !== undefined && programGate(entry.program.id, sessions, nowMs) !== undefined;
      chip.stripe.setAlpha(gated ? 0.35 : 1);
      chip.label.setAlpha(gated ? 0.5 : 1);
      chip.glyph.setAlpha(gated ? 0.4 : 1);
    });
    // Los ajustes sugeridos solo rellenan huecos: lo que el rider tocó, se respeta.
    const values = (this.stored.values[this.recommendation.programId] ??= {});
    for (const [id, value] of Object.entries(this.recommendation.values)) {
      if (values[id] === undefined) values[id] = value;
    }
    this.select(this.recommendedIndex);
    this.maybeReview();
  }

  private renderStatus(): void {
    const band = this.registry.get('band') as BandConnection;
    const p = this.registry.get('riderProfileStored') as StoredRiderProfile;
    const feel = this.registry.get('inputMode') === 'feel';
    const connected = band.isConnected();
    const sign = p.intensityPct > 0 ? '+' : '';
    const due = stepTestDue(p, Date.now());
    const stepNote = due === 'stale' || due === 'restDropped' ? '  ·  escalera: toca repetirla' : '';
    const narrow = reserveWarning(p) !== undefined;
    const reserveNote = narrow ? `  ·  ZONAS DE ${Math.round(zoneWidthBpm(p))} LATIDOS: revisa el máximo` : '';
    this.statusText.setText(
      feel
        ? `Modo por sensación: tramos por tiempo, la prueba del habla como guía  ·  ${connected ? band.getDeviceName() ?? 'pulsera conectada' : 'sin pulsera'}`
        : `${connected ? (band.getDeviceName() ?? 'pulsera conectada') : 'sin pulsera'}  ·  reposo ${p.hrRestBpm}  ·  máx ${p.hrMaxBpm}  ·  intensidad ${sign}${p.intensityPct} %${stepNote}${reserveNote}`,
    );
    this.statusText.setColor(narrow ? UI.warn : connected || feel ? UI.textMuted : UI.textDim);
    // La pulsera como icono, con su lucecita.
    this.statusGlyph.clear();
    icon(this.statusGlyph, 'band', 1224 - this.statusText.width - 22, 84, 18, connected ? 0x2ecc71 : 0x5d6470);
    this.statusGlyph.fillStyle(connected ? 0x2ecc71 : 0xe74c3c, 1);
    this.statusGlyph.fillCircle(1224 - this.statusText.width - 22 + 9, 84 - 9, 3);
  }

  private openProfile(): void {
    if (this.profilePanel || this.overlayOpen) return;
    const stored = this.registry.get('riderProfileStored') as StoredRiderProfile;
    this.profilePanel = new ProfilePanel(
      this,
      stored,
      () => this.renderStatus(),
      () => {
        this.profilePanel = undefined;
      },
    );
  }

  /** El cribado de salud: cuatro preguntas, el porqué, y el modo por sensación si hace falta. */
  private openScreening(): void {
    if (this.overlayOpen || this.profilePanel) return;
    this.overlayOpen = true;
    const plan = loadPlanState();
    new ScreeningPanel(this, {
      flags: plan.screening?.flags,
      why: plan.why,
      onDone: (flags, mode, why) => {
        savePlanState({ screening: { answeredAtMs: Date.now(), flags }, inputMode: mode, why });
        this.registry.set('inputMode', mode);
        this.overlayOpen = false;
        this.renderStatus();
        this.maybeReview();
      },
    });
  }

  private openMarks(): void {
    if (this.overlayOpen || this.profilePanel) return;
    this.overlayOpen = true;
    new MarksPanel(this, this.history(), () => {
      this.overlayOpen = false;
    });
  }

  /** La salida elegida, abierta en el diseñador tramo a tramo (si cabe en él). */
  private editSteps(): void {
    const entry = this.catalog[this.selectedIndex];
    if (!entry) return;
    const blocks = programToBlocks(this.adjustedProgram(entry));
    if (!blocks) return;
    this.openBuilder(blocks);
  }

  /** El editor de salidas: al guardar, la salida "Mía" entra en las pestañas. */
  private openBuilder(initial?: readonly Block[]): void {
    if (this.overlayOpen || this.profilePanel) return;
    this.overlayOpen = true;
    new BuilderPanel(this, {
      initial: initial ?? loadPlanState().customBlocks,
      onSave: (blocks) => {
        savePlanState({ customBlocks: blocks });
        this.catalog = catalogWithCustom(blocks);
        this.rebuildChips();
        this.overlayOpen = false;
        this.refreshFromHistory();
        this.select(this.catalog.length - 1);
      },
      onClose: () => {
        this.overlayOpen = false;
      },
    });
  }

  /**
   * Los paneles de apertura, en orden y de uno en uno: la revisión semanal,
   * el informe de temporada si se cerró una, y la ceremonia si se subió de
   * fase. Cada uno vuelve a llamar aquí al cerrarse.
   */
  private maybeReview(): void {
    if (this.overlayOpen) return;
    const sessions = this.history();
    if (sessions.length === 0) return; // el historial puede no haber llegado aún
    const nowMs = Date.now();
    const plan: PlanState = loadPlanState();
    if (!plan.screening) return; // primero el cribado; su cierre vuelve a llamar aquí

    if (!this.reviewChecked && weeklyReviewDue(sessions, plan.lastReviewWeekMs, nowMs)) {
      this.reviewChecked = true;
      this.overlayOpen = true;
      new ReviewPanel(this, {
        review: weeklyReview(sessions, nowMs),
        why: plan.why,
        onClose: () => {
          savePlanState({ lastReviewWeekMs: weekStartMs(nowMs) });
          this.overlayOpen = false;
          this.maybeReview();
        },
      });
      return;
    }
    this.reviewChecked = true;

    const closedSeason = seasonReportDue(sessions, plan.lastSeasonReported, nowMs);
    if (closedSeason !== undefined) {
      this.overlayOpen = true;
      new SeasonPanel(this, seasonReport(sessions, closedSeason), () => {
        savePlanState({ lastSeasonReported: closedSeason });
        this.overlayOpen = false;
        this.maybeReview();
      });
      return;
    }

    // La ceremonia de fase: solo al subir, y una vez. La primera vez que se
    // conoce la fase no se celebra nada: se anota.
    const order: PlanPhase[] = ['arranque', 'base', 'rotacion'];
    const current = planPhase(sessions, nowMs).phase;
    const seen = plan.lastPhaseSeen;
    if (seen === undefined) {
      savePlanState({ lastPhaseSeen: current });
    } else if (current !== 'descarga' && order.indexOf(current) > order.indexOf(seen) && hasCeremony(current)) {
      this.overlayOpen = true;
      new PhasePanel(this, current, () => {
        savePlanState({ lastPhaseSeen: current });
        this.overlayOpen = false;
      });
    } else if (current !== 'descarga' && current !== seen) {
      savePlanState({ lastPhaseSeen: current });
    }
  }

  // ---- el cartel de la salida -----------------------------------------------

  private buildCard(): void {
    paper(this, RIGHT_X, POSTER_Y, RIGHT_W, POSTER_H, { tilt: 0.004, depth: 1 });
    this.cardName = this.add
      .text(RIGHT_X + 26, POSTER_Y + 48, '', { fontFamily: FONT_SANS, fontSize: '40px', fontStyle: 'bold', color: INK })
      .setDepth(2);
    this.cardDuration = this.add
      .text(RIGHT_X + RIGHT_W - 24, POSTER_Y + 54, '', { fontFamily: FONT_MONO, fontSize: '30px', fontStyle: 'bold', color: INK })
      .setOrigin(1, 0)
      .setDepth(2);
    this.cardReason = this.add
      .text(RIGHT_X + 26, POSTER_Y + 96, '', { fontFamily: FONT_SANS, fontSize: '15px', color: INK_MUTED, wordWrap: { width: RIGHT_W - 52 } })
      .setDepth(2);
    this.preview = new ProfilePreview(this, RIGHT_X + 26, POSTER_Y + 138, RIGHT_W - 52, 70, 2);
    this.cardGate = this.add
      .text(RIGHT_X + 26, POSTER_Y + POSTER_H - 22, '', { fontFamily: FONT_SANS, fontSize: '12px', color: INK_RED, wordWrap: { width: RIGHT_W - 260 } })
      .setOrigin(0, 0.5)
      .setDepth(2);
    this.cardHorde = this.add.graphics().setDepth(2);
    // Cada tramo se puede tocar: la salida se abre en el diseñador.
    this.editButton = makeIconButton(this, RIGHT_X + RIGHT_W - 100, POSTER_Y + POSTER_H - 24, 150, 34, 'pencil', 'Editar pasos', () => this.editSteps(), 3, 13);
    paper(this, RIGHT_X, ADJUST_Y, RIGHT_W, ADJUST_H, { tilt: -0.003, depth: 1, dark: true, pins: false });
  }

  private buildChip(entry: CatalogEntry, index: number): void {
    const n = this.catalog.length;
    const w = Math.floor((RIGHT_W - CHIP_GAP * (n - 1)) / n);
    const x = RIGHT_X + index * (w + CHIP_GAP);
    const chipPaper = this.add.graphics({ x, y: CHIPS_Y }).setDepth(1);
    const hit = this.add
      .rectangle(x, CHIPS_Y, w, CHIP_H, 0xffffff, 0.001)
      .setOrigin(0, 0)
      .setDepth(3)
      .setInteractive({ useHandCursor: true });
    const stripe = this.add
      .rectangle(x, CHIPS_Y + CHIP_H - 4, w, 4, TARGET_COLOR[entry.program.target] ?? 0x7f8c8d)
      .setOrigin(0, 0)
      .setDepth(2);
    const glyph = this.add.graphics().setDepth(2);
    icon(glyph, TARGET_ICON[entry.program.target] ?? 'road', x + w / 2, CHIPS_Y + 15, 18, INK_HEX, 0.85);
    const label = this.add
      .text(x + w / 2, CHIPS_Y + 33, chipLabel(entry), { fontFamily: FONT_SANS, fontSize: '11px', color: INK })
      .setOrigin(0.5)
      .setDepth(2);
    hit.on('pointerdown', () => this.select(index));
    this.chips.push({ paper: chipPaper, hit, label, stripe, glyph });
    this.paintChip(this.chips.length - 1, false, w);
    if (index === 0 && !this.otherLabel) {
      this.otherLabel = heading(this, RIGHT_X, CHIPS_Y - 20, 'Otra salida', 12, UI.textMuted, 2);
    }
  }

  private paintChip(i: number, selected: boolean, w?: number): void {
    const chip = this.chips[i];
    if (!chip) return;
    const n = this.catalog.length;
    const width = w ?? Math.floor((RIGHT_W - CHIP_GAP * (n - 1)) / n);
    const g = chip.paper;
    g.clear();
    g.fillStyle(0x000000, 0.3);
    g.fillRect(3, 4, width, CHIP_H);
    g.fillStyle(selected ? PAPER : PAPER_DARK, selected ? 1 : 0.8);
    g.fillRect(0, 0, width, CHIP_H);
    if (selected) {
      g.fillStyle(INK_RED_HEX, 1);
      g.fillCircle(width / 2, 5, 4);
    }
    chip.label.setColor(selected ? INK : INK_MUTED);
  }

  private rebuildChips(): void {
    for (const chip of this.chips) {
      chip.paper.destroy();
      chip.hit.destroy();
      chip.label.destroy();
      chip.stripe.destroy();
      chip.glyph.destroy();
    }
    this.chips = [];
    this.catalog.forEach((entry, i) => this.buildChip(entry, i));
  }

  private select(index: number): void {
    const entry = this.catalog[index];
    if (!entry) return;
    this.selectedIndex = index;
    this.stored.programId = entry.program.id;
    this.persist();
    this.chips.forEach((_chip, i) => this.paintChip(i, i === index));

    const recommended = index === this.recommendedIndex;
    this.cardStamp?.destroy();
    this.cardStamp = stamp(
      this,
      RIGHT_X + 130,
      POSTER_Y + 26,
      recommended ? `Salida de hoy · ${PHASE_ES[this.recommendation.phase]}` : 'Tu elección de hoy',
      recommended ? INK_RED : INK_MUTED,
      2,
      14,
    );
    this.cardName.setText(entry.program.name);
    // La puerta del plan, si la hay: información, no prohibición.
    const gate = programGate(entry.program.id, this.history(), Date.now());
    this.cardReason.setText(recommended ? this.recommendation.reason : entry.description);
    this.cardReason.setColor(recommended ? INK : INK_MUTED);
    this.cardGate.setText(!recommended && gate ? gate : '');
    this.drawHorde(entry.program.target);
    // Editar pasos solo si la salida cabe en el diseñador (las de muchas oleadas no).
    const editable = programToBlocks(this.adjustedProgram(entry)) !== undefined;
    this.editButton.rect.setAlpha(editable ? 0.9 : 0.3);
    this.editButton.label.setAlpha(editable ? 1 : 0.4);
    this.editButton.gfx.setAlpha(editable ? 1 : 0.4);

    this.rebuildAdjustments(entry);
    this.refreshPreview(entry);
  }

  /** Los zombis del cartel: cuántos y cómo de grandes según lo que pide la salida. */
  private drawHorde(target: string): void {
    const g = this.cardHorde;
    g.clear();
    const spec = TARGET_HORDE[target] ?? TARGET_HORDE.aerobic!;
    let x = RIGHT_X + RIGHT_W - 200;
    const y = POSTER_Y + POSTER_H - 26;
    for (let i = 0; i < spec.count; i++) {
      icon(g, 'zombie', x, y, spec.size, INK_RED_HEX, spec.alpha - i * 0.08);
      x -= spec.size * 0.7;
    }
    if (target === 'strength') icon(g, 'mountain', x - 10, y, 30, INK_HEX, 0.6);
  }

  /** Valores de ajuste del programa, con defaults rellenados y persistidos. */
  private valuesFor(entry: CatalogEntry): Record<string, number> {
    const values = this.stored.values[entry.program.id] ?? {};
    for (const spec of entry.adjustments) {
      if (values[spec.id] === undefined) values[spec.id] = spec.defaultValue;
    }
    this.stored.values[entry.program.id] = values;
    return values;
  }

  private adjustedProgram(entry: CatalogEntry) {
    return applyAdjustments(entry.program, entry.adjustments, this.valuesFor(entry));
  }

  private adjustedDurationSec(entry: CatalogEntry): number {
    return totalDurationSec(expandProgram(this.adjustedProgram(entry)));
  }

  private rebuildAdjustments(entry: CatalogEntry): void {
    this.adjustObjects.forEach((obj) => obj.destroy());
    this.adjustObjects = [];
    const values = this.valuesFor(entry);
    if (entry.adjustments.length === 0) {
      const note = this.add
        .text(RIGHT_X + RIGHT_W / 2, ADJUST_Y + ADJUST_H / 2, 'Esta salida va como está.', { fontFamily: FONT_SANS, fontSize: '15px', color: INK_DIM })
        .setOrigin(0.5)
        .setDepth(2);
      this.adjustObjects.push(note);
      return;
    }

    entry.adjustments.forEach((spec, row) => {
      const y = ADJUST_Y + 22 + row * 32;
      const label = this.add
        .text(RIGHT_X + 26, y, spec.label, { fontFamily: FONT_SANS, fontSize: '17px', color: INK })
        .setOrigin(0, 0.5)
        .setDepth(2);
      const valueText = this.add
        .text(1104, y, '', { fontFamily: FONT_MONO, fontSize: '22px', fontStyle: 'bold', color: INK })
        .setOrigin(0.5)
        .setDepth(2);
      const renderValue = () =>
        valueText.setText(`${values[spec.id] ?? spec.defaultValue}${spec.unit ? ` ${spec.unit}` : ''}`);
      const bump = (direction: number) => {
        const current = values[spec.id] ?? spec.defaultValue;
        values[spec.id] = Math.min(spec.max, Math.max(spec.min, current + direction * spec.step));
        this.persist();
        renderValue();
        this.refreshPreview(entry);
      };
      const minus = makeTapButton(this, 1040, y, 28, '−', () => bump(-1), 2);
      const plus = makeTapButton(this, 1168, y, 28, '+', () => bump(1), 2);
      renderValue();
      this.adjustObjects.push(label, valueText, minus.rect, minus.label, plus.rect, plus.label);
    });
  }

  private refreshPreview(entry: CatalogEntry): void {
    this.preview.show(this.adjustedProgram(entry));
    this.cardDuration.setText(formatMMSS(this.adjustedDurationSec(entry)));
  }

  private persist(): void {
    this.registry.set('trainingConfig', this.stored);
  }

  private startRide(): void {
    if (this.profilePanel || this.overlayOpen) return; // un panel abierto: el dim se traga el toque
    const entry = this.catalog[this.selectedIndex];
    if (!entry) return;
    this.launch(this.adjustedProgram(entry));
  }

  /** Diez minutos de recuperación, sin tocar la selección: para el día que no hay más. */
  private startMinimal(): void {
    if (this.profilePanel || this.overlayOpen) return;
    const entry = PROGRAM_CATALOG.find((e) => e.program.id === 'recuperacion');
    if (!entry) return;
    this.launch(applyAdjustments(entry.program, entry.adjustments, { ...MINIMAL_RIDE }));
  }

  private launch(program: ReturnType<typeof applyAdjustments>): void {
    this.registry.set('selectedProgram', program);
    // Todo lo que exige gesto de usuario, en el mismo gesto.
    try {
      if (!this.scale.isFullscreen) this.scale.startFullscreen();
    } catch {
      // El fullscreen puede fallar (p. ej. iframe); el juego sigue igual.
    }
    acquireWakeLock();
    gameAudio.unlock();
    this.scene.start('RideScene');
  }
}
