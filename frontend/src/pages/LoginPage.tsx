import { FormEvent, useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { Lock, Mail } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { Logo } from '../components/Logo';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
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
      if (isMobileLike()) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      if (shouldFallbackToRedirect(err)) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      setError(err instanceof Error ? err.message : 'Nie udało się zalogować przez Google.');
    }
  }

  return (
    <main className="login-shell">
      <Logo />
      <section className="login-panel">
        <h1>Bezpieczny backup telefonu</h1>
        <p>Pliki trafiają na prywatny serwer, a Firestore przechowuje tylko metadane i historię backupów.</p>
        <button className="button button-secondary" onClick={signInWithGoogle}>
          <Mail size={18} /> Zaloguj przez Google
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

function isMobileLike(): boolean {
  return window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
}

function shouldFallbackToRedirect(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('code' in err)) {
    return false;
  }
  const code = String((err as { code?: unknown }).code);
  return code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
}
