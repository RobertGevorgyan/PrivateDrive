import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { browserLocalPersistence, getRedirectResult, onAuthStateChanged, setPersistence } from 'firebase/auth';
import { apiFetch } from './api';
import { auth } from './firebase';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: () => void = () => undefined;
    let cancelled = false;

    async function bootAuth() {
      await setPersistence(auth, browserLocalPersistence).catch(() => undefined);
      const redirectResult = await getRedirectResult(auth).catch((err) => {
        sessionStorage.removeItem('privatedrive.googleRedirectStarted');
        sessionStorage.setItem('privatedrive.authError', readableAuthError(err));
        return null;
      });
      if (redirectResult?.user && !cancelled) {
        sessionStorage.removeItem('privatedrive.googleRedirectStarted');
        setUser(redirectResult.user);
        setLoading(false);
        await apiFetch(redirectResult.user, '/api/users/me', { method: 'POST' }).catch(() => undefined);
      }
      if (!redirectResult?.user && sessionStorage.getItem('privatedrive.googleRedirectStarted') === '1') {
        sessionStorage.removeItem('privatedrive.googleRedirectStarted');
        sessionStorage.setItem(
          'privatedrive.authError',
          'Google redirect nie zakończył logowania. Sprawdź domenę w Firebase Authorized domains, HTTPS oraz czy przeglądarka nie blokuje storage/cookies.'
        );
      }
      unsubscribe = onAuthStateChanged(auth, async (next) => {
        if (cancelled) return;
        setUser(next);
        setLoading(false);
        if (next) {
          await apiFetch(next, '/api/users/me', { method: 'POST' }).catch(() => undefined);
        }
      });
    }

    void bootAuth();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { user, loading };
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
