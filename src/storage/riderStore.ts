import { defaultRiderProfile, type StoredRiderProfile } from '../sim/riderProfile';

const KEY = 'cadencia-cero.rider';

/** Un solo usuario, una tablet: el perfil vive en localStorage. */
export function loadRiderProfile(): StoredRiderProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultRiderProfile();
    const parsed = JSON.parse(raw) as Partial<StoredRiderProfile>;
    return { ...defaultRiderProfile(parsed.ageYears ?? 33), ...parsed };
  } catch {
    return defaultRiderProfile();
  }
}

export function saveRiderProfile(profile: StoredRiderProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Modo privado o cuota: el perfil vive en memoria durante la sesión.
  }
}
