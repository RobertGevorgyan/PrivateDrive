package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"privatedrive/backend/internal/auth"
)

type passVerifier struct{}

func (passVerifier) VerifyIDToken(context.Context, string) (*auth.Token, error) {
	return &auth.Token{UID: "u1"}, nil
}

func TestHealthIsPublic(t *testing.T) {
	handler := New(nil, nil, auth.Middleware(passVerifier{}), []string{"http://localhost:5173"}, 1024, 1024, t.TempDir())
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestCorsPreflight(t *testing.T) {
	handler := New(nil, nil, auth.Middleware(passVerifier{}), []string{"http://localhost:5173"}, 1024, 1024, t.TempDir())
	req := httptest.NewRequest(http.MethodOptions, "/api/files", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("unexpected CORS origin %q", got)
	}
}
