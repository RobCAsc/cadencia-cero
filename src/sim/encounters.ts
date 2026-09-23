import type { ExpandedSegment } from './program';

// Los encuentros: lo que pasa de vez en cuando en la carretera y nadie
// prescribió. Un ciervo que cruza, una hoguera entre los árboles, un tren en
// el horizonte. Son hechos del camino, no historia ni coleccionables: no
// tocan la simulación (ni el hueco ni la zona), y el resumen los cuenta en
// una línea. Aquí se decide, por salida, si hay uno, cuál y cuándo; el
// dibujo vive en src/game/encounters.ts.

export type EncounterKind =
  | 'deer'
  | 'boars'
  | 'owl'
  | 'cat'
  | 'cyclist'
  | 'car'
  | 'sign'
  | 'trafficLight'
  | 'fireflies'
  | 'campfire'
  | 'crows'
  | 'train'
  | 'bats'
  | 'meteors';

export const ENCOUNTER_KINDS: readonly EncounterKind[] = [
  'deer',
  'boars',
  'owl',
  'cat',
  'cyclist',
  'car',
  'sign',
  'trafficLight',
  'fireflies',
  'campfire',
  'crows',
  'train',
  'bats',
  'meteors',
];

/** Cuándo cabe cada uno: en cualquier tramo permitido, solo de noche cerrada, o solo en tramos suaves. */
export type EncounterWhen = 'any' | 'night' | 'soft';

export interface EncounterSpec {
  /** Segundos que necesita en pantalla, para que quepa entero en la ventana. */
  durationSec: number;
  when: EncounterWhen;
}

export const ENCOUNTER_SPECS: Readonly<Record<EncounterKind, EncounterSpec>> = {
  deer: { durationSec: 8, when: 'any' },
  boars: { durationSec: 10, when: 'any' },
  owl: { durationSec: 8, when: 'any' },
  cat: { durationSec: 8, when: 'any' },
  cyclist: { durationSec: 8, when: 'any' },
  car: { durationSec: 10, when: 'any' },
  sign: { durationSec: 8, when: 'any' },
  trafficLight: { durationSec: 10, when: 'any' },
  fireflies: { durationSec: 20, when: 'soft' },
  campfire: { durationSec: 30, when: 'any' },
  crows: { durationSec: 12, when: 'any' },
  train: { durationSec: 70, when: 'any' },
  bats: { durationSec: 22, when: 'night' },
  meteors: { durationSec: 25, when: 'night' },
};

export interface EncounterPlan {
  kind: EncounterKind;
  /** Segundo de la salida en que aparece. */
  atSec: number;
}

export interface EncounterWindow {
  fromSec: number;
  toSec: number;
}

export interface PlanOptions {
  /** Probabilidad de que la salida tenga encuentro. La mitad, para que siga siendo sorpresa. */
  chance: number;
  /** Segundos antes de una oleada que se reservan: la pantalla es de la horda. */
  warningSec: number;
  /** Segundos al arrancar sin nada: el cartel de salida y el ciclista arrancando. */
  startQuietSec: number;
  /** Segundos al final sin nada: el amanecer no se comparte. */
  endQuietSec: number;
  /** Fracción de la salida con noche cerrada (las fases del cielo en atmosphere.ts). */
  night: readonly [number, number];
}

export const PLAN_DEFAULTS: PlanOptions = {
  chance: 0.5,
  warningSec: 15,
  startQuietSec: 30,
  endQuietSec: 20,
  night: [0.2, 0.78],
};

const SOFT_ZONE_MAX = 2;

function isAllowed(seg: ExpandedSegment): boolean {
  return seg.kind !== 'surge' && seg.kind !== 'push';
}

/**
 * Las ventanas en que cabe un encuentro de ese tipo: tramos que no son oleada
 * ni empujón, sin los segundos de aviso antes de una oleada, sin el arranque
 * ni el final, y con la condición del tipo (noche, suave). Solo las ventanas
 * en que entra entero.
 */
export function encounterWindows(
  kind: EncounterKind,
  segments: readonly ExpandedSegment[],
  opts: PlanOptions = PLAN_DEFAULTS,
): EncounterWindow[] {
  const last = segments[segments.length - 1];
  if (!last) return [];
  const totalSec = last.endSec;
  const spec = ENCOUNTER_SPECS[kind];
  const out: EncounterWindow[] = [];
  segments.forEach((seg, i) => {
    if (!isAllowed(seg)) return;
    if (spec.when === 'soft' && seg.zoneMax > SOFT_ZONE_MAX) return;
    let from = Math.max(seg.startSec, opts.startQuietSec);
    let to = Math.min(seg.endSec, totalSec - opts.endQuietSec);
    const next = segments[i + 1];
    if (next && next.kind === 'surge') to = Math.min(to, next.startSec - opts.warningSec);
    if (spec.when === 'night') {
      from = Math.max(from, opts.night[0] * totalSec);
      to = Math.min(to, opts.night[1] * totalSec);
    }
    // Cabe entero: el final de la ventana es donde aún puede empezar.
    to -= spec.durationSec;
    if (to > from) out.push({ fromSec: from, toSec: to });
  });
  return out;
}

/**
 * Decide el encuentro de la salida: la mitad de las veces ninguno; si hay,
 * un tipo al azar entre los que caben, en un segundo al azar de sus ventanas
 * (las más largas pesan más). `rnd` devuelve [0, 1); con un LCG sembrado la
 * decisión es reproducible.
 */
export function planEncounter(
  segments: readonly ExpandedSegment[],
  rnd: () => number,
  opts: PlanOptions = PLAN_DEFAULTS,
): EncounterPlan | undefined {
  if (segments.length === 0) return undefined;
  if (rnd() >= opts.chance) return undefined;
  const candidates = ENCOUNTER_KINDS.map((kind) => ({ kind, windows: encounterWindows(kind, segments, opts) })).filter(
    (c) => c.windows.length > 0,
  );
  const pick = candidates[Math.min(candidates.length - 1, Math.floor(rnd() * candidates.length))];
  if (!pick) return undefined;
  const total = pick.windows.reduce((acc, w) => acc + (w.toSec - w.fromSec), 0);
  let r = rnd() * total;
  for (const w of pick.windows) {
    const span = w.toSec - w.fromSec;
    if (r <= span) return { kind: pick.kind, atSec: w.fromSec + r };
    r -= span;
  }
  const lastWindow = pick.windows[pick.windows.length - 1]!;
  return { kind: pick.kind, atSec: lastWindow.toSec };
}

function fmtKm(km: number): string {
  return km.toFixed(1).replace('.', ',');
}

/** La línea del resumen: qué pasó y en qué km de la Ruta. */
export function describeEncounter(kind: EncounterKind, km: number): string {
  const at = `km ${fmtKm(km)}`;
  switch (kind) {
    case 'deer':
      return `Un ciervo cruzó la carretera en el ${at}`;
    case 'boars':
      return `Una familia de jabalíes cruzó en el ${at}`;
    case 'owl':
      return `Una lechuza te vio pasar en el ${at}`;
    case 'cat':
      return `Un gato te miró desde una tapia en el ${at}`;
    case 'cyclist':
      return `Otro superviviente en bici te saludó en el ${at}`;
    case 'car':
      return `Un coche con los intermitentes puestos en el ${at}`;
    case 'sign':
      return `Una señal pintada por alguien en el ${at}`;
    case 'trafficLight':
      return `Un semáforo en ámbar en un cruce vacío, ${at}`;
    case 'fireflies':
      return `Un enjambre de luciérnagas en el ${at}`;
    case 'campfire':
      return `Una hoguera con supervivientes en el ${at}`;
    case 'crows':
      return `Una bandada de cuervos se levantó a tu paso en el ${at}`;
    case 'train':
      return `Un tren con las ventanas encendidas cruzó el horizonte, ${at}`;
    case 'bats':
      return `Murciélagos sobre la luna en el ${at}`;
    case 'meteors':
      return `Una lluvia de estrellas en el ${at}`;
  }
}
