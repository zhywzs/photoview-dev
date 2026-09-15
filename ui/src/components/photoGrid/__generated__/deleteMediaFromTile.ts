/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL mutation operation: deleteMediaFromTile
// ====================================================

export interface deleteMediaFromTile {
  /**
   * Move a media to the trash (soft delete, file stays on disk for 30 days)
   */
  deleteMedia: boolean;
}

export interface deleteMediaFromTileVariables {
  mediaId: string;
}
