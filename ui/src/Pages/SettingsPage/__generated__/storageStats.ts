/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: storageStats
// ====================================================

export interface storageStats_storageStats {
  __typename: "StorageStats";
  /**
   * Total capacity of the storage filesystem in bytes
   */
  totalBytes: number;
  /**
   * Used bytes on the storage filesystem
   */
  usedBytes: number;
  /**
   * Free bytes on the storage filesystem
   */
  freeBytes: number;
  /**
   * Bytes used by the media cache (thumbnails/transcodes)
   */
  mediaCacheBytes: number;
  /**
   * Average original photo size in the library, in bytes
   */
  averagePhotoSize: number;
  /**
   * Estimated number of additional photos that fit in free space
   */
  estimatedRemainingPhotos: number;
}

export interface storageStats {
  /**
   * Storage statistics for the media cache filesystem
   */
  storageStats: storageStats_storageStats;
}
