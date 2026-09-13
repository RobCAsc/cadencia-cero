import { BleHeartRateSource } from './BleHeartRateSource';
import { FakeHeartRateSource } from './FakeHeartRateSource';
import type { HeartRateSource } from './HeartRateSource';

export type HeartRateSourceKind = 'fake' | 'ble';

/** Fuente seleccionable en runtime: el slider del panel dev o la pulsera real. */
export function createHeartRateSource(kind: HeartRateSourceKind): HeartRateSource {
  switch (kind) {
    case 'fake':
      return new FakeHeartRateSource();
    case 'ble':
      return new BleHeartRateSource();
  }
}
