package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

type contextKey string

const userKey contextKey = "user"

type User struct {
	UID   string
	Email string
	Name  string
}

type Token struct {
	UID    string
	Claims map[string]any
}

type Verifier interface {
	VerifyIDToken(ctx context.Context, token string) (*Token, error)
}

func Middleware(verifier Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := r.Header.Get("Authorization")
			if raw == "" || !strings.HasPrefix(raw, "Bearer ") {
				http.Error(w, "missing bearer token", http.StatusUnauthorized)
				return
			}
			token, err := verifier.VerifyIDToken(r.Context(), strings.TrimPrefix(raw, "Bearer "))
			if err != nil || token == nil || token.UID == "" {
				http.Error(w, "invalid bearer token", http.StatusUnauthorized)
				return
			}
			user := User{UID: token.UID}
			if email, ok := token.Claims["email"].(string); ok {
				user.Email = email
			}
			if name, ok := token.Claims["name"].(string); ok {
				user.Name = name
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey, user)))
		})
	}
}

func FromContext(ctx context.Context) (User, error) {
	user, ok := ctx.Value(userKey).(User)
	if !ok || user.UID == "" {
		return User{}, errors.New("user missing from context")
	}
	return user, nil
}
