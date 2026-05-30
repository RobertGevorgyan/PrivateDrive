import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./lib/useAuth', () => ({
  useAuth: () => ({ user: null, loading: false })
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
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
