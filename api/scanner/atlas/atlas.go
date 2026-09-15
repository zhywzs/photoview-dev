// Package atlas generates thumbnail sprite sheets ("atlases") for the
// dense gallery zoom levels: instead of loading one image per photo
// (~1800 requests for a full 30-column screen), the photos of a user are
// bundled into 8x8 grids of 128px tiles, so a screen-full of thumbnails
// arrives in a few dozen requests.
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

const (
	tileSize  = models.AtlasTileSizePx
	gridSize  = models.AtlasGridSize
	sheetSize = tileSize * gridSize // 1024
	chunkSize = gridSize * gridSize // 64 media per atlas
)

type atlasMedia struct {
	MediaID  int    `gorm:"column:id"`
	AlbumID  int    `gorm:"column:album_id"`
	TinyName string `gorm:"column:tiny_name"`
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

// RegenerateAllAtlases rebuilds the sprite sheets of every user.
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
		Select("media.id as id, media.album_id as album_id, media_urls.media_name as tiny_name").
		Joins("JOIN albums ON media.album_id = albums.id").
		Joins("JOIN user_albums ON user_albums.album_id = albums.id AND user_albums.user_id = ?", user.ID).
		Joins("JOIN media_urls ON media_urls.media_id = media.id AND media_urls.purpose = ?", models.PhotoThumbnailTiny).
		Where("media.type = ?", models.MediaTypePhoto).
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

	for start := 0; start < len(media); start += chunkSize {
		end := start + chunkSize
		if end > len(media) {
			end = len(media)
		}
		chunk := media[start:end]

		fileName := fmt.Sprintf("atlas-%d-%d.jpg", user.ID, start/chunkSize)
		if err := writeAtlasSheet(dir, fileName, chunk); err != nil {
			return fmt.Errorf("writing %s: %w", fileName, err)
		}

		atlasRow := models.ThumbnailAtlas{
			UserID:   user.ID,
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
				X:                i % gridSize,
				Y:                i / gridSize,
			})
		}
		if err := db.Create(&entries).Error; err != nil {
			return fmt.Errorf("inserting atlas entries: %w", err)
		}
	}

	log.Info(nil, "Generated thumbnail atlases", "user", user.Username, "media", len(media), "sheets", (len(media)+chunkSize-1)/chunkSize)
	return nil
}

// writeAtlasSheet composes up to 64 tiny thumbnails into one 1024x1024
// JPEG. Each thumbnail is center-cropped to a square and scaled to the
// 128px tile, matching how tiles are displayed in the grid.
func writeAtlasSheet(dir string, fileName string, chunk []atlasMedia) error {
	canvas := image.NewRGBA(image.Rect(0, 0, sheetSize, sheetSize))

	for i, m := range chunk {
		tile, err := loadSquareTile(filepath.Join(
			utils.MediaCachePath(),
			fmt.Sprintf("%d", m.AlbumID),
			fmt.Sprintf("%d", m.MediaID),
			m.TinyName,
		))
		if err != nil {
			// skip photos whose tiny thumbnail is missing; the frontend
			// falls back to loading them individually
			continue
		}
		slot := image.Rect(
			(i%gridSize)*tileSize,
			(i/gridSize)*tileSize,
			(i%gridSize)*tileSize+tileSize,
			(i/gridSize)*tileSize+tileSize,
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

// loadSquareTile reads a tiny thumbnail, center-crops it to a square and
// scales it to the atlas tile size.
func loadSquareTile(path string) (image.Image, error) {
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

	// center square crop
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
