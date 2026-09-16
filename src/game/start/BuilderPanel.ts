import Phaser from 'phaser';
import { RENDER } from '../../config';
import { expandProgram, totalDurationSec } from '../../sim/program';
import {
  blocksToProgram,
  DEFAULT_BLOCKS,
  KIND_ORDER,
  MAX_BLOCKS,
  sustainability,
  validateProgram,
  type Block,
  type BlockKind,
} from '../../sim/programRules';
import { formatMMSS } from '../format';
import { KIND_ES } from '../hud/KindNames';
import { FONT_MONO, FONT_SANS, KIND_COLOR, UI } from '../theme';
import { makeTapButton, makeTextButton, type TapButton } from '../uiButton';

// Diseña tu salida: bloques (calor, ritmo, oleada, recuperación, calma) con
// minutos y zona, dentro de las reglas del pulso. Antes de guardar, el rider
// modelo la corre: si a él lo alcanzan, no vale. Creatividad dentro de la
// fisiología.

const DEPTH = 55;
const PANEL_W = 1040;
const PANEL_H = 660;
const ROW0_Y = 118;
const ROW_H = 52;
const GOLD = '#d9b06a';

export interface BuilderPanelOptions {
  initial?: readonly Block[];
  onSave: (blocks: Block[]) => void;
  onClose: () => void;
}

export class BuilderPanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private rowObjects: Phaser.GameObjects.GameObject[] = [];
  private blocks: Block[];
  private readonly verdictText: Phaser.GameObjects.Text;
  private readonly totalText: Phaser.GameObjects.Text;
  private readonly saveButton: TapButton;
  private readonly addButton: TapButton;
  private checked = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: BuilderPanelOptions,
  ) {
    this.blocks = (opts.initial ?? DEFAULT_BLOCKS).map((b) => ({ ...b }));
    const cx = RENDER.width / 2;
    const cy = RENDER.height / 2;
    const top = cy - PANEL_H / 2;
    const dim = scene.add.rectangle(cx, cy, RENDER.width, RENDER.height, 0x05060e, 0.86).setDepth(DEPTH).setInteractive();
    const panel = scene.add.rectangle(cx, cy, PANEL_W, PANEL_H, UI.panel).setDepth(DEPTH).setStrokeStyle(2, 0x3a4256);
    const title = scene.add
      .text(cx, top + 34, 'Diseña tu salida', { fontFamily: FONT_SANS, fontSize: '30px', fontStyle: 'bold', color: UI.textBright })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    const subtitle = scene.add
      .text(cx, top + 66, 'Toca el tipo para cambiarlo. Calor de tres minutos, esfuerzos de un minuto o más, calma al final: el rider modelo la prueba antes de guardar.', {
        fontFamily: FONT_SANS,
        fontSize: '14px',
        color: UI.textMuted,
        align: 'center',
        wordWrap: { width: PANEL_W - 80 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.objects.push(dim, panel, title, subtitle);

    const footY = top + PANEL_H - 44;
    this.addButton = makeTextButton(scene, cx - 400, footY, 150, 46, '+ bloque', () => this.addBlock(), DEPTH + 1, 18);
    const testButton = makeTextButton(scene, cx - 220, footY, 170, 46, 'Probar', () => this.check(), DEPTH + 1, 18);
    this.saveButton = makeTextButton(scene, cx - 20, footY, 170, 46, 'Guardar', () => this.save(), DEPTH + 1, 18);
    const close = makeTextButton(scene, cx + 380, footY, 150, 46, 'Cerrar', () => this.close(), DEPTH + 1, 18);
    this.totalText = scene.add
      .text(cx + 200, footY, '', { fontFamily: FONT_MONO, fontSize: '22px', color: UI.textBright })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.verdictText = scene.add
      .text(cx, footY - 56, '', { fontFamily: FONT_SANS, fontSize: '15px', color: UI.info, align: 'center', wordWrap: { width: PANEL_W - 80 } })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.objects.push(this.addButton.rect, this.addButton.label, testButton.rect, testButton.label, this.saveButton.rect, this.saveButton.label, close.rect, close.label, this.totalText, this.verdictText);
    this.render();
  }

  private rowY(i: number): number {
    return RENDER.height / 2 - PANEL_H / 2 + ROW0_Y + i * ROW_H;
  }

  private render(): void {
    this.rowObjects.forEach((o) => o.destroy());
    this.rowObjects = [];
    const cx = RENDER.width / 2;
    const left = cx - PANEL_W / 2 + 40;
    const g = this.scene.add.graphics().setDepth(DEPTH + 1);
    this.rowObjects.push(g);

    this.blocks.forEach((block, i) => {
      const y = this.rowY(i);
      g.fillStyle(KIND_COLOR[block.kind] ?? 0xffffff, 0.9);
      g.fillRect(left, y - 14, 6, 28);
      const index = this.scene.add
        .text(left + 18, y, `${i + 1}`, { fontFamily: FONT_MONO, fontSize: '18px', color: UI.textDim })
        .setOrigin(0, 0.5)
        .setDepth(DEPTH + 1);
      const kind = makeTextButton(this.scene, left + 150, y, 190, 40, KIND_ES[block.kind] ?? block.kind, () => this.cycleKind(i), DEPTH + 1, 17);
      const minutesLabel = this.scene.add
        .text(left + 300, y, 'min', { fontFamily: FONT_SANS, fontSize: '15px', color: UI.textDim })
        .setOrigin(0, 0.5)
        .setDepth(DEPTH + 1);
      const minutesMinus = makeTapButton(this.scene, left + 360, y, 40, '−', () => this.bump(i, 'minutes', -1), DEPTH + 1);
      const minutes = this.scene.add
        .text(left + 420, y, `${block.minutes}`, { fontFamily: FONT_MONO, fontSize: '24px', color: UI.textBright })
        .setOrigin(0.5)
        .setDepth(DEPTH + 1);
      const minutesPlus = makeTapButton(this.scene, left + 480, y, 40, '+', () => this.bump(i, 'minutes', 1), DEPTH + 1);
      const zoneLabelText = this.scene.add
        .text(left + 540, y, block.kind === 'warmup' || block.kind === 'cooldown' ? 'hasta zona' : block.kind === 'recover' ? 'zona ≤' : 'zona', {
          fontFamily: FONT_SANS,
          fontSize: '15px',
          color: UI.textDim,
        })
        .setOrigin(0, 0.5)
        .setDepth(DEPTH + 1);
      const zoneMinus = makeTapButton(this.scene, left + 660, y, 40, '−', () => this.bump(i, 'zone', -1), DEPTH + 1);
      const zone = this.scene.add
        .text(left + 720, y, block.zone === 0 ? 'suave' : `Z${block.zone}`, { fontFamily: FONT_MONO, fontSize: '24px', color: UI.textBright })
        .setOrigin(0.5)
        .setDepth(DEPTH + 1);
      const zonePlus = makeTapButton(this.scene, left + 780, y, 40, '+', () => this.bump(i, 'zone', 1), DEPTH + 1);
      const remove = makeTapButton(this.scene, left + 860, y, 36, '×', () => this.removeBlock(i), DEPTH + 1);
      remove.rect.setAlpha(0.6);
      this.rowObjects.push(index, kind.rect, kind.label, minutesLabel, minutesMinus.rect, minutesMinus.label, minutes, minutesPlus.rect, minutesPlus.label, zoneLabelText, zoneMinus.rect, zoneMinus.label, zone, zonePlus.rect, zonePlus.label, remove.rect, remove.label);
    });

    const program = blocksToProgram(this.blocks);
    const total = this.blocks.length > 0 ? totalDurationSec(expandProgram(program)) : 0;
    this.totalText.setText(formatMMSS(total));
    this.addButton.rect.setAlpha(this.blocks.length >= MAX_BLOCKS ? 0.4 : 1);
    if (!this.checked) {
      const problems = this.blocks.length > 0 ? validateProgram(program) : ['La salida está vacía.'];
      this.verdictText.setText(problems.length > 0 ? problems.join('  ·  ') : 'Cumple las reglas. Pruébala con el rider modelo para poder guardarla.');
      this.verdictText.setColor(problems.length > 0 ? UI.warn : UI.textMuted);
      this.saveButton.rect.setAlpha(0.4);
    }
  }

  private cycleKind(i: number): void {
    const block = this.blocks[i];
    if (!block) return;
    const next = KIND_ORDER[(KIND_ORDER.indexOf(block.kind) + 1) % KIND_ORDER.length] as BlockKind;
    block.kind = next;
    this.touched();
  }

  private bump(i: number, field: 'minutes' | 'zone', delta: number): void {
    const block = this.blocks[i];
    if (!block) return;
    if (field === 'minutes') block.minutes = Math.min(45, Math.max(1, block.minutes + delta));
    else block.zone = Math.min(5, Math.max(0, block.zone + delta));
    this.touched();
  }

  private addBlock(): void {
    if (this.blocks.length >= MAX_BLOCKS) return;
    // El bloque nuevo entra antes de la calma, si la hay.
    const last = this.blocks[this.blocks.length - 1];
    const block: Block = { kind: 'steady', minutes: 5, zone: 2 };
    if (last?.kind === 'cooldown') this.blocks.splice(this.blocks.length - 1, 0, block);
    else this.blocks.push(block);
    this.touched();
  }

  private removeBlock(i: number): void {
    this.blocks.splice(i, 1);
    this.touched();
  }

  private touched(): void {
    this.checked = false;
    this.render();
  }

  /** Reglas primero; luego el rider modelo. Solo entonces se puede guardar. */
  private check(): void {
    const program = blocksToProgram(this.blocks);
    const problems = this.blocks.length > 0 ? validateProgram(program) : ['La salida está vacía.'];
    if (problems.length > 0) {
      this.verdictText.setText(problems.join('  ·  '));
      this.verdictText.setColor(UI.warn);
      return;
    }
    const verdict = sustainability(program);
    this.checked = verdict.ok;
    this.verdictText.setText(verdict.message);
    this.verdictText.setColor(verdict.ok ? UI.good : UI.warn);
    this.saveButton.rect.setAlpha(verdict.ok ? 1 : 0.4);
  }

  private save(): void {
    if (!this.checked) {
      this.check();
      if (!this.checked) return;
    }
    const blocks = this.blocks.map((b) => ({ ...b }));
    this.destroy();
    this.opts.onSave(blocks);
  }

  private close(): void {
    this.destroy();
    this.opts.onClose();
  }

  private destroy(): void {
    this.rowObjects.forEach((o) => o.destroy());
    this.rowObjects = [];
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
  }
}

export { GOLD as BUILDER_GOLD };
