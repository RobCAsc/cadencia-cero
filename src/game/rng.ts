/**
 * LCG determinista para el arte generado: el paisaje y la manada son los
 * mismos en cada arranque, y retunear no cambia lo que ya viste.
 */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
