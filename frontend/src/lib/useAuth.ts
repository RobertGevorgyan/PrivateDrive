import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { apiFetch } from './api';
import { auth } from './firebase';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (next) => {
      setUser(next);
      setLoading(false);
      if (next) {
        await apiFetch(next, '/api/users/me', { method: 'POST' }).catch(() => undefined);
      }
    });
  }, []);

  return { user, loading };
}
