package models

// ThumbnailAtlas bundles many tiny thumbnails of one user into a single
// JPEG sprite sheet, so dense gallery views can load hundreds of photos
// with a handful of requests instead of one request per photo.
type ThumbnailAtlas struct {
	Model
	UserID   int                    `gorm:"not null;index"`
	FileName string                 `gorm:"not null;uniqueIndex"`
	Entries  []ThumbnailAtlasEntry `gorm:"constraint:OnDelete:CASCADE;"`
}

func (ThumbnailAtlas) TableName() string {
	return "thumbnail_atlases"
}

// ThumbnailAtlasEntry maps a single media into its position in an atlas.
// (user, media) is unique: a media appears in at most one atlas per user.
type ThumbnailAtlasEntry struct {
	Model
	ThumbnailAtlasID int `gorm:"not null;index"`
	MediaID          int `gorm:"not null;uniqueIndex:idx_atlas_user_media"`
	UserID           int `gorm:"not null;uniqueIndex:idx_atlas_user_media"`
	X                int `gorm:"not null"`
	Y                int `gorm:"not null"`
}

func (ThumbnailAtlasEntry) TableName() string {
	return "thumbnail_atlas_entries"
}

// Atlas geometry: a fixed 8x8 grid of 128px tiles => 1024x1024 sheets.
const (
	AtlasTileSizePx = 128
	AtlasGridSize   = 8
)
