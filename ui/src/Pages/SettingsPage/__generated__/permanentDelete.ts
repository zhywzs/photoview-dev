/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL mutation operation: permanentDelete
// ====================================================

export interface permanentDelete {
  /**
   * Permanently delete a single media from the trash (removes file + cache)
   */
  permanentlyDeleteMedia: boolean;
}

export interface permanentDeleteVariables {
  mediaId: string;
}
