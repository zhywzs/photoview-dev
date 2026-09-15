package actions

import (
	"strings"
	"time"

	"github.com/photoview/photoview/api/database/drivers"
	"github.com/photoview/photoview/api/graphql/models"
	"github.com/pkg/errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// textMatchConditions returns a SQL expression matching media by free text
// across title, path, EXIF fields (camera, maker, lens, description) and
// face group labels. wild must be a lower-cased `%query%` pattern.
func textMatchConditions(wild string) string {
	return `(LOWER(media.title) LIKE ?
	OR LOWER(media.path) LIKE ?
	OR EXISTS (SELECT 1 FROM media_exif WHERE media_exif.id = media.exif_id AND
		(media_exif.camera IS NOT NULL AND LOWER(media_exif.camera) LIKE ?
		OR media_exif.maker IS NOT NULL AND LOWER(media_exif.maker) LIKE ?
		OR media_exif.lens IS NOT NULL AND LOWER(media_exif.lens) LIKE ?
		OR media_exif.description IS NOT NULL AND LOWER(media_exif.description) LIKE ?))
	OR EXISTS (SELECT 1 FROM image_faces
		JOIN face_groups ON face_groups.id = image_faces.face_group_id
		WHERE image_faces.media_id = media.id
		AND face_groups.label IS NOT NULL
		AND LOWER(face_groups.label) LIKE ?))`
}

func textMatchVars(wild string) []interface{} {
	return []interface{}{wild, wild, wild, wild, wild, wild, wild}
}

// ownedMediaScope restricts a query on media to albums owned by the user.
func ownedMediaScope(db *gorm.DB, userID int) *gorm.DB {
	return db.
		Joins("JOIN albums ON media.album_id = albums.id").
		Where("albums.id IN (?)", db.Table("user_albums").Select("user_albums.album_id").Where("user_id = ?", userID)).
		Where("media.deleted_at IS NULL")
}

func Search(db *gorm.DB, query string, userID int, limitMedia *int, limitAlbums *int) (*models.SearchResult, error) {
	limitMediaInternal := 10
	limitAlbumsInternal := 10

	if limitMedia != nil {
		limitMediaInternal = *limitMedia
	}

	if limitAlbums != nil {
		limitAlbumsInternal = *limitAlbums
	}

	wildQuery := "%" + strings.ToLower(query) + "%"

	var media []*models.Media

	userSubquery := db.Table("user_albums").Where("user_id = ?", userID)
	if drivers.POSTGRES.MatchDatabase(db) {
		userSubquery = userSubquery.Where("album_id = \"Album\".id")
	} else {
		userSubquery = userSubquery.Where("album_id = Album.id")
	}

	err := db.Joins("Album").
		Where("EXISTS (?)", userSubquery).
		Where("media.deleted_at IS NULL").
		Where("("+textMatchConditions(wildQuery)+")", textMatchVars(wildQuery)...).
		Clauses(clause.OrderBy{
			Expression: clause.Expr{
				SQL:                "(CASE WHEN LOWER(media.title) LIKE ? THEN 2 WHEN LOWER(media.path) LIKE ? THEN 1 ELSE 0 END) DESC",
				Vars:               []interface{}{wildQuery, wildQuery},
				WithoutParentheses: true},
		}).
		Limit(limitMediaInternal).Find(&media).Error

	if err != nil {
		return nil, errors.Wrapf(err, "searching media")
	}

	var albums []*models.Album

	err = db.
		Where("EXISTS (?)", db.Table("user_albums").Where("user_id = ?", userID).Where("album_id = albums.id")).
		Where("LOWER(albums.title) LIKE ? OR LOWER(albums.path) LIKE ?", wildQuery, wildQuery).
		Clauses(clause.OrderBy{
			Expression: clause.Expr{
				SQL:                "(CASE WHEN LOWER(albums.title) LIKE ? THEN 2 WHEN LOWER(albums.path) LIKE ? THEN 1 ELSE 0 END) DESC",
				Vars:               []interface{}{wildQuery, wildQuery},
				WithoutParentheses: true},
		}).
		Limit(limitAlbumsInternal).
		Find(&albums).Error

	if err != nil {
		return nil, errors.Wrapf(err, "searching albums")
	}

	// Search face groups by label
	faceGroups := []*models.FaceGroup{}
	err = db.
		Where("label IS NOT NULL AND LOWER(label) LIKE ?", wildQuery).
		Where("EXISTS (?)", db.Table("image_faces").
			Select("image_faces.id").
			Joins("JOIN media ON image_faces.media_id = media.id").
			Joins("JOIN albums ON media.album_id = albums.id").
			Where("albums.id IN (?)", db.Table("user_albums").Select("user_albums.album_id").Where("user_id = ?", userID)).
			Where("image_faces.face_group_id = face_groups.id")).
		Limit(limitAlbumsInternal).
		Find(&faceGroups).Error

	if err != nil {
		return nil, errors.Wrapf(err, "searching face groups")
	}

	result := models.SearchResult{
		Query:      query,
		Media:      media,
		Albums:     albums,
		FaceGroups: faceGroups,
	}

	return &result, nil
}

// FilterMedia returns media matching the given filters, ordered by date shot (newest first).
func FilterMedia(db *gorm.DB, user *models.User, query *string, dateFrom *time.Time, dateTo *time.Time,
	location *models.GeoBoundingBox, onlyFavorites *bool, order *models.Ordering, paginate *models.Pagination) ([]*models.Media, error) {

	querySQL := ownedMediaScope(db, user.ID)

	if query != nil && strings.TrimSpace(*query) != "" {
		wild := "%" + strings.ToLower(strings.TrimSpace(*query)) + "%"
		querySQL = querySQL.Where("("+textMatchConditions(wild)+")", textMatchVars(wild)...)
	}

	if dateFrom != nil {
		querySQL = querySQL.Where("media.date_shot >= ?", dateFrom)
	}

	if dateTo != nil {
		querySQL = querySQL.Where("media.date_shot <= ?", dateTo)
	}

	if location != nil {
		querySQL = querySQL.Where(`EXISTS (SELECT 1 FROM media_exif WHERE media_exif.id = media.exif_id
			AND media_exif.gps_latitude IS NOT NULL
			AND media_exif.gps_longitude IS NOT NULL
			AND media_exif.gps_latitude BETWEEN ? AND ?
			AND media_exif.gps_longitude BETWEEN ? AND ?)`,
			location.MinLatitude, location.MaxLatitude, location.MinLongitude, location.MaxLongitude)
	}

	if onlyFavorites != nil && *onlyFavorites {
		querySQL = querySQL.
			Where("media.id IN (?)", db.Table("user_media_data").
				Select("user_media_data.media_id").
				Where("user_media_data.user_id = ?", user.ID).
				Where("user_media_data.favorite"))
	}

	// Default ordering: newest first, only when no explicit order is requested
	if order == nil || order.OrderBy == nil {
		querySQL = querySQL.Order("media.date_shot DESC")
	}

	querySQL = models.FormatSQL(querySQL, order, paginate)

	var media []*models.Media
	if err := querySQL.Find(&media).Error; err != nil {
		return nil, errors.Wrapf(err, "filtering media")
	}

	return media, nil
}
