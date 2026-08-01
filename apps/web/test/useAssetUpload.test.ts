import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAssetUpload } from "../app/editor/useAssetUpload";

function fakeClient(overrides: Partial<{ uploadAsset: unknown }> = {}) {
  return {
    uploadAsset: vi.fn(async () => ({
      id: "asset-1",
      contentType: "image/png",
      width: 10,
      height: 10,
      byteSize: 24,
    })),
    ...overrides,
  } as never;
}

const file = (name = "a.png") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

describe("useAssetUpload", () => {
  it("reports the assetId the server chose", async () => {
    const onUploaded = vi.fn();
    const client = fakeClient();
    const { result } = renderHook(() => useAssetUpload(client, onUploaded));

    await act(async () => {
      await result.current.upload(file());
    });

    expect(onUploaded).toHaveBeenCalledWith("asset-1");
  });

  // The bytes must reach the client, not the File object — the API takes a raw
  // body and the client's own contract is a Uint8Array.
  it("sends the file's bytes", async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useAssetUpload(client, vi.fn()));

    await act(async () => {
      await result.current.upload(file());
    });

    const [bytes] = (client as unknown as { uploadAsset: { mock: { calls: unknown[][] } } })
      .uploadAsset.mock.calls[0]!;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes as Uint8Array)).toEqual([1, 2, 3]);
  });

  it("does nothing at all without a client", async () => {
    const onUploaded = vi.fn();
    const { result } = renderHook(() => useAssetUpload(null, onUploaded));

    await act(async () => {
      await result.current.upload(file());
    });

    expect(onUploaded).not.toHaveBeenCalled();
    expect(result.current.error).toBeTruthy();
  });

  it("surfaces a rejected upload rather than failing silently", async () => {
    const client = fakeClient({
      uploadAsset: vi.fn(async () => {
        throw Object.assign(new Error("unsupported image"), { status: 415 });
      }),
    });
    const onUploaded = vi.fn();
    const { result } = renderHook(() => useAssetUpload(client, onUploaded));

    await act(async () => {
      await result.current.upload(file());
    });

    expect(onUploaded).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.error).toContain("unsupported image"));
  });

  it("reports while a upload is in flight", async () => {
    let release: (() => void) | null = null;
    const client = fakeClient({
      uploadAsset: vi.fn(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({ id: "asset-1", contentType: "image/png", width: 1, height: 1, byteSize: 3 });
          }),
      ),
    });
    const { result } = renderHook(() => useAssetUpload(client, vi.fn()));

    let pending: Promise<void>;
    act(() => {
      pending = result.current.upload(file());
    });
    await waitFor(() => expect(result.current.uploading).toBe(true));

    await act(async () => {
      release!();
      await pending!;
    });
    expect(result.current.uploading).toBe(false);
  });

  // The same lesson useAutosave paid for: an outcome must be reported even
  // when the component that started it has gone.
  it("says nothing once unmounted", async () => {
    const onUploaded = vi.fn();
    const client = fakeClient();
    const { result, unmount } = renderHook(() => useAssetUpload(client, onUploaded));

    const pending = result.current.upload(file());
    unmount();
    await act(async () => {
      await pending;
    });

    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("clears a previous error on the next attempt", async () => {
    let fail = true;
    const client = fakeClient({
      uploadAsset: vi.fn(async () => {
        if (fail) throw new Error("boom");
        return { id: "asset-2", contentType: "image/png", width: 1, height: 1, byteSize: 3 };
      }),
    });
    const { result } = renderHook(() => useAssetUpload(client, vi.fn()));

    await act(async () => {
      await result.current.upload(file());
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());

    fail = false;
    await act(async () => {
      await result.current.upload(file());
    });
    await waitFor(() => expect(result.current.error).toBeNull());
  });
});
