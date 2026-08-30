import { RENDER } from '../config';

interface GapRenderConfig {
  gapPxMax: number;
  gapHalfM: number;
}

/**
 * Mapeo asintótico gap (m) → offset en pantalla (px): gapPxMax · g / (g + gapHalfM).
 * Las distancias de peligro reciben la mayoría de los píxeles y la horda nunca
 * sale de pantalla: la amenaza siempre es visible, sin indicador de borde.
 */
export function gapToPx(gapM: number, cfg: GapRenderConfig = RENDER): number {
  const g = Math.max(0, gapM);
  return (cfg.gapPxMax * g) / (g + cfg.gapHalfM);
}

/** Escala de la horda con la distancia: 1 al contacto, 0.55 en el infinito. */
export function hordeScale(gapM: number, cfg: GapRenderConfig = RENDER): number {
  return 1 - 0.45 * (gapToPx(gapM, cfg) / cfg.gapPxMax);
}
