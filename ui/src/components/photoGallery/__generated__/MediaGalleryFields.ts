/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

import { MediaType } from "./../../../__generated__/globalTypes";

// ====================================================
// GraphQL fragment: MediaGalleryFields
// ====================================================

export interface MediaGalleryFields_thumbnail {
  __typename: "MediaURL";
  /**
   * URL for previewing the image
   */
  url: string;
  /**
   * Width of the image in pixels
   */
  width: number;
  /**
   * Height of the image in pixels
   */
  height: number;
}

export interface MediaGalleryFields_thumbnailSmall {
  __typename: "MediaURL";
  /**
   * URL for previewing the image
   */
  url: string;
  /**
   * Width of the image in pixels
   */
  width: number;
  /**
   * Height of the image in pixels
   */
  height: number;
}

export interface MediaGalleryFields_thumbnailTiny {
  __typename: "MediaURL";
  /**
   * URL for previewing the image
   */
  url: string;
  /**
   * Width of the image in pixels
   */
  width: number;
  /**
   * Height of the image in pixels
   */
  height: number;
}

export interface MediaGalleryFields_highRes {
  __typename: "MediaURL";
  /**
   * URL for previewing the image
   */
  url: string;
}

export interface MediaGalleryFields_videoWeb {
  __typename: "MediaURL";
  /**
   * URL for previewing the image
   */
  url: string;
}

export interface MediaGalleryFields {
  __typename: "Media";
  id: string;
  type: MediaType;
  title: string;
  /**
   * A short string that can be used to generate a blured version of the media, to show while the original is loading
   */
  blurhash: string | null;
  /**
   * URL to display the media in a smaller resolution
   */
  thumbnail: MediaGalleryFields_thumbnail | null;
  /**
   * URL to display the media in a small resolution (max 256px), used for zoomed out gallery views
   */
  thumbnailSmall: MediaGalleryFields_thumbnailSmall | null;
  /**
   * URL to display the media in a tiny resolution (max 128px), used for ultra dense gallery views
   */
  thumbnailTiny: MediaGalleryFields_thumbnailTiny | null;
  /**
   * URL to display the photo in full resolution, will be null for videos
   */
  highRes: MediaGalleryFields_highRes | null;
  /**
   * URL to get the video in a web format that can be played in the browser, will be null for photos
   */
  videoWeb: MediaGalleryFields_videoWeb | null;
  favorite: boolean;
}
