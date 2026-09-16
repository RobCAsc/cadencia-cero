import type { SessionRecord } from '../sim/history';

// Historial de sesiones en IndexedDB (contrato: sin backend, un solo usuario,
// una tablet). API mínima con promesas; si IndexedDB no existe o falla, el
// juego sigue igual y el historial simplemente no persiste.

const DB_NAME = 'cadencia-cero';
const DB_VERSION = 1;
const STORE = 'sessions';

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('startedAtMs', 'startedAtMs', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open falló'));
    request.onblocked = () => reject(new Error('indexedDB.open bloqueado'));
  });
}

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('petición IndexedDB falló'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const result = await run(tx.objectStore(STORE));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('transacción IndexedDB falló'));
      tx.onabort = () => reject(tx.error ?? new Error('transacción IndexedDB abortada'));
    });
    return result;
  } finally {
    db.close();
  }
}

/** Guarda (o reemplaza por id) una sesión. Nunca lanza: un fallo solo se avisa. */
export async function saveSession(record: SessionRecord): Promise<boolean> {
  if (!hasIndexedDb()) return false;
  try {
    await withStore('readwrite', (store) => asPromise(store.put(record)));
    return true;
  } catch (err) {
    console.warn('[historial] no se pudo guardar la sesión', err);
    return false;
  }
}

/** Guarda varias de una vez (importar una copia). Nunca lanza. */
export async function saveSessions(records: readonly SessionRecord[]): Promise<boolean> {
  if (!hasIndexedDb()) return false;
  try {
    await withStore('readwrite', async (store) => {
      for (const record of records) await asPromise(store.put(record));
    });
    return true;
  } catch (err) {
    console.warn('[historial] no se pudieron guardar las sesiones', err);
    return false;
  }
}

/** Todas las sesiones, de la más antigua a la más reciente. */
export async function loadSessions(): Promise<SessionRecord[]> {
  if (!hasIndexedDb()) return [];
  try {
    const all = await withStore('readonly', (store) => asPromise(store.getAll()));
    return (all as SessionRecord[]).sort((a, b) => a.startedAtMs - b.startedAtMs);
  } catch (err) {
    console.warn('[historial] no se pudo leer el historial', err);
    return [];
  }
}

export async function deleteAllSessions(): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    await withStore('readwrite', (store) => asPromise(store.clear()));
  } catch (err) {
    console.warn('[historial] no se pudo vaciar el historial', err);
  }
}
