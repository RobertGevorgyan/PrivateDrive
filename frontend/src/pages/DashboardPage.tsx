import { ChangeEvent, DragEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import { ArrowLeft, Clock3, Download, FileArchive, FileCode2, FileText, Files, Folder, FolderPlus, FolderSync, Image, LogOut, RefreshCcw, Share2, Trash2, UploadCloud } from 'lucide-react';
import { auth } from '../lib/firebase';
import { BackupFileEntry, BackupPlan, BackupRun, backupsApi, devicesApi, downloadFile, FileRecord, filesApi, FolderRecord, foldersApi, shareFile, shareFiles, uploadFile } from '../lib/api';
import { formatBytes, formatDate, notify, vibrateDone } from '../lib/format';
import { requestFcmToken } from '../lib/firebase';
import { Logo } from '../components/Logo';
import { createThumbnail } from '../lib/thumbnails';
import { PickedDirectoryFile, pickDirectory, readStoredDirectory, saveDirectoryHandle, supportsDirectoryPicker } from '../lib/directoryHandles';

type Props = { user: User };
type Progress = { label: string; value: number };
type View = 'files' | 'backups' | 'history';
type BrowserItem =
  | { type: 'folder'; name: string; path: string; count: number }
  | { type: 'file'; file: FileRecord };

export function DashboardPage({ user }: Props) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [plans, setPlans] = useState<BackupPlan[]>([]);
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState<View>('files');
  const [currentPath, setCurrentPath] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOverPath, setDragOverPath] = useState('');
  const uploadInput = useRef<HTMLInputElement>(null);
  const folderUploadInput = useRef<HTMLInputElement>(null);
  const backupFolderInput = useRef<HTMLInputElement>(null);
  const notificationSetupDone = useRef(false);
  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);
  const draggedFileId = useRef<string | null>(null);
  const selectedRef = useRef(selected);

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.sizeBytes, 0), [files]);
  const browserItems = useMemo(() => buildBrowserItems(files, folders, currentPath), [files, folders, currentPath]);
  const selectedFiles = useMemo(() => filesForSelection(files, selected), [files, selected]);
  const visibleKeys = useMemo(() => browserItems.map((item) => item.type === 'folder' ? `d:${item.path}` : `f:${item.file.id}`), [browserItems]);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));

  async function refresh() {
    setError('');
    try {
      const [nextFiles, nextFolders, nextPlans, nextRuns] = await Promise.all([
        filesApi.list(user),
        foldersApi.list(user),
        backupsApi.plans(user),
        backupsApi.runs(user)
      ]);
      setFiles(nextFiles ?? []);
      setFolders(nextFolders ?? []);
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
    selectedRef.current = selected;
  }, [selected]);

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
        const path = currentPath ? `${currentPath}/${file.name}` : file.name;
        setProgress({ label: `Upload: ${path}`, value: 0 });
        await uploadFile(user, file, (value) => setProgress({ label: `Upload: ${file.name}`, value }), {
          relativePath: path,
          thumbnailDataUrl: await safeThumbnail(file)
        });
        done += 1;
      }
      vibrateDone();
      notify(done === 1 ? 'Plik wysłany' : 'Upload zakończony', done === 1 ? `${picked[0].name} jest już w PrivateDrive.` : `Wysłano ${done} plików do PrivateDrive.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload nie powiódł się.');
      notify('Błąd synchronizacji', err instanceof Error ? err.message : 'Upload nie powiódł się.');
    } finally {
      setProgress(null);
      event.target.value = '';
    }
  }

  async function handleFolderUpload(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!picked.length) return;
    setError('');
    let done = 0;
    try {
      for (const file of picked) {
        const relativePath = currentPath ? `${currentPath}/${getRelativePath(file)}` : getRelativePath(file);
        setProgress({ label: `Folder upload: ${relativePath}`, value: 0 });
        await uploadFile(user, file, (value) => setProgress({ label: `Folder upload: ${relativePath}`, value }), {
          relativePath,
          thumbnailDataUrl: await safeThumbnail(file)
        });
        done += 1;
      }
      vibrateDone();
      notify('Backup zakończony', `Wysłano folder: ${done} plików.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload folderu nie powiódł się.');
      notify('Błąd synchronizacji', err instanceof Error ? err.message : 'Upload folderu nie powiódł się.');
    } finally {
      setProgress(null);
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

  async function createFolder() {
    const name = window.prompt('Nazwa folderu');
    if (!name?.trim()) return;
    try {
      await foldersApi.create(user, { name: name.trim(), parentPath: currentPath });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się utworzyć folderu.');
    }
  }

  async function bulkDelete() {
    const folderPaths = Array.from(selected).filter((key) => key.startsWith('d:')).map((key) => key.slice(2));
    const selectedFileIds = new Set(Array.from(selected).filter((key) => key.startsWith('f:')).map((key) => key.slice(2)));
    try {
      for (const path of folderPaths) {
        await foldersApi.remove(user, path);
      }
      for (const file of files) {
        if (selectedFileIds.has(file.id) && !folderPaths.some((path) => isInsidePath(normalizedFilePath(file), path))) {
          await filesApi.remove(user, file.id);
        }
      }
      selectedRef.current = new Set();
      setSelected(new Set());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się usunąć zaznaczonych elementów.');
    }
  }

  async function bulkDownload() {
    if (!selectedFiles.length) return;
    try {
      for (const file of selectedFiles) {
        setProgress({ label: `Pobieranie: ${file.filename}`, value: 0 });
        await downloadFile(user, file, (value) => setProgress({ label: `Pobieranie: ${file.filename}`, value }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać zaznaczonych elementów.');
    } finally {
      setProgress(null);
    }
  }

  async function bulkShare() {
    if (!selectedFiles.length) return;
    setProgress({ label: 'Udostępnianie zaznaczonych plików', value: 0 });
    try {
      await shareFiles(user, selectedFiles, (value) => setProgress({ label: 'Udostępnianie zaznaczonych plików', value }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się udostępnić zaznaczonych elementów.');
    } finally {
      setProgress(null);
    }
  }

  function toggleSelected(key: string) {
    setSelected((next) => {
      const copy = new Set(next);
      if (copy.has(key)) {
        copy.delete(key);
      } else {
        copy.add(key);
      }
      selectedRef.current = copy;
      return copy;
    });
  }

  function selectKey(key: string) {
    setSelected((next) => {
      if (next.has(key)) return next;
      const copy = new Set(next);
      copy.add(key);
      selectedRef.current = copy;
      return copy;
    });
  }

  function sweepSelect(event: PointerEvent<HTMLElement>) {
    if (selectedRef.current.size === 0 || event.pointerType === 'mouse') return;
    const card = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-select-key]');
    const key = card?.dataset.selectKey;
    if (key) {
      selectKey(key);
    }
  }

  function toggleVisibleSelection() {
    setSelected((next) => {
      const copy = new Set(next);
      if (allVisibleSelected) {
        visibleKeys.forEach((key) => copy.delete(key));
      } else {
        visibleKeys.forEach((key) => copy.add(key));
      }
      selectedRef.current = copy;
      return copy;
    });
  }

  function openFolder(path: string) {
    const empty = new Set<string>();
    selectedRef.current = empty;
    setSelected(empty);
    setCurrentPath(path);
  }

  function beginLongPress(event: PointerEvent<HTMLElement>, key: string) {
    if ((event.target as HTMLElement).closest('button')) return;
    clearLongPress();
    longPressTriggered.current = false;
    longPress.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        longPressTriggered.current = true;
        toggleSelected(key);
        vibrateDone();
        longPress.current = null;
      }, 420)
    };
  }

  function moveLongPress(event: PointerEvent<HTMLElement>) {
    if (!longPress.current) return;
    if (Math.abs(event.clientX - longPress.current.x) > 12 || Math.abs(event.clientY - longPress.current.y) > 12) {
      clearLongPress();
    }
  }

  function clearLongPress() {
    if (longPress.current) {
      window.clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
  }

  function handleCardClick(item: BrowserItem) {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    const key = item.type === 'folder' ? `d:${item.path}` : `f:${item.file.id}`;
    if (selected.size > 0) {
      toggleSelected(key);
      return;
    }
    if (item.type === 'folder') {
      openFolder(item.path);
    }
  }

  function startFileDrag(event: DragEvent<HTMLElement>, file: FileRecord) {
    draggedFileId.current = file.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', file.id);
  }

  async function dropOnFolder(event: DragEvent<HTMLElement>, targetPath: string) {
    event.preventDefault();
    event.stopPropagation();
    setDragOverPath('');
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length) {
      await uploadDroppedFiles(droppedFiles, targetPath);
      return;
    }
    const draggedId = draggedFileId.current || event.dataTransfer.getData('text/plain');
    draggedFileId.current = null;
    await moveFilesToFolder(targetPath, draggedId);
  }

  async function uploadDroppedFiles(picked: File[], targetPath: string) {
    setError('');
    try {
      for (const file of picked) {
        const relativePath = `${targetPath}/${getRelativePath(file)}`;
        setProgress({ label: `Upload: ${relativePath}`, value: 0 });
        await uploadFile(user, file, (value) => setProgress({ label: `Upload: ${relativePath}`, value }), {
          relativePath,
          thumbnailDataUrl: await safeThumbnail(file)
        });
      }
      vibrateDone();
      notify('Plik wysłany', `Dodano ${picked.length} plików do folderu.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się przenieść plików do folderu.');
      notify('Błąd synchronizacji', err instanceof Error ? err.message : 'Nie udało się przenieść plików do folderu.');
    } finally {
      setProgress(null);
    }
  }

  async function moveFilesToFolder(targetPath: string, draggedId: string) {
    const fileIds = new Set(Array.from(selected).filter((key) => key.startsWith('f:')).map((key) => key.slice(2)));
    if (!fileIds.has(draggedId)) {
      fileIds.clear();
      if (draggedId) fileIds.add(draggedId);
    }
    const filesToMove = files.filter((file) => fileIds.has(file.id));
    if (!filesToMove.length) return;
    try {
      await Promise.all(filesToMove.map((file) => filesApi.move(user, file.id, `${targetPath}/${file.filename}`)));
      selectedRef.current = new Set();
      setSelected(new Set());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się przenieść plików.');
    }
  }

  async function createPlanFromPicker() {
    if (supportsDirectoryPicker()) {
      try {
        const picked = await pickDirectory();
        await createPlanFromPickedFiles(picked.files, picked.name, picked.handle);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Nie udało się odczytać folderu.');
        return;
      }
    }
    backupFolderInput.current?.click();
  }

  async function createPlanFromFolder(event: ChangeEvent<HTMLInputElement>) {
    const pickedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!pickedFiles.length) return;
    await createPlanFromPickedFiles(toPickedDirectoryFiles(pickedFiles), getFolderName(pickedFiles));
  }

  async function createPlanFromPickedFiles(pickedFiles: PickedDirectoryFile[], folderName: string, handle?: unknown) {
    setError('');
    const manifest = buildManifest(pickedFiles);
    try {
      const plan = await backupsApi.createPlan(user, {
        displayName: folderName,
        selectedPathLabel: folderName,
        includePatterns: ['*'],
        fileManifest: []
      });
      if (handle) {
        await saveDirectoryHandle(directoryHandleKey(user.uid, plan.id), handle);
      }
      await renewPlan({ ...plan, fileManifest: [] }, pickedFiles, manifest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się dodać folderu backupu.');
      notify('Błąd synchronizacji', err instanceof Error ? err.message : 'Nie udało się dodać folderu backupu.');
    }
  }

  async function renewPlanFromStoredFolder(plan: BackupPlan) {
    const picked = await readStoredDirectory(directoryHandleKey(user.uid, plan.id));
    if (picked) {
      await renewPlan(plan, picked);
      return;
    }
    await reconnectPlanFolder(plan);
  }

  async function renewPlanFromFolderInput(plan: BackupPlan, event: ChangeEvent<HTMLInputElement>) {
    const pickedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!pickedFiles.length) return;
    await renewPlan(plan, toPickedDirectoryFiles(pickedFiles));
  }

  async function reconnectPlanFolder(plan: BackupPlan) {
    if (supportsDirectoryPicker()) {
      try {
        const picked = await pickDirectory();
        await saveDirectoryHandle(directoryHandleKey(user.uid, plan.id), picked.handle);
        await renewPlan(plan, picked.files);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Nie udało się podpiąć folderu.');
        return;
      }
    }
    document.getElementById(`backup-input-${plan.id}`)?.click();
  }

  async function deleteBackupPlan(plan: BackupPlan) {
    const confirmed = window.confirm(`Usunąć backup "${plan.displayName}"? Historia tego backupu też zostanie usunięta.`);
    if (!confirmed) return;
    setError('');
    try {
      await backupsApi.removePlan(user, plan.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się usunąć backupu.');
    }
  }

  async function renewPlan(plan: BackupPlan, pickedFiles: PickedDirectoryFile[], nextManifest = buildManifest(pickedFiles)) {
    if (!pickedFiles.length) return;
    const changedFiles = getChangedFiles(plan.fileManifest ?? [], pickedFiles, nextManifest);
    let bytes = 0;
    const errors: string[] = [];
    for (const entry of changedFiles) {
      try {
        setProgress({ label: `Renew ${plan.displayName}: ${entry.relativePath}`, value: 0 });
        await uploadFile(user, entry.file, (value) => setProgress({ label: `Renew ${plan.displayName}: ${value}%`, value }), {
          relativePath: backupUploadPath(plan, entry),
          thumbnailDataUrl: await safeThumbnail(entry.file)
        });
        bytes += entry.file.size;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Nie udało się wysłać ${entry.relativePath}.`);
      }
    }
    await backupsApi.renew(user, plan.id, {
      fileCount: changedFiles.length,
      skippedCount: pickedFiles.length - changedFiles.length,
      bytesUploaded: bytes,
      errors,
      fileManifest: nextManifest
    });
    vibrateDone();
    if (errors.length) {
      notify('Błąd synchronizacji', `Backup ${plan.displayName} zakończony z błędami.`);
    } else if (changedFiles.length === 0) {
      notify('Backup sprawdzony', `Brak zmian w folderze ${plan.displayName}.`);
    } else {
      notify('Backup zakończony', `Backup ${plan.displayName}: wysłano ${changedFiles.length}, pominięto ${pickedFiles.length - changedFiles.length}.`);
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
              <>
                <button className="button button-primary" onClick={() => uploadInput.current?.click()}><UploadCloud size={18} /> Upload plików</button>
                <button className="button button-secondary" onClick={() => folderUploadInput.current?.click()}><FolderPlus size={18} /> Upload folderu</button>
                <button className="button button-secondary" onClick={createFolder}><FolderPlus size={18} /> Stwórz folder</button>
              </>
            )}
            <input hidden ref={uploadInput} type="file" multiple onChange={handleUpload} />
            <input hidden ref={folderUploadInput} type="file" multiple webkitdirectory="" onChange={handleFolderUpload} />
          </section>

          {activeView === 'files' && (
            <section className="panel">
              <div className="section-title">
                <h1>{currentPath || 'Pliki'}</h1>
                <div className="section-actions">
                  <button className="button button-secondary compact-button" disabled={!visibleKeys.length} onClick={toggleVisibleSelection}>{allVisibleSelected ? 'Odznacz' : 'Zaznacz wszystko'}</button>
                  {currentPath ? <button className="icon-button" aria-label="Wróć" onClick={() => openFolder(parentPath(currentPath))}><ArrowLeft size={18} /></button> : <Share2 size={18} />}
                </div>
              </div>
              {selected.size > 0 && (
                <div className="selection-bar">
                  <span>{selected.size} zazn.</span>
                  <button className="button button-secondary" onClick={bulkShare}><Share2 size={18} /> Udostępnij</button>
                  <button className="button button-secondary" onClick={bulkDownload}><Download size={18} /> Pobierz</button>
                  <button className="button button-secondary danger-text" onClick={bulkDelete}><Trash2 size={18} /> Usuń</button>
                </div>
              )}
              <div className="file-grid">
                {browserItems.map((item) => item.type === 'folder' ? (
                  <article
                    className={`file-card folder-card ${selected.has(`d:${item.path}`) ? 'selected' : ''} ${dragOverPath === item.path ? 'drop-target' : ''}`}
                    key={item.path}
                    data-select-key={`d:${item.path}`}
                    onClick={() => handleCardClick(item)}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={(event) => beginLongPress(event, `d:${item.path}`)}
                    onPointerMove={(event) => {
                      moveLongPress(event);
                      sweepSelect(event);
                    }}
                    onPointerUp={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onPointerLeave={clearLongPress}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverPath(item.path);
                    }}
                    onDragLeave={() => setDragOverPath('')}
                    onDrop={(event) => dropOnFolder(event, item.path)}
                  >
                    <div className="file-thumb icon-thumb"><Folder size={44} /></div>
                    <strong>{item.name}</strong>
                    <span>{item.count} plików</span>
                  </article>
                ) : (
                  <article
                    className={`file-card ${selected.has(`f:${item.file.id}`) ? 'selected' : ''}`}
                    key={item.file.id}
                    data-select-key={`f:${item.file.id}`}
                    draggable
                    onClick={() => handleCardClick(item)}
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={(event) => beginLongPress(event, `f:${item.file.id}`)}
                    onPointerMove={(event) => {
                      moveLongPress(event);
                      sweepSelect(event);
                    }}
                    onPointerUp={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onPointerLeave={clearLongPress}
                    onDragStart={(event) => startFileDrag(event, item.file)}
                    onDragEnd={() => {
                      draggedFileId.current = null;
                      setDragOverPath('');
                    }}
                  >
                    <FilePreview file={item.file} />
                    <strong>{item.file.filename}</strong>
                    <span>{formatBytes(item.file.sizeBytes)} · {formatDate(item.file.createdAt)}</span>
                    <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                      <button className="icon-button" aria-label="Udostępnij" onClick={() => handleShare(item.file)}><Share2 size={18} /></button>
                      <button className="icon-button" aria-label="Pobierz" onClick={() => handleDownload(item.file)}><Download size={18} /></button>
                      <button className="icon-button danger" aria-label="Usuń" onClick={() => handleDelete(item.file)}><Trash2 size={18} /></button>
                    </div>
                  </article>
                ))}
                {!browserItems.length && <p className="muted">Brak plików. Dodaj pierwszy backup lub upload.</p>}
              </div>
            </section>
          )}

          {activeView === 'backups' && (
            <section className="panel">
              <div className="section-title"><h1>Backup folderów</h1><FolderSync size={18} /></div>
              <button className="button button-primary full-width" onClick={createPlanFromPicker}><FolderPlus size={18} /> Wybierz folder do backupu</button>
              <input hidden ref={backupFolderInput} type="file" multiple webkitdirectory="" onChange={createPlanFromFolder} />
              <div className="list">
                {plans.map((plan) => (
                  <article className="row" key={plan.id}>
                    <div><strong>{plan.displayName}</strong><span>{plan.selectedPathLabel} · {plan.fileManifest?.length ?? 0} plików · ostatnio: {formatDate(plan.lastBackupAt)}</span></div>
                    <div className="row-actions backup-actions">
                      <button className="button button-secondary" onClick={() => renewPlanFromStoredFolder(plan)}><RefreshCcw size={18} /> Sprawdź zmiany</button>
                      <button className="icon-button danger" aria-label="Usuń backup" onClick={() => deleteBackupPlan(plan)}><Trash2 size={18} /></button>
                      <input id={`backup-input-${plan.id}`} hidden type="file" multiple webkitdirectory="" onChange={(event) => renewPlanFromFolderInput(plan, event)} />
                    </div>
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
                    <div><strong>{run.status}</strong><span>wysłano: {run.fileCount} · pominięto: {run.skippedCount ?? 0} · {formatBytes(run.bytesUploaded)} · {formatDate(run.finishedAt)}</span></div>
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

function buildManifest(files: PickedDirectoryFile[]): BackupFileEntry[] {
  return files.map(({ file, relativePath }) => ({
    relativePath,
    sizeBytes: file.size,
    lastModified: file.lastModified
  })).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function getChangedFiles(previousManifest: BackupFileEntry[], files: PickedDirectoryFile[], nextManifest: BackupFileEntry[]): PickedDirectoryFile[] {
  const previous = new Map(previousManifest.map((entry) => [entry.relativePath, entry]));
  const nextByPath = new Map(nextManifest.map((entry) => [entry.relativePath, entry]));
  return files.filter(({ relativePath }) => {
    const oldEntry = previous.get(relativePath);
    const nextEntry = nextByPath.get(relativePath);
    if (!oldEntry || !nextEntry) return true;
    return oldEntry.sizeBytes !== nextEntry.sizeBytes || oldEntry.lastModified !== nextEntry.lastModified;
  });
}

function toPickedDirectoryFiles(files: File[]): PickedDirectoryFile[] {
  return files.map((file) => ({ file, relativePath: getRelativePath(file) }));
}

function getRelativePath(file: File): string {
  return ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/^\/+/, '');
}

function backupUploadPath(plan: BackupPlan, entry: PickedDirectoryFile): string {
  const root = cleanPathSegment(plan.selectedPathLabel || plan.displayName || 'Backup');
  const relativePath = entry.relativePath.replace(/^\/+/, '');
  if (!root || relativePath === root || relativePath.startsWith(`${root}/`)) {
    return relativePath;
  }
  return `${root}/${relativePath}`;
}

function cleanPathSegment(value: string): string {
  return value.split('/').filter(Boolean).at(-1)?.trim() || 'Backup';
}

function directoryHandleKey(uid: string, planID: string): string {
  return `${uid}:${planID}`;
}

async function safeThumbnail(file: File): Promise<string> {
  try {
    return await createThumbnail(file);
  } catch {
    return '';
  }
}

function buildBrowserItems(files: FileRecord[], folders: FolderRecord[], currentPath: string): BrowserItem[] {
  const prefix = currentPath ? `${currentPath}/` : '';
  const folderMap = new Map<string, { name: string; path: string; count: number }>();
  for (const folder of folders) {
    if (folder.parentPath === currentPath) {
      folderMap.set(folder.path, { name: folder.name, path: folder.path, count: 0 });
    } else if (folder.path.startsWith(prefix)) {
      const rest = folder.path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash >= 0) {
        const name = rest.slice(0, slash);
        const folderPath = prefix + name;
        if (!folderMap.has(folderPath)) {
          folderMap.set(folderPath, { name, path: folderPath, count: 0 });
        }
      }
    }
  }
  const visibleFiles: FileRecord[] = [];
  for (const file of files) {
    const path = normalizedFilePath(file);
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      const name = rest.slice(0, slash);
      const folderPath = prefix + name;
      const folder = folderMap.get(folderPath) ?? { name, path: folderPath, count: 0 };
      folder.count += 1;
      folderMap.set(folderPath, folder);
    } else {
      visibleFiles.push(file);
    }
  }
  return [
    ...Array.from(folderMap.values()).sort((a, b) => a.name.localeCompare(b.name)).map((folder) => ({ type: 'folder' as const, ...folder })),
    ...visibleFiles.sort((a, b) => a.filename.localeCompare(b.filename)).map((file) => ({ type: 'file' as const, file }))
  ];
}

function normalizedFilePath(file: FileRecord): string {
  return (file.relativePath || file.filename).replace(/^\/+/, '');
}

function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function FilePreview({ file }: { file: FileRecord }) {
  if (file.thumbnailDataUrl) {
    return <img className="file-thumb image-thumb" src={file.thumbnailDataUrl} alt="" />;
  }
  const Icon = iconForFile(file);
  return <div className="file-thumb icon-thumb"><Icon size={42} /></div>;
}

function iconForFile(file: FileRecord) {
  const name = file.filename.toLowerCase();
  if (file.mimeType.startsWith('image/')) return Image;
  if (file.mimeType === 'application/pdf' || name.endsWith('.pdf')) return FileText;
  if (name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z')) return FileArchive;
  if (name.endsWith('.doc') || name.endsWith('.docx') || name.endsWith('.odt')) return FileText;
  if (name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.csv')) return FileText;
  if (name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.html') || name.endsWith('.css') || name.endsWith('.go')) return FileCode2;
  return Files;
}

function filesForSelection(files: FileRecord[], selected: Set<string>): FileRecord[] {
  const fileIds = new Set(Array.from(selected).filter((key) => key.startsWith('f:')).map((key) => key.slice(2)));
  const folderPaths = Array.from(selected).filter((key) => key.startsWith('d:')).map((key) => key.slice(2));
  return files.filter((file) => fileIds.has(file.id) || folderPaths.some((path) => isInsidePath(normalizedFilePath(file), path)));
}

function isInsidePath(filePath: string, folderPath: string): boolean {
  return filePath === folderPath || filePath.startsWith(`${folderPath}/`);
}
