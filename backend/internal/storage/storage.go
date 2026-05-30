package storage

import (
	"context"
	"io"
)

type Object struct {
	Key         string
	Name        string
	ContentType string
	Size        int64
	Body        io.ReadCloser
}

type Client interface {
	EnsureBucket(ctx context.Context) error
	Put(ctx context.Context, key, contentType string, size int64, body io.Reader) error
	Get(ctx context.Context, key string) (Object, error)
	Delete(ctx context.Context, key string) error
}
