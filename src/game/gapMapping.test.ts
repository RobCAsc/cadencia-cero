import { describe, expect, it } from 'vitest';
import { RENDER } from '../config';
import { gapToPx, hordeScale } from './gapMapping';

describe('gapToPx', () => {
  it('contacto en 0 px y punto medio en gapHalfM', () => {
    expect(gapToPx(0)).toBe(0);
    expect(gapToPx(RENDER.gapHalfM)).toBeCloseTo(RENDER.gapPxMax / 2, 10);
  });

  it('es monotono y acotado por gapPxMax', () => {
    let prev = -1;
    for (let g = 0; g <= 500; g += 5) {
      const px = gapToPx(g);
      expect(px).toBeGreaterThan(prev);
      expect(px).toBeLessThan(RENDER.gapPxMax);
      prev = px;
    }
  });

  it('trata gaps negativos como contacto', () => {
    expect(gapToPx(-10)).toBe(0);
  });
});

describe('hordeScale', () => {
  it('escala 1 al contacto y decrece con la distancia', () => {
    expect(hordeScale(0)).toBe(1);
    expect(hordeScale(150)).toBeLessThan(hordeScale(20));
    expect(hordeScale(1000)).toBeGreaterThan(0.5);
  });
});
