package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr                     string
	PublicAPIURL             string
	AllowedOrigins           []string
	FirebaseProjectID        string
	FirebaseCredentials      string
	MinIOEndpoint            string
	MinIOAccessKey           string
	MinIOSecretKey           string
	MinIOBucket              string
	MinIOUseSSL              bool
	MaxUploadBytes           int64
	MaxChunkBytes            int64
	UploadTempDir            string
	ShutdownTimeout          time.Duration
	FirestoreEmulatorHost    string
	FirebaseAuthEmulatorHost string
}

func Load() (Config, error) {
	cfg := Config{
		Addr:                     value("API_ADDR", ":8080"),
		PublicAPIURL:             value("PUBLIC_API_URL", "https://privatecloud.rgevorgyan.com"),
		AllowedOrigins:           split(value("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8080,https://privatecloud.rgevorgyan.com")),
		FirebaseProjectID:        os.Getenv("FIREBASE_PROJECT_ID"),
		FirebaseCredentials:      os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"),
		MinIOEndpoint:            value("MINIO_ENDPOINT", "minio:9000"),
		MinIOAccessKey:           os.Getenv("MINIO_ROOT_USER"),
		MinIOSecretKey:           os.Getenv("MINIO_ROOT_PASSWORD"),
		MinIOBucket:              value("MINIO_BUCKET", "privatedrive"),
		MinIOUseSSL:              value("MINIO_USE_SSL", "false") == "true",
		MaxUploadBytes:           512 << 20,
		MaxChunkBytes:            16 << 20,
		UploadTempDir:            value("UPLOAD_TEMP_DIR", "/tmp/privatedrive-uploads"),
		ShutdownTimeout:          10 * time.Second,
		FirestoreEmulatorHost:    os.Getenv("FIRESTORE_EMULATOR_HOST"),
		FirebaseAuthEmulatorHost: os.Getenv("FIREBASE_AUTH_EMULATOR_HOST"),
	}
	if v := os.Getenv("MAX_UPLOAD_BYTES"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n <= 0 {
			return cfg, errors.New("MAX_UPLOAD_BYTES must be a positive integer")
		}
		cfg.MaxUploadBytes = n
	}
	if v := os.Getenv("MAX_CHUNK_BYTES"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n <= 0 {
			return cfg, errors.New("MAX_CHUNK_BYTES must be a positive integer")
		}
		cfg.MaxChunkBytes = n
	}
	if cfg.FirebaseProjectID == "" {
		return cfg, errors.New("FIREBASE_PROJECT_ID is required")
	}
	if cfg.MinIOAccessKey == "" || cfg.MinIOSecretKey == "" {
		return cfg, errors.New("MINIO_ROOT_USER and MINIO_ROOT_PASSWORD are required")
	}
	return cfg, nil
}

func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func split(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
