// Package atlas generates thumbnail sprite sheets ("atlases") for all
// gallery zoom levels. Two sizes are produced:
//   - 128px tiles (8x8 grid, 64 photos/sheet) for dense levels (15/30 columns)
//   - 256px tiles (4x4 grid, 16 photos/sheet) for sparse levels (3/5 columns)
//
// Instead of loading one image per photo (~1800 requests for a full
// 30-column screen, ~20 x 47KB requests for a 3-column screen), entire
// screens arrive in a few requests.
package atlas

import (
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"os"
	"path/filepath"
	"sync/atomic"

	"github.com/photoview/photoview/api/graphql/models"
	"github.com/photoview/photoview/api/log"
	"github.com/photoview/photoview/api/utils"
	xdraw "golang.org/x/image/draw"
	"gorm.io/gorm"
)

type atlasMedia struct {
	MediaID  int    `gorm:"column:id"`
	AlbumID  int    `gorm:"column:album_id"`
	TinyName string `gorm:"column:tiny_name"`
	SmallName string `gorm:"column:small_name"`
}

type atlasSpec struct {
	tileSize  int
	gridSize  int
	urlSuffix string // which cached thumbnail to read from
}

var specs = []atlasSpec{
	{models.AtlasTileSmall, models.AtlasGridSmall, "tiny_name"},
	{models.AtlasTileLarge, models.AtlasGridLarge, "small_name"},
}

// RegenerateAllAtlasesAsync rebuilds the atlases of every user in the
// background. Repeated calls while a rebuild is in flight are ignored.
func RegenerateAllAtlasesAsync(db *gorm.DB) {
	var running int32
	if !atomic.CompareAndSwapInt32(&running, 0, 1) {
		return
	}
	go func() {
		defer atomic.StoreInt32(&running, 0)
		if err := RegenerateAllAtlases(db); err != nil {
			log.Error(nil, "Atlas regeneration failed", "error", err)
		}
	}()
}

// RegenerateAllAtlases rebuilds all sprite sheets (both sizes) of every user.
func RegenerateAllAtlases(db *gorm.DB) error {
	var users []models.User
	if err := db.Find(&users).Error; err != nil {
		return fmt.Errorf("atlases: loading users: %w", err)
	}

	for _, user := range users {
		if err := regenerateAtlasesForUser(db, &user); err != nil {
			return fmt.Errorf("atlases: user %d: %w", user.ID, err)
		}
	}
	return nil
}

func atlasDir(userID int) string {
	return filepath.Join(utils.MediaCachePath(), "atlases", fmt.Sprintf("%d", userID))
}

func regenerateAtlasesForUser(db *gorm.DB, user *models.User) error {
	var media []atlasMedia
	err := db.Table("media").
		Select(`media.id as id, media.album_id as album_id,
			tiny.media_name as tiny_name, small.media_name as small_name`).
		Joins("JOIN albums ON media.album_id = albums.id").
		Joins("JOIN user_albums ON user_albums.album_id = albums.id AND user_albums.user_id = ?", user.ID).
		Joins("LEFT JOIN media_urls tiny ON tiny.media_id = media.id AND tiny.purpose = ?", models.PhotoThumbnailTiny).
		Joins("LEFT JOIN media_urls small ON small.media_id = media.id AND small.purpose = ?", models.PhotoThumbnailSmall).
		Where("media.type = ?", models.MediaTypePhoto).
		Where("tiny.media_name IS NOT NULL AND small.media_name IS NOT NULL").
		Order("media.date_shot DESC, media.id DESC").
		Scan(&media).Error
	if err != nil {
		return fmt.Errorf("querying media: %w", err)
	}

	// start from a clean slate: entries reference their atlas via
	// OnDelete:CASCADE, so deleting the atlases removes the entries too
	if err := db.Where("user_id = ?", user.ID).Delete(&models.ThumbnailAtlas{}).Error; err != nil {
		return fmt.Errorf("deleting old atlases: %w", err)
	}

	if len(media) == 0 {
		return nil
	}

	dir := atlasDir(user.ID)
	if err := os.MkdirAll(dir, os.ModePerm); err != nil {
		return fmt.Errorf("creating atlas dir: %w", err)
	}

	for _, spec := range specs {
		if err := generateAtlasSize(db, user, media, dir, spec); err != nil {
			return fmt.Errorf("tileSize %d: %w", spec.tileSize, err)
		}
	}

	log.Info(nil, "Generated thumbnail atlases",
		"user", user.Username, "media", len(media),
		"sheets", (len(media)+63)/64+(len(media)+15)/16)
	return nil
}

func generateAtlasSize(db *gorm.DB, user *models.User, media []atlasMedia, dir string, spec atlasSpec) error {
	chunkSize := spec.gridSize * spec.gridSize
	sheetPx := spec.tileSize * spec.gridSize

	for start := 0; start < len(media); start += chunkSize {
		end := start + chunkSize
		if end > len(media) {
			end = len(media)
		}
		chunk := media[start:end]

		fileName := fmt.Sprintf("atlas-%d-%d-%d.jpg", user.ID, spec.tileSize, start/chunkSize)
		if err := writeAtlasSheet(dir, fileName, chunk, spec, sheetPx); err != nil {
			return fmt.Errorf("writing %s: %w", fileName, err)
		}

		atlasRow := models.ThumbnailAtlas{
			UserID:   user.ID,
			TileSize: spec.tileSize,
			FileName: fileName,
		}
		if err := db.Create(&atlasRow).Error; err != nil {
			return fmt.Errorf("inserting atlas row: %w", err)
		}

		entries := make([]models.ThumbnailAtlasEntry, 0, len(chunk))
		for i, m := range chunk {
			entries = append(entries, models.ThumbnailAtlasEntry{
				ThumbnailAtlasID: atlasRow.ID,
				MediaID:          m.MediaID,
				UserID:           user.ID,
				X:                i % spec.gridSize,
				Y:                i / spec.gridSize,
			})
		}
		if err := db.Create(&entries).Error; err != nil {
			return fmt.Errorf("inserting atlas entries: %w", err)
		}
	}
	return nil
}

// writeAtlasSheet composes thumbnails into a single JPEG sprite sheet.
// Each thumbnail is center-cropped to a square and scaled to the tile size.
func writeAtlasSheet(dir string, fileName string, chunk []atlasMedia, spec atlasSpec, sheetPx int) error {
	canvas := image.NewRGBA(image.Rect(0, 0, sheetPx, sheetPx))

	for i, m := range chunk {
		// pick the cached thumbnail matching this atlas size
		cachedName := m.TinyName
		if spec.tileSize >= models.AtlasTileLarge {
			cachedName = m.SmallName
		}
		if cachedName == "" {
			continue
		}

		tile, err := loadSquareTile(filepath.Join(
			utils.MediaCachePath(),
			fmt.Sprintf("%d", m.AlbumID),
			fmt.Sprintf("%d", m.MediaID),
			cachedName,
		), spec.tileSize)
		if err != nil {
			continue // skip missing; frontend falls back to individual loading
		}
		slot := image.Rect(
			(i%spec.gridSize)*spec.tileSize,
			(i/spec.gridSize)*spec.tileSize,
			(i%spec.gridSize)*spec.tileSize+spec.tileSize,
			(i/spec.gridSize)*spec.tileSize+spec.tileSize,
		)
		draw.Draw(canvas, slot, tile, image.Point{}, draw.Src)
	}

	outPath := filepath.Join(dir, fileName)
	out, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer out.Close()
	return jpeg.Encode(out, canvas, &jpeg.Options{Quality: 75})
}

// loadSquareTile reads a cached thumbnail, center-crops it to a square
// and scales it to the atlas tile size.
func loadSquareTile(path string, tileSize int) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	img, err := jpeg.Decode(f)
	if err != nil {
		return nil, err
	}

	bounds := img.Bounds()
	w := bounds.Dx()
	h := bounds.Dy()
	side := w
	if h < side {
		side = h
	}

	crop := image.Rect(
		bounds.Min.X+(w-side)/2,
		bounds.Min.Y+(h-side)/2,
		bounds.Min.X+(w-side)/2+side,
		bounds.Min.Y+(h-side)/2+side,
	)
	cropped, ok := img.(interface {
		SubImage(r image.Rectangle) image.Image
	})
	if !ok {
		return nil, fmt.Errorf("image does not support SubImage")
	}

	tile := image.NewRGBA(image.Rect(0, 0, tileSize, tileSize))
	xdraw.CatmullRom.Scale(tile, tile.Bounds(), cropped.SubImage(crop), crop, draw.Over, nil)
	return tile, nil
}
