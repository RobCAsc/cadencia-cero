import type { HeartRateSample } from '../sim/types';

export type { HeartRateSample };

export type HeartRateListener = (sample: HeartRateSample) => void;

/**
 * Entrada de pulso tras la misma interfaz que la cadencia: la fuente falsa
 * (slider) para desarrollar en el escritorio y la BLE real (perfil Heart Rate
 * estándar, que es lo que difunde la Huawei Band 9) para entrenar.
 */
export interface HeartRateSource {
  start(): Promise<void> | void;
  stop(): void;
  /** Suscribe un listener; devuelve la función para desuscribir. */
  onSample(listener: HeartRateListener): () => void;
}
