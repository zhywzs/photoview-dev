/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL mutation operation: setAlbumTitle
// ====================================================

export interface setAlbumTitle_setAlbumTitle {
  __typename: "Album";
  id: string;
  title: string;
}

export interface setAlbumTitle {
  /**
   * Rename an album. Only changes the title stored in the database,
   * the directory on the filesystem is left untouched.
   */
  setAlbumTitle: setAlbumTitle_setAlbumTitle;
}

export interface setAlbumTitleVariables {
  albumID: string;
  title: string;
}
