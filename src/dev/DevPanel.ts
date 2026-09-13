import type Phaser from 'phaser';
import type { FakeCadenceSource } from '../input/FakeCadenceSource';
import type { FakeHeartRateSource } from '../input/FakeHeartRateSource';
import { BleHeartRateSource, type BleStatus } from '../input/BleHeartRateSource';
import type { HeartRateSource } from '../input/HeartRateSource';
import type { RideScene } from '../game/scenes/RideScene';

const MAX_RPM = 130;
const MAX_BPM = 200;

const STATUS_LABEL: Record<BleStatus, string> = {
  idle: 'sin pulsera',
  unsupported: 'sin Web Bluetooth',
  requesting: 'eligiendo…',
  connecting: 'conectando…',
  connected: 'conectada',
  reconnecting: 'reconectando…',
  disconnected: 'desconectada',
  error: 'error',
};

/**
 * Overlay DOM de desarrollo: los "sensores" mientras no hay hardware, y el
 * botón para enchufar la pulsera real cuando sí lo hay.
 * DOM y no canvas a propósito: un <input type=range> nativo da arrastre
 * preciso y foco de teclado gratis, y mantiene el utillaje de las fuentes
 * falsas fuera de la capa de render. Solo se monta en dev o con ?dev=1.
 */
export class DevPanel {
  private readonly slider: HTMLInputElement;
  private readonly readout: HTMLSpanElement;
  private readonly emitToggle: HTMLInputElement;
  private readonly hrSlider: HTMLInputElement;
  private readonly hrReadout: HTMLSpanElement;
  private readonly bleButton: HTMLButtonElement;
  private readonly bleStatus: HTMLSpanElement;
  private readonly bleReadout: HTMLSpanElement;

  private ble: BleHeartRateSource | undefined;
  private unsubscribeLive: (() => void) | undefined;

  constructor(
    private readonly game: Phaser.Game,
    private readonly fake: FakeCadenceSource,
    private readonly fakeHr: FakeHeartRateSource,
  ) {
    const root = document.getElementById('dev-panel');
    if (!root) throw new Error('falta #dev-panel en index.html');

    root.innerHTML = `
      <strong>Panel dev</strong>
      <label>Entrada <select id="dev-input"><option value="heartRate">pulso</option><option value="cadence">cadencia</option></select></label>
      <label>Cadencia <input id="dev-cadence" type="range" min="0" max="${MAX_RPM}" step="1" value="0" /></label>
      <span id="dev-readout">0 rpm</span>
      <label><input id="dev-emit" type="checkbox" checked /> Emitir muestras</label>
      <label>Pulso <input id="dev-hr" type="range" min="0" max="${MAX_BPM}" step="1" value="0" /></label>
      <span id="dev-hr-readout">sin pulso</span>
      <button id="dev-skip" type="button">Saltar segmento</button>
      <span class="ble">
        <button id="dev-ble" type="button">Conectar pulsera</button>
        <span id="dev-ble-status" class="ble-status">${STATUS_LABEL.idle}</span>
        <span id="dev-ble-readout"></span>
      </span>
      <span class="hint">&uarr;/&darr; cadencia &middot; &larr;/&rarr; resistencia &middot; +/&minus; pulso &middot; 0 parar &middot; S se&ntilde;al</span>
    `;
    root.classList.add('visible');

    const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel) as T;
    this.slider = q<HTMLInputElement>('#dev-cadence');
    this.readout = q<HTMLSpanElement>('#dev-readout');
    this.emitToggle = q<HTMLInputElement>('#dev-emit');
    this.hrSlider = q<HTMLInputElement>('#dev-hr');
    this.hrReadout = q<HTMLSpanElement>('#dev-hr-readout');
    this.bleButton = q<HTMLButtonElement>('#dev-ble');
    this.bleStatus = q<HTMLSpanElement>('#dev-ble-status');
    this.bleReadout = q<HTMLSpanElement>('#dev-ble-readout');
    const skip = q<HTMLButtonElement>('#dev-skip');
    const inputSelect = q<HTMLSelectElement>('#dev-input');

    // La entrada elegida la lee RideScene al empezar cada sesión.
    inputSelect.value = (this.game.registry.get('inputMode') as string | undefined) ?? 'heartRate';
    inputSelect.addEventListener('change', () => {
      this.game.registry.set('inputMode', inputSelect.value);
      inputSelect.blur();
    });
    this.slider.addEventListener('input', () => this.setCadence(Number(this.slider.value)));
    this.emitToggle.addEventListener('change', () => this.fake.setEmitting(this.emitToggle.checked));
    this.hrSlider.addEventListener('input', () => this.setBpm(Number(this.hrSlider.value)));
    skip.addEventListener('click', () => {
      this.rideScene()?.fastForwardToNextSegment();
      skip.blur(); // que Espacio/Enter no lo re-dispare al seguir jugando
    });
    this.bleButton.addEventListener('click', () => {
      void this.toggleBle();
      this.bleButton.blur();
    });

    if (!BleHeartRateSource.isSupported()) {
      this.bleButton.disabled = true;
      this.showStatus('unsupported');
    }

    this.watchLive(this.fakeHr);
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  private rideScene(): RideScene | undefined {
    if (!this.game.scene.isActive('RideScene')) return undefined;
    return this.game.scene.getScene('RideScene') as RideScene;
  }

  private setCadence(rpm: number): void {
    const clamped = Math.min(MAX_RPM, Math.max(0, Math.round(rpm)));
    this.fake.setCadence(clamped);
    this.slider.value = String(clamped);
    this.readout.textContent = `${clamped} rpm`;
  }

  private setBpm(bpm: number): void {
    const clamped = Math.min(MAX_BPM, Math.max(0, Math.round(bpm)));
    this.fakeHr.setBpm(clamped);
    this.hrSlider.value = String(clamped);
    this.hrReadout.textContent = clamped > 0 ? `${clamped} bpm` : 'sin pulso';
  }

  /**
   * Alterna entre el slider y la pulsera real. La fuente activa vive en el
   * registry de Phaser bajo 'heartRateSource'; la escena la lee al empezar.
   */
  private async toggleBle(): Promise<void> {
    if (this.ble) {
      this.ble.stop();
      this.ble = undefined;
      this.activateHeartRate(this.fakeHr);
      this.bleButton.textContent = 'Conectar pulsera';
      this.showStatus('idle');
      return;
    }
    const ble = new BleHeartRateSource();
    ble.onStatus((status, detail) => this.showStatus(status, detail));
    this.bleButton.disabled = true;
    try {
      await ble.start(); // desde el click: gesto de usuario para el chooser
      this.ble = ble;
      this.activateHeartRate(ble);
      this.bleButton.textContent = 'Desconectar pulsera';
    } catch (err) {
      console.warn('[ble] no se pudo conectar la pulsera', err);
    } finally {
      this.bleButton.disabled = false;
    }
  }

  private activateHeartRate(source: HeartRateSource): void {
    const current = this.game.registry.get('heartRateSource') as HeartRateSource | undefined;
    if (current === source) return;
    if (current === this.fakeHr) this.fakeHr.stop();
    if (source === this.fakeHr) this.fakeHr.start();
    this.game.registry.set('heartRateSource', source);
    this.watchLive(source);
  }

  private watchLive(source: HeartRateSource): void {
    this.unsubscribeLive?.();
    this.bleReadout.textContent = '';
    this.unsubscribeLive = source.onSample((s) => {
      this.bleReadout.textContent = source === this.fakeHr ? '' : `♥ ${s.bpm}`;
    });
  }

  private showStatus(status: BleStatus, detail?: string): void {
    const name = this.ble?.getDeviceName();
    const label =
      status === 'connected' && (detail || name)
        ? `${STATUS_LABEL[status]}: ${detail ?? name}`
        : detail && status !== 'connected'
          ? `${STATUS_LABEL[status]} (${detail})`
          : STATUS_LABEL[status];
    this.bleStatus.textContent = label;
    this.bleStatus.className = 'ble-status';
    if (status === 'connected') this.bleStatus.classList.add('connected');
    if (status === 'error' || status === 'unsupported' || status === 'disconnected') {
      this.bleStatus.classList.add('error');
    }
    if (status !== 'connected' && status !== 'reconnecting') this.bleReadout.textContent = '';
  }

  private onKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowUp':
        this.setCadence(this.fake.getCadence() + 5);
        e.preventDefault();
        break;
      case 'ArrowDown':
        this.setCadence(this.fake.getCadence() - 5);
        e.preventDefault();
        break;
      case 'ArrowLeft':
        this.rideScene()?.adjustResistance(-1);
        e.preventDefault();
        break;
      case 'ArrowRight':
        this.rideScene()?.adjustResistance(1);
        e.preventDefault();
        break;
      case '+':
      case '=':
        this.setBpm(this.fakeHr.getBpm() + 5);
        break;
      case '-':
        this.setBpm(this.fakeHr.getBpm() - 5);
        break;
      case '0':
        this.setCadence(0);
        break;
      case 's':
      case 'S':
        this.emitToggle.checked = !this.emitToggle.checked;
        this.fake.setEmitting(this.emitToggle.checked);
        break;
      default:
        break;
    }
  }
}
