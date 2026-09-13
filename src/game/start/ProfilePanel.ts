import Phaser from 'phaser';
import { RENDER } from '../../config';
import type { BandConnection } from '../../input/BandConnection';
import type { BleStatus } from '../../input/BleHeartRateSource';
import type { HeartRateSource } from '../../input/HeartRateSource';
import { PaceTest, RestTest, type TestProgress } from '../../sim/heartRateTests';
import {
  INTENSITY_MAX,
  INTENSITY_MIN,
  toSimRider,
  withAge,
  withAnchor,
  withIntensity,
  withManualMax,
  withRest,
  type StoredRiderProfile,
} from '../../sim/riderProfile';
import { saveRiderProfile } from '../../storage/riderStore';
import { formatMMSS } from '../format';
import { FONT_MONO, FONT_SANS, UI } from '../theme';
import { makeTapButton, makeTextButton } from '../uiButton';

const DEPTH = 50;
const PANEL_W = 860;
const PANEL_H = 600;
const LABEL_X = 250;
const VALUE_X = 640;
const MINUS_X = 560;
const PLUS_X = 720;
const ACTION_X = 930;
const ROW0_Y = 178;
const ROW_H = 64;

const STATUS_ES: Record<BleStatus, string> = {
  idle: 'sin conectar',
  unsupported: 'este navegador no tiene Web Bluetooth',
  requesting: 'elige la pulsera en el selector…',
  connecting: 'conectando…',
  connected: 'conectada',
  reconnecting: 'reconectando…',
  disconnected: 'desconectada',
  error: 'error al conectar',
};

const MAX_SOURCE_ES: Record<StoredRiderProfile['hrMaxSource'], string> = {
  age: 'estimado por edad',
  anchor: 'derivado del ritmo cómodo',
  observed: 'pico observado en sesión',
  manual: 'ajustado a mano',
};

type ActiveTest =
  | { kind: 'rest'; test: RestTest }
  | { kind: 'pace'; test: PaceTest };

/**
 * Overlay de perfil y pulsera sobre la pantalla de inicio. Todo lo que cambia
 * el perfil pasa por setProfile(): persiste, publica al registry y redibuja.
 * Sin Container a propósito: el hit-test de Phaser no ve botones re-parentados.
 */
export class ProfilePanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly band: BandConnection;
  private profile: StoredRiderProfile;

  private bandStatusText!: Phaser.GameObjects.Text;
  private bandButton!: ReturnType<typeof makeTextButton>;
  private ageText!: Phaser.GameObjects.Text;
  private restText!: Phaser.GameObjects.Text;
  private restButton!: ReturnType<typeof makeTextButton>;
  private maxText!: Phaser.GameObjects.Text;
  private maxSourceText!: Phaser.GameObjects.Text;
  private anchorText!: Phaser.GameObjects.Text;
  private paceButton!: ReturnType<typeof makeTextButton>;
  private intensityText!: Phaser.GameObjects.Text;
  private testText!: Phaser.GameObjects.Text;

  private active: ActiveTest | undefined;
  private unsubscribeSamples: (() => void) | undefined;
  private unsubscribeStatus: (() => void) | undefined;
  private ticker: Phaser.Time.TimerEvent | undefined;

  constructor(
    private readonly scene: Phaser.Scene,
    profile: StoredRiderProfile,
    private readonly onChange: (profile: StoredRiderProfile) => void,
    private readonly onClose: () => void,
  ) {
    this.profile = profile;
    this.band = scene.registry.get('band') as BandConnection;
    this.build();
    this.unsubscribeStatus = this.band.onStatus(() => this.renderBand());
    this.render();
  }

  private build(): void {
    const cx = RENDER.width / 2;
    const cy = RENDER.height / 2;
    const dim = this.scene.add
      .rectangle(cx, cy, RENDER.width, RENDER.height, 0x05060e, 0.82)
      .setDepth(DEPTH)
      .setInteractive(); // se traga los toques de la pantalla de abajo
    const panel = this.scene.add
      .rectangle(cx, cy, PANEL_W, PANEL_H, UI.panel)
      .setDepth(DEPTH)
      .setStrokeStyle(2, 0x3a4256);
    const title = this.scene.add
      .text(cx, 96, 'Tu perfil y la pulsera', {
        fontFamily: FONT_SANS,
        fontSize: '32px',
        fontStyle: 'bold',
        color: UI.textBright,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.objects.push(dim, panel, title);

    // Fila 0: pulsera
    this.label(0, 'Pulsera');
    this.bandStatusText = this.value(0, '', UI.textMuted, 22).setOrigin(0, 0.5).setX(MINUS_X - 28);
    this.bandButton = this.action(0, 'Conectar', () => void this.toggleBand());

    // Fila 1: edad
    this.label(1, 'Edad');
    this.ageText = this.value(1, '');
    this.stepper(1, (d) => this.setProfile(withAge(this.profile, this.profile.ageYears + d)));

    // Fila 2: reposo
    this.label(2, 'Reposo');
    this.restText = this.value(2, '');
    this.stepper(2, (d) => this.setProfile(withRest(this.profile, this.profile.hrRestBpm + d)));
    this.restButton = this.action(2, 'Medir 1 min', () => this.toggleTest('rest'));

    // Fila 3: máximo
    this.label(3, 'Máximo');
    this.maxText = this.value(3, '');
    this.stepper(3, (d) => this.setProfile(withManualMax(this.profile, this.profile.hrMaxBpm + d)));
    this.maxSourceText = this.scene.add
      .text(ACTION_X - 100, this.rowY(3), '', { fontFamily: FONT_SANS, fontSize: '17px', color: UI.textDim })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH + 1);
    this.objects.push(this.maxSourceText);

    // Fila 4: ritmo cómodo
    this.label(4, 'Ritmo cómodo');
    this.anchorText = this.value(4, '');
    this.paceButton = this.action(4, 'Medir 5 min', () => this.toggleTest('pace'));

    // Fila 5: intensidad
    this.label(5, 'Intensidad');
    this.intensityText = this.value(5, '');
    this.stepper(5, (d) => this.setProfile(withIntensity(this.profile, this.profile.intensityPct + 5 * d)));

    // Pie: estado de la prueba en curso y cerrar
    this.testText = this.scene.add
      .text(cx, this.rowY(6) + 6, '', { fontFamily: FONT_SANS, fontSize: '20px', color: UI.info, align: 'center' })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    const close = makeTextButton(this.scene, cx, RENDER.height - 82, 220, 56, 'Cerrar', () => this.close(), DEPTH + 1, 24);
    this.objects.push(this.testText, close.rect, close.label);
  }

  private rowY(row: number): number {
    return ROW0_Y + row * ROW_H;
  }

  private label(row: number, text: string): void {
    const t = this.scene.add
      .text(LABEL_X, this.rowY(row), text, { fontFamily: FONT_SANS, fontSize: '22px', color: UI.textMuted })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH + 1);
    this.objects.push(t);
  }

  private value(row: number, text: string, color: string = UI.textBright, size = 28): Phaser.GameObjects.Text {
    const t = this.scene.add
      .text(VALUE_X, this.rowY(row), text, { fontFamily: FONT_MONO, fontSize: `${size}px`, color })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.objects.push(t);
    return t;
  }

  private stepper(row: number, onDelta: (d: number) => void): void {
    const y = this.rowY(row);
    const minus = makeTapButton(this.scene, MINUS_X, y, 48, '−', () => onDelta(-1), DEPTH + 1);
    const plus = makeTapButton(this.scene, PLUS_X, y, 48, '+', () => onDelta(1), DEPTH + 1);
    this.objects.push(minus.rect, minus.label, plus.rect, plus.label);
  }

  private action(row: number, text: string, onTap: () => void): ReturnType<typeof makeTextButton> {
    const b = makeTextButton(this.scene, ACTION_X, this.rowY(row), 200, 48, text, onTap, DEPTH + 1, 19);
    this.objects.push(b.rect, b.label);
    return b;
  }

  private setProfile(profile: StoredRiderProfile): void {
    this.profile = profile;
    saveRiderProfile(profile);
    this.scene.registry.set('riderProfileStored', profile);
    this.scene.registry.set('riderProfile', toSimRider(profile));
    this.onChange(profile);
    this.render();
  }

  private render(): void {
    const p = this.profile;
    this.ageText.setText(`${p.ageYears} años`);
    this.restText.setText(`${p.hrRestBpm} bpm`);
    this.maxText.setText(`${p.hrMaxBpm} bpm`);
    this.maxSourceText.setText(MAX_SOURCE_ES[p.hrMaxSource]);
    this.anchorText.setText(p.anchorBpm !== undefined ? `${p.anchorBpm} bpm` : '––');
    const sign = p.intensityPct > 0 ? '+' : '';
    this.intensityText.setText(`${sign}${p.intensityPct} %`);
    this.intensityText.setColor(
      p.intensityPct >= INTENSITY_MAX || p.intensityPct <= INTENSITY_MIN ? UI.warn : UI.textBright,
    );
    this.renderBand();
  }

  private renderBand(): void {
    const status = this.band.getStatus();
    const name = this.band.getDeviceName();
    const text = status === 'connected' && name ? `${STATUS_ES[status]}: ${name}` : STATUS_ES[status];
    this.bandStatusText.setText(text);
    this.bandStatusText.setColor(
      status === 'connected' ? UI.good : status === 'error' || status === 'unsupported' ? UI.danger : UI.textMuted,
    );
    this.bandButton.label.setText(status === 'connected' ? 'Desconectar' : 'Conectar');
    const canConnect = status !== 'unsupported' && status !== 'requesting' && status !== 'connecting';
    this.bandButton.rect.setAlpha(canConnect ? 1 : 0.5);
  }

  private async toggleBand(): Promise<void> {
    if (this.band.isConnected()) {
      this.band.disconnect();
      return;
    }
    const status = this.band.getStatus();
    if (status === 'unsupported' || status === 'requesting' || status === 'connecting') return;
    await this.band.connect(); // desde el toque: gesto de usuario para el chooser
  }

  // ---- pruebas rápidas ----------------------------------------------------

  private toggleTest(kind: 'rest' | 'pace'): void {
    if (this.active) {
      const cancelling = this.active.kind === kind;
      this.stopTest();
      if (cancelling) return;
    }
    const source = this.scene.registry.get('heartRateSource') as HeartRateSource;
    this.active = kind === 'rest' ? { kind, test: new RestTest() } : { kind, test: new PaceTest() };
    this.unsubscribeSamples = source.onSample((s) => this.active?.test.push(s));
    this.ticker = this.scene.time.addEvent({ delay: 250, loop: true, callback: () => this.tick() });
    this.renderTest(this.active.test.progress(performance.now()));
  }

  private tick(): void {
    if (!this.active) return;
    const progress = this.active.test.progress(performance.now());
    this.renderTest(progress);
    if (progress.done) this.finishTest();
  }

  private renderTest(progress: TestProgress): void {
    if (!this.active) return;
    const rest = this.active.kind === 'rest';
    this.restButton.label.setText(this.active.kind === 'rest' ? 'Cancelar' : 'Medir 1 min');
    this.paceButton.label.setText(this.active.kind === 'pace' ? 'Cancelar' : 'Medir 5 min');
    const live = progress.liveBpm > 0 ? `♥ ${progress.liveBpm}` : 'esperando pulso…';
    const hint = rest
      ? 'Quieto sobre la bici, sin pedalear.'
      : 'Pedalea a un ritmo que aguantarías media hora hablando.';
    const waiting = progress.elapsedSec === 0;
    this.testText.setText(
      waiting
        ? `${rest ? 'Reposo' : 'Ritmo cómodo'} · ${live}\n${hint}`
        : `${rest ? 'Reposo' : 'Ritmo cómodo'} · quedan ${formatMMSS(progress.remainingSec)} · ${live}\n${hint}`,
    );
    this.testText.setColor(UI.info);
  }

  private finishTest(): void {
    const active = this.active;
    if (!active) return;
    const result = active.test.result();
    this.stopTest();
    if (result === undefined) {
      this.testText.setText('No llegaron muestras suficientes de la pulsera. Repite la prueba.');
      this.testText.setColor(UI.warn);
      return;
    }
    if (active.kind === 'rest') {
      this.setProfile(withRest(this.profile, result));
      this.testText.setText(`Reposo medido: ${result} bpm.`);
    } else {
      this.setProfile(withAnchor(this.profile, result));
      this.testText.setText(
        `Ritmo cómodo: ${result} bpm → máximo derivado ${this.profile.hrMaxBpm} bpm.`,
      );
    }
    this.testText.setColor(UI.good);
  }

  private stopTest(): void {
    this.unsubscribeSamples?.();
    this.unsubscribeSamples = undefined;
    this.ticker?.remove(false);
    this.ticker = undefined;
    this.active = undefined;
    this.restButton.label.setText('Medir 1 min');
    this.paceButton.label.setText('Medir 5 min');
    this.testText.setText('');
  }

  private close(): void {
    this.stopTest();
    this.unsubscribeStatus?.();
    this.objects.forEach((o) => o.destroy());
    this.objects.length = 0;
    this.onClose();
  }
}
