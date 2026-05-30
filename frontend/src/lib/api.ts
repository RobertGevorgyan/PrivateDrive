import type { User } from 'firebase/auth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;

export type FileRecord = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type BackupPlan = {
  id: string;
  displayName: string;
  selectedPathLabel: string;
  includePatterns: string[];
  lastBackupAt?: string;
  nextManualRenewHint: string;
  enabled: boolean;
};

export type BackupRun = {
  id: string;
  planId: string;
  startedAt: string;
  finishedAt: string;
  status: string;
  fileCount: number;
  bytesUploaded: number;
  errors: string[];
};

async function token(user: User): Promise<string> {
  return user.getIdToken();
}

export async function apiFetch<T>(user: User, path: string, init: RequestInit = {}): Promise<T> {
  const bearer = await token(user);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${bearer}`);
  if (!(init.body instanceof FormData) && init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || res.statusText);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function uploadFile(user: User, file: File, onProgress: (value: number) => void): Promise<FileRecord> {
  return chunkedUpload(user, file, onProgress);
}

export async function downloadFile(user: User, file: FileRecord, onProgress: (value: number) => void): Promise<void> {
  const blob = await fetchFileBlob(user, file, onProgress);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
  onProgress(100);
}

export async function shareFile(user: User, file: FileRecord, onProgress: (value: number) => void): Promise<void> {
  if (!navigator.share) {
    throw new Error('Udostępnianie systemowe nie jest dostępne w tej przeglądarce.');
  }
  const blob = await fetchFileBlob(user, file, onProgress);
  const shareableFile = new File([blob], file.filename, { type: file.mimeType || 'application/octet-stream' });
  if (navigator.canShare && !navigator.canShare({ files: [shareableFile] })) {
    throw new Error('Ten plik nie może zostać udostępniony przez systemowy panel.');
  }
  await navigator.share({
    title: file.filename,
    text: `Plik z PrivateDrive: ${file.filename}`,
    files: [shareableFile]
  });
  onProgress(100);
}

async function fetchFileBlob(user: User, file: FileRecord, onProgress: (value: number) => void): Promise<Blob> {
  const bearer = await token(user);
  const res = await fetch(`${API_BASE}/api/files/${file.id}/download`, {
    headers: { Authorization: `Bearer ${bearer}` }
  });
  if (!res.ok || !res.body) {
    throw new Error('Nie udało się pobrać pliku.');
  }
  const total = Number(res.headers.get('Content-Length') || file.sizeBytes || 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress(total ? Math.round((loaded / total) * 100) : 50);
    }
  }
  return new Blob(chunks.map((chunk) => chunk.slice().buffer), { type: file.mimeType });
}

async function chunkedUpload(user: User, file: File, onProgress: (value: number) => void): Promise<FileRecord> {
  const chunkSize = DEFAULT_CHUNK_SIZE;
  const totalChunks = Math.ceil(file.size / chunkSize);
  const session = await apiFetch<{ uploadId: string; chunkSize: number }>(user, '/api/uploads/init', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      totalChunks,
      chunkSize
    })
  });
  let uploadedBytes = 0;
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunk = file.slice(start, end);
    await xhrUploadChunk(user, session.uploadId, index, chunk, (chunkLoaded) => {
      const loaded = Math.min(file.size, uploadedBytes + chunkLoaded);
      onProgress(Math.round((loaded / file.size) * 100));
    });
    uploadedBytes += chunk.size;
    onProgress(Math.round((uploadedBytes / file.size) * 100));
  }
  return apiFetch<FileRecord>(user, `/api/uploads/${session.uploadId}/complete`, { method: 'POST' });
}

async function xhrUploadChunk(user: User, uploadId: string, index: number, chunk: Blob, onProgress: (value: number) => void): Promise<void> {
  const bearer = await token(user);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${API_BASE}/api/uploads/${uploadId}/chunks/${index}`);
    xhr.setRequestHeader('Authorization', `Bearer ${bearer}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(parseError(xhr.responseText) || 'Upload failed'));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(chunk);
  });
}

function parseError(raw: string): string {
  try {
    return JSON.parse(raw).error || raw;
  } catch {
    return raw;
  }
}

export const filesApi = {
  list: (user: User) => apiFetch<FileRecord[]>(user, '/api/files'),
  remove: (user: User, id: string) => apiFetch<void>(user, `/api/files/${id}`, { method: 'DELETE' })
};

export const backupsApi = {
  plans: (user: User) => apiFetch<BackupPlan[]>(user, '/api/backups/plans'),
  runs: (user: User) => apiFetch<BackupRun[]>(user, '/api/backups/runs'),
  createPlan: (user: User, payload: { displayName: string; selectedPathLabel: string; includePatterns: string[] }) =>
    apiFetch<BackupPlan>(user, '/api/backups/plans', { method: 'POST', body: JSON.stringify(payload) }),
  renew: (user: User, id: string, payload: { fileCount: number; bytesUploaded: number; errors: string[] }) =>
    apiFetch<BackupRun>(user, `/api/backups/plans/${id}/renew`, { method: 'POST', body: JSON.stringify(payload) })
};

export const devicesApi = {
  saveFcmToken: (user: User, fcmToken: string) =>
    apiFetch<void>(user, '/api/devices/fcm-token', { method: 'POST', body: JSON.stringify({ token: fcmToken, platform: 'web-pwa' }) })
};
