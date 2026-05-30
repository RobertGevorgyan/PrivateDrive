import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import { Clock3, Download, Files, FolderPlus, FolderSync, LogOut, RefreshCcw, Share2, Trash2, UploadCloud } from 'lucide-react';
import { auth } from '../lib/firebase';
import { BackupPlan, BackupRun, backupsApi, devicesApi, downloadFile, FileRecord, filesApi, shareFile, uploadFile } from '../lib/api';
import { formatBytes, formatDate, notify, vibrateDone } from '../lib/format';
import { requestFcmToken } from '../lib/firebase';
import { Logo } from '../components/Logo';

type Props = { user: User };
type Progress = { label: string; value: number };
type View = 'files' | 'backups' | 'history';

export function DashboardPage({ user }: Props) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [plans, setPlans] = useState<BackupPlan[]>([]);
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState<View>('files');
  const uploadInput = useRef<HTMLInputElement>(null);
  const backupFolderInput = useRef<HTMLInputElement>(null);
  const notificationSetupDone = useRef(false);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.sizeBytes, 0), [files]);

  async function refresh() {
    setError('');
    try {
      const [nextFiles, nextPlans, nextRuns] = await Promise.all([
        filesApi.list(user),
        backupsApi.plans(user),
        backupsApi.runs(user)
      ]);
      setFiles(nextFiles ?? []);
      setPlans(nextPlans ?? []);
      setRuns(nextRuns ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się odświeżyć danych.');
    }
  }

  useEffect(() => {
    void refresh();
  }, [user.uid]);

  useEffect(() => {
    if (notificationSetupDone.current) return;
    notificationSetupDone.current = true;
    void enableNotificationsOnStart();
  }, [user.uid]);

  async function enableNotificationsOnStart() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') return;
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') return;
    const token = await requestFcmToken();
    if (token) {
      await devicesApi.saveFcmToken(user, token);
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (!picked.length) return;
    setError('');
    let done = 0;
    try {
      for (const file of picked) {
        setProgress({ label: `Upload: ${file.name}`, value: 0 });
        await uploadFile(user, file, (value) => setProgress({ label: `Upload: ${file.name}`, value }));
        notify('Plik wysłany', `${file.name} jest już w PrivateDrive.`);
        done += 1;
      }
      vibrateDone();
      notify('Backup zakończony', `Zakończono upload ${done} plików.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload nie powiódł się.');
      notify('Błąd synchronizacji', err instanceof Error ? err.message : 'Upload nie powiódł się.');
    } finally {
      setProgress(null);
      event.target.value = '';
    }
  }

  async function handleDownload(file: FileRecord) {
    setProgress({ label: `Download: ${file.filename}`, value: 0 });
    try {
      await downloadFile(user, file, (value) => setProgress({ label: `Download: ${file.filename}`, value }));
      notify('PrivateDrive', `Pobrano ${file.filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download nie powiódł się.');
      notify('Błąd synchronizacji', err instanceof Error ? err.message : 'Download nie powiódł się.');
    } finally {
      setProgress(null);
    }
  }

  async function handleShare(file: FileRecord) {
    setProgress({ label: `Udostępnianie: ${file.filename}`, value: 0 });
    try {
      await shareFile(user, file, (value) => setProgress({ label: `Udostępnianie: ${file.filename}`, value }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się udostępnić pliku.');
      notify('Błąd synchronizacji', err instanceof Error ? err.message : 'Nie udało się udostępnić pliku.');
    } finally {
      setProgress(null);
    }
  }

  async function handleDelete(file: FileRecord) {
    await filesApi.remove(user, file.id);
    await refresh();
  }

  async function createPlanFromFolder(event: ChangeEvent<HTMLInputElement>) {
    const pickedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!pickedFiles.length) return;
    setError('');
    const folderName = getFolderName(pickedFiles);
    try {
      const plan = await backupsApi.createPlan(user, {
        displayName: folderName,
        selectedPathLabel: folderName,
        includePatterns: ['*']
      });
      await renewPlan(plan, pickedFiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się dodać folderu backupu.');
      notify('Błąd synchronizacji', err instanceof Error ? err.message : 'Nie udało się dodać folderu backupu.');
    }
  }

  async function renewPlan(plan: BackupPlan, pickedFiles: File[]) {
    if (!pickedFiles.length) return;
    let bytes = 0;
    const errors: string[] = [];
    for (const file of pickedFiles) {
      try {
        setProgress({ label: `Renew ${plan.displayName}: ${file.name}`, value: 0 });
        await uploadFile(user, file, (value) => setProgress({ label: `Renew ${plan.displayName}: ${value}%`, value }));
        notify('Plik wysłany', `${file.name} jest już w PrivateDrive.`);
        bytes += file.size;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Nie udało się wysłać ${file.name}.`);
      }
    }
    await backupsApi.renew(user, plan.id, { fileCount: pickedFiles.length, bytesUploaded: bytes, errors });
    vibrateDone();
    if (errors.length) {
      notify('Błąd synchronizacji', `Backup ${plan.displayName} zakończony z błędami.`);
    } else {
      notify('Backup zakończony', `Backup ${plan.displayName} zakończony.`);
    }
    setProgress(null);
    await refresh();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Logo />
        <button className="icon-button" aria-label="Wyloguj" onClick={() => signOut(auth)}><LogOut size={20} /></button>
      </header>

      <div className="desktop-layout">
        <aside className="sidebar">
          <section className="summary-grid">
            <article className="metric"><span>Pliki</span><strong>{files.length}</strong></article>
            <article className="metric"><span>Dane</span><strong>{formatBytes(totalBytes)}</strong></article>
            <article className="metric"><span>Backupy</span><strong>{plans.length}</strong></article>
          </section>

          <nav className="app-nav" aria-label="Sekcje aplikacji">
            <button className={activeView === 'files' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('files')}>
              <Files size={18} /> Pliki
            </button>
            <button className={activeView === 'backups' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('backups')}>
              <FolderSync size={18} /> Backupy
            </button>
            <button className={activeView === 'history' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('history')}>
              <Clock3 size={18} /> Historia
            </button>
          </nav>
        </aside>

        <div className="content-stack">
          {progress && (
            <section className="progress-strip" aria-live="polite">
              <span>{progress.label}</span>
              <progress value={progress.value} max={100}>{progress.value}%</progress>
            </section>
          )}
          {error && <p className="error">{error}</p>}

          <section className="toolbar">
            {activeView === 'files' && (
              <button className="button button-primary" onClick={() => uploadInput.current?.click()}><UploadCloud size={18} /> Upload</button>
            )}
            <button className="button button-secondary" onClick={refresh}><RefreshCcw size={18} /> Odśwież</button>
            <input hidden ref={uploadInput} type="file" multiple onChange={handleUpload} />
          </section>

          {activeView === 'files' && (
            <section className="panel">
              <div className="section-title"><h1>Pliki</h1><Share2 size={18} /></div>
              <div className="list">
                {files.map((file) => (
                  <article className="row" key={file.id}>
                    <div><strong>{file.filename}</strong><span>{formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}</span></div>
                    <div className="row-actions">
                      <button className="icon-button" aria-label="Udostępnij" onClick={() => handleShare(file)}><Share2 size={18} /></button>
                      <button className="icon-button" aria-label="Pobierz" onClick={() => handleDownload(file)}><Download size={18} /></button>
                      <button className="icon-button danger" aria-label="Usuń" onClick={() => handleDelete(file)}><Trash2 size={18} /></button>
                    </div>
                  </article>
                ))}
                {!files.length && <p className="muted">Brak plików. Dodaj pierwszy backup lub upload.</p>}
              </div>
            </section>
          )}

          {activeView === 'backups' && (
            <section className="panel">
              <div className="section-title"><h1>Backup folderów</h1><FolderSync size={18} /></div>
              <button className="button button-primary full-width" onClick={() => backupFolderInput.current?.click()}><FolderPlus size={18} /> Wybierz folder do backupu</button>
              <input hidden ref={backupFolderInput} type="file" multiple webkitdirectory="" onChange={createPlanFromFolder} />
              <div className="list">
                {plans.map((plan) => (
                  <article className="row" key={plan.id}>
                    <div><strong>{plan.displayName}</strong><span>{plan.selectedPathLabel} · ostatnio: {formatDate(plan.lastBackupAt)}</span></div>
                    <label className="button button-secondary">
                      <RefreshCcw size={18} /> Renew
                      <input hidden type="file" multiple webkitdirectory="" onChange={(event) => renewPlan(plan, Array.from(event.target.files ?? []))} />
                    </label>
                  </article>
                ))}
                {!plans.length && <p className="muted">Wybierz folder, a PrivateDrive automatycznie utworzy plan backupu z jego nazwą.</p>}
              </div>
            </section>
          )}

          {activeView === 'history' && (
            <section className="panel">
              <div className="section-title"><h1>Historia</h1><Clock3 size={18} /></div>
              <div className="list compact">
                {runs.map((run) => (
                  <article className="row" key={run.id}>
                    <div><strong>{run.status}</strong><span>{run.fileCount} plików · {formatBytes(run.bytesUploaded)} · {formatDate(run.finishedAt)}</span></div>
                  </article>
                ))}
                {!runs.length && <p className="muted">Historia backupów pojawi się po pierwszym renew.</p>}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function getFolderName(files: File[]): string {
  const first = files[0] as File & { webkitRelativePath?: string };
  const relativePath = first.webkitRelativePath || first.name;
  const root = relativePath.split('/').filter(Boolean)[0];
  return root || 'Backup folderu';
}
