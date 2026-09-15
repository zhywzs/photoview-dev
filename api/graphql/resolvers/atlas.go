package resolvers

import (
	"context"
	"path"

	"github.com/photoview/photoview/api/graphql/auth"
	"github.com/photoview/photoview/api/graphql/models"
	"github.com/photoview/photoview/api/scanner/atlas"
	"github.com/photoview/photoview/api/utils"
)

// MediaAtlases is the resolver for the mediaAtlases field.
func (r *queryResolver) MediaAtlases(ctx context.Context, ids []int, tileSize *int) ([]*models.MediaAtlas, error) {
	user := auth.UserFromContext(ctx)
	if user == nil {
		return nil, auth.ErrUnauthorized
	}

	// default to the small (128px) atlas for backward compatibility
	effectiveTileSize := models.AtlasTileSmall
	if tileSize != nil {
		effectiveTileSize = *tileSize
	}

	var atlases []models.ThumbnailAtlas
	err := r.DB(ctx).
		Preload("Entries", "media_id IN ?", ids).
		Where("user_id = ? AND tile_size = ? AND id IN (?)", user.ID, effectiveTileSize,
			r.DB(ctx).Model(&models.ThumbnailAtlasEntry{}).
				Select("thumbnail_atlas_id").
				Where("user_id = ? AND media_id IN ?", user.ID, ids)).
		Find(&atlases).Error
	if err != nil {
		return nil, err
	}

	result := make([]*models.MediaAtlas, 0, len(atlases))
	for _, sheet := range atlases {
		endpoint := utils.ApiEndpointUrl()
		endpoint.Path = path.Join(endpoint.Path, "atlas", sheet.FileName)

		entries := make([]*models.MediaAtlasEntry, 0, len(sheet.Entries))
		for _, entry := range sheet.Entries {
			entries = append(entries, &models.MediaAtlasEntry{
				MediaID: entry.MediaID,
				X:       entry.X,
				Y:       entry.Y,
			})
		}

		result = append(result, &models.MediaAtlas{
			URL:      endpoint.String(),
			TileSize: sheet.TileSize,
			GridSize: models.AtlasGridSizeForTile(sheet.TileSize),
			Entries:  entries,
		})
	}

	return result, nil
}

// RegenerateThumbnailAtlases is the resolver for the regenerateThumbnailAtlases field.
func (r *mutationResolver) RegenerateThumbnailAtlases(ctx context.Context) (bool, error) {
	if err := atlas.RegenerateAllAtlases(r.DB(ctx)); err != nil {
		return false, err
	}
	return true, nil
}
