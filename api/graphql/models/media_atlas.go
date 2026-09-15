package models

// ThumbnailAtlas bundles many thumbnails of one user into a single JPEG
// sprite sheet, so gallery views can load a whole screen of photos with
// a handful of requests instead of one request per photo.
//
// Two sizes are generated:
//   - 128px tiles (8x8 grid, 64 photos/sheet) for dense zoom levels
//   - 256px tiles (4x4 grid, 16 photos/sheet) for sparse zoom levels
type ThumbnailAtlas struct {
	Model
	UserID   int                    `gorm:"not null;index"`
	TileSize int                    `gorm:"not null"` // 128 or 256
	FileName string                 `gorm:"not null;uniqueIndex"`
	Entries  []ThumbnailAtlasEntry `gorm:"constraint:OnDelete:CASCADE;"`
}

func (ThumbnailAtlas) TableName() string {
	return "thumbnail_atlases"
}

// ThumbnailAtlasEntry maps a single media into its position in an atlas.
// A media appears in one atlas per (user, tileSize) combination.
type ThumbnailAtlasEntry struct {
	Model
	ThumbnailAtlasID int `gorm:"not null;index"`
	MediaID          int `gorm:"not null;index:idx_atlas_user_media"`
	UserID           int `gorm:"not null;index:idx_atlas_user_media"`
	X                int `gorm:"not null"`
	Y                int `gorm:"not null"`
}

func (ThumbnailAtlasEntry) TableName() string {
	return "thumbnail_atlas_entries"
}

// Atlas tile sizes and their grid geometries.
const (
	AtlasTileSmall = 128 // dense levels (15/30 columns)
	AtlasTileLarge = 256 // sparse levels (3/5 columns)

	AtlasGridSmall = 8 // 8x8 = 64 photos per 1024x1024 sheet
	AtlasGridLarge = 4 // 4x4 = 16 photos per 1024x1024 sheet
)

// AtlasGridSizeForTile returns the grid dimension for a tile size.
func AtlasGridSizeForTile(tileSize int) int {
	if tileSize >= AtlasTileLarge {
		return AtlasGridLarge
	}
	return AtlasGridSmall
}
