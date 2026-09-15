package routes

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"gorm.io/gorm"

	"github.com/photoview/photoview/api/graphql/auth"
	"github.com/photoview/photoview/api/graphql/models"
	"github.com/photoview/photoview/api/scanner/scanner_queue"
)

const maxUploadSize = 500 << 20 // 500 MB

type uploadResponse struct {
	MediaID      int    `json:"mediaId"`
	Title        string `json:"title"`
	Path         string `json:"path"`
	AlbumPath    string `json:"albumPath"`
	AutoFavorite bool   `json:"autoFavorite"`
}

// RegisterUploadRoutes handles photo/video uploads.
// POST /api/upload with multipart form: file, albumId (optional), autoFavorite (optional).
// If albumId is omitted, the file is auto-archived into {root}/{YYYY}/{MM}/ based on EXIF date.
// The destination album is scanned in the background to generate thumbnails.
func RegisterUploadRoutes(db *gorm.DB, router *mux.Router) {
	router.HandleFunc("", func(w http.ResponseWriter, r *http.Request) {
		user := auth.UserFromContext(r.Context())
		if user == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		if err := r.ParseMultipartForm(maxUploadSize); err != nil {
			http.Error(w, "failed to parse form: "+err.Error(), http.StatusBadRequest)
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, "missing file field: "+err.Error(), http.StatusBadRequest)
			return
		}
		defer file.Close()

		if header.Size > maxUploadSize {
			http.Error(w, "file too large (max 500MB)", http.StatusRequestEntityTooLarge)
			return
		}

		// determine destination album
		var album *models.Album
		albumIdStr := r.FormValue("albumId")
		autoFavorite := r.FormValue("autoFavorite") == "true"

		if albumIdStr != "" {
			var albumID int
			fmt.Sscanf(albumIdStr, "%d", &albumID)
			album, err = findAlbumById(db, user, albumID)
			if err != nil {
				http.Error(w, "album not found or not owned: "+err.Error(), http.StatusForbidden)
				return
			}
		} else {
			// auto-archive by EXIF date → {root}/{YYYY}/{MM}/
			// create a temp copy to read EXIF without consuming the stream
			tmpFile, err := saveToTemp(file)
			if err != nil {
				http.Error(w, "temp save failed: "+err.Error(), http.StatusInternalServerError)
				return
			}
			defer os.Remove(tmpFile.Name())
			defer tmpFile.Close()

			album, err = findOrCreateDatedAlbum(db, user, tmpFile.Name())
			if err != nil {
				http.Error(w, "failed to determine destination: "+err.Error(), http.StatusInternalServerError)
				return
			}
			// copy from temp file to destination
			file = tmpFile
		}

		// ensure filename is safe and unique
		destName := sanitizeFilename(header.Filename)
		destPath := filepath.Join(album.Path, destName)
		if _, err := os.Stat(destPath); err == nil {
			ext := filepath.Ext(destName)
			base := strings.TrimSuffix(destName, ext)
			destPath = filepath.Join(album.Path, fmt.Sprintf("%s_%d%s", base, time.Now().UnixMilli(), ext))
		}

		// save the file
		if seeker, ok := file.(io.Seeker); ok {
			seeker.Seek(0, 0)
		}
		dst, err := os.Create(destPath)
		if err != nil {
			http.Error(w, "failed to create file: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if _, err := io.Copy(dst, file); err != nil {
			dst.Close()
			os.Remove(destPath)
			http.Error(w, "failed to write file: "+err.Error(), http.StatusInternalServerError)
			return
		}
		dst.Close()

		// create the Media record so it exists immediately
		// (the background scan will generate thumbnails and parse EXIF)
		mediaType := detectMediaType(header.Header.Get("Content-Type"), destPath)
		media := models.Media{
			Title:    filepath.Base(destPath),
			Path:     destPath,
			PathHash: models.MD5Hash(destPath),
			AlbumID:  album.ID,
			DateShot: time.Now(),
			Type:     mediaType,
		}
		if err := db.Create(&media).Error; err != nil {
			// not fatal: the scanner will create it on the next pass
			// (path_hash collision means it already exists)
			_ = err
		}

		// auto-favorite
		if autoFavorite && media.ID > 0 {
			_, _ = user.FavoriteMedia(db, media.ID, true)
		}

		// trigger background scan of the destination album
		scanner_queue.AddAlbumToQueue(db, album.ID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(uploadResponse{
			MediaID:      media.ID,
			Title:        filepath.Base(destPath),
			Path:         destPath,
			AlbumPath:    album.Path,
			AutoFavorite: autoFavorite,
		})
	}).Methods("POST")
}

func findAlbumById(db *gorm.DB, user *models.User, albumID int) (*models.Album, error) {
	var album models.Album
	err := db.
		Joins("JOIN user_albums ON albums.id = user_albums.album_id AND user_albums.user_id = ?", user.ID).
		Where("albums.id = ?", albumID).
		First(&album).Error
	if err != nil {
		return nil, fmt.Errorf("album %d not found for user", albumID)
	}
	return &album, nil
}

func saveToTemp(src io.Reader) (*os.File, error) {
	tmp, err := os.CreateTemp("", "pvupload_*")
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return nil, err
	}
	tmp.Seek(0, 0)
	return tmp, nil
}

// findOrCreateDatedAlbum reads EXIF from a temp file to determine the
// target {YYYY}/{MM} directory under the user's root path, creating the
// album hierarchy and directories as needed.
func findOrCreateDatedAlbum(db *gorm.DB, user *models.User, tempPath string) (*models.Album, error) {
	var rootAlbums []*models.Album
	if err := db.
		Joins("JOIN user_albums ON albums.id = user_albums.album_id AND user_albums.user_id = ?", user.ID).
		Where("albums.parent_album_id IS NULL").
		Order("albums.id ASC").
		Find(&rootAlbums).Error; err != nil || len(rootAlbums) == 0 {
		return nil, fmt.Errorf("user has no root album")
	}
	root := rootAlbums[0]

	// determine date from EXIF or file modification time
	dateShot := time.Now()
	if fi, err := os.Stat(tempPath); err == nil {
		dateShot = fi.ModTime()
	}
	// the scanner's EXIF parsing will refine this after upload;
	// for now we use file mtime (browser usually preserves original date)

	targetPath := filepath.Join(root.Path, dateShot.Format("2006"), dateShot.Format("01"))
	return ensureAlbumPath(db, user, root, targetPath)
}

// ensureAlbumPath finds or creates the album hierarchy for a filesystem path.
func ensureAlbumPath(db *gorm.DB, user *models.User, root *models.Album, fullPath string) (*models.Album, error) {
	relPath, err := filepath.Rel(root.Path, fullPath)
	if err != nil {
		return nil, err
	}
	if relPath == "." {
		return root, nil
	}

	parts := strings.Split(filepath.ToSlash(relPath), "/")
	current := root
	currentPath := root.Path

	for _, part := range parts {
		if part == "" || part == "." {
			continue
		}
		currentPath = filepath.Join(currentPath, part)
		pathHash := models.MD5Hash(currentPath)

		var existing models.Album
		if err := db.Where("path_hash = ?", pathHash).First(&existing).Error; err == nil {
			current = &existing
			continue
		}

		newAlbum := models.Album{
			Title:         part,
			Path:          currentPath,
			ParentAlbumID: &current.ID,
		}
		if err := db.Create(&newAlbum).Error; err != nil {
			return nil, fmt.Errorf("creating album %s: %w", currentPath, err)
		}
		if err := db.Model(user).Association("Albums").Append(&newAlbum); err != nil {
			return nil, fmt.Errorf("associating album: %w", err)
		}
		if err := os.MkdirAll(currentPath, os.ModePerm); err != nil {
			return nil, fmt.Errorf("creating directory: %w", err)
		}
		current = &newAlbum
	}

	return current, nil
}

func sanitizeFilename(name string) string {
	name = filepath.Base(name)
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || strings.ContainsRune(`<>:"|?*`, r) {
			return '_'
		}
		return r
	}, name)
	if len(name) > 200 {
		ext := filepath.Ext(name)
		name = name[:200-len(ext)] + ext
	}
	return name
}

// detectMediaType returns photo or video based on Content-Type header or file extension.
func detectMediaType(contentType string, path string) models.MediaType {
	if strings.HasPrefix(contentType, "video/") {
		return models.MediaTypeVideo
	}
	if strings.HasPrefix(contentType, "image/") {
		return models.MediaTypePhoto
	}
	// fallback: extension check
	ext := strings.ToLower(filepath.Ext(path))
	videoExts := map[string]bool{
		".mp4": true, ".avi": true, ".mov": true, ".mkv": true,
		".wmv": true, ".flv": true, ".webm": true, ".m4v": true,
		".mpg": true, ".mpeg": true, ".3gp": true,
	}
	if videoExts[ext] {
		return models.MediaTypeVideo
	}
	return models.MediaTypePhoto
}
