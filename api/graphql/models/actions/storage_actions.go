package actions

import (
	"os"
	"path/filepath"
	"syscall"

	"github.com/photoview/photoview/api/graphql/models"
	"github.com/photoview/photoview/api/utils"
	"gorm.io/gorm"
)

// GetStorageStats returns filesystem capacity and media statistics.
func GetStorageStats(db *gorm.DB) (*models.StorageStats, error) {
	cachePath := utils.MediaCachePath()

	// filesystem stats via statfs
	var stat syscall.Statfs_t
	if err := syscall.Statfs(cachePath, &stat); err != nil {
		return nil, err
	}

	totalBytes := int64(stat.Blocks) * int64(stat.Bsize)
	freeBytes := int64(stat.Bfree) * int64(stat.Bsize)
	usedBytes := totalBytes - freeBytes

	// media cache size (walk the cache dir)
	var mediaCacheBytes int64
	filepath.Walk(cachePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // skip errors
		}
		if !info.IsDir() {
			mediaCacheBytes += info.Size()
		}
		return nil
	})

	// average original photo size
	var totalSize int64
	var count int64
	db.Table("media_urls").
		Select("COALESCE(SUM(file_size), 0) as total, COUNT(*) as cnt").
		Where("purpose = ?", "original").
		Scan(&struct {
			Total int64 `gorm:"column:total"`
			Cnt   int64 `gorm:"column:cnt"`
		}{})

	db.Table("media_urls").
		Where("purpose = ?", "original").
		Select("SUM(file_size)").Row().Scan(&totalSize)
	db.Table("media_urls").
		Where("purpose = ?", "original").
		Count(&count)

	avgPhotoSize := int64(0)
	if count > 0 && totalSize > 0 {
		avgPhotoSize = totalSize / count
	}

	estimatedRemaining := int64(0)
	if avgPhotoSize > 0 {
		estimatedRemaining = freeBytes / avgPhotoSize
	}

	return &models.StorageStats{
		TotalBytes:              int(totalBytes),
		UsedBytes:               int(usedBytes),
		FreeBytes:               int(freeBytes),
		MediaCacheBytes:         int(mediaCacheBytes),
		AveragePhotoSize:        int(avgPhotoSize),
		EstimatedRemainingPhotos: int(estimatedRemaining),
	}, nil
}
