import Phaser from 'phaser';
import { expandProgram, totalDurationSec } from '../../sim/program';
import {
  applyAdjustments,
  PROGRAM_CATALOG,
  type CatalogEntry,
} from '../../sim/programs/catalog';
import { Atmosphere } from '../atmosphere';
import { gameAudio } from '../audio';
import { formatMMSS } from '../format';
import { ProfilePreview } from '../start/ProfilePreview';
import { FONT_MONO, FONT_SANS, UI } from '../theme';
import { makeTapButton } from '../uiButton';
import { acquireWakeLock } from '../wakeLock';

const TARGET_COLOR: Record<string, number> = {
  recovery: 0x2ecc71,
  aerobic: 0x16a085,
  threshold: 0xf39c12,
  anaerobic: 0xe74c3c,
  mixed: 0x9b59b6,
};

const CARD_X = 56;
const CARD_W = 480;
const CARD_H = 88;
const CARD_PITCH = 100;
const CARD_Y0 = 140;
const PANEL_X = 620;

interface CardRefs {
  bg: Phaser.GameObjects.Rectangle;
  duration: Phaser.GameObjects.Text;
}

/** Configuración elegida, persistida en el registry mientras viva la sesión. */
interface StoredConfig {
  programId: string;
  values: Record<string, Record<string, number>>;
}

/**
 * Pantalla de configuración del entrenamiento: eliges el programa (= el perfil
 * del antagonista), lo ajustas dentro de rangos acotados y EMPEZAR es el gesto
 * que desbloquea fullscreen, wake lock y audio — el mismo patrón de gesto que
 * exigirá requestDevice() en Fase 1.
 */
export class StartScene extends Phaser.Scene {
  private selectedIndex = 0;
  private stored!: StoredConfig;
  private atmosphere!: Atmosphere;
  private cards: CardRefs[] = [];
  private preview!: ProfilePreview;
  // Objetos de las filas de ajuste, destruidos y recreados al cambiar de
  // programa. Sin Container: el hit-test de Phaser no ve botones re-parentados.
  private adjustObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('StartScene');
  }

  create(): void {
    // La noche de fondo, atenuada para que la UI respire.
    this.atmosphere = new Atmosphere(this, false);
    this.add.rectangle(0, 0, 1280, 720, 0x05060e, 0.6).setOrigin(0, 0);

    const stored = this.registry.get('trainingConfig') as StoredConfig | undefined;
    this.stored = stored ?? { programId: 'hiit-30-30', values: {} };
    const storedIndex = PROGRAM_CATALOG.findIndex((e) => e.program.id === this.stored.programId);
    this.selectedIndex = storedIndex >= 0 ? storedIndex : 0;
    this.cards = [];

    this.add.text(CARD_X, 34, 'CADENCIA CERO', {
      fontFamily: FONT_SANS,
      fontSize: '44px',
      fontStyle: 'bold',
      color: UI.textBright,
    });
    this.add.text(CARD_X, 92, 'Elige a tu perseguidor y pedalea', {
      fontFamily: FONT_SANS,
      fontSize: '20px',
      color: UI.textMuted,
    });

    PROGRAM_CATALOG.forEach((entry, i) => this.buildCard(entry, i));

    this.add.text(PANEL_X, 132, 'Perfil de la horda', {
      fontFamily: FONT_SANS,
      fontSize: '20px',
      color: UI.textMuted,
    });
    this.preview = new ProfilePreview(this, PANEL_X, 162, 600, 168);
    this.adjustObjects = [];

    const startButton = this.add
      .rectangle(1070, 620, 300, 84, 0x1e8449)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(1070, 620, 'EMPEZAR', {
        fontFamily: FONT_SANS,
        fontSize: '36px',
        fontStyle: 'bold',
        color: UI.textBright,
      })
      .setOrigin(0.5);
    startButton.on('pointerover', () => startButton.setFillStyle(0x27ae60));
    startButton.on('pointerout', () => startButton.setFillStyle(0x1e8449));
    startButton.on('pointerdown', () => this.startRide());

    this.add.text(CARD_X, 682, 'Entrada: cadencia simulada (panel dev)', {
      fontFamily: FONT_SANS,
      fontSize: '16px',
      color: UI.textDim,
    });

    this.select(this.selectedIndex);
  }

  update(_time: number, deltaMs: number): void {
    this.atmosphere.update(0, deltaMs / 1000); // la niebla deriva sola
  }

  private buildCard(entry: CatalogEntry, index: number): void {
    const y = CARD_Y0 + index * CARD_PITCH;
    const bg = this.add
      .rectangle(CARD_X, y, CARD_W, CARD_H, 0x161b28)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    this.add
      .rectangle(CARD_X, y, 6, CARD_H, TARGET_COLOR[entry.program.target] ?? 0x7f8c8d)
      .setOrigin(0, 0);
    this.add.text(CARD_X + 24, y + 12, entry.program.name, {
      fontFamily: FONT_SANS,
      fontSize: '24px',
      fontStyle: 'bold',
      color: UI.textBright,
    });
    const duration = this.add
      .text(CARD_X + CARD_W - 16, y + 16, formatMMSS(this.adjustedDurationSec(entry)), {
        fontFamily: FONT_MONO,
        fontSize: '20px',
        color: UI.textMuted,
      })
      .setOrigin(1, 0);
    this.add.text(CARD_X + 24, y + 50, entry.description, {
      fontFamily: FONT_SANS,
      fontSize: '15px',
      color: UI.textMuted,
    });

    bg.on('pointerdown', () => this.select(index));
    bg.on('pointerover', () => {
      if (this.selectedIndex !== index) bg.setFillStyle(0x1b2233);
    });
    bg.on('pointerout', () => {
      if (this.selectedIndex !== index) bg.setFillStyle(0x161b28);
    });
    this.cards.push({ bg, duration });
  }

  private select(index: number): void {
    const entry = PROGRAM_CATALOG[index];
    if (!entry) return;
    this.selectedIndex = index;
    this.stored.programId = entry.program.id;
    this.persist();

    this.cards.forEach((card, i) => {
      card.bg.setFillStyle(i === index ? 0x232b3d : 0x161b28);
      if (i === index) card.bg.setStrokeStyle(2, 0x7ec8ff);
      else card.bg.setStrokeStyle();
    });

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
      const y = 408 + row * 72;
      const label = this.add.text(PANEL_X, y, spec.label, {
        fontFamily: FONT_SANS,
        fontSize: '22px',
        color: UI.textMuted,
      }).setOrigin(0, 0.5);
      const valueText = this.add
        .text(1136, y, '', { fontFamily: FONT_MONO, fontSize: '28px', color: UI.textBright })
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
      const minus = makeTapButton(this, 1064, y, 56, '−', () => bump(-1));
      const plus = makeTapButton(this, 1208, y, 56, '+', () => bump(1));
      renderValue();
      this.adjustObjects.push(label, valueText, minus.rect, minus.label, plus.rect, plus.label);
    });
  }

  private refreshPreview(entry: CatalogEntry): void {
    this.preview.show(this.adjustedProgram(entry));
    this.cards[this.selectedIndex]?.duration.setText(formatMMSS(this.adjustedDurationSec(entry)));
  }

  private persist(): void {
    this.registry.set('trainingConfig', this.stored);
  }

  private startRide(): void {
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
