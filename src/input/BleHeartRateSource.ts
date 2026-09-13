import type { HeartRateListener, HeartRateSample, HeartRateSource } from './HeartRateSource';
import { parseHeartRateMeasurement } from './parseHeartRate';

const HR_SERVICE = 'heart_rate'; // 0x180D
const HR_MEASUREMENT = 'heart_rate_measurement'; // 0x2A37

export type BleStatus =
  | 'idle'
  | 'unsupported'
  | 'requesting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export type BleStatusListener = (status: BleStatus, detail?: string) => void;

export interface BleHeartRateSourceOptions {
  now?: () => number;
  /** Reintentos de reconexión antes de darse por vencido. */
  reconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
}

/**
 * Pulsómetro BLE real por Web Bluetooth (perfil Heart Rate estándar).
 *
 * start() abre el chooser nativo y por tanto DEBE llamarse desde un gesto
 * del usuario (un click). Solo funciona en contexto seguro: localhost o
 * HTTPS. Si la banda se desconecta a media sesión, reconecta sola con
 * backoff; esa reconexión no necesita gesto porque el dispositivo ya está
 * autorizado.
 */
export class BleHeartRateSource implements HeartRateSource {
  private readonly listeners = new Set<HeartRateListener>();
  private readonly statusListeners = new Set<BleStatusListener>();
  private readonly now: () => number;
  private readonly reconnectAttempts: number;
  private readonly reconnectBaseDelayMs: number;

  private device: BluetoothDevice | undefined;
  private characteristic: BluetoothRemoteGATTCharacteristic | undefined;
  private status: BleStatus = 'idle';
  private stopped = false;

  constructor(opts: BleHeartRateSourceOptions = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.reconnectAttempts = opts.reconnectAttempts ?? 8;
    this.reconnectBaseDelayMs = opts.reconnectBaseDelayMs ?? 1000;
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  async start(): Promise<void> {
    if (!BleHeartRateSource.isSupported()) {
      this.setStatus('unsupported', 'Web Bluetooth no disponible: hace falta Chrome por HTTPS');
      throw new Error('Web Bluetooth no disponible');
    }
    this.stopped = false;
    this.setStatus('requesting');
    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth.requestDevice({
        // El filtro por servicio es el estándar; el prefijo de nombre es una
        // red de seguridad por si la banda no anuncia el servicio en el
        // advertisement. Con optionalServices podemos leerlo igualmente.
        filters: [{ services: [HR_SERVICE] }, { namePrefix: 'HUAWEI' }],
        optionalServices: [HR_SERVICE],
      });
    } catch (err) {
      // Cancelar el chooser no es un error del sistema, es volver al inicio.
      this.setStatus('idle');
      throw err;
    }
    this.device = device;
    device.addEventListener('gattserverdisconnected', this.onDisconnected);
    try {
      await this.connect();
    } catch (err) {
      this.setStatus('error', errorMessage(err));
      throw err;
    }
  }

  stop(): void {
    this.stopped = true;
    this.detachCharacteristic();
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.onDisconnected);
      this.device.gatt?.disconnect();
      this.device = undefined;
    }
    this.setStatus('disconnected');
  }

  onSample(listener: HeartRateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: BleStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): BleStatus {
    return this.status;
  }

  getDeviceName(): string | undefined {
    return this.device?.name ?? undefined;
  }

  private async connect(): Promise<void> {
    const device = this.device;
    if (!device?.gatt) throw new Error('El dispositivo no expone GATT');
    this.setStatus('connecting');
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(HR_SERVICE);
    const characteristic = await service.getCharacteristic(HR_MEASUREMENT);
    characteristic.addEventListener('characteristicvaluechanged', this.onValue);
    await characteristic.startNotifications();
    this.characteristic = characteristic;
    this.setStatus('connected', device.name ?? undefined);
  }

  private detachCharacteristic(): void {
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.onValue);
    this.characteristic = undefined;
  }

  private readonly onValue = (event: Event): void => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    if (!target.value) return;
    const parsed = parseHeartRateMeasurement(target.value);
    if (!parsed || parsed.bpm <= 0) return;
    const sample: HeartRateSample = { bpm: parsed.bpm, timestampMs: this.now() };
    for (const listener of this.listeners) listener(sample);
  };

  private readonly onDisconnected = (): void => {
    this.detachCharacteristic();
    if (this.stopped) return;
    void this.reconnect();
  };

  private async reconnect(): Promise<void> {
    this.setStatus('reconnecting');
    for (let attempt = 0; attempt < this.reconnectAttempts && !this.stopped; attempt++) {
      await delay(this.reconnectBaseDelayMs * 2 ** Math.min(attempt, 4));
      if (this.stopped) return;
      try {
        await this.connect();
        return;
      } catch {
        // seguimos intentando
      }
    }
    if (!this.stopped) this.setStatus('disconnected', 'No se pudo reconectar');
  }

  private setStatus(status: BleStatus, detail?: string): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status, detail);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
