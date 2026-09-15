import Phaser from 'phaser';
import { RENDER } from '../../config';
import { FONT_SANS, UI } from '../theme';
import { makeTextButton, type TapButton } from '../uiButton';

const DEPTH = 17;
const W = 640;
const H = 118;
const Y = 372;

export interface Offer {
  text: string;
  yesLabel: string;
  noLabel?: string;
  onYes: () => void;
  onNo?: () => void;
  durationMs: number;
}

/**
 * Una pregunta durante la salida con dos botones y un plazo: el empujón
 * opcional, cambiar a suave con la salud a cero. Se cierra sola si el rider
 * no contesta; no contestar nunca cuesta nada.
 */
export class OfferBanner {
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private readonly timer: Phaser.GameObjects.Rectangle;
  private readonly yes: TapButton;
  private readonly no: TapButton;
  private offer: Offer | undefined;
  private untilMs = 0;

  constructor(private readonly scene: Phaser.Scene) {
    const cx = RENDER.width / 2;
    this.bg = scene.add.rectangle(cx, Y, W, H, UI.panel, 0.95).setDepth(DEPTH).setStrokeStyle(2, 0x7ec8ff);
    this.label = scene.add
      .text(cx, Y - 28, '', { fontFamily: FONT_SANS, fontSize: '24px', color: UI.textBright, align: 'center', wordWrap: { width: W - 40 } })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.timer = scene.add.rectangle(cx - W / 2, Y + H / 2 - 4, W, 4, 0x7ec8ff).setOrigin(0, 0.5).setDepth(DEPTH + 1);
    this.yes = makeTextButton(scene, cx - 110, Y + 22, 190, 46, '', () => this.answer(true), DEPTH + 1, 20);
    this.no = makeTextButton(scene, cx + 110, Y + 22, 190, 46, '', () => this.answer(false), DEPTH + 1, 20);
    this.no.rect.setAlpha(0.7);
    this.setVisible(false);
  }

  get isOpen(): boolean {
    return this.offer !== undefined;
  }

  show(offer: Offer): void {
    this.offer = offer;
    this.untilMs = this.scene.time.now + offer.durationMs;
    this.label.setText(offer.text);
    this.yes.label.setText(offer.yesLabel);
    this.no.label.setText(offer.noLabel ?? 'No, sigo');
    this.setVisible(true);
  }

  update(): void {
    if (!this.offer) return;
    const left = Math.max(0, (this.untilMs - this.scene.time.now) / this.offer.durationMs);
    this.timer.setScale(left, 1);
    if (left <= 0) this.answer(false);
  }

  hide(): void {
    this.offer = undefined;
    this.setVisible(false);
  }

  private answer(yes: boolean): void {
    const offer = this.offer;
    if (!offer) return;
    this.hide();
    if (yes) offer.onYes();
    else offer.onNo?.();
  }

  private setVisible(visible: boolean): void {
    this.bg.setVisible(visible);
    this.label.setVisible(visible);
    this.timer.setVisible(visible);
    for (const b of [this.yes, this.no]) {
      b.rect.setVisible(visible);
      b.label.setVisible(visible);
      if (visible) b.rect.setInteractive({ useHandCursor: true });
      else b.rect.disableInteractive();
    }
  }
}
