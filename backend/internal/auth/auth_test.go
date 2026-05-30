package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type fakeVerifier struct {
	token *Token
	err   error
}

func (f fakeVerifier) VerifyIDToken(context.Context, string) (*Token, error) {
	return f.token, f.err
}

func TestMiddlewareAcceptsBearerToken(t *testing.T) {
	handler := Middleware(fakeVerifier{token: &Token{UID: "u1", Claims: map[string]any{"email": "a@example.com"}}})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, err := FromContext(r.Context())
		if err != nil {
			t.Fatal(err)
		}
		if user.UID != "u1" || user.Email != "a@example.com" {
			t.Fatalf("unexpected user: %+v", user)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer good")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
}

func TestMiddlewareRejectsMissingToken(t *testing.T) {
	handler := Middleware(fakeVerifier{})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler should not be called")
	}))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
