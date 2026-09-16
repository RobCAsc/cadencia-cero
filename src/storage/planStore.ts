// Lo que el plan recuerda entre sesiones y no es una salida: el cribado de
// salud, el día comprometido para la próxima salida, cuándo se hizo la
// última revisión semanal y cuándo se mostró el aviso de seguridad. Un solo
// usuario, una tablet: localStorage, como el perfil.

const KEY = 'cadencia-cero.plan';

export type ScreeningFlag = 'chestPain' | 'dizziness' | 'heartCondition' | 'medication';

export interface Screening {
  answeredAtMs: number;
  /** Las preguntas contestadas con "sí". Vacío = sin avisos. */
  flags: ScreeningFlag[];
}

export interface PlanState {
  screening?: Screening;
  /** Medianoche local del día elegido para la próxima salida. */
  nextRideDayMs?: number;
  /** Lunes de la última semana en la que se mostró la revisión. */
  lastReviewWeekMs?: number;
  /** Lunes de la última semana en la que se mostró el aviso de seguridad en el ritual. */
  safetyNoteWeekMs?: number;
  /** El modo elegido tras el cribado, si el rider no puede fiarse del pulso. */
  inputMode?: 'heartRate' | 'feel';
  /** Por qué pedalea, en sus palabras. Aparece en el ritual y en la revisión. */
  why?: string;
  /** Última fase del plan celebrada: la ceremonia se muestra una vez por ascenso. */
  lastPhaseSeen?: 'arranque' | 'base' | 'rotacion' | 'descarga';
  /** Última temporada con informe mostrado. */
  lastSeasonReported?: number;
  /** Contra quién corre el fantasma: la última vez o la mejor. */
  ghostMode?: 'last' | 'best';
  /** Nombres que el rider puso a los refugios, por índice. */
  refugeNames?: Record<number, string>;
}

export function loadPlanState(): PlanState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlanState) : {};
  } catch {
    return {};
  }
}

export function savePlanState(patch: Partial<PlanState>): PlanState {
  const next = { ...loadPlanState(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Modo privado o cuota: vive en memoria durante la sesión.
  }
  return next;
}
