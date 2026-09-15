package routes

import (
	"fmt"
	"net/http"
	"path/filepath"

	"github.com/gorilla/mux"
	"gorm.io/gorm"

	"github.com/photoview/photoview/api/graphql/auth"
	"github.com/photoview/photoview/api/graphql/models"
	"github.com/photoview/photoview/api/utils"
)

// RegisterAtlasRoutes serves the thumbnail sprite sheets. An atlas belongs
// to a single user and only that user (or an admin) may fetch it, so a
// sheet never leaks photos across users.
func RegisterAtlasRoutes(db *gorm.DB, router *mux.Router) {
	router.HandleFunc("/{name}", func(w http.ResponseWriter, r *http.Request) {
		fileName := mux.Vars(r)["name"]

		var atlas models.ThumbnailAtlas
		if err := db.Where("file_name = ?", fileName).First(&atlas).Error; err != nil {
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte("404 - Atlas not found"))
			return
		}

		user := auth.UserFromContext(r.Context())
		if user == nil || (user.ID != atlas.UserID && !user.Admin) {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("401 - Unauthorized"))
			return
		}

		atlasPath := filepath.Join(utils.MediaCachePath(), "atlases",
			fmt.Sprintf("%d", atlas.UserID), atlas.FileName)

		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.Header().Set("Content-Type", "image/jpeg")
		http.ServeFile(w, r, atlasPath)
	})
}
