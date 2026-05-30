import { Loader2 } from 'lucide-react';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { useAuth } from './lib/useAuth';

export function App() {
  const { user, loading } = useAuth();
  if (loading) {
    return <main className="center"><Loader2 className="spin" /> Ładowanie PrivateDrive</main>;
  }
  return user ? <DashboardPage user={user} /> : <LoginPage />;
}
