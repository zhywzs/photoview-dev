/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL mutation operation: uploadFabScanAll
// ====================================================

export interface uploadFabScanAll_scanAll {
  __typename: "ScannerResult";
  success: boolean;
  message: string | null;
}

export interface uploadFabScanAll {
  /**
   * Scan all users for new media
   */
  scanAll: uploadFabScanAll_scanAll;
}
