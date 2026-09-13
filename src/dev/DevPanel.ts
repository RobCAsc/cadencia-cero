import type Phaser from 'phaser';
import type { FakeCadenceSource } from '../input/FakeCadenceSource';
import type { FakeHeartRateSource } from '../input/FakeHeartRateSource';
import type { BandConnection } from '../input/BandConnection';
import type { BleStatus } from '../input/BleHeartRateSource';
import type { HeartRateSource } from '../input/HeartRateSource';
import type { RideScene } from '../game/scenes/RideScene';

const MAX_RPM = 130;
const MAX_BPM = 200;

export const BLE_STATUS_LABEL: Record<BleStatus, string> = {
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
  private readonly band: BandConnection;

  private unsubscribeLive: (() => void) | undefined;

  constructor(
    private readonly game: Phaser.Game,
    private readonly fake: FakeCadenceSource,
    private readonly fakeHr: FakeHeartRateSource,
  ) {
    const root = document.getElementById('dev-panel');
    if (!root) throw new Error('falta #dev-panel en index.html');
    this.band = game.registry.get('band') as BandConnection;

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
        <span id="dev-ble-status" class="ble-status">${BLE_STATUS_LABEL.idle}</span>
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
      void this.toggleBand();
      this.bleButton.blur();
    });

    this.band.onStatus((status, detail) => this.showStatus(status, detail));
    this.showStatus(this.band.getStatus(), this.band.getDetail());
    if (this.band.getStatus() === 'unsupported') this.bleButton.disabled = true;

    // La fuente activa cambia al conectar/desconectar (desde aquí o desde la
    // pantalla de inicio); seguimos siempre a la que esté publicada.
    this.watchLive(this.game.registry.get('heartRateSource') as HeartRateSource);
    this.game.registry.events.on(
      'changedata-heartRateSource',
      (_parent: unknown, source: HeartRateSource) => this.watchLive(source),
    );

    window.addEventListener('keydown', (e) => this.onKeyDown(e));

    // El panel es fijo al pie: si el lienzo no cede sitio, tapa la franja
    // inferior del juego (y con ella el botón de perfil). Se reserva su
    // altura y se avisa al escalador de Phaser.
    const app = document.getElementById('app');
    if (app) {
      const reserve = () => {
        app.style.height = `calc(100% - ${root.offsetHeight}px)`;
        this.game.scale.refresh();
      };
      reserve();
      new ResizeObserver(reserve).observe(root);
    }
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

  private async toggleBand(): Promise<void> {
    if (this.band.isConnected()) {
      this.band.disconnect();
      return;
    }
    this.bleButton.disabled = true;
    try {
      await this.band.connect(); // desde el click: gesto de usuario para el chooser
    } finally {
      this.bleButton.disabled = false;
    }
  }

  private watchLive(source: HeartRateSource): void {
    this.unsubscribeLive?.();
    this.bleReadout.textContent = '';
    this.unsubscribeLive = source.onSample((s) => {
      this.bleReadout.textContent = source === this.fakeHr ? '' : `♥ ${s.bpm}`;
    });
  }

  private showStatus(status: BleStatus, detail?: string): void {
    const name = this.band.getDeviceName();
    const label =
      status === 'connected' && (detail || name)
        ? `${BLE_STATUS_LABEL[status]}: ${detail ?? name}`
        : detail && status !== 'connected'
          ? `${BLE_STATUS_LABEL[status]} (${detail})`
          : BLE_STATUS_LABEL[status];
    this.bleStatus.textContent = label;
    this.bleStatus.className = 'ble-status';
    if (status === 'connected') this.bleStatus.classList.add('connected');
    if (status === 'error' || status === 'unsupported' || status === 'disconnected') {
      this.bleStatus.classList.add('error');
    }
    if (status !== 'connected' && status !== 'reconnecting') this.bleReadout.textContent = '';
    this.bleButton.textContent = status === 'connected' ? 'Desconectar pulsera' : 'Conectar pulsera';
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
