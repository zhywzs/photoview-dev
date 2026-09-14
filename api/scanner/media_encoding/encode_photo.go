package media_encoding

import (
	"context"
	"fmt"
	"image"

	"github.com/photoview/photoview/api/graphql/models"
	"github.com/photoview/photoview/api/utils"
	"github.com/photoview/photoview/api/scanner/media_encoding/executable_worker"
	"github.com/photoview/photoview/api/scanner/media_type"
	"github.com/pkg/errors"
	"gopkg.in/vansante/go-ffprobe.v2"

	"gorm.io/gorm"
)

// Dimension presents the Dimension of a image.
type Dimension struct {
	Width  int
	Height int
}

// ScaleToFit generates a new dimension scaled so the longest side is maxSize.
func (d *Dimension) ScaleToFit(maxSize int) Dimension {
	if d.Height == 0 || d.Width == 0 {
		return Dimension{Width: 0, Height: 0}
	}

	aspect := float64(d.Width) / float64(d.Height)

	var width, height int

	if aspect > 1 {
		width = maxSize
		height = int(float64(maxSize) / aspect)
	} else {
		width = int(float64(maxSize) * aspect)
		height = maxSize
	}

	if width > d.Width {
		width = d.Width
		height = d.Height
	}

	return Dimension{
		Width:  width,
		Height: height,
	}
}

// ThumbnailScale generates a new dimension for thumbnails (max 1024).
func (d *Dimension) ThumbnailScale() Dimension {
	return d.ScaleToFit(1024)
}

// ThumbnailSmallScale generates a new dimension for small thumbnails (max 256).
func (d *Dimension) ThumbnailSmallScale() Dimension {
	return d.ScaleToFit(256)
}

// GetPhotoDimensions returns the dimension of the image `imagePath`.
func GetPhotoDimensions(imagePath string) (Dimension, error) {
	w, h, err := executable_worker.Magick.IdentifyDimension(imagePath)
	if err != nil {
		return Dimension{}, fmt.Errorf("identify dimension %q error: %w", imagePath, err)
	}

	return Dimension{
		Width:  int(w),
		Height: int(h),
	}, nil
}

// EncodeThumbnail encodes a thumbnail of `inputPath`, and store it as `outputPath`.
// It returns the dimension of the thumbnail. The thumbnail will be not bigger than 1024x1024.
func EncodeThumbnail(db *gorm.DB, inputPath string, outputPath string) (Dimension, error) {
	return EncodeThumbnailWithSize(inputPath, outputPath, 1024)
}

// EncodeThumbnailSmall encodes a small thumbnail of `inputPath` (max 256x256).
func EncodeThumbnailSmall(inputPath string, outputPath string) (Dimension, error) {
	return EncodeThumbnailWithSize(inputPath, outputPath, 256)
}

// EncodeThumbnailTiny encodes a tiny thumbnail of `inputPath` (max 128x128).
func EncodeThumbnailTiny(inputPath string, outputPath string) (Dimension, error) {
	return EncodeThumbnailWithSize(inputPath, outputPath, 128)
}

// EncodeThumbnailWithSize encodes a thumbnail of `inputPath` scaled so the
// longest side is at most `maxSize`, and stores it as `outputPath`.
// It returns the actual dimension of the encoded thumbnail.
func EncodeThumbnailWithSize(inputPath string, outputPath string, maxSize int) (Dimension, error) {
	w, h, err := executable_worker.Magick.IdentifyDimension(inputPath)
	if err != nil {
		return Dimension{}, fmt.Errorf("can't generate thumbnail of file %q: %w", inputPath, err)
	}

	origin := Dimension{
		Width:  int(w),
		Height: int(h),
	}
	thumbnail := origin.ScaleToFit(maxSize)

	if err := executable_worker.Magick.GenerateThumbnail(inputPath, outputPath, uint(thumbnail.Width), uint(thumbnail.Height)); err != nil {
		return Dimension{}, fmt.Errorf("can't generate thumbnail of file %q: %w", inputPath, err)
	}

	w, h, err = executable_worker.Magick.IdentifyDimension(outputPath)
	if err != nil {
		return Dimension{}, fmt.Errorf("can't generate thumbnail of file %q: %w", inputPath, err)
	}
	thumbnail = Dimension{
		Width:  int(w),
		Height: int(h),
	}

	return thumbnail, nil
}

// EncodeMediaData is used to easily decode media data, with a cache so expensive operations are not repeated
type EncodeMediaData struct {
	Media           *models.Media
	CounterpartPath *string
	_photoImage     image.Image
	_contentType    media_type.MediaType
	_videoMetadata  *ffprobe.ProbeData
}

func NewEncodeMediaData(media *models.Media) EncodeMediaData {
	fileType := media_type.GetMediaType(media.Path)

	return EncodeMediaData{
		Media:        media,
		_contentType: fileType,
	}
}

// ContentType reads the image to determine its content type
func (img *EncodeMediaData) ContentType() (media_type.MediaType, error) {
	if img._contentType != media_type.TypeUnknown {
		return img._contentType, nil
	}

	imgType := media_type.GetMediaType(img.Media.Path)
	if imgType == media_type.TypeUnknown {
		return imgType, fmt.Errorf("unknown type of %q", img.Media.Path)
	}

	img._contentType = imgType
	return imgType, nil
}

func (img *EncodeMediaData) EncodeHighRes(outputPath string) error {
	contentType, err := img.ContentType()
	if err != nil {
		return err
	}

	if !contentType.IsSupported() {
		return errors.New("could not convert photo as file format is not supported")
	}

	// Use magick if there is no counterpart JPEG file to use instead
	if contentType.IsImage() && !contentType.IsWebCompatible() {
		imgPath := img.Media.Path
		if img.CounterpartPath != nil {
			imgPath = *img.CounterpartPath
		}

		err := executable_worker.Magick.EncodeJpeg(imgPath, outputPath, 70)
		if err != nil {
			return fmt.Errorf("failed to convert RAW photo %q to JPEG: %w", imgPath, err)
		}
	}

	return nil
}

func (enc *EncodeMediaData) VideoMetadata() (*ffprobe.ProbeData, error) {

	if enc._videoMetadata != nil {
		return enc._videoMetadata, nil
	}

	ctx, cancelFn := context.WithTimeout(context.Background(), utils.MediaProbeTimeout())
	defer cancelFn()
	data, err := ffprobe.ProbeURL(ctx, enc.Media.Path)
	if err != nil {
		return nil, errors.Wrapf(err, "could not read video metadata (%s)", enc.Media.Title)
	}

	enc._videoMetadata = data
	return enc._videoMetadata, nil
}
