package models

import "gorm.io/gorm"

// NotDeleted filters out soft-deleted (trashed) media from a query.
// Apply this to every query that lists media for normal browsing.
func NotDeleted(db *gorm.DB) *gorm.DB {
	return db.Where("media.deleted_at IS NULL")
}

// IsDeleted filters for soft-deleted (trashed) media only.
func IsDeleted(db *gorm.DB) *gorm.DB {
	return db.Where("media.deleted_at IS NOT NULL")
}
