package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"privatedrive/backend/internal/auth"
	"privatedrive/backend/internal/metadata"
	"privatedrive/backend/internal/storage"
)

type Server struct {
	store          metadata.Store
	objects        storage.Client
	authMiddleware func(http.Handler) http.Handler
	allowedOrigins map[string]struct{}
	maxUploadBytes int64
	maxChunkBytes  int64
	uploadTempDir  string
}

func New(store metadata.Store, objects storage.Client, authMiddleware func(http.Handler) http.Handler, allowedOrigins []string, maxUploadBytes, maxChunkBytes int64, uploadTempDir string) http.Handler {
	s := &Server{
		store:          store,
		objects:        objects,
		authMiddleware: authMiddleware,
		allowedOrigins: map[string]struct{}{},
		maxUploadBytes: maxUploadBytes,
		maxChunkBytes:  maxChunkBytes,
		uploadTempDir:  uploadTempDir,
	}
	for _, origin := range allowedOrigins {
		s.allowedOrigins[origin] = struct{}{}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.Handle("POST /api/users/me", authMiddleware(http.HandlerFunc(s.upsertUser)))
	mux.Handle("POST /api/files/upload", authMiddleware(http.HandlerFunc(s.uploadFile)))
	mux.Handle("POST /api/uploads/init", authMiddleware(http.HandlerFunc(s.initChunkUpload)))
	mux.Handle("PUT /api/uploads/{id}/chunks/{index}", authMiddleware(http.HandlerFunc(s.putUploadChunk)))
	mux.Handle("POST /api/uploads/{id}/complete", authMiddleware(http.HandlerFunc(s.completeChunkUpload)))
	mux.Handle("GET /api/files", authMiddleware(http.HandlerFunc(s.listFiles)))
	mux.Handle("GET /api/files/{id}/download", authMiddleware(http.HandlerFunc(s.downloadFile)))
	mux.Handle("DELETE /api/files/{id}", authMiddleware(http.HandlerFunc(s.deleteFile)))
	mux.Handle("POST /api/backups/plans", authMiddleware(http.HandlerFunc(s.createBackupPlan)))
	mux.Handle("GET /api/backups/plans", authMiddleware(http.HandlerFunc(s.listBackupPlans)))
	mux.Handle("POST /api/backups/plans/{id}/renew", authMiddleware(http.HandlerFunc(s.renewBackupPlan)))
	mux.Handle("GET /api/backups/runs", authMiddleware(http.HandlerFunc(s.listBackupRuns)))
	mux.Handle("POST /api/devices/fcm-token", authMiddleware(http.HandlerFunc(s.saveFCMToken)))
	return s.cors(mux)
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			if _, ok := s.allowedOrigins[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (s *Server) upsertUser(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	if err := s.store.UpsertUser(r.Context(), user.UID, user.Email, user.Name, "firebase"); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"uid": user.UID})
}

func (s *Server) uploadFile(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.maxUploadBytes)
	if err := r.ParseMultipartForm(s.maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	defer file.Close()

	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	cleanName := filepath.Base(header.Filename)
	objectKey := fmt.Sprintf("%s/%s/%s", user.UID, time.Now().Format("20060102"), uuid.NewString()+"-"+cleanName)
	if err := s.objects.Put(r.Context(), objectKey, contentType, header.Size, file); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	record, err := s.store.CreateFile(r.Context(), metadata.FileRecord{
		OwnerUID: user.UID, ObjectKey: objectKey, Filename: cleanName, MimeType: contentType, SizeBytes: header.Size,
		Tags: []string{"manual"}, Shared: false, Status: "available",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

func (s *Server) listFiles(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	files, err := s.store.ListFiles(r.Context(), user.UID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, files)
}

func (s *Server) downloadFile(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	record, err := s.store.GetFile(r.Context(), user.UID, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	obj, err := s.objects.Get(r.Context(), record.ObjectKey)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	defer obj.Body.Close()
	w.Header().Set("Content-Type", record.MimeType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", obj.Size))
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", record.Filename))
	_, _ = io.Copy(w, obj.Body)
}

func (s *Server) deleteFile(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	record, err := s.store.GetFile(r.Context(), user.UID, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if err := s.objects.Delete(r.Context(), record.ObjectKey); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if err := s.store.DeleteFile(r.Context(), user.UID, record.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createBackupPlan(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	var payload struct {
		DisplayName       string   `json:"displayName"`
		SelectedPathLabel string   `json:"selectedPathLabel"`
		IncludePatterns   []string `json:"includePatterns"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	payload.DisplayName = strings.TrimSpace(payload.DisplayName)
	payload.SelectedPathLabel = strings.TrimSpace(payload.SelectedPathLabel)
	if payload.DisplayName == "" || payload.SelectedPathLabel == "" {
		writeError(w, http.StatusBadRequest, errors.New("displayName and selectedPathLabel are required"))
		return
	}
	plan, err := s.store.CreateBackupPlan(r.Context(), metadata.BackupPlan{
		OwnerUID: user.UID, DisplayName: payload.DisplayName, SelectedPathLabel: payload.SelectedPathLabel, IncludePatterns: payload.IncludePatterns,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, plan)
}

func (s *Server) listBackupPlans(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	plans, err := s.store.ListBackupPlans(r.Context(), user.UID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, plans)
}

func (s *Server) renewBackupPlan(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	var payload struct {
		FileCount     int      `json:"fileCount"`
		BytesUploaded int64    `json:"bytesUploaded"`
		Errors        []string `json:"errors"`
	}
	_ = json.NewDecoder(r.Body).Decode(&payload)
	status := "completed"
	if len(payload.Errors) > 0 {
		status = "completed_with_errors"
	}
	run, err := s.store.UpdateBackupPlanLastRun(r.Context(), user.UID, r.PathValue("id"), metadata.BackupRun{
		Status: status, FileCount: payload.FileCount, BytesUploaded: payload.BytesUploaded, Errors: payload.Errors,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (s *Server) listBackupRuns(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	runs, err := s.store.ListBackupRuns(r.Context(), user.UID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, runs)
}

func (s *Server) saveFCMToken(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	var payload struct {
		Token    string `json:"token"`
		Platform string `json:"platform"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if strings.TrimSpace(payload.Token) == "" {
		writeError(w, http.StatusBadRequest, errors.New("token is required"))
		return
	}
	if payload.Platform == "" {
		payload.Platform = "web"
	}
	if err := s.store.SaveFCMToken(r.Context(), user.UID, metadata.DeviceToken{Token: payload.Token, Platform: payload.Platform}); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
