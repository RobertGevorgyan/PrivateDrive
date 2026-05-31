export function formatBytes(value: number): string {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(value?: string): string {
  if (!value) return 'Nigdy';
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function vibrateDone(): void {
  navigator.vibrate?.([80, 40, 80]);
}

export function notify(title: string, body: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = { body, icon: '/logo.svg', badge: '/logo.svg' };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => registration.showNotification(title, options))
      .catch(() => showWindowNotification(title, options));
    return;
  }
  showWindowNotification(title, options);
}

function showWindowNotification(title: string, options: NotificationOptions): void {
  try {
    new Notification(title, options);
  } catch {
    // Android standalone PWAs can reject the constructor; in that case the UI progress state remains the fallback.
  }
}
