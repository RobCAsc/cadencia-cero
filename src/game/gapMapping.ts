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

/**
 * Exageración visual de la pendiente: un 6 % real se dibuja como un 10 %.
 * Con 2,5 la horda lejana caía casi fuera de pantalla en las cuestas.
 */
export const SLOPE_VISUAL_FACTOR = 1.6;

/** Pendiente de pantalla (tangente) para un desnivel en %: positiva = cuesta arriba hacia la derecha. */
export function slopeForGrade(gradePct: number): number {
  return (Math.max(0, gradePct) / 100) * SLOPE_VISUAL_FACTOR;
}

/**
 * Altura del suelo en la pantalla para una x, con la carretera inclinada
 * `slope` (tangente) y pivotando en los pies del ciclista: lo que queda atrás
 * (la horda) está más abajo en la cuesta.
 */
export function groundYAt(x: number, slope: number, cfg: { playerX: number; groundY: number } = RENDER): number {
  return cfg.groundY - (x - cfg.playerX) * slope;
}

/** Rotación (rad) de un objeto apoyado en la carretera inclinada. */
export function slopeRotation(slope: number): number {
  return -Math.atan(slope);
}
