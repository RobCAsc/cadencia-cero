import { rideWithLaggedPulse } from './modelRider';
import type { SpeedSegment, SpeedSegmentKind, TrainingProgram } from './program';
import { zoneRange } from './zones';

// Las reglas de una salida que el rider diseña. Son las mismas que cumple el
// catálogo y que el pulso de muñeca impone: calor de tres minutos, esfuerzos
// de un minuto o más, vuelta a la calma siempre. Luego el rider modelo corre
// el programa: si a él lo alcanzan, la salida pide algo que un sensor óptico
// no puede reflejar a tiempo, y no se guarda.

export const MIN_WARMUP_SEC = 180;
export const MIN_COOLDOWN_SEC = 120;
export const MIN_EFFORT_SEC = 60;
export const MIN_EASY_SEC = 60;
export const MAX_TOTAL_SEC = 90 * 60;
export const MAX_BLOCKS = 8;

/** Los tipos que el rider puede poner; el empujón lo inserta el juego, no el editor. */
export type BlockKind = Exclude<SpeedSegmentKind, 'push'>;
export const KIND_ORDER: readonly BlockKind[] = ['warmup', 'steady', 'surge', 'recover', 'cooldown'];

/** Un bloque del editor: tipo, minutos y zona alta (el calor y la calma van de suave a esa zona). */
export interface Block {
  kind: BlockKind;
  minutes: number;
  zone: number;
}

export const DEFAULT_BLOCKS: readonly Block[] = [
  { kind: 'warmup', minutes: 5, zone: 2 },
  { kind: 'steady', minutes: 10, zone: 2 },
  { kind: 'surge', minutes: 1, zone: 4 },
  { kind: 'recover', minutes: 2, zone: 2 },
  { kind: 'cooldown', minutes: 3, zone: 1 },
];

/** De bloques a programa: el calor y la calma admiten desde suave; el resto, la zona exacta. */
export function blocksToProgram(blocks: readonly Block[], id = 'mia', name = 'Mía'): TrainingProgram {
  const segments: SpeedSegment[] = blocks.map((b) => ({
    kind: b.kind,
    durationSec: Math.round(b.minutes * 60),
    zone: b.kind === 'warmup' || b.kind === 'cooldown' ? [0, Math.max(0, b.zone)] : b.kind === 'recover' ? [Math.max(0, b.zone - 1), b.zone] : b.zone,
  }));
  return { id, name, target: 'custom', segments };
}

/**
 * De un programa del catálogo a bloques del editor, para retocarlo tramo a
 * tramo. Los repeat se desenrollan; undefined si no cabe en el editor (más
 * de MAX_BLOCKS bloques, o tramos que el editor no conoce). Un rango de
 * zonas queda en su zona alta: el rider ve los bloques y ajusta.
 */
export function programToBlocks(program: TrainingProgram): Block[] | undefined {
  const segs = expandForBlocks(program);
  if (!segs || segs.length > MAX_BLOCKS) return undefined;
  return segs.map((s) => {
    const [, hi] = zoneRange(s.zone);
    return { kind: s.kind, minutes: Math.max(1, Math.round(s.durationSec / 60)), zone: hi };
  });
}

function expandForBlocks(program: TrainingProgram): Array<SpeedSegment & { kind: BlockKind }> | undefined {
  const out: Array<SpeedSegment & { kind: BlockKind }> = [];
  for (let i = 0; i < program.segments.length; i++) {
    const seg = program.segments[i]!;
    if (seg.kind === 'repeat') {
      const block = program.segments.slice(seg.fromIndex, i);
      for (let n = 1; n < seg.times; n++) {
        for (const s of block) {
          if (s.kind === 'repeat' || s.kind === 'push') return undefined;
          out.push(s as SpeedSegment & { kind: BlockKind });
        }
      }
    } else if (seg.kind === 'push') {
      return undefined;
    } else {
      out.push(seg as SpeedSegment & { kind: BlockKind });
    }
  }
  return out;
}

/** Problemas de una salida diseñada, en frases; vacío si cumple las reglas. */
export function validateProgram(program: TrainingProgram): string[] {
  const problems: string[] = [];
  const segs = program.segments.filter((s): s is SpeedSegment => s.kind !== 'repeat');
  if (segs.length === 0) return ['La salida está vacía.'];
  if (segs.length > MAX_BLOCKS) problems.push(`Como mucho ${MAX_BLOCKS} bloques.`);
  const first = segs[0]!;
  if (first.kind !== 'warmup' || first.durationSec < MIN_WARMUP_SEC) {
    problems.push(`Empieza con un calentamiento de al menos ${MIN_WARMUP_SEC / 60} minutos.`);
  }
  const last = segs[segs.length - 1]!;
  if (last.kind !== 'cooldown' || last.durationSec < MIN_COOLDOWN_SEC) {
    problems.push(`Termina con una vuelta a la calma de al menos ${MIN_COOLDOWN_SEC / 60} minutos.`);
  }
  const total = segs.reduce((acc, s) => acc + s.durationSec, 0);
  if (total > MAX_TOTAL_SEC) problems.push(`Como mucho ${MAX_TOTAL_SEC / 60} minutos en total.`);
  if (!segs.some((s) => s.kind === 'steady' || s.kind === 'surge')) problems.push('Falta el trabajo: un ritmo o una oleada.');
  segs.forEach((s, i) => {
    const [lo, hi] = zoneRange(s.zone);
    if (lo < 0 || hi > 5 || lo > hi) problems.push(`Bloque ${i + 1}: zona inválida.`);
    if ((s.kind === 'surge' || s.kind === 'steady') && s.durationSec < MIN_EFFORT_SEC) {
      problems.push(`Bloque ${i + 1}: un esfuerzo dura al menos ${MIN_EFFORT_SEC} segundos; un pulso de muñeca no juzga menos.`);
    }
    if (s.kind === 'recover' && s.durationSec < MIN_EASY_SEC) {
      problems.push(`Bloque ${i + 1}: una recuperación dura al menos ${MIN_EASY_SEC} segundos.`);
    }
    if (s.kind === 'surge' && hi >= 5 && s.durationSec > 180) {
      problems.push(`Bloque ${i + 1}: en Z5 nadie aguanta más de tres minutos; acorta o baja a Z4.`);
    }
    const prev = segs[i - 1];
    if (s.kind === 'surge' && prev?.kind === 'surge') {
      problems.push(`Bloque ${i + 1}: dos oleadas seguidas sin recuperación entre medias.`);
    }
  });
  return problems;
}

export interface Sustainability {
  ok: boolean;
  timesCaught: number;
  inZoneFrac: number;
  minGapM: number;
  message: string;
}

/**
 * El rider modelo corre la salida. Si lo alcanzan, la salida pide lo que un
 * pulso óptico no puede dar a tiempo (esfuerzos demasiado cortos o cambios
 * demasiado bruscos) y no vale; si la aguanta, vale.
 */
export function sustainability(program: TrainingProgram): Sustainability {
  const out = rideWithLaggedPulse(program);
  const caught = out.summary.timesCaught;
  const inZone = out.inZoneFrac;
  if (caught > 0) {
    return {
      ok: false,
      timesCaught: caught,
      inZoneFrac: inZone,
      minGapM: out.minGapM,
      message: `Al rider modelo lo alcanzaron ${caught} ${caught === 1 ? 'vez' : 'veces'} siguiendo la zona: algún cambio es demasiado brusco o corto para un pulso de muñeca. Alarga los esfuerzos o suaviza el salto de zona.`,
    };
  }
  return {
    ok: true,
    timesCaught: 0,
    inZoneFrac: inZone,
    minGapM: out.minGapM,
    message: `Sostenible: el rider modelo la aguanta sin capturas, ${Math.round(inZone * 100)} % del tiempo en zona y nunca por debajo de ${Math.round(out.minGapM)} m de ventaja.`,
  };
}
