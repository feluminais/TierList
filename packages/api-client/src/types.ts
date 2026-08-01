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

export interface AssetResponse {
  id: string;
  contentType: string;
  width: number;
  height: number;
  byteSize: number;
}
