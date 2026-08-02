import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareDialog } from "../app/editor/ShareDialog";

afterEach(cleanup);

function mount(overrides: Partial<Parameters<typeof ShareDialog>[0]> = {}) {
  const props = {
    onShareView: vi.fn(),
    viewUrl: null,
    onShareTemplate: vi.fn(),
    templateUrl: null,
    busy: false,
    error: null,
    onClose: vi.fn(),
    ...overrides,
  };
  render(createElement(ShareDialog, props));
  return props;
}

describe("ShareDialog", () => {
  it("offers both a view link and a template link", () => {
    mount();
    expect(screen.getByTestId("share-create-view")).not.toBeNull();
    expect(screen.getByTestId("share-create-template")).not.toBeNull();
  });

  /**
   * The two are different offers, and the whole point of the dialog is that a
   * reader can be invited to *fill* rather than only to look. Wiring them to
   * the same handler would compile and would silently lose the loop.
   */
  it("routes each button to its own action", () => {
    const props = mount();

    fireEvent.click(screen.getByTestId("share-create-view"));
    expect(props.onShareView).toHaveBeenCalledTimes(1);
    expect(props.onShareTemplate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("share-create-template"));
    expect(props.onShareTemplate).toHaveBeenCalledTimes(1);
    expect(props.onShareView).toHaveBeenCalledTimes(1);
  });

  it("shows each link only once it exists, and keeps them apart", () => {
    mount({ viewUrl: "http://x/l/AAAAAAAA" });

    expect(screen.getByTestId<HTMLInputElement>("share-url-view").value).toBe(
      "http://x/l/AAAAAAAA",
    );
    // The template has not been published, so it still offers its button.
    expect(screen.queryByTestId("share-url-template")).toBeNull();
    expect(screen.getByTestId("share-create-template")).not.toBeNull();
  });

  it("shows both links when both exist", () => {
    mount({ viewUrl: "http://x/l/AAAAAAAA", templateUrl: "http://x/l/BBBBBBBB" });
    expect(screen.getByTestId<HTMLInputElement>("share-url-view").value).toBe(
      "http://x/l/AAAAAAAA",
    );
    expect(screen.getByTestId<HTMLInputElement>("share-url-template").value).toBe(
      "http://x/l/BBBBBBBB",
    );
  });

  it("disables the create buttons while a share is in flight", () => {
    mount({ busy: true });
    expect(screen.getByTestId<HTMLButtonElement>("share-create-view").disabled).toBe(true);
    expect(screen.getByTestId<HTMLButtonElement>("share-create-template").disabled).toBe(true);
  });

  it("surfaces an error", () => {
    mount({ error: "boom" });
    expect(screen.getByTestId("share-dialog-error").textContent).toBe("boom");
  });

  it("closes on the button, on Escape, and on the backdrop", () => {
    let props = mount();
    fireEvent.click(screen.getByTestId("share-dialog-close"));
    expect(props.onClose).toHaveBeenCalled();
    cleanup();

    props = mount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
    cleanup();

    props = mount();
    // The backdrop is the dialog's parent.
    fireEvent.click(screen.getByTestId("share-dialog").parentElement!);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("does not close when a click starts inside the dialog", () => {
    const props = mount({ viewUrl: "http://x/l/AAAAAAAA" });
    fireEvent.click(screen.getByTestId("share-url-view"));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("copies a link and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    mount({ viewUrl: "http://x/l/AAAAAAAA" });
    expect(screen.getByTestId("share-copy-view").textContent).toBe("Copy");

    await fireEvent.click(screen.getByTestId("share-copy-view"));
    expect(writeText).toHaveBeenCalledWith("http://x/l/AAAAAAAA");
    // The state flip is asynchronous; findBy waits for the re-render.
    expect(await screen.findByText("Copied")).not.toBeNull();
  });

  it("survives a clipboard that refuses", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });

    mount({ viewUrl: "http://x/l/AAAAAAAA" });
    await fireEvent.click(screen.getByTestId("share-copy-view"));
    // Still says Copy — it did not claim a success it did not get — and the
    // link is on screen to select by hand.
    expect(screen.getByTestId("share-copy-view").textContent).toBe("Copy");
  });
});
