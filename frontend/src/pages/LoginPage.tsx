import { FormEvent, useEffect, useState } from 'react';
import { browserLocalPersistence, createUserWithEmailAndPassword, setPersistence, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { Lock } from 'lucide-react';
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
        <button className="button button-secondary" onClick={signInWithGoogle} disabled={googlePending}>
          <GoogleIcon /> {googlePending ? 'Przekierowuję do Google...' : 'Zaloguj przez Google'}
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

function GoogleIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
      <path fill="#4285f4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34a853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.94v2.34A9 9 0 0 0 9 18z" />
      <path fill="#fbbc05" d="M3.96 10.72a5.41 5.41 0 0 1 0-3.44V4.94H.94a9 9 0 0 0 0 8.12l3.02-2.34z" />
      <path fill="#ea4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.34l2.58-2.58A8.66 8.66 0 0 0 9 0 9 9 0 0 0 .94 4.94l3.02 2.34C4.67 5.16 6.66 3.58 9 3.58z" />
    </svg>
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
