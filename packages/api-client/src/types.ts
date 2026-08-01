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
