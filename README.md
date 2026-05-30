# PrivateDrive

PrivateDrive is a mobile-first PWA for backing up phone files to a private server. The frontend is a React SPA/PWA, the backend is a Go API, user files are stored in MinIO, and Firebase is used for Authentication, Firestore metadata, and Cloud Messaging.

## Features

- Google and email/password sign-in with Firebase Authentication.
- Manual file and folder backup from the mobile picker.
- File upload/download progress in the app.
- Chunked uploads for large files and folders.
- Android PWA installability and share target support for the system share sheet / Quick Share flow.
- Vibration when uploads or backup renewals finish.
- Web Notifications and Firebase Cloud Messaging token registration.
- Firestore metadata collections: `users`, `files`, `backupPlans`, `backupRuns`.

## Requirements

- Docker and Docker Compose on the VM.
- Firebase project with Authentication, Firestore, and Cloud Messaging enabled.
- Firebase web app config for the frontend.
- Firebase service account JSON available on the VM for the Go backend.
- DNS/TLS reverse proxy pointing production traffic to the frontend container. The production API base is expected to be `https://privatecloud.rgevorgyan.com`.

## Configuration

Copy `.env.example` to `.env` on the VM and fill in real values:

```bash
cp .env.example .env
```

Keep the real `.env` and the Firebase service account JSON out of git. The current `.gitignore` already ignores `.env`.

For the backend, put the Firebase service account JSON on the VM and set `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env`. Docker Compose mounts it as `/run/secrets/firebase-service-account.json` inside the API container. If you use a reverse proxy, set `ALLOWED_ORIGINS` to include the public frontend origin.

## Development

Install frontend dependencies:

```bash
cd frontend
npm install
npm run dev
```

Run the backend locally:

```bash
cd backend
go mod download
go run ./cmd/api
```

The Vite dev server proxies `/api` to `http://localhost:8080`.

## Docker Compose

Build and start everything:

```bash
docker compose up --build
```

Services:

- Frontend: `http://localhost`
- API: `http://localhost:8080/api/health`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`

Large uploads are split into chunks by the frontend. `MAX_CHUNK_BYTES` controls the maximum single request size, while the API temporarily stores chunks in `UPLOAD_TEMP_DIR` before streaming the completed file into MinIO.

## Testing

Frontend:

```bash
cd frontend
npm run test
npm run build
```

Backend:

```bash
cd backend
go test ./...
```

Manual acceptance checks:

- Sign in with Google.
- Sign in or register with email/password.
- Upload a file and confirm that it appears in MinIO and in the Firestore `files` collection.
- Download a file and confirm that the progress bar advances.
- Create a backup plan and use Renew to pick files/folders manually.
- Install the PWA on Android Chrome.
- Share a file from Android to PrivateDrive through the share sheet.
- Allow notifications and confirm the FCM token is stored under the user document.

## PWA Limits

Browser PWAs cannot reliably auto-back up arbitrary phone folders in the background, and Android does not expose a guaranteed native progress notification API to web apps. PrivateDrive implements the PWA-safe version: manual picker-based backup, in-app progress, Web Notifications/FCM status messages, and vibration after completion.
