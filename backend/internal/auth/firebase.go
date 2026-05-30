package auth

import (
	"context"

	firebase "firebase.google.com/go/v4"
	firebaseauth "firebase.google.com/go/v4/auth"
)

type FirebaseVerifier struct {
	client *firebaseauth.Client
}

func NewFirebaseVerifier(ctx context.Context, app *firebase.App) (*FirebaseVerifier, error) {
	client, err := app.Auth(ctx)
	if err != nil {
		return nil, err
	}
	return &FirebaseVerifier{client: client}, nil
}

func (v *FirebaseVerifier) VerifyIDToken(ctx context.Context, raw string) (*Token, error) {
	token, err := v.client.VerifyIDToken(ctx, raw)
	if err != nil {
		return nil, err
	}
	return &Token{UID: token.UID, Claims: token.Claims}, nil
}
