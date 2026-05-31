package metadata

import "context"

type Store interface {
	UpsertUser(ctx context.Context, uid, email, name, provider string) error
	CreateFile(ctx context.Context, record FileRecord) (FileRecord, error)
	ListFiles(ctx context.Context, ownerUID string) ([]FileRecord, error)
	GetFile(ctx context.Context, ownerUID, id string) (FileRecord, error)
	DeleteFile(ctx context.Context, ownerUID, id string) error
	CreateBackupPlan(ctx context.Context, plan BackupPlan) (BackupPlan, error)
	ListBackupPlans(ctx context.Context, ownerUID string) ([]BackupPlan, error)
	GetBackupPlan(ctx context.Context, ownerUID, id string) (BackupPlan, error)
	UpdateBackupPlanLastRun(ctx context.Context, ownerUID, id string, run BackupRun, manifest []BackupFileEntry) (BackupRun, error)
	ListBackupRuns(ctx context.Context, ownerUID string) ([]BackupRun, error)
	SaveFCMToken(ctx context.Context, ownerUID string, token DeviceToken) error
}
