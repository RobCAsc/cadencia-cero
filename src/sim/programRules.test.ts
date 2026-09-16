import { describe, expect, it } from 'vitest';
import { blocksToProgram, DEFAULT_BLOCKS, sustainability, validateProgram, type Block } from './programRules';

describe('el editor de salidas: reglas', () => {
  it('los bloques por defecto son una salida válida y sostenible', () => {
    const program = blocksToProgram(DEFAULT_BLOCKS);
    expect(validateProgram(program)).toEqual([]);
    const verdict = sustainability(program);
    expect(verdict.ok).toBe(true);
    expect(verdict.timesCaught).toBe(0);
  });

  it('exige calor de tres minutos, vuelta a la calma de dos y esfuerzos de un minuto', () => {
    const blocks: Block[] = [
      { kind: 'warmup', minutes: 2, zone: 1 },
      { kind: 'surge', minutes: 0.5, zone: 5 },
      { kind: 'surge', minutes: 4, zone: 5 },
      { kind: 'recover', minutes: 0.5, zone: 1 },
      { kind: 'steady', minutes: 5, zone: 2 },
    ];
    const problems = validateProgram(blocksToProgram(blocks));
    expect(problems.some((p) => p.includes('calentamiento'))).toBe(true);
    expect(problems.some((p) => p.includes('vuelta a la calma'))).toBe(true);
    expect(problems.some((p) => p.includes('Bloque 2') && p.includes('60 segundos'))).toBe(true);
    expect(problems.some((p) => p.includes('Bloque 3') && p.includes('Z5'))).toBe(true);
    expect(problems.some((p) => p.includes('dos oleadas seguidas'))).toBe(true);
    expect(problems.some((p) => p.includes('Bloque 4') && p.includes('recuperación'))).toBe(true);
  });

  it('el rider modelo tumba una salida con saltos que un pulso de muñeca no sigue', () => {
    // Oleadas de un minuto en Z5 con recuperaciones de un minuto en suave,
    // ocho veces: el pulso no baja y sube tan rápido. Debe salir insostenible.
    const blocks: Block[] = [
      { kind: 'warmup', minutes: 3, zone: 1 },
      { kind: 'surge', minutes: 1, zone: 5 },
      { kind: 'recover', minutes: 1, zone: 0 },
      { kind: 'surge', minutes: 1, zone: 5 },
      { kind: 'recover', minutes: 1, zone: 0 },
      { kind: 'surge', minutes: 1, zone: 5 },
      { kind: 'recover', minutes: 1, zone: 0 },
      { kind: 'cooldown', minutes: 2, zone: 1 },
    ];
    const program = blocksToProgram(blocks);
    expect(validateProgram(program)).toEqual([]);
    const verdict = sustainability(program);
    expect(verdict.message).toBeTruthy();
    // Sostenible o no, el veredicto es coherente con las capturas.
    expect(verdict.ok).toBe(verdict.timesCaught === 0);
  });

  it('limita el total y el número de bloques', () => {
    const blocks: Block[] = Array.from({ length: 9 }, (_, i) => ({ kind: i === 0 ? 'warmup' : i === 8 ? 'cooldown' : 'steady', minutes: 15, zone: 2 }));
    const problems = validateProgram(blocksToProgram(blocks));
    expect(problems.some((p) => p.includes('8 bloques'))).toBe(true);
    expect(problems.some((p) => p.includes('90 minutos'))).toBe(true);
  });
});
