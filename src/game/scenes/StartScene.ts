import Phaser from 'phaser';
import type { BandConnection } from '../../input/BandConnection';
import type { SessionRecord } from '../../sim/history';
import { expandProgram, totalDurationSec } from '../../sim/program';
import {
  applyAdjustments,
  PROGRAM_CATALOG,
  type CatalogEntry,
} from '../../sim/programs/catalog';
import { recommendToday, type Recommendation } from '../../sim/progress';
import type { StoredRiderProfile } from '../../sim/riderProfile';
import { Atmosphere } from '../atmosphere';
import { gameAudio } from '../audio';
import { formatMMSS } from '../format';
import { ProfilePanel } from '../start/ProfilePanel';
import { ProfilePreview } from '../start/ProfilePreview';
import { ProgressPanel } from '../start/ProgressPanel';
import { FONT_MONO, FONT_SANS, UI } from '../theme';
import { makeTapButton, makeTextButton } from '../uiButton';
import { acquireWakeLock } from '../wakeLock';

const TARGET_COLOR: Record<string, number> = {
  starter: 0x5dade2,
  recovery: 0x2ecc71,
  aerobic: 0x16a085,
  threshold: 0xf39c12,
  anaerobic: 0xe74c3c,
  mixed: 0x9b59b6,
};

const LEFT_X = 56;
const LEFT_W = 470;
const RIGHT_X = 580;
const RIGHT_W = 644;
const CARD_Y = 134;
const CARD_H = 236;
const ADJUST_Y0 = 404;
const ADJUST_PITCH = 56;
const CHIPS_Y = 552;
const CHIP_H = 44;
const CHIP_GAP = 6;
const CARD_BG = 0x161b28;
const CARD_BG_SELECTED = 0x1c2334;

interface Chip {
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  stripe: Phaser.GameObjects.Rectangle;
}

/** Configuración elegida, persistida en el registry mientras viva la sesión. */
interface StoredConfig {
  programId: string;
  values: Record<string, Record<string, number>>;
}

/** Nombre corto para los chips: "Primera salida" no cabe. */
function chipLabel(entry: CatalogEntry): string {
  return entry.program.id === 'primera-salida' ? 'Primera' : entry.program.name;
}

/**
 * El campamento: lo que llevas (semana, racha, Ruta, salud) a la izquierda y
 * la salida de hoy a la derecha, lista con un toque. Los demás programas
 * quedan a mano como chips. EMPEZAR es el gesto que desbloquea fullscreen,
 * wake lock y audio, el mismo gesto que exige requestDevice().
 */
export class StartScene extends Phaser.Scene {
  private selectedIndex = 0;
  private recommendedIndex = 0;
  private recommendation!: Recommendation;
  private stored!: StoredConfig;
  private atmosphere!: Atmosphere;
  private progress!: ProgressPanel;
  private preview!: ProfilePreview;
  private cardHeading!: Phaser.GameObjects.Text;
  private cardStripe!: Phaser.GameObjects.Rectangle;
  private cardName!: Phaser.GameObjects.Text;
  private cardDuration!: Phaser.GameObjects.Text;
  private cardReason!: Phaser.GameObjects.Text;
  private chips: Chip[] = [];
  // Objetos de las filas de ajuste, destruidos y recreados al cambiar de
  // programa. Sin Container: el hit-test de Phaser no ve botones re-parentados.
  private adjustObjects: Phaser.GameObjects.GameObject[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private profilePanel: ProfilePanel | undefined;

  constructor() {
    super('StartScene');
  }

  create(): void {
    // La noche de fondo, atenuada para que la UI respire.
    this.atmosphere = new Atmosphere(this, false);
    this.add.rectangle(0, 0, 1280, 720, 0x05060e, 0.74).setOrigin(0, 0);

    const stored = this.registry.get('trainingConfig') as StoredConfig | undefined;
    this.stored = stored ?? { programId: 'primera-salida', values: {} };
    this.chips = [];
    this.adjustObjects = [];

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

    // Perfil y pulsera: botón arriba a la derecha, estado abajo a la izquierda.
    makeTextButton(this, 1124, 54, 200, 42, 'Perfil y pulsera', () => this.openProfile(), 10, 18);
    this.statusText = this.add.text(LEFT_X, 686, '', {
      fontFamily: FONT_SANS,
      fontSize: '15px',
      color: UI.textDim,
    });
    const band = this.registry.get('band') as BandConnection;
    const unsubscribeBand = band.onStatus(() => this.renderStatus());
    this.renderStatus();

    this.progress = new ProgressPanel(this, LEFT_X, 108, LEFT_W);
    this.buildCard();
    PROGRAM_CATALOG.forEach((entry, i) => this.buildChip(entry, i));

    const startButton = this.add
      .rectangle(1074, 650, 300, 84, 0x1e8449)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(1074, 650, 'EMPEZAR', {
        fontFamily: FONT_SANS,
        fontSize: '36px',
        fontStyle: 'bold',
        color: UI.textBright,
      })
      .setOrigin(0.5);
    startButton.on('pointerover', () => startButton.setFillStyle(0x27ae60));
    startButton.on('pointerout', () => startButton.setFillStyle(0x1e8449));
    startButton.on('pointerdown', () => this.startRide());

    // El historial llega de IndexedDB cuando llega (y cambia al sembrarlo o
    // borrarlo desde el panel dev): el campamento se rehace con él.
    const onHistory = () => this.refreshFromHistory();
    this.registry.events.on('changedata-sessionHistory', onHistory);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribeBand();
      this.registry.events.off('changedata-sessionHistory', onHistory);
    });
    this.refreshFromHistory();
  }

  update(_time: number, deltaMs: number): void {
    this.atmosphere.update(0, deltaMs / 1000); // la niebla deriva sola
  }

  private history(): SessionRecord[] {
    return (this.registry.get('sessionHistory') as SessionRecord[] | undefined) ?? [];
  }

  /** Redibuja el progreso y vuelve a recomendar; la selección salta a lo recomendado. */
  private refreshFromHistory(): void {
    const sessions = this.history();
    const nowMs = Date.now();
    this.progress.show(sessions, nowMs);
    this.recommendation = recommendToday(sessions, nowMs);
    const index = PROGRAM_CATALOG.findIndex((e) => e.program.id === this.recommendation.programId);
    this.recommendedIndex = index >= 0 ? index : 0;
    // Los ajustes sugeridos solo rellenan huecos: lo que el rider tocó, se respeta.
    const values = (this.stored.values[this.recommendation.programId] ??= {});
    for (const [id, value] of Object.entries(this.recommendation.values)) {
      if (values[id] === undefined) values[id] = value;
    }
    this.select(this.recommendedIndex);
  }

  private renderStatus(): void {
    const band = this.registry.get('band') as BandConnection;
    const p = this.registry.get('riderProfileStored') as StoredRiderProfile;
    const bandText = band.isConnected()
      ? `Pulsera: ${band.getDeviceName() ?? 'conectada'}`
      : 'Pulsera: sin conectar';
    const sign = p.intensityPct > 0 ? '+' : '';
    this.statusText.setText(
      `${bandText}  ·  ${p.ageYears} años  ·  reposo ${p.hrRestBpm}  ·  máx ${p.hrMaxBpm}  ·  intensidad ${sign}${p.intensityPct} %`,
    );
    this.statusText.setColor(band.isConnected() ? UI.textMuted : UI.textDim);
  }

  private openProfile(): void {
    if (this.profilePanel) return;
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

  // ---- la tarjeta de la salida -----------------------------------------------

  private buildCard(): void {
    this.cardHeading = this.add
      .text(RIGHT_X, 108, 'SALIDA DE HOY', { fontFamily: FONT_SANS, fontSize: '13px', color: UI.textDim })
      .setLetterSpacing(2);
    this.add.rectangle(RIGHT_X, CARD_Y, RIGHT_W, CARD_H, CARD_BG_SELECTED).setOrigin(0, 0).setStrokeStyle(2, 0x2a3142);
    this.cardStripe = this.add.rectangle(RIGHT_X, CARD_Y, 6, CARD_H, 0xffffff).setOrigin(0, 0);
    this.cardName = this.add.text(RIGHT_X + 26, CARD_Y + 16, '', {
      fontFamily: FONT_SANS,
      fontSize: '34px',
      fontStyle: 'bold',
      color: UI.textBright,
    });
    this.cardDuration = this.add
      .text(RIGHT_X + RIGHT_W - 20, CARD_Y + 24, '', { fontFamily: FONT_MONO, fontSize: '24px', color: UI.textMuted })
      .setOrigin(1, 0);
    this.cardReason = this.add.text(RIGHT_X + 26, CARD_Y + 64, '', {
      fontFamily: FONT_SANS,
      fontSize: '17px',
      color: UI.textMuted,
      wordWrap: { width: RIGHT_W - 52 },
    });
    this.preview = new ProfilePreview(this, RIGHT_X + 26, CARD_Y + 108, RIGHT_W - 52, 84);
  }

  private buildChip(entry: CatalogEntry, index: number): void {
    const n = PROGRAM_CATALOG.length;
    const w = Math.floor((RIGHT_W - CHIP_GAP * (n - 1)) / n);
    const x = RIGHT_X + index * (w + CHIP_GAP);
    const rect = this.add
      .rectangle(x, CHIPS_Y, w, CHIP_H, CARD_BG)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    const stripe = this.add
      .rectangle(x, CHIPS_Y + CHIP_H - 4, w, 4, TARGET_COLOR[entry.program.target] ?? 0x7f8c8d)
      .setOrigin(0, 0);
    const label = this.add
      .text(x + w / 2, CHIPS_Y + CHIP_H / 2 - 2, chipLabel(entry), {
        fontFamily: FONT_SANS,
        fontSize: '15px',
        color: UI.textMuted,
      })
      .setOrigin(0.5);
    rect.on('pointerdown', () => this.select(index));
    rect.on('pointerover', () => {
      if (this.selectedIndex !== index) rect.setFillStyle(0x1b2233);
    });
    rect.on('pointerout', () => {
      if (this.selectedIndex !== index) rect.setFillStyle(CARD_BG);
    });
    this.chips.push({ rect, label, stripe });
    if (index === 0) {
      this.add
        .text(RIGHT_X, CHIPS_Y - 24, 'OTRA SALIDA', { fontFamily: FONT_SANS, fontSize: '13px', color: UI.textDim })
        .setLetterSpacing(2);
    }
  }

  private select(index: number): void {
    const entry = PROGRAM_CATALOG[index];
    if (!entry) return;
    this.selectedIndex = index;
    this.stored.programId = entry.program.id;
    this.persist();

    this.chips.forEach((chip, i) => {
      const selected = i === index;
      chip.rect.setFillStyle(selected ? 0x232b3d : CARD_BG);
      if (selected) chip.rect.setStrokeStyle(2, 0x7ec8ff);
      else chip.rect.setStrokeStyle();
      chip.label.setColor(selected ? UI.textBright : UI.textMuted);
    });

    const recommended = index === this.recommendedIndex;
    this.cardHeading.setText(recommended ? 'SALIDA DE HOY' : 'TU ELECCIÓN DE HOY');
    this.cardStripe.setFillStyle(TARGET_COLOR[entry.program.target] ?? 0x7f8c8d);
    this.cardName.setText(entry.program.name);
    this.cardReason.setText(recommended ? this.recommendation.reason : entry.description);
    this.cardReason.setColor(recommended ? UI.info : UI.textMuted);

    this.rebuildAdjustments(entry);
    this.refreshPreview(entry);
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

    entry.adjustments.forEach((spec, row) => {
      const y = ADJUST_Y0 + row * ADJUST_PITCH;
      const label = this.add
        .text(RIGHT_X + 26, y, spec.label, { fontFamily: FONT_SANS, fontSize: '20px', color: UI.textMuted })
        .setOrigin(0, 0.5);
      const valueText = this.add
        .text(1104, y, '', { fontFamily: FONT_MONO, fontSize: '26px', color: UI.textBright })
        .setOrigin(0.5);
      const renderValue = () =>
        valueText.setText(`${values[spec.id] ?? spec.defaultValue}${spec.unit ? ` ${spec.unit}` : ''}`);
      const bump = (direction: number) => {
        const current = values[spec.id] ?? spec.defaultValue;
        values[spec.id] = Math.min(spec.max, Math.max(spec.min, current + direction * spec.step));
        this.persist();
        renderValue();
        this.refreshPreview(entry);
      };
      const minus = makeTapButton(this, 1032, y, 48, '−', () => bump(-1));
      const plus = makeTapButton(this, 1176, y, 48, '+', () => bump(1));
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
    if (this.profilePanel) return; // el panel está abierto: el dim se traga el toque
    const entry = PROGRAM_CATALOG[this.selectedIndex];
    if (!entry) return;
    this.registry.set('selectedProgram', this.adjustedProgram(entry));
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
