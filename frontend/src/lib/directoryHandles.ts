export type PickedDirectoryFile = {
  file: File;
  relativePath: string;
};

type StoredHandleRecord = {
  key: string;
  handle: unknown;
};

const DB_NAME = 'privatedrive-directory-handles';
const STORE_NAME = 'handles';

export function supportsDirectoryPicker(): boolean {
  return 'showDirectoryPicker' in window;
}

export async function pickDirectory(): Promise<{ name: string; handle: unknown; files: PickedDirectoryFile[] }> {
  const handle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandleLike> }).showDirectoryPicker();
  return { name: handle.name, handle, files: await readDirectoryFiles(handle) };
}

export async function readStoredDirectory(key: string): Promise<PickedDirectoryFile[] | null> {
  const handle = await getDirectoryHandle(key);
  if (!handle) return null;
  if (!(await ensureDirectoryPermission(handle))) return null;
  return readDirectoryFiles(handle);
}

export async function saveDirectoryHandle(key: string, handle: unknown): Promise<void> {
  const db = await openDB();
  await txDone(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ key, handle } satisfies StoredHandleRecord));
  db.close();
}

async function getDirectoryHandle(key: string): Promise<FileSystemDirectoryHandleLike | null> {
  const db = await openDB();
  const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
  const record = await requestDone<StoredHandleRecord | undefined>(request);
  db.close();
  return (record?.handle as FileSystemDirectoryHandleLike | undefined) ?? null;
}

async function ensureDirectoryPermission(handle: FileSystemDirectoryHandleLike): Promise<boolean> {
  const readable = await handle.queryPermission?.({ mode: 'read' });
  if (readable === 'granted') return true;
  const requested = await handle.requestPermission?.({ mode: 'read' });
  return requested === 'granted';
}

async function readDirectoryFiles(handle: FileSystemDirectoryHandleLike, prefix = ''): Promise<PickedDirectoryFile[]> {
  const out: PickedDirectoryFile[] = [];
  for await (const entry of handle.values()) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      out.push({ file: await entry.getFile(), relativePath });
    } else {
      out.push(...await readDirectoryFiles(entry, relativePath));
    }
  }
  return out;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(request: IDBRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

type FileSystemHandlePermissionDescriptor = {
  mode: 'read' | 'readwrite';
};

type FileSystemFileHandleLike = {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
};

type FileSystemDirectoryHandleLike = {
  kind: 'directory';
  name: string;
  values: () => AsyncIterable<FileSystemFileHandleLike | FileSystemDirectoryHandleLike>;
  queryPermission?: (descriptor: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
};
