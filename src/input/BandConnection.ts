import type Phaser from 'phaser';
import { BleHeartRateSource, type BleStatus, type BleStatusListener } from './BleHeartRateSource';
import type { HeartRateSource } from './HeartRateSource';

/**
 * La pulsera como recurso compartido de toda la app: la pantalla de inicio y
 * el panel dev la conectan y desconectan desde aquí, y la fuente activa
 * (pulsera o slider) queda publicada en el registry bajo 'heartRateSource'.
 */
export class BandConnection {
  private readonly listeners = new Set<BleStatusListener>();
  private ble: BleHeartRateSource | undefined;
  private lastStatus: BleStatus = 'idle';
  private lastDetail: string | undefined;

  constructor(
    private readonly registry: Phaser.Data.DataManager,
    private readonly fallback: HeartRateSource,
  ) {
    if (!BleHeartRateSource.isSupported()) this.lastStatus = 'unsupported';
  }

  static isSupported(): boolean {
    return BleHeartRateSource.isSupported();
  }

  isConnected(): boolean {
    return this.ble?.getStatus() === 'connected';
  }

  getStatus(): BleStatus {
    return this.ble?.getStatus() ?? this.lastStatus;
  }

  getDetail(): string | undefined {
    return this.lastDetail;
  }

  getDeviceName(): string | undefined {
    return this.ble?.getDeviceName();
  }

  onStatus(listener: BleStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Debe llamarse desde un gesto del usuario: abre el chooser nativo. */
  async connect(): Promise<void> {
    if (this.ble) return;
    const ble = new BleHeartRateSource();
    ble.onStatus((status, detail) => this.emit(status, detail));
    try {
      await ble.start();
    } catch (err) {
      console.warn('[ble] no se pudo conectar la pulsera', err);
      return;
    }
    this.ble = ble;
    this.activate(ble);
  }

  disconnect(): void {
    if (!this.ble) return;
    this.ble.stop();
    this.ble = undefined;
    this.activate(this.fallback);
    this.emit('idle');
  }

  private activate(source: HeartRateSource): void {
    const current = this.registry.get('heartRateSource') as HeartRateSource | undefined;
    if (current === source) return;
    if (current === this.fallback) this.fallback.stop();
    if (source === this.fallback) void this.fallback.start();
    this.registry.set('heartRateSource', source);
  }

  private emit(status: BleStatus, detail?: string): void {
    this.lastStatus = status;
    this.lastDetail = detail;
    for (const listener of this.listeners) listener(status, detail);
  }
}
