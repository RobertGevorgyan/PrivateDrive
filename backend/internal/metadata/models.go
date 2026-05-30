package metadata

import "time"

type FileRecord struct {
	ID        string    `json:"id" firestore:"-"`
	OwnerUID  string    `json:"ownerUid" firestore:"ownerUid"`
	ObjectKey string    `json:"objectKey" firestore:"objectKey"`
	Filename  string    `json:"filename" firestore:"filename"`
	MimeType  string    `json:"mimeType" firestore:"mimeType"`
	SizeBytes int64     `json:"sizeBytes" firestore:"sizeBytes"`
	Status    string    `json:"status" firestore:"status"`
	Tags      []string  `json:"tags" firestore:"tags"`
	Shared    bool      `json:"shared" firestore:"shared"`
	CreatedAt time.Time `json:"createdAt" firestore:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt" firestore:"updatedAt"`
}

type BackupPlan struct {
	ID                  string     `json:"id" firestore:"-"`
	OwnerUID            string     `json:"ownerUid" firestore:"ownerUid"`
	DisplayName         string     `json:"displayName" firestore:"displayName"`
	SelectedPathLabel   string     `json:"selectedPathLabel" firestore:"selectedPathLabel"`
	IncludePatterns     []string   `json:"includePatterns" firestore:"includePatterns"`
	LastBackupAt        *time.Time `json:"lastBackupAt,omitempty" firestore:"lastBackupAt,omitempty"`
	NextManualRenewHint string     `json:"nextManualRenewHint" firestore:"nextManualRenewHint"`
	Enabled             bool       `json:"enabled" firestore:"enabled"`
	CreatedAt           time.Time  `json:"createdAt" firestore:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt" firestore:"updatedAt"`
}

type BackupRun struct {
	ID            string    `json:"id" firestore:"-"`
	PlanID        string    `json:"planId" firestore:"planId"`
	OwnerUID      string    `json:"ownerUid" firestore:"ownerUid"`
	StartedAt     time.Time `json:"startedAt" firestore:"startedAt"`
	FinishedAt    time.Time `json:"finishedAt" firestore:"finishedAt"`
	Status        string    `json:"status" firestore:"status"`
	FileCount     int       `json:"fileCount" firestore:"fileCount"`
	BytesUploaded int64     `json:"bytesUploaded" firestore:"bytesUploaded"`
	Errors        []string  `json:"errors" firestore:"errors"`
}

type DeviceToken struct {
	Token     string    `json:"token" firestore:"token"`
	Platform  string    `json:"platform" firestore:"platform"`
	CreatedAt time.Time `json:"createdAt" firestore:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt" firestore:"updatedAt"`
}
