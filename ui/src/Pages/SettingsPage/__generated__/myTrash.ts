/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL query operation: myTrash
// ====================================================

export interface myTrash_myTrash {
  __typename: "TrashedMedia";
  id: string;
  title: string;
  /**
   * URL of the thumbnail for display in the trash list
   */
  thumbnailUrl: string | null;
  /**
   * Original album's filesystem path
   */
  originalAlbumPath: string;
  deletedAt: Time;
  /**
   * Days until permanent deletion (30 - days since deletion)
   */
  daysRemaining: number;
  /**
   * Size of the original file in bytes
   */
  fileSize: number;
}

export interface myTrash {
  /**
   * Media in the trash of the logged in user, newest deletion first
   */
  myTrash: myTrash_myTrash[];
}
