import { describe, expect, it } from 'vitest';
import { parseHeartRateMeasurement } from './parseHeartRate';

const view = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);

describe('parseHeartRateMeasurement', () => {
  it('lee el pulso como uint8 cuando el bit 0 de flags es 0', () => {
    expect(parseHeartRateMeasurement(view(0x00, 72))).toEqual({ bpm: 72 });
  });

  it('lee el pulso como uint16 LE cuando el bit 0 de flags es 1', () => {
    expect(parseHeartRateMeasurement(view(0x01, 0x2c, 0x01))).toEqual({ bpm: 300 });
  });

  it('informa del contacto con la piel solo si la banda lo soporta', () => {
    expect(parseHeartRateMeasurement(view(0x06, 90))).toEqual({ bpm: 90, sensorContact: true });
    expect(parseHeartRateMeasurement(view(0x02, 90))).toEqual({ bpm: 90, sensorContact: false });
    expect(parseHeartRateMeasurement(view(0x04, 90))).toEqual({ bpm: 90 });
  });

  it('ignora los campos opcionales que siguen al pulso', () => {
    // energía (bit 3) + intervalos RR (bit 4) tras un uint8
    expect(parseHeartRateMeasurement(view(0x18, 130, 0x10, 0x00, 0x20, 0x03))).toEqual({
      bpm: 130,
    });
  });

  it('descarta paquetes truncados', () => {
    expect(parseHeartRateMeasurement(view(0x00))).toBeUndefined();
    expect(parseHeartRateMeasurement(view(0x01, 0x50))).toBeUndefined();
  });
});
