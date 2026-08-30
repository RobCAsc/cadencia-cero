import { describe, expect, it } from 'vitest';
import { expandProgram, totalDurationSec } from '../program';
import { applyAdjustments, PROGRAM_CATALOG } from './catalog';
import { HIIT_30_30 } from './hiit-30-30';

const hiitEntry = PROGRAM_CATALOG.find((e) => e.program.id === 'hiit-30-30');
if (!hiitEntry) throw new Error('falta hiit-30-30 en el catálogo');

describe('PROGRAM_CATALOG', () => {
  it('todas las entradas expanden sin errores y con duración positiva', () => {
    for (const entry of PROGRAM_CATALOG) {
      const expanded = expandProgram(entry.program);
      expect(totalDurationSec(expanded)).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('los ids de programa son únicos', () => {
    const ids = PROGRAM_CATALOG.map((e) => e.program.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('los ajustes tienen rangos coherentes', () => {
    for (const entry of PROGRAM_CATALOG) {
      for (const spec of entry.adjustments) {
        expect(spec.min).toBeLessThanOrEqual(spec.max);
        expect(spec.step).toBeGreaterThan(0);
        expect(spec.defaultValue).toBeGreaterThanOrEqual(spec.min);
        expect(spec.defaultValue).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it('los defaults coinciden con el programa base (aplicar defaults = no tocar nada)', () => {
    for (const entry of PROGRAM_CATALOG) {
      const adjusted = applyAdjustments(entry.program, entry.adjustments, {});
      expect(expandProgram(adjusted)).toEqual(expandProgram(entry.program));
    }
  });
});

describe('applyAdjustments', () => {
  it('repeats cambia las ejecuciones totales de las oleadas', () => {
    const adjusted = applyAdjustments(hiitEntry.program, hiitEntry.adjustments, { repeats: 6 });
    const expanded = expandProgram(adjusted);
    expect(expanded.filter((s) => s.kind === 'surge')).toHaveLength(6);
    expect(totalDurationSec(expanded)).toBe(300 + 6 * 120);
  });

  it('warmupMin cambia solo la duración del calentamiento', () => {
    const adjusted = applyAdjustments(hiitEntry.program, hiitEntry.adjustments, { warmupMin: 8 });
    const expanded = expandProgram(adjusted);
    expect(expanded[0]).toMatchObject({ kind: 'warmup', endSec: 480 });
    expect(totalDurationSec(expanded)).toBe(480 + 8 * 120);
  });

  it('clampa y snapea valores fuera de rango o entre steps', () => {
    const big = applyAdjustments(hiitEntry.program, hiitEntry.adjustments, { repeats: 99 });
    expect(expandProgram(big).filter((s) => s.kind === 'surge')).toHaveLength(12);
    const frac = applyAdjustments(hiitEntry.program, hiitEntry.adjustments, { repeats: 4.4 });
    expect(expandProgram(frac).filter((s) => s.kind === 'surge')).toHaveLength(4);
  });

  it('no muta el programa base', () => {
    applyAdjustments(hiitEntry.program, hiitEntry.adjustments, { repeats: 3, warmupMin: 2 });
    const repeat = HIIT_30_30.segments[3];
    expect(repeat).toMatchObject({ kind: 'repeat', times: 8 });
    expect(HIIT_30_30.segments[0]).toMatchObject({ durationSec: 300 });
  });

  it('ignora valores de ajustes que el programa no declara', () => {
    const entry = PROGRAM_CATALOG.find((e) => e.program.id === 'umbral');
    if (!entry) throw new Error('falta umbral');
    const adjusted = applyAdjustments(entry.program, entry.adjustments, { repeats: 5 });
    expect(expandProgram(adjusted)).toEqual(expandProgram(entry.program));
  });
});
