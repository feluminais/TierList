export interface TokenResponse {
  id: string;
  token: string;
}

export interface WriteResponse {
  id: string;
  revision: number;
}

export interface ListSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ShareResponse {
  /** 8-character base32. The public name of the list. */
  code: string;
  /** The asset holding the link-preview image, once one has been rendered. */
  ogAssetId: string | null;
  /** Whether this share appears on browse pages. */
  listed: boolean;
}

/** One card on a browse page. Never carries a document — see `GET /browse`. */
export interface BrowseResult {
  code: string;
  title: string;
  categoryId: string | null;
  ogAssetId: string | null;
  updatedAt: string;
}

export interface BrowseParams {
  category?: string | null;
  q?: string | null;
  limit?: number;
}

/** The intrinsic pixel size of an uploaded image, as the server measured it. */
export interface AssetSize {
  id: string;
  width: number;
  height: number;
}

/** A shared list as a reader gets it: the document, never its id. */
export interface SharedList {
  document: import("@tl/core").TierList;
  ogAssetId: string | null;
  /** Whether this share appears on browse pages. */
  listed: boolean;
  /**
   * Sizes for every image the document references.
   *
   * Sent because a crop is stored as a fraction of its source, so a renderer
   * that never decodes the image — which is the whole point of the public
   * page — cannot otherwise work out which part of it a tile shows.
   */
  assets: AssetSize[];
}

export interface AssetResponse {
  id: string;
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
}
