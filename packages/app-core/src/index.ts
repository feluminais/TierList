/**
 * The React that is not rendering.
 *
 * Everything here is shared by the web editor and the Expo app: talking to the
 * API, saving, sharing, uploading. It deliberately imports neither Skia nor
 * the DOM — Skia because `apps/web` must be able to import these hooks at
 * module scope, which loading `@tl/editor` would forbid, and the DOM because
 * React Native does not have one.
 */
export { draftKey, readDraft, removeDraft, useDraft } from "./drafts";
export type { DraftStore } from "./drafts";
export { newId, newListId } from "./ids";
export { useApiClient, TOKEN_STORAGE_KEY } from "./useApiClient";
export type { ApiClientIo, Connection, TokenStore } from "./useApiClient";
export { useAssetUpload } from "./useAssetUpload";
export type { AssetUpload, UploadSource } from "./useAssetUpload";
export { classifySaveError, useAutosave } from "./useAutosave";
export type { Autosave, AutosaveHandlers, AutosaveTimings } from "./useAutosave";
export { useShare } from "./useShare";
export type { ShareState } from "./useShare";
