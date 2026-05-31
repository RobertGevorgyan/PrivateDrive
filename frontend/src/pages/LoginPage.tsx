import { FormEvent, useEffect, useState } from 'react';
import { browserLocalPersistence, createUserWithEmailAndPassword, setPersistence, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { Lock, Mail } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { Logo } from '../components/Logo';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [googlePending, setGooglePending] = useState(false);

  useEffect(() => {
    const redirectError = sessionStorage.getItem('privatedrive.authError');
    if (redirectError) {
      sessionStorage.removeItem('privatedrive.authError');
      setError(redirectError);
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await setPersistence(auth, browserLocalPersistence);
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zalogować.');
    }
  }

  async function signInWithGoogle() {
    setError('');
    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (shouldFallbackToRedirect(err)) {
        setGooglePending(true);
        sessionStorage.setItem('privatedrive.googleRedirectStarted', '1');
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      setGooglePending(false);
      setError(readableAuthError(err));
    }
  }

  return (
    <main className="login-shell">
      <Logo />
      <section className="login-panel">
        <h1>Bezpieczny backup telefonu</h1>
        <p>Pliki trafiają na prywatny serwer, a Firestore przechowuje tylko metadane i historię backupów.</p>
        <button className="button button-secondary" onClick={signInWithGoogle} disabled={googlePending}>
          <Mail size={18} /> {googlePending ? 'Przekierowuję do Google...' : 'Zaloguj przez Google'}
        </button>
        <div className="divider">lub</div>
        <form onSubmit={submit} className="form-stack">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Hasło
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={6} required />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="button button-primary" type="submit">
            <Lock size={18} /> {mode === 'login' ? 'Zaloguj' : 'Utwórz konto'}
          </button>
        </form>
        <button className="button button-ghost" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Potrzebuję konta' : 'Mam już konto'}
        </button>
      </section>
    </main>
  );
}

function readableAuthError(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return 'Nie udało się zalogować.';
  }
  const code = 'code' in err ? String((err as { code?: unknown }).code) : '';
  if (code === 'auth/unauthorized-domain') {
    return 'Ta domena nie jest dodana w Firebase Authentication > Authorized domains.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Ten sposób logowania nie jest włączony w Firebase Authentication.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Nie udało się połączyć z Firebase. Sprawdź HTTPS, domenę i połączenie.';
  }
  return err instanceof Error ? err.message : 'Nie udało się zalogować.';
}

function shouldFallbackToRedirect(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) {
    return false;
  }
  const code = String((err as { code?: unknown }).code);
  return code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request';
}
