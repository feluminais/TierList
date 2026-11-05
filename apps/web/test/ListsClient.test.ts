import { ApiError } from "@tl/api-client";
import { draftKey } from "@tl/app-core";
import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ListsClient from "../app/lists/ListsClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

// One object for the whole run: the real hook returns a stable connection, and
// the page re-reads the list whenever the connection changes identity.
const { client, connection } = vi.hoisted(() => {
  const client = { listMine: vi.fn(), deleteList: vi.fn() };
  return { client, connection: { state: "connected" as const, client } };
});

vi.mock("@tl/app-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tl/app-core")>()),
  useApiClient: () => connection,
}));

const LISTS = [
  { id: "list-1", title: "Ramen", updatedAt: "2026-08-01T12:00:00.000Z" },
  { id: "list-2", title: "Games", updatedAt: "2026-08-02T12:00:00.000Z" },
];

beforeEach(() => {
  client.listMine.mockReset().mockResolvedValue(LISTS);
  client.deleteList.mockReset().mockResolvedValue(true);
  window.localStorage.clear();
});
afterEach(cleanup);

async function mount() {
  render(createElement(ListsClient));
  await screen.findAllByTestId("list-card");
}

const rowOf = (title: string) => screen.getByText(title).closest("li") as HTMLElement;
const within = (row: HTMLElement, testId: string) =>
  row.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

describe("deleting a list", () => {
  it("asks first, and does nothing until it is confirmed", async () => {
    await mount();
    fireEvent.click(within(rowOf("Ramen"), "list-delete")!);

    expect(within(rowOf("Ramen"), "list-delete-confirm")).not.toBeNull();
    expect(client.deleteList).not.toHaveBeenCalled();

    fireEvent.click(within(rowOf("Ramen"), "list-delete-cancel")!);
    expect(client.deleteList).not.toHaveBeenCalled();
    expect(within(rowOf("Ramen"), "list-delete")).not.toBeNull();
  });

  it("deletes the confirmed list and leaves the others", async () => {
    await mount();
    fireEvent.click(within(rowOf("Ramen"), "list-delete")!);
    await act(async () => {
      fireEvent.click(within(rowOf("Ramen"), "list-delete-confirm")!);
    });

    expect(client.deleteList).toHaveBeenCalledWith("list-1");
    expect(client.deleteList).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("Ramen")).toBeNull());
    expect(screen.getByText("Games")).not.toBeNull();
  });

  it("forgets this device's draft of it, so the editor cannot bring it back", async () => {
    window.localStorage.setItem(draftKey("list-1"), "{}");
    window.localStorage.setItem(draftKey("list-2"), "{}");
    await mount();
    fireEvent.click(within(rowOf("Ramen"), "list-delete")!);
    await act(async () => {
      fireEvent.click(within(rowOf("Ramen"), "list-delete-confirm")!);
    });

    await waitFor(() => expect(window.localStorage.getItem(draftKey("list-1"))).toBeNull());
    expect(window.localStorage.getItem(draftKey("list-2"))).toBe("{}");
  });

  it("treats a list the server no longer has as deleted", async () => {
    client.deleteList.mockResolvedValue(false);
    await mount();
    fireEvent.click(within(rowOf("Ramen"), "list-delete")!);
    await act(async () => {
      fireEvent.click(within(rowOf("Ramen"), "list-delete-confirm")!);
    });
    await waitFor(() => expect(screen.queryByText("Ramen")).toBeNull());
  });

  it("keeps the list, its draft and an alert when the delete fails", async () => {
    client.deleteList.mockRejectedValue(new ApiError(500, "boom"));
    window.localStorage.setItem(draftKey("list-1"), "{}");
    await mount();
    fireEvent.click(within(rowOf("Ramen"), "list-delete")!);
    await act(async () => {
      fireEvent.click(within(rowOf("Ramen"), "list-delete-confirm")!);
    });

    expect((await screen.findByRole("alert")).textContent).toContain("boom");
    expect(screen.getByText("Ramen")).not.toBeNull();
    expect(window.localStorage.getItem(draftKey("list-1"))).toBe("{}");
  });

  it("does not let another list's delete be started while one is running", async () => {
    let finish: (removed: boolean) => void = () => {};
    client.deleteList.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
    await mount();

    fireEvent.click(within(rowOf("Ramen"), "list-delete")!);
    await act(async () => {
      fireEvent.click(within(rowOf("Ramen"), "list-delete-confirm")!);
    });

    // While it runs, the other row cannot open a confirmation to be cancelled
    // silently when this one finishes.
    expect((within(rowOf("Games"), "list-delete") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => finish(true));
    await waitFor(() => expect(screen.queryByText("Ramen")).toBeNull());
    expect((within(rowOf("Games"), "list-delete") as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the empty state once the last list is gone", async () => {
    client.listMine.mockResolvedValue([LISTS[0]]);
    await mount();
    fireEvent.click(within(rowOf("Ramen"), "list-delete")!);
    await act(async () => {
      fireEvent.click(within(rowOf("Ramen"), "list-delete-confirm")!);
    });
    expect(await screen.findByTestId("lists-empty")).not.toBeNull();
  });
});
