package actions

import (
	"fmt"
	"os"
	"time"

	"github.com/photoview/photoview/api/graphql/models"
	"github.com/photoview/photoview/api/log"
	"gorm.io/gorm"
)

// TrashRetentionDays is how long media stays in the trash before auto-purge.
const TrashRetentionDays = 30

// PermanentlyDeleteMedia removes the media file, cache directory and DB records.
func PermanentlyDeleteMedia(tx *gorm.DB, media *models.Media) error {
	// remove original file
	if err := os.Remove(media.Path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("removing original file %s: %w", media.Path, err)
	}

	// remove cache directory (thumbnails, transcodes)
	cachePath, err := media.CachePath()
	if err == nil {
		if err := os.RemoveAll(cachePath); err != nil {
			return fmt.Errorf("removing cache dir %s: %w", cachePath, err)
		}
	}

	// remove DB record (cascades to MediaURL, EXIF, Faces)
	if err := tx.Delete(media).Error; err != nil {
		return fmt.Errorf("deleting DB record: %w", err)
	}

	return nil
}

// PurgeExpiredTrash deletes all media that has been in the trash longer
// than the retention period.
func PurgeExpiredTrash(db *gorm.DB) {
	cutoff := time.Now().AddDate(0, 0, -TrashRetentionDays)

	var media []*models.Media
	if err := db.Where("deleted_at IS NOT NULL AND deleted_at < ?", cutoff).
		Find(&media).Error; err != nil {
		log.Error(nil, "PurgeExpiredTrash query failed", "error", err)
		return
	}

	for _, m := range media {
		if err := PermanentlyDeleteMedia(db, m); err != nil {
			log.Error(nil, "PurgeExpiredTrash: failed to delete", "id", m.ID, "error", err)
		} else {
			log.Info(nil, "Purged expired trash media", "id", m.ID, "path", m.Path)
		}
	}
}
