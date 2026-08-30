import type { CadenceSource } from './CadenceSource';
import { FakeCadenceSource } from './FakeCadenceSource';

export type CadenceSourceKind = 'fake' | 'ble';

/** Fuente seleccionable en runtime: 'fake' hoy; el slot 'ble' llega en Fase 1. */
export function createCadenceSource(kind: CadenceSourceKind): CadenceSource {
  switch (kind) {
    case 'fake':
      return new FakeCadenceSource();
    case 'ble':
      throw new Error('Fuente BLE CSC: Fase 1');
  }
}
