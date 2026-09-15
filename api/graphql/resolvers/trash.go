package resolvers

import (
	"context"
	"fmt"
	"time"

	"github.com/photoview/photoview/api/graphql/auth"
	"github.com/photoview/photoview/api/graphql/models"
	"github.com/photoview/photoview/api/graphql/models/actions"
	"github.com/photoview/photoview/api/utils"
	"gorm.io/gorm"
)

// MyTrash is the resolver for the myTrash field.
func (r *queryResolver) MyTrash(ctx context.Context) ([]*models.TrashedMedia, error) {
	user := auth.UserFromContext(ctx)
	if user == nil {
		return nil, auth.ErrUnauthorized
	}

	type trashRow struct {
		ID                int       `gorm:"column:id"`
		Title             string    `gorm:"column:title"`
		DeletedAt         time.Time `gorm:"column:deleted_at"`
		OriginalAlbumPath string    `gorm:"column:original_album_path"`
		ThumbnailName     *string   `gorm:"column:thumbnail_name"`
		FileSize          *int64    `gorm:"column:file_size"`
	}

	var rows []trashRow
	err := r.DB(ctx).Table("media").
		Select(`media.id, media.title, media.deleted_at,
			albums.path AS original_album_path,
			(SELECT media_urls.media_name FROM media_urls
			 WHERE media_urls.media_id = media.id AND media_urls.purpose = 'thumbnail'
			 LIMIT 1) AS thumbnail_name,
			(SELECT media_urls.file_size FROM media_urls
			 WHERE media_urls.media_id = media.id AND media_urls.purpose = 'original'
			 LIMIT 1) AS file_size`).
		Joins("JOIN albums ON media.album_id = albums.id").
		Joins("JOIN user_albums ON albums.id = user_albums.album_id AND user_albums.user_id = ?", user.ID).
		Where("media.deleted_at IS NOT NULL").
		Order("media.deleted_at DESC").
		Scan(&rows).Error

	if err != nil {
		return nil, fmt.Errorf("querying trash: %w", err)
	}

	result := make([]*models.TrashedMedia, 0, len(rows))
	for _, row := range rows {
		daysRemaining := actions.TrashRetentionDays - int(time.Since(row.DeletedAt).Hours()/24)
		if daysRemaining < 0 {
			daysRemaining = 0
		}

		item := &models.TrashedMedia{
			ID:                row.ID,
			Title:             row.Title,
			OriginalAlbumPath: row.OriginalAlbumPath,
			DeletedAt:         row.DeletedAt,
			DaysRemaining:     daysRemaining,
		}

		if row.ThumbnailName != nil {
			endpoint := utils.ApiEndpointUrl()
			endpoint.Path = endpoint.Path + "/photo/" + *row.ThumbnailName
			url := endpoint.String()
			item.ThumbnailURL = &url
		}

		if row.FileSize != nil {
			item.FileSize = int(*row.FileSize)
		}

		result = append(result, item)
	}

	return result, nil
}

// DeleteMedia is the resolver for the deleteMedia field.
func (r *mutationResolver) DeleteMedia(ctx context.Context, mediaID int) (bool, error) {
	user := auth.UserFromContext(ctx)
	if user == nil {
		return false, auth.ErrUnauthorized
	}

	var count int64
	r.DB(ctx).Table("media").
		Joins("JOIN albums ON media.album_id = albums.id").
		Joins("JOIN user_albums ON albums.id = user_albums.album_id AND user_albums.user_id = ?", user.ID).
		Where("media.id = ? AND media.deleted_at IS NULL", mediaID).
		Count(&count)
	if count == 0 {
		return false, fmt.Errorf("media not found or not owned by user")
	}

	now := time.Now()
	if err := r.DB(ctx).Model(&models.Media{}).Where("id = ?", mediaID).
		Update("deleted_at", now).Error; err != nil {
		return false, fmt.Errorf("deleting media: %w", err)
	}

	return true, nil
}

// RestoreMedia is the resolver for the restoreMedia field.
func (r *mutationResolver) RestoreMedia(ctx context.Context, mediaID int) (bool, error) {
	user := auth.UserFromContext(ctx)
	if user == nil {
		return false, auth.ErrUnauthorized
	}

	var count int64
	r.DB(ctx).Table("media").
		Joins("JOIN albums ON media.album_id = albums.id").
		Joins("JOIN user_albums ON albums.id = user_albums.album_id AND user_albums.user_id = ?", user.ID).
		Where("media.id = ? AND media.deleted_at IS NOT NULL", mediaID).
		Count(&count)
	if count == 0 {
		return false, fmt.Errorf("media not found in trash")
	}

	if err := r.DB(ctx).Model(&models.Media{}).Where("id = ?", mediaID).
		Update("deleted_at", nil).Error; err != nil {
		return false, fmt.Errorf("restoring media: %w", err)
	}

	return true, nil
}

// PermanentlyDeleteMedia is the resolver for the permanentlyDeleteMedia field.
func (r *mutationResolver) PermanentlyDeleteMedia(ctx context.Context, mediaID int) (bool, error) {
	user := auth.UserFromContext(ctx)
	if user == nil {
		return false, auth.ErrUnauthorized
	}

	var media models.Media
	err := r.DB(ctx).
		Joins("JOIN albums ON media.album_id = albums.id").
		Joins("JOIN user_albums ON albums.id = user_albums.album_id AND user_albums.user_id = ?", user.ID).
		Where("media.id = ? AND media.deleted_at IS NOT NULL", mediaID).
		First(&media).Error
	if err != nil {
		return false, fmt.Errorf("media not found in trash: %w", err)
	}

	if err := actions.PermanentlyDeleteMedia(r.DB(ctx), &media); err != nil {
		return false, err
	}

	return true, nil
}

// EmptyTrash is the resolver for the emptyTrash field.
func (r *mutationResolver) EmptyTrash(ctx context.Context) (int, error) {
	user := auth.UserFromContext(ctx)
	if user == nil || !user.Admin {
		return 0, auth.ErrUnauthorized
	}

	var media []*models.Media
	if err := r.DB(ctx).Where("deleted_at IS NOT NULL").Find(&media).Error; err != nil {
		return 0, fmt.Errorf("querying trash: %w", err)
	}

	deleted := 0
	for _, m := range media {
		if err := actions.PermanentlyDeleteMedia(r.DB(ctx), m); err != nil {
			continue
		}
		deleted++
	}

	return deleted, nil
}

// StorageStats is the resolver for the storageStats field.
func (r *queryResolver) StorageStats(ctx context.Context) (*models.StorageStats, error) {
	user := auth.UserFromContext(ctx)
	if user == nil || !user.Admin {
		return nil, auth.ErrUnauthorized
	}

	stats, err := actions.GetStorageStats(r.DB(ctx))
	if err != nil {
		return nil, err
	}
	return stats, nil
}

var _ = gorm.DB{} // ensure gorm import isn't flagged as unused
