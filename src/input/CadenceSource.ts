import type { CadenceSample } from '../sim/types';

export type { CadenceSample };

export type CadenceListener = (sample: CadenceSample) => void;

/**
 * La capa de entrada detrás de una interfaz con dos implementaciones:
 * la fuente falsa (slider) hoy, la BLE CSC real en Fase 1. La falsa no es
 * andamiaje descartable: es como se desarrolla y depura el juego sin pedalear.
 */
export interface CadenceSource {
  start(): Promise<void> | void;
  stop(): void;
  /** Suscribe un listener; devuelve la función para desuscribir. */
  onSample(listener: CadenceListener): () => void;
}
