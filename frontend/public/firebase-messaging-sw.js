importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FIREBASE_CONFIG') {
    self.firebaseConfig = event.data.config;
    if (!firebase.apps.length) {
      firebase.initializeApp(self.firebaseConfig);
      firebase.messaging();
    }
  }
});
