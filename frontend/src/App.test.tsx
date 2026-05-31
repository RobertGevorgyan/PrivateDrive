import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./lib/useAuth', () => ({
  useAuth: () => ({ user: null, loading: false })
}));

vi.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  createUserWithEmailAndPassword: vi.fn(),
  getRedirectResult: vi.fn(() => Promise.resolve(null)),
  setPersistence: vi.fn(() => Promise.resolve()),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  GoogleAuthProvider: vi.fn()
}));

vi.mock('./lib/firebase', () => ({
  auth: {},
  googleProvider: {}
}));

describe('App', () => {
  it('renders login screen for anonymous users', () => {
    render(<App />);
    expect(screen.getByText('Bezpieczny backup telefonu')).toBeInTheDocument();
  });
});
