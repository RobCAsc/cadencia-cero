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
  | 'meteors'
  | 'dog'
  | 'horses';

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
  'dog',
  'horses',
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
  dog: { durationSec: 50, when: 'any' },
  horses: { durationSec: 60, when: 'any' },
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
  /** Un encuentro por cada tantos minutos de salida, entre minPerRide y maxPerRide. */
  perMinutes: number;
  minPerRide: number;
  maxPerRide: number;
  /** Segundos mínimos entre el final de uno y el principio del siguiente: que sigan siendo sorpresa. */
  minGapSec: number;
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
  perMinutes: 7,
  minPerRide: 1,
  maxPerRide: 5,
  minGapSec: 150,
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

export interface RidePlan {
  /** Los encuentros de la salida, en orden de aparición. */
  encounters: EncounterPlan[];
  /** Lo que queda en la bolsa para las próximas salidas. */
  bag: EncounterKind[];
}

function shuffled(kinds: readonly EncounterKind[], rnd: () => number): EncounterKind[] {
  const out = [...kinds];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rnd() * (i + 1)));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

function separated(atSec: number, kind: EncounterKind, placed: readonly EncounterPlan[], minGapSec: number): boolean {
  const end = atSec + ENCOUNTER_SPECS[kind].durationSec;
  return placed.every((p) => {
    const pEnd = p.atSec + ENCOUNTER_SPECS[p.kind].durationSec;
    return atSec >= pEnd + minGapSec || end + minGapSec <= p.atSec;
  });
}

/** Un segundo al azar dentro de las ventanas: las más largas pesan más. */
function sampleWindow(windows: readonly EncounterWindow[], rnd: () => number): number | undefined {
  const total = windows.reduce((acc, w) => acc + (w.toSec - w.fromSec), 0);
  if (total <= 0) return undefined;
  let r = rnd() * total;
  for (const w of windows) {
    const span = w.toSec - w.fromSec;
    if (r <= span) return w.fromSec + r;
    r -= span;
  }
  return windows[windows.length - 1]?.toSec;
}

const PLACE_ATTEMPTS = 30;

/**
 * Los encuentros de la salida, sacados de la bolsa: los dieciséis barajados,
 * cada salida saca varios (uno por cada `perMinutes` minutos) sin repetir, y
 * cuando la bolsa se vacía se vuelve a barajar. Así cada uno toca al menos
 * una vez cada cuatro o cinco salidas normales, y ninguno se repite antes de
 * que hayan salido todos. Los que no caben en esta salida (el tren en una
 * corta, los murciélagos sin noche cerrada) se quedan en la bolsa. Cada uno
 * cae en un segundo al azar de sus ventanas, con `minGapSec` entre ellos.
 * `rnd` devuelve [0, 1); con un LCG sembrado la decisión es reproducible.
 * La primera versión daba un encuentro como mucho a la mitad de las salidas,
 * y cada uno salía de media una vez cada treinta (2026-09-23).
 */
export function planRide(
  segments: readonly ExpandedSegment[],
  rnd: () => number,
  bag: readonly EncounterKind[] | undefined,
  opts: PlanOptions = PLAN_DEFAULTS,
): RidePlan {
  const last = segments[segments.length - 1];
  if (!last) return { encounters: [], bag: bag ? [...bag] : [] };
  const count = Math.max(opts.minPerRide, Math.min(opts.maxPerRide, Math.round(last.endSec / 60 / opts.perMinutes)));
  const known = new Set<EncounterKind>(ENCOUNTER_KINDS);
  let pool = bag && bag.length > 0 ? bag.filter((k) => known.has(k)) : shuffled(ENCOUNTER_KINDS, rnd);
  const placed: EncounterPlan[] = [];
  const kept: EncounterKind[] = [];
  const drawn = new Set<EncounterKind>();
  let refilled = false;
  const draw = (): EncounterKind | undefined => {
    if (pool.length === 0) {
      if (refilled) return undefined;
      refilled = true;
      pool = shuffled(ENCOUNTER_KINDS, rnd).filter((k) => !drawn.has(k));
    }
    const kind = pool.shift();
    if (kind) drawn.add(kind);
    return kind;
  };
  const tryPlace = (kind: EncounterKind): boolean => {
    const windows = encounterWindows(kind, segments, opts);
    for (let i = 0; i < PLACE_ATTEMPTS; i++) {
      const candidate = sampleWindow(windows, rnd);
      if (candidate !== undefined && separated(candidate, kind, placed, opts.minGapSec)) {
        placed.push({ kind, atSec: candidate });
        return true;
      }
    }
    kept.push(kind);
    return false;
  };
  // Se sacan los de esta salida y se colocan primero los de ventanas más
  // estrechas (las luciérnagas, la noche cerrada): así casi siempre caben.
  const batch: EncounterKind[] = [];
  while (batch.length < count) {
    const kind = draw();
    if (!kind) break;
    batch.push(kind);
  }
  const span = (kind: EncounterKind): number => encounterWindows(kind, segments, opts).reduce((acc, w) => acc + (w.toSec - w.fromSec), 0);
  batch.sort((a, b) => span(a) - span(b));
  for (const kind of batch) tryPlace(kind);
  // Si alguno no cupo, se saca otro en su lugar mientras quede bolsa.
  while (placed.length < count) {
    const kind = draw();
    if (!kind) break;
    tryPlace(kind);
  }
  placed.sort((a, b) => a.atSec - b.atSec);
  return { encounters: placed, bag: [...kept, ...pool] };
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
    case 'dog':
      return `Un perro te salió al paso en el ${at}`;
    case 'horses':
      return `Una manada de caballos al galope en el ${at}`;
  }
}

/** Cada encuentro como sintagma corto, para la lista del resumen. */
export function encounterNoun(kind: EncounterKind): string {
  switch (kind) {
    case 'deer':
      return 'un ciervo cruzando';
    case 'boars':
      return 'una familia de jabalíes';
    case 'owl':
      return 'una lechuza';
    case 'cat':
      return 'un gato en una tapia';
    case 'cyclist':
      return 'otro superviviente en bici';
    case 'car':
      return 'un coche con los intermitentes';
    case 'sign':
      return 'una señal pintada';
    case 'trafficLight':
      return 'un semáforo en ámbar';
    case 'fireflies':
      return 'luciérnagas';
    case 'campfire':
      return 'una hoguera';
    case 'crows':
      return 'cuervos';
    case 'train':
      return 'un tren en el horizonte';
    case 'bats':
      return 'murciélagos';
    case 'meteors':
      return 'una lluvia de estrellas';
    case 'dog':
      return 'un perro';
    case 'horses':
      return 'caballos al galope';
  }
}

/** La línea del resumen con todos los de la salida; uno solo se cuenta entero. */
export function describeEncounters(list: ReadonlyArray<{ kind: EncounterKind; km: number }>): string {
  const first = list[0];
  if (!first) return '';
  if (list.length === 1) return describeEncounter(first.kind, first.km);
  return `Viste ${list.map((e) => `${encounterNoun(e.kind)} (km ${fmtKm(e.km)})`).join(', ')}`;
}
