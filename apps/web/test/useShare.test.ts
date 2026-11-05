import { ApiError, type Client } from "@tl/api-client";
import { createTierList } from "@tl/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useShare } from "@tl/app-core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const doc = createTierList({ id: "list-1", now: "2026-08-01T12:00:00.000Z" });
const shareUrlFor = (code: string) => `http://x/l/${code}`;

function fakeClient(overrides: Record<string, unknown> = {}) {
  const client = {
    shareList: vi.fn(async (id: string) => ({
      code: id === "list-1" ? "AAAAAAAA" : "BBBBBBBB",
      ogAssetId: null,
      listed: false,
    })),
    createList: vi.fn<(doc: { id: string }) => Promise<{ id: string; revision: number }>>(async () => ({
      id: "t",
      revision: 0,
    })),
    unshareList: vi.fn<(id: string) => Promise<boolean>>(async () => true),
    uploadAsset: vi.fn(),
    ...overrides,
  };
  return client as unknown as Client & typeof client;
}

function mount(client: Client) {
  return renderHook(() => useShare(client, "list-1", doc, () => null, shareUrlFor));
}

describe("useShare: stopping", () => {
  it("withdraws the view link and forgets it", async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await act(async () => result.current.share());
    expect(result.current.url).toBe("http://x/l/AAAAAAAA");

    await act(async () => result.current.unshare());

    expect(client.unshareList).toHaveBeenCalledWith("list-1");
    expect(result.current.url).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.sharing).toBe(false);
  });

  it("keeps the link on screen when the server did not confirm the withdrawal", async () => {
    const client = fakeClient({
      unshareList: vi.fn(async () => {
        throw new ApiError(500, "boom");
      }),
    });
    const { result } = mount(client);
    await act(async () => result.current.share());

    await act(async () => result.current.unshare());

    expect(result.current.url).toBe("http://x/l/AAAAAAAA");
    expect(result.current.error).toBe("boom");
    expect(result.current.sharing).toBe(false);
  });

  it("withdraws the template's link by the template's id, not the list's", async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await act(async () => result.current.shareTemplate(false));
    const templateId = client.createList.mock.calls[0]![0].id;
    expect(result.current.templateUrl).toBe("http://x/l/BBBBBBBB");

    await act(async () => result.current.unshareTemplate());

    expect(client.unshareList).toHaveBeenCalledWith(templateId);
    expect(templateId).not.toBe("list-1");
    expect(result.current.templateUrl).toBeNull();
  });

  it("publishing the template again after stopping re-shares the same template", async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await act(async () => result.current.shareTemplate(false));
    await act(async () => result.current.unshareTemplate());
    await act(async () => result.current.shareTemplate(false));

    expect(client.createList).toHaveBeenCalledTimes(1);
    expect(client.shareList).toHaveBeenCalledTimes(2);
  });

  it("says so rather than failing silently when there is no connection", async () => {
    const { result } = renderHook(() => useShare(null, "list-1", doc, () => null, shareUrlFor));
    await act(async () => result.current.unshare());
    expect(result.current.error).toBe("not connected to an API");
  });

  it("has nothing to withdraw for a template that was never published", async () => {
    const client = fakeClient();
    const { result } = mount(client);
    await act(async () => result.current.unshareTemplate());
    expect(client.unshareList).not.toHaveBeenCalled();
  });
});
