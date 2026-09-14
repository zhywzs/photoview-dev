package processing_tasks

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path"

	"github.com/photoview/photoview/api/graphql/models"
	"github.com/photoview/photoview/api/scanner/media_encoding"
	"github.com/photoview/photoview/api/scanner/media_type"
	"github.com/photoview/photoview/api/scanner/scanner_task"
	"github.com/photoview/photoview/api/scanner/scanner_utils"
	"github.com/pkg/errors"
)

type SidecarTask struct {
	scanner_task.ScannerTaskBase
}

func (t SidecarTask) AfterMediaFound(ctx scanner_task.TaskContext, media *models.Media, newMedia bool) error {
	if media.Type != models.MediaTypePhoto || !newMedia {
		return nil
	}

	mediaType := ctx.GetCache().GetMediaType(media.Path)
	if mediaType == media_type.TypeUnknown {
		return fmt.Errorf("scan for sidecar file %s failed: media type is %s", media.Path, mediaType)
	}

	if mediaType.IsWebCompatible() {
		return nil
	}

	var sideCarPath *string = nil
	var sideCarHash *string = nil

	sideCarPath = scanForSideCarFile(media.Path)
	if sideCarPath != nil {
		sideCarHash = hashSideCarFile(sideCarPath)
	}

	// Add sidecar data to media
	media.SideCarPath = sideCarPath
	media.SideCarHash = sideCarHash
	if err := ctx.GetDB().Save(media).Error; err != nil {
		return errors.Wrapf(err, "update media sidecar info (%s)", *sideCarPath)
	}

	return nil
}

func (t SidecarTask) ProcessMedia(ctx scanner_task.TaskContext, mediaData *media_encoding.EncodeMediaData, mediaCachePath string) (updatedURLs []*models.MediaURL, err error) {
	mediaType, err := mediaData.ContentType()
	if err != nil {
		return []*models.MediaURL{}, errors.Wrap(err, "sidecar task, process media")
	}

	if mediaType.IsWebCompatible() {
		return []*models.MediaURL{}, nil
	}

	photo := mediaData.Media

	sideCarFileHasChanged := false
	var currentFileHash *string
	currentSideCarPath := scanForSideCarFile(photo.Path)

	if currentSideCarPath != nil {
		currentFileHash = hashSideCarFile(currentSideCarPath)
		if photo.SideCarHash == nil || *photo.SideCarHash != *currentFileHash {
			sideCarFileHasChanged = true
		}
	} else if photo.SideCarPath != nil { // sidecar has been deleted since last scan
		sideCarFileHasChanged = true
	}

	if !sideCarFileHasChanged {
		return []*models.MediaURL{}, nil
	}

	fmt.Printf("Detected changed sidecar file for %s recreating JPG's to reflect changes\n", photo.Path)

	highResURL, err := photo.GetHighRes()
	if err != nil {
		return []*models.MediaURL{}, errors.Wrap(err, "sidecar task, get high-res media_url")
	}

	thumbURL, err := photo.GetThumbnail()
	if err != nil {
		return []*models.MediaURL{}, errors.Wrap(err, "sidecar task, get high-res media_url")
	}

	thumbSmallURL, err := photo.GetThumbnailSmall()
	if err != nil {
		return []*models.MediaURL{}, errors.Wrap(err, "sidecar task, get small thumbnail media_url")
	}

	thumbTinyURL, err := photo.GetThumbnailTiny()
	if err != nil {
		return []*models.MediaURL{}, errors.Wrap(err, "sidecar task, get tiny thumbnail media_url")
	}

	// update high res image may be cropped so dimentions and file size can change
	baseImagePath := path.Join(mediaCachePath, highResURL.MediaName) // update base image path for thumbnail
	tempHighResPath := baseImagePath + ".hold"
	os.Rename(baseImagePath, tempHighResPath)
	updatedHighRes, err := generateSaveHighResJPEG(ctx.GetDB(), photo, mediaData, highResURL.MediaName, baseImagePath, highResURL)
	if err != nil {
		os.Rename(tempHighResPath, baseImagePath)
		return []*models.MediaURL{}, errors.Wrap(err, "sidecar task, recreating high-res cached image")
	}
	os.Remove(tempHighResPath)

	// update thumbnail image may be cropped so dimentions and file size can change
	thumbPath := path.Join(mediaCachePath, thumbURL.MediaName)
	tempThumbPath := thumbPath + ".hold" // hold onto the original image incase for some reason we fail to recreate one with the new settings
	os.Rename(thumbPath, tempThumbPath)
	updatedThumbnail, err := generateSaveThumbnailJPEG(ctx.GetDB(), photo, thumbURL.MediaName, mediaCachePath, baseImagePath, thumbURL)
	if err != nil {
		os.Rename(tempThumbPath, thumbPath)
		return []*models.MediaURL{}, errors.Wrap(err, "recreating thumbnail cached image")
	}
	os.Remove(tempThumbPath)

	// update small thumbnail as well, since the crop may have changed
	var updatedSmallThumbnail *models.MediaURL
	if thumbSmallURL != nil {
		smallThumbPath := path.Join(mediaCachePath, thumbSmallURL.MediaName)
		tempSmallThumbPath := smallThumbPath + ".hold"
		os.Rename(smallThumbPath, tempSmallThumbPath)
		updatedSmallThumbnail, err = generateSaveSmallThumbnailJPEG(ctx.GetDB(), photo, thumbSmallURL.MediaName, mediaCachePath, baseImagePath, thumbSmallURL)
		if err != nil {
			os.Rename(tempSmallThumbPath, smallThumbPath)
			return []*models.MediaURL{}, errors.Wrap(err, "recreating small thumbnail cached image")
		}
		os.Remove(tempSmallThumbPath)
	}

	// update tiny thumbnail as well, since the crop may have changed
	var updatedTinyThumbnail *models.MediaURL
	if thumbTinyURL != nil {
		tinyThumbPath := path.Join(mediaCachePath, thumbTinyURL.MediaName)
		tempTinyThumbPath := tinyThumbPath + ".hold"
		os.Rename(tinyThumbPath, tempTinyThumbPath)
		updatedTinyThumbnail, err = generateSaveTinyThumbnailJPEG(ctx.GetDB(), photo, thumbTinyURL.MediaName, mediaCachePath, baseImagePath, thumbTinyURL)
		if err != nil {
			os.Rename(tempTinyThumbPath, tinyThumbPath)
			return []*models.MediaURL{}, errors.Wrap(err, "recreating tiny thumbnail cached image")
		}
		os.Remove(tempTinyThumbPath)
	}

	photo.SideCarHash = currentFileHash
	photo.SideCarPath = currentSideCarPath

	// save new side car hash
	if err := ctx.GetDB().Save(&photo).Error; err != nil {
		return []*models.MediaURL{}, errors.Wrapf(err, "could not update side car hash for media: %s", photo.Path)
	}

	updatedList := []*models.MediaURL{
		updatedThumbnail,
		updatedHighRes,
	}
	if updatedSmallThumbnail != nil {
		updatedList = append(updatedList, updatedSmallThumbnail)
	}
	if updatedTinyThumbnail != nil {
		updatedList = append(updatedList, updatedTinyThumbnail)
	}

	return updatedList, nil
}

func scanForSideCarFile(path string) *string {
	testPath := path + ".xmp"

	if scanner_utils.FileExists(testPath) {
		return &testPath
	}

	return nil
}

func hashSideCarFile(path *string) *string {
	if path == nil {
		return nil
	}

	f, err := os.Open(*path)
	if err != nil {
		log.Printf("ERROR: %s", err)
	}
	defer f.Close()

	h := md5.New()
	if _, err := io.Copy(h, f); err != nil {
		log.Printf("ERROR: %s", err)
	}
	hash := hex.EncodeToString(h.Sum(nil))
	return &hash
}
