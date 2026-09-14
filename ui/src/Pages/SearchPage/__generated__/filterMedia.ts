/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

import { GeoBoundingBox, MediaType } from "./../../../__generated__/globalTypes";

// ====================================================
// GraphQL query operation: filterMedia
// ====================================================

export interface filterMedia_filterMedia_thumbnail {
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

export interface filterMedia_filterMedia_thumbnailSmall {
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

export interface filterMedia_filterMedia_thumbnailTiny {
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

export interface filterMedia_filterMedia_highRes {
  __typename: "MediaURL";
  /**
   * URL for previewing the image
   */
  url: string;
}

export interface filterMedia_filterMedia_videoWeb {
  __typename: "MediaURL";
  /**
   * URL for previewing the image
   */
  url: string;
}

export interface filterMedia_filterMedia {
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
  thumbnail: filterMedia_filterMedia_thumbnail | null;
  /**
   * URL to display the media in a small resolution (max 256px), used for zoomed out gallery views
   */
  thumbnailSmall: filterMedia_filterMedia_thumbnailSmall | null;
  /**
   * URL to display the media in a tiny resolution (max 128px), used for ultra dense gallery views
   */
  thumbnailTiny: filterMedia_filterMedia_thumbnailTiny | null;
  /**
   * URL to display the photo in full resolution, will be null for videos
   */
  highRes: filterMedia_filterMedia_highRes | null;
  /**
   * URL to get the video in a web format that can be played in the browser, will be null for photos
   */
  videoWeb: filterMedia_filterMedia_videoWeb | null;
  favorite: boolean;
  /**
   * The date the image was shot or the date it was imported as a fallback
   */
  date: Time;
}

export interface filterMedia {
  /**
   * Filter media by text, date range, geographic bounding box and favorites.
   * Results are ordered by date shot, newest first, unless another order is given.
   */
  filterMedia: filterMedia_filterMedia[];
}

export interface filterMediaVariables {
  query?: string | null;
  dateFrom?: Time | null;
  dateTo?: Time | null;
  location?: GeoBoundingBox | null;
  onlyFavorites?: boolean | null;
  limit?: number | null;
  offset?: number | null;
}
