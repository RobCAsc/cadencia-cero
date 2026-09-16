import type { SessionRecord } from '../sim/history';
import type { StoredRiderProfile } from '../sim/riderProfile';
import { loadPlanState, savePlanState, type PlanState } from './planStore';
import { loadRiderProfile, saveRiderProfile } from './riderStore';
import { saveSessions } from './sessionStore';

// El historial es del rider: se lo lleva a otra tablet o lo guarda donde
// quiera, sin servidor. Un archivo JSON con sesiones, perfil y plan; al
// importar, las sesiones se unen por id (nada se borra), y perfil y plan se
// sustituyen.

const FORMAT = 'cadencia-cero/backup';
const VERSION = 1;

export interface Backup {
  format: typeof FORMAT;
  version: number;
  exportedAtMs: number;
  sessions: SessionRecord[];
  profile: StoredRiderProfile;
  plan: PlanState;
}

export function makeBackup(sessions: readonly SessionRecord[]): Backup {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAtMs: Date.now(),
    sessions: [...sessions],
    profile: loadRiderProfile(),
    plan: loadPlanState(),
  };
}

export type ExportOutcome = 'shared' | 'downloaded' | 'unavailable';

/** Entrega el archivo: por el menú de compartir si existe, si no como descarga. */
export async function exportBackup(sessions: readonly SessionRecord[]): Promise<ExportOutcome> {
  const json = JSON.stringify(makeBackup(sessions), null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `cadencia-cero-${stamp}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && (nav.canShare?.({ files: [file] }) ?? false)) {
    try {
      await nav.share({ files: [file], title: 'Copia de Cadencia Cero' });
      return 'shared';
    } catch {
      // cancelado: se intenta la descarga
    }
  }
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'downloaded';
  } catch {
    return 'unavailable';
  }
}

export function parseBackup(text: string): Backup {
  const parsed = JSON.parse(text) as Partial<Backup>;
  if (parsed.format !== FORMAT || !Array.isArray(parsed.sessions) || !parsed.profile) {
    throw new Error('El archivo no es una copia de Cadencia Cero.');
  }
  return parsed as Backup;
}

/** Pide un archivo al rider (selector nativo) y devuelve su texto, o undefined si cancela. */
export function pickFile(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(undefined);
      file.text().then(resolve, () => resolve(undefined));
    });
    document.body.append(input);
    input.click();
  });
}

export interface ImportResult {
  sessions: SessionRecord[];
  added: number;
  profile: StoredRiderProfile;
}

/** Une las sesiones importadas con las existentes (por id) y sustituye perfil y plan. */
export async function importBackup(text: string, existing: readonly SessionRecord[]): Promise<ImportResult> {
  const backup = parseBackup(text);
  const byId = new Map(existing.map((s) => [s.id, s]));
  let added = 0;
  for (const s of backup.sessions) {
    if (!byId.has(s.id)) added += 1;
    byId.set(s.id, s);
  }
  const sessions = [...byId.values()].sort((a, b) => a.startedAtMs - b.startedAtMs);
  await saveSessions(backup.sessions);
  saveRiderProfile(backup.profile);
  savePlanState(backup.plan ?? {});
  return { sessions, added, profile: backup.profile };
}
