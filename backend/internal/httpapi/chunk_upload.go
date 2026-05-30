package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/google/uuid"

	"privatedrive/backend/internal/auth"
	"privatedrive/backend/internal/metadata"
)

type uploadSession struct {
	ID          string    `json:"id"`
	OwnerUID    string    `json:"ownerUid"`
	Filename    string    `json:"filename"`
	MimeType    string    `json:"mimeType"`
	SizeBytes   int64     `json:"sizeBytes"`
	TotalChunks int       `json:"totalChunks"`
	ChunkSize   int64     `json:"chunkSize"`
	CreatedAt   time.Time `json:"createdAt"`
}

func (s *Server) initChunkUpload(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	var payload struct {
		Filename    string `json:"filename"`
		MimeType    string `json:"mimeType"`
		SizeBytes   int64  `json:"sizeBytes"`
		TotalChunks int    `json:"totalChunks"`
		ChunkSize   int64  `json:"chunkSize"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if payload.SizeBytes <= 0 || payload.TotalChunks <= 0 || payload.ChunkSize <= 0 {
		writeError(w, http.StatusBadRequest, errors.New("invalid upload metadata"))
		return
	}
	if payload.ChunkSize > s.maxChunkBytes {
		writeError(w, http.StatusBadRequest, fmt.Errorf("chunk size exceeds %d bytes", s.maxChunkBytes))
		return
	}
	if payload.MimeType == "" {
		payload.MimeType = "application/octet-stream"
	}
	session := uploadSession{
		ID:          uuid.NewString(),
		OwnerUID:    user.UID,
		Filename:    filepath.Base(payload.Filename),
		MimeType:    payload.MimeType,
		SizeBytes:   payload.SizeBytes,
		TotalChunks: payload.TotalChunks,
		ChunkSize:   payload.ChunkSize,
		CreatedAt:   time.Now(),
	}
	dir := s.uploadDir(session.ID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if err := s.writeUploadSession(session); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"uploadId":  session.ID,
		"chunkSize": session.ChunkSize,
	})
}

func (s *Server) putUploadChunk(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	session, err := s.readUploadSession(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if session.OwnerUID != user.UID {
		writeError(w, http.StatusNotFound, errors.New("upload not found"))
		return
	}
	index, err := strconv.Atoi(r.PathValue("index"))
	if err != nil || index < 0 || index >= session.TotalChunks {
		writeError(w, http.StatusBadRequest, errors.New("invalid chunk index"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.maxChunkBytes)
	defer r.Body.Close()
	tmp := s.chunkPath(session.ID, index) + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	written, copyErr := io.Copy(out, r.Body)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		writeError(w, http.StatusBadRequest, copyErr)
		return
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		writeError(w, http.StatusInternalServerError, closeErr)
		return
	}
	if written > s.maxChunkBytes {
		_ = os.Remove(tmp)
		writeError(w, http.StatusRequestEntityTooLarge, errors.New("chunk too large"))
		return
	}
	if err := os.Rename(tmp, s.chunkPath(session.ID, index)); err != nil {
		_ = os.Remove(tmp)
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) completeChunkUpload(w http.ResponseWriter, r *http.Request) {
	user, err := auth.FromContext(r.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, err)
		return
	}
	session, err := s.readUploadSession(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if session.OwnerUID != user.UID {
		writeError(w, http.StatusNotFound, errors.New("upload not found"))
		return
	}
	for i := 0; i < session.TotalChunks; i++ {
		if _, err := os.Stat(s.chunkPath(session.ID, i)); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("missing chunk %d", i))
			return
		}
	}

	reader, writer := io.Pipe()
	go func() {
		writer.CloseWithError(s.streamChunks(session, writer))
	}()

	objectKey := fmt.Sprintf("%s/%s/%s", user.UID, time.Now().Format("20060102"), uuid.NewString()+"-"+session.Filename)
	if err := s.objects.Put(r.Context(), objectKey, session.MimeType, session.SizeBytes, reader); err != nil {
		_ = reader.Close()
		writeError(w, http.StatusBadGateway, err)
		return
	}
	record, err := s.store.CreateFile(r.Context(), metadata.FileRecord{
		OwnerUID:  user.UID,
		ObjectKey: objectKey,
		Filename:  session.Filename,
		MimeType:  session.MimeType,
		SizeBytes: session.SizeBytes,
		Tags:      []string{"manual", "chunked"},
		Shared:    false,
		Status:    "available",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	_ = os.RemoveAll(s.uploadDir(session.ID))
	writeJSON(w, http.StatusCreated, record)
}

func (s *Server) writeUploadSession(session uploadSession) error {
	file, err := os.Create(filepath.Join(s.uploadDir(session.ID), "session.json"))
	if err != nil {
		return err
	}
	defer file.Close()
	return json.NewEncoder(file).Encode(session)
}

func (s *Server) readUploadSession(id string) (uploadSession, error) {
	file, err := os.Open(filepath.Join(s.uploadDir(id), "session.json"))
	if err != nil {
		return uploadSession{}, err
	}
	defer file.Close()
	var session uploadSession
	if err := json.NewDecoder(file).Decode(&session); err != nil {
		return uploadSession{}, err
	}
	return session, nil
}

func (s *Server) streamChunks(session uploadSession, writer *io.PipeWriter) error {
	for i := 0; i < session.TotalChunks; i++ {
		file, err := os.Open(s.chunkPath(session.ID, i))
		if err != nil {
			return err
		}
		if _, err := io.Copy(writer, file); err != nil {
			_ = file.Close()
			return err
		}
		if err := file.Close(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) uploadDir(id string) string {
	return filepath.Join(s.uploadTempDir, filepath.Base(id))
}

func (s *Server) chunkPath(id string, index int) string {
	return filepath.Join(s.uploadDir(id), fmt.Sprintf("%06d.part", index))
}
