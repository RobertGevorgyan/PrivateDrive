package metadata

import (
	"context"
	"errors"
	"sort"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/google/uuid"
	"google.golang.org/api/iterator"
)

type FirestoreStore struct {
	client *firestore.Client
}

func NewFirestoreStore(client *firestore.Client) *FirestoreStore {
	return &FirestoreStore{client: client}
}

func (s *FirestoreStore) UpsertUser(ctx context.Context, uid, email, name, provider string) error {
	_, err := s.client.Collection("users").Doc(uid).Set(ctx, map[string]any{
		"uid":       uid,
		"email":     email,
		"name":      name,
		"provider":  provider,
		"settings":  map[string]any{"notifications": true, "theme": "system"},
		"updatedAt": time.Now(),
		"createdAt": time.Now(),
	}, firestore.MergeAll)
	return err
}

func (s *FirestoreStore) CreateFile(ctx context.Context, record FileRecord) (FileRecord, error) {
	now := time.Now()
	record.ID = uuid.NewString()
	record.CreatedAt = now
	record.UpdatedAt = now
	if record.Status == "" {
		record.Status = "available"
	}
	_, err := s.client.Collection("files").Doc(record.ID).Set(ctx, record)
	return record, err
}

func (s *FirestoreStore) ListFiles(ctx context.Context, ownerUID string) ([]FileRecord, error) {
	iter := s.client.Collection("files").Where("ownerUid", "==", ownerUID).Documents(ctx)
	defer iter.Stop()
	var out []FileRecord
	for {
		doc, err := iter.Next()
		if errors.Is(err, iterator.Done) {
			sort.Slice(out, func(i, j int) bool {
				return out[i].CreatedAt.After(out[j].CreatedAt)
			})
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		var record FileRecord
		if err := doc.DataTo(&record); err != nil {
			return nil, err
		}
		record.ID = doc.Ref.ID
		out = append(out, record)
	}
}

func (s *FirestoreStore) GetFile(ctx context.Context, ownerUID, id string) (FileRecord, error) {
	doc, err := s.client.Collection("files").Doc(id).Get(ctx)
	if err != nil {
		return FileRecord{}, err
	}
	var record FileRecord
	if err := doc.DataTo(&record); err != nil {
		return FileRecord{}, err
	}
	record.ID = doc.Ref.ID
	if record.OwnerUID != ownerUID {
		return FileRecord{}, errors.New("file not found")
	}
	return record, nil
}

func (s *FirestoreStore) DeleteFile(ctx context.Context, ownerUID, id string) error {
	if _, err := s.GetFile(ctx, ownerUID, id); err != nil {
		return err
	}
	_, err := s.client.Collection("files").Doc(id).Delete(ctx)
	return err
}

func (s *FirestoreStore) CreateBackupPlan(ctx context.Context, plan BackupPlan) (BackupPlan, error) {
	now := time.Now()
	plan.ID = uuid.NewString()
	plan.CreatedAt = now
	plan.UpdatedAt = now
	plan.Enabled = true
	if plan.NextManualRenewHint == "" {
		plan.NextManualRenewHint = "Wybierz pliki z tego folderu i uruchom Renew."
	}
	_, err := s.client.Collection("backupPlans").Doc(plan.ID).Set(ctx, plan)
	return plan, err
}

func (s *FirestoreStore) ListBackupPlans(ctx context.Context, ownerUID string) ([]BackupPlan, error) {
	iter := s.client.Collection("backupPlans").Where("ownerUid", "==", ownerUID).Documents(ctx)
	defer iter.Stop()
	var out []BackupPlan
	for {
		doc, err := iter.Next()
		if errors.Is(err, iterator.Done) {
			sort.Slice(out, func(i, j int) bool {
				return out[i].UpdatedAt.After(out[j].UpdatedAt)
			})
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		var plan BackupPlan
		if err := doc.DataTo(&plan); err != nil {
			return nil, err
		}
		plan.ID = doc.Ref.ID
		out = append(out, plan)
	}
}

func (s *FirestoreStore) GetBackupPlan(ctx context.Context, ownerUID, id string) (BackupPlan, error) {
	doc, err := s.client.Collection("backupPlans").Doc(id).Get(ctx)
	if err != nil {
		return BackupPlan{}, err
	}
	var plan BackupPlan
	if err := doc.DataTo(&plan); err != nil {
		return BackupPlan{}, err
	}
	plan.ID = doc.Ref.ID
	if plan.OwnerUID != ownerUID {
		return BackupPlan{}, errors.New("backup plan not found")
	}
	return plan, nil
}

func (s *FirestoreStore) UpdateBackupPlanLastRun(ctx context.Context, ownerUID, id string, run BackupRun, manifest []BackupFileEntry) (BackupRun, error) {
	plan, err := s.GetBackupPlan(ctx, ownerUID, id)
	if err != nil {
		return BackupRun{}, err
	}
	now := time.Now()
	run.ID = uuid.NewString()
	run.PlanID = plan.ID
	run.OwnerUID = ownerUID
	if run.StartedAt.IsZero() {
		run.StartedAt = now
	}
	if run.FinishedAt.IsZero() {
		run.FinishedAt = now
	}
	if run.Status == "" {
		run.Status = "completed"
	}
	_, err = s.client.Collection("backupRuns").Doc(run.ID).Set(ctx, run)
	if err != nil {
		return BackupRun{}, err
	}
	updates := []firestore.Update{
		{Path: "lastBackupAt", Value: run.FinishedAt},
		{Path: "updatedAt", Value: now},
	}
	if manifest != nil {
		updates = append(updates, firestore.Update{Path: "fileManifest", Value: manifest})
	}
	_, err = s.client.Collection("backupPlans").Doc(id).Update(ctx, updates)
	return run, err
}

func (s *FirestoreStore) ListBackupRuns(ctx context.Context, ownerUID string) ([]BackupRun, error) {
	iter := s.client.Collection("backupRuns").Where("ownerUid", "==", ownerUID).Documents(ctx)
	defer iter.Stop()
	var out []BackupRun
	for {
		doc, err := iter.Next()
		if errors.Is(err, iterator.Done) {
			sort.Slice(out, func(i, j int) bool {
				return out[i].StartedAt.After(out[j].StartedAt)
			})
			if len(out) > 50 {
				out = out[:50]
			}
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		var run BackupRun
		if err := doc.DataTo(&run); err != nil {
			return nil, err
		}
		run.ID = doc.Ref.ID
		out = append(out, run)
	}
}

func (s *FirestoreStore) SaveFCMToken(ctx context.Context, ownerUID string, token DeviceToken) error {
	now := time.Now()
	token.CreatedAt = now
	token.UpdatedAt = now
	_, err := s.client.Collection("users").Doc(ownerUID).Collection("fcmTokens").Doc(token.Token).Set(ctx, token, firestore.MergeAll)
	return err
}
