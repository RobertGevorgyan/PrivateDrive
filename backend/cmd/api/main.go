package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	"google.golang.org/api/option"

	"privatedrive/backend/internal/auth"
	"privatedrive/backend/internal/config"
	"privatedrive/backend/internal/httpapi"
	"privatedrive/backend/internal/metadata"
	"privatedrive/backend/internal/storage"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	app, err := newFirebaseApp(ctx, cfg)
	if err != nil {
		log.Fatalf("firebase: %v", err)
	}
	firestoreClient, err := firestore.NewClient(ctx, cfg.FirebaseProjectID, firebaseOptions(cfg)...)
	if err != nil {
		log.Fatalf("firestore: %v", err)
	}
	defer firestoreClient.Close()

	verifier, err := auth.NewFirebaseVerifier(ctx, app)
	if err != nil {
		log.Fatalf("auth: %v", err)
	}
	minioClient, err := storage.NewMinIOClient(cfg.MinIOEndpoint, cfg.MinIOAccessKey, cfg.MinIOSecretKey, cfg.MinIOBucket, cfg.MinIOUseSSL)
	if err != nil {
		log.Fatalf("minio: %v", err)
	}
	if err := minioClient.EnsureBucket(ctx); err != nil {
		log.Fatalf("minio bucket: %v", err)
	}

	handler := httpapi.New(
		metadata.NewFirestoreStore(firestoreClient),
		minioClient,
		auth.Middleware(verifier),
		cfg.AllowedOrigins,
		cfg.MaxUploadBytes,
		cfg.MaxChunkBytes,
		cfg.UploadTempDir,
	)
	server := &http.Server{Addr: cfg.Addr, Handler: handler}

	go func() {
		log.Printf("PrivateDrive API listening on %s", cfg.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func newFirebaseApp(ctx context.Context, cfg config.Config) (*firebase.App, error) {
	return firebase.NewApp(ctx, &firebase.Config{ProjectID: cfg.FirebaseProjectID}, firebaseOptions(cfg)...)
}

func firebaseOptions(cfg config.Config) []option.ClientOption {
	if cfg.FirebaseCredentials == "" {
		return nil
	}
	return []option.ClientOption{option.WithCredentialsFile(cfg.FirebaseCredentials)}
}
