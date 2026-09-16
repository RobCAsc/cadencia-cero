import Phaser from 'phaser';
import { RENDER } from '../../config';
import type { BandConnection } from '../../input/BandConnection';
import type { BleStatus } from '../../input/BleHeartRateSource';
import type { HeartRateSource } from '../../input/HeartRateSource';
import { StepTest, type StepProgress } from '../../sim/heartRateTests';
import { isCountable, type SessionRecord } from '../../sim/history';
import {
  INTENSITY_MAX,
  INTENSITY_MIN,
  reserveWarning,
  STEP_TEST_FROM_RIDES,
  stepTestDue,
  toSimRider,
  withAge,
  withIntensity,
  withManualMax,
  withMaxFromAge,
  withRest,
  withStepTest,
  zoneWidthBpm,
  type StoredRiderProfile,
} from '../../sim/riderProfile';
import { saveRiderProfile } from '../../storage/riderStore';
import { formatMMSS } from '../format';
import { FONT_MONO, FONT_SANS, UI } from '../theme';
import { makeTapButton, makeTextButton } from '../uiButton';

const DEPTH = 50;
const PANEL_W = 900;
const PANEL_H = 620;
const LABEL_X = 230;
const VALUE_X = 620;
const MINUS_X = 540;
const PLUS_X = 700;
const ACTION_X = 930;
const ROW0_Y = 168;
const ROW_H = 62;

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
  step: 'de la escalera',
  anchor: 'derivado del ritmo cómodo',
  observed: 'pico observado en sesión',
  manual: 'ajustado a mano',
};

const REST_SOURCE_ES: Record<NonNullable<StoredRiderProfile['hrRestSource']>, string> = {
  default: 'por defecto: mídelo con el minuto de calma',
  ritual: 'del minuto de calma',
  manual: 'ajustado a mano',
  measured: 'medido',
};

const STAGE_ES = {
  warm: ['Escalón 1 de 3 · entrar en calor (4 min)', 'Pedalea suave y ve subiendo. Este escalón no cuenta, solo calienta.'],
  easy: ['Escalón 2 de 3 · cómodo', 'Un ritmo en el que hablas sin problema, frases enteras.'],
  hard: ['Escalón 3 de 3 · fuerte', 'Un ritmo en el que ya no puedes hablar. Aguanta los dos minutos; si algo no va, cancela.'],
} as const;
const STEP_BUTTON_LABEL = 'Escalera 8 min';

/**
 * Overlay de perfil y pulsera sobre la pantalla de inicio. Todo lo que cambia
 * el perfil pasa por setProfile(): persiste, publica al registry y redibuja.
 * El reposo llega solo del minuto de calma; el máximo, de la escalera (dos
 * anclas del habla) y de los picos observados. Sin Container a propósito: el
 * hit-test de Phaser no ve botones re-parentados.
 */
export class ProfilePanel {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly band: BandConnection;
  private profile: StoredRiderProfile;

  private bandStatusText!: Phaser.GameObjects.Text;
  private bandButton!: ReturnType<typeof makeTextButton>;
  private ageText!: Phaser.GameObjects.Text;
  private restText!: Phaser.GameObjects.Text;
  private restSourceText!: Phaser.GameObjects.Text;
  private maxText!: Phaser.GameObjects.Text;
  private maxSourceText!: Phaser.GameObjects.Text;
  private reserveText!: Phaser.GameObjects.Text;
  private stepText!: Phaser.GameObjects.Text;
  private stepNoteText!: Phaser.GameObjects.Text;
  private stepButton!: ReturnType<typeof makeTextButton>;
  private intensityText!: Phaser.GameObjects.Text;
  private testText!: Phaser.GameObjects.Text;

  private active: StepTest | undefined;
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
      .text(cx, 90, 'Tu perfil y la pulsera', {
        fontFamily: FONT_SANS,
        fontSize: '32px',
        fontStyle: 'bold',
        color: UI.textBright,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    const subtitle = this.scene.add
      .text(cx, 124, 'El juego mide con lo que el pulso sí puede dar: reposo, máximo y lo que pasa en cada salida.', {
        fontFamily: FONT_SANS,
        fontSize: '15px',
        color: UI.textDim,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.objects.push(dim, panel, title, subtitle);

    // Fila 0: pulsera
    this.label(0, 'Pulsera');
    this.bandStatusText = this.value(0, '', UI.textMuted, 22).setOrigin(0, 0.5).setX(MINUS_X - 28);
    this.bandButton = this.action(0, 'Conectar', () => void this.toggleBand());

    // Fila 1: edad
    this.label(1, 'Edad');
    this.ageText = this.value(1, '');
    this.stepper(1, (d) => this.setProfile(withAge(this.profile, this.profile.ageYears + d)));

    // Fila 2: reposo (llega solo del minuto de calma; el stepper es el ajuste a mano)
    this.label(2, 'Reposo');
    this.restText = this.value(2, '');
    this.stepper(2, (d) => this.setProfile(withRest(this.profile, this.profile.hrRestBpm + d)));
    this.restSourceText = this.note(2);

    // Fila 3: máximo, con vuelta a la estimación por edad a un toque (tocarlo
    // a mano latido a latido no es camino para deshacer un error).
    this.label(3, 'Máximo');
    this.maxText = this.value(3, '').setY(this.rowY(3) - 8);
    this.stepper(3, (d) => this.setProfile(withManualMax(this.profile, this.profile.hrMaxBpm + d)));
    this.maxSourceText = this.scene.add
      .text(VALUE_X, this.rowY(3) + 16, '', { fontFamily: FONT_SANS, fontSize: '13px', color: UI.textDim })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.objects.push(this.maxSourceText);
    this.action(3, 'Por edad', () => this.setProfile(withMaxFromAge(this.profile)));
    // Aviso de reserva estrecha: las zonas son el 10 % de la reserva, y con
    // pocos latidos por zona la salida es perseguir un número.
    this.reserveText = this.scene.add
      .text(cx, this.rowY(5) + 40, '', { fontFamily: FONT_SANS, fontSize: '15px', color: UI.warn, align: 'center', wordWrap: { width: PANEL_W - 80 } })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.objects.push(this.reserveText);

    // Fila 4: escalera
    this.label(4, 'Escalera');
    this.stepText = this.value(4, '', UI.textBright, 22).setY(this.rowY(4) - 8);
    this.stepNoteText = this.scene.add
      .text(VALUE_X, this.rowY(4) + 16, '', { fontFamily: FONT_SANS, fontSize: '13px', color: UI.textDim })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    this.objects.push(this.stepNoteText);
    this.stepButton = this.action(4, STEP_BUTTON_LABEL, () => this.toggleTest());

    // Fila 5: intensidad
    this.label(5, 'Intensidad');
    this.intensityText = this.value(5, '');
    this.stepper(5, (d) => this.setProfile(withIntensity(this.profile, this.profile.intensityPct + 5 * d)));

    // Pie: estado de la prueba en curso y cerrar
    this.testText = this.scene.add
      .text(cx, this.rowY(6) + 24, '', { fontFamily: FONT_SANS, fontSize: '19px', color: UI.info, align: 'center' })
      .setOrigin(0.5)
      .setDepth(DEPTH + 1);
    const close = makeTextButton(this.scene, cx, RENDER.height - 76, 220, 56, 'Cerrar', () => this.close(), DEPTH + 1, 24);
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

  private note(row: number): Phaser.GameObjects.Text {
    const t = this.scene.add
      .text(ACTION_X - 110, this.rowY(row), '', { fontFamily: FONT_SANS, fontSize: '16px', color: UI.textDim })
      .setOrigin(0, 0.5)
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
    this.restSourceText.setText(REST_SOURCE_ES[p.hrRestSource ?? 'default']);
    this.maxText.setText(`${p.hrMaxBpm} bpm`);
    this.maxSourceText.setText(`${MAX_SOURCE_ES[p.hrMaxSource]} · zonas de ${zoneWidthBpm(p).toFixed(1).replace('.', ',')} latidos`);
    const warning = reserveWarning(p);
    this.reserveText.setText(warning ?? '');
    this.maxText.setColor(warning ? UI.warn : UI.textBright);
    this.stepText.setText(
      p.anchorBpm !== undefined && p.hardBpm !== undefined
        ? `cómodo ${p.anchorBpm} · fuerte ${p.hardBpm}`
        : p.anchorBpm !== undefined
          ? `cómodo ${p.anchorBpm} · fuerte ––`
          : '––',
    );
    // La escalera se gana con seis salidas (el escalón fuerte no es para el
    // primer día) y se repite cuando envejece o el reposo bajó.
    const rides = this.ridesCount();
    const due = stepTestDue(p, Date.now());
    const locked = rides < STEP_TEST_FROM_RIDES;
    this.stepNoteText.setText(
      locked
        ? `a partir de la salida ${STEP_TEST_FROM_RIDES} (llevas ${rides})`
        : due === 'stale'
          ? 'toca repetirla: hace más de seis semanas'
          : due === 'restDropped'
            ? 'toca repetirla: tu reposo bajó'
            : due === 'never'
              ? 'dos anclas del habla afinan el máximo'
              : '',
    );
    this.stepNoteText.setColor(due === 'stale' || due === 'restDropped' ? UI.warn : UI.textDim);
    if (!this.active) this.stepButton.rect.setAlpha(locked ? 0.45 : 1);

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

  // ---- la escalera ---------------------------------------------------------

  private ridesCount(): number {
    const history = (this.scene.registry.get('sessionHistory') as SessionRecord[] | undefined) ?? [];
    return history.filter(isCountable).length;
  }

  private toggleTest(): void {
    if (this.active) {
      this.stopTest();
      return;
    }
    if (this.ridesCount() < STEP_TEST_FROM_RIDES) {
      this.testText.setText(`La escalera pide un escalón fuerte: se abre a partir de la salida ${STEP_TEST_FROM_RIDES}. Hasta entonces, edad y reposo bastan.`);
      this.testText.setColor(UI.textMuted);
      return;
    }
    const source = this.scene.registry.get('heartRateSource') as HeartRateSource;
    this.active = new StepTest();
    this.unsubscribeSamples = source.onSample((s) => this.active?.push(s));
    this.ticker = this.scene.time.addEvent({ delay: 250, loop: true, callback: () => this.tick() });
    this.stepButton.label.setText('Cancelar');
    this.renderTest(this.active.progress(performance.now()));
  }

  private tick(): void {
    if (!this.active) return;
    const progress = this.active.progress(performance.now());
    this.renderTest(progress);
    if (progress.done) this.finishTest();
  }

  private renderTest(progress: StepProgress): void {
    if (!this.active) return;
    const [stageTitle, hint] = STAGE_ES[progress.stage];
    const live = progress.liveBpm > 0 ? `♥ ${progress.liveBpm}` : 'esperando pulso…';
    const clock = progress.elapsedSec === 0 ? '' : ` · quedan ${formatMMSS(progress.stageRemainingSec)}`;
    this.testText.setText(`${stageTitle}${clock} · ${live}\n${hint}`);
    this.testText.setColor(progress.stage === 'hard' ? UI.warn : UI.info);
  }

  private finishTest(): void {
    const active = this.active;
    if (!active) return;
    const result = active.result();
    this.stopTest();
    if (result === undefined) {
      this.testText.setText('No llegaron muestras suficientes de la pulsera. Repite la escalera.');
      this.testText.setColor(UI.warn);
      return;
    }
    this.setProfile(withStepTest(this.profile, result.easyBpm, result.hardBpm, Date.now()));
    this.testText.setText(
      `Escalera: cómodo ${result.easyBpm} · fuerte ${result.hardBpm} → máximo ${this.profile.hrMaxBpm} bpm (${MAX_SOURCE_ES[this.profile.hrMaxSource]}).`,
    );
    this.testText.setColor(UI.good);
  }

  private stopTest(): void {
    this.unsubscribeSamples?.();
    this.unsubscribeSamples = undefined;
    this.ticker?.remove(false);
    this.ticker = undefined;
    this.active = undefined;
    this.stepButton.label.setText(STEP_BUTTON_LABEL);
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
