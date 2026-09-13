/**
 * Parser puro de la característica Heart Rate Measurement (0x2A37).
 * Sin DOM ni Bluetooth: se testea con un DataView a mano.
 *
 * Byte 0 son flags. Bit 0 en 1 → el pulso es uint16 LE en bytes 1-2;
 * en 0 → uint8 en byte 1. Bits 1-2 informan del contacto con la piel
 * (bit 1 = la banda lo soporta, bit 2 = detectado). El resto (energía,
 * intervalos RR) no nos hace falta.
 */
export interface HeartRateMeasurement {
  bpm: number;
  /** undefined si la banda no informa del contacto. */
  sensorContact?: boolean;
}

export function parseHeartRateMeasurement(view: DataView): HeartRateMeasurement | undefined {
  if (view.byteLength < 2) return undefined;
  const flags = view.getUint8(0);
  const is16 = (flags & 0x01) !== 0;
  if (is16 && view.byteLength < 3) return undefined;
  const bpm = is16 ? view.getUint16(1, true) : view.getUint8(1);
  const contactSupported = (flags & 0x02) !== 0;
  const result: HeartRateMeasurement = { bpm };
  if (contactSupported) result.sensorContact = (flags & 0x04) !== 0;
  return result;
}
