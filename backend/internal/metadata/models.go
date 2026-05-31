package metadata

import "time"

type FileRecord struct {
	ID               string    `json:"id" firestore:"-"`
	OwnerUID         string    `json:"ownerUid" firestore:"ownerUid"`
	ObjectKey        string    `json:"objectKey" firestore:"objectKey"`
	Filename         string    `json:"filename" firestore:"filename"`
	RelativePath     string    `json:"relativePath" firestore:"relativePath"`
	MimeType         string    `json:"mimeType" firestore:"mimeType"`
	SizeBytes        int64     `json:"sizeBytes" firestore:"sizeBytes"`
	ThumbnailDataURL string    `json:"thumbnailDataUrl" firestore:"thumbnailDataUrl"`
	Status           string    `json:"status" firestore:"status"`
	Tags             []string  `json:"tags" firestore:"tags"`
	Shared           bool      `json:"shared" firestore:"shared"`
	CreatedAt        time.Time `json:"createdAt" firestore:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt" firestore:"updatedAt"`
}

type FolderRecord struct {
	ID         string    `json:"id" firestore:"-"`
	OwnerUID   string    `json:"ownerUid" firestore:"ownerUid"`
	Name       string    `json:"name" firestore:"name"`
	Path       string    `json:"path" firestore:"path"`
	ParentPath string    `json:"parentPath" firestore:"parentPath"`
	CreatedAt  time.Time `json:"createdAt" firestore:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt" firestore:"updatedAt"`
}

type BackupPlan struct {
	ID                  string            `json:"id" firestore:"-"`
	OwnerUID            string            `json:"ownerUid" firestore:"ownerUid"`
	DisplayName         string            `json:"displayName" firestore:"displayName"`
	SelectedPathLabel   string            `json:"selectedPathLabel" firestore:"selectedPathLabel"`
	IncludePatterns     []string          `json:"includePatterns" firestore:"includePatterns"`
	FileManifest        []BackupFileEntry `json:"fileManifest" firestore:"fileManifest"`
	LastBackupAt        *time.Time        `json:"lastBackupAt,omitempty" firestore:"lastBackupAt,omitempty"`
	NextManualRenewHint string            `json:"nextManualRenewHint" firestore:"nextManualRenewHint"`
	Enabled             bool              `json:"enabled" firestore:"enabled"`
	CreatedAt           time.Time         `json:"createdAt" firestore:"createdAt"`
	UpdatedAt           time.Time         `json:"updatedAt" firestore:"updatedAt"`
}

type BackupFileEntry struct {
	RelativePath string `json:"relativePath" firestore:"relativePath"`
	SizeBytes    int64  `json:"sizeBytes" firestore:"sizeBytes"`
	LastModified int64  `json:"lastModified" firestore:"lastModified"`
}

type BackupRun struct {
	ID            string    `json:"id" firestore:"-"`
	PlanID        string    `json:"planId" firestore:"planId"`
	OwnerUID      string    `json:"ownerUid" firestore:"ownerUid"`
	StartedAt     time.Time `json:"startedAt" firestore:"startedAt"`
	FinishedAt    time.Time `json:"finishedAt" firestore:"finishedAt"`
	Status        string    `json:"status" firestore:"status"`
	FileCount     int       `json:"fileCount" firestore:"fileCount"`
	SkippedCount  int       `json:"skippedCount" firestore:"skippedCount"`
	BytesUploaded int64     `json:"bytesUploaded" firestore:"bytesUploaded"`
	Errors        []string  `json:"errors" firestore:"errors"`
}

type DeviceToken struct {
	Token     string    `json:"token" firestore:"token"`
	Platform  string    `json:"platform" firestore:"platform"`
	CreatedAt time.Time `json:"createdAt" firestore:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt" firestore:"updatedAt"`
}
