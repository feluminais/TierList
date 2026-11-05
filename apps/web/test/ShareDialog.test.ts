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
    onStopView: vi.fn(),
    onStopTemplate: vi.fn(),
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

  /**
   * "Anyone with the link" and "anyone at all" are different offers, and the
   * second is the one that cannot be taken back once a crawler has seen it.
   * A default of on would publish work someone only meant to send to a friend.
   */
  it("does not list publicly unless the author asks", () => {
    const props = mount();

    expect(screen.getByTestId<HTMLInputElement>("share-listed").checked).toBe(false);
    fireEvent.click(screen.getByTestId("share-create-template"));
    expect(props.onShareTemplate).toHaveBeenCalledWith(false);
  });

  it("passes the listing choice through when it is ticked", () => {
    const props = mount();

    fireEvent.click(screen.getByTestId("share-listed"));
    fireEvent.click(screen.getByTestId("share-create-template"));
    expect(props.onShareTemplate).toHaveBeenCalledWith(true);
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

  it("offers to stop sharing only a link that exists, each to its own handler", () => {
    mount();
    expect(screen.queryByTestId("share-stop-view")).toBeNull();
    expect(screen.queryByTestId("share-stop-template")).toBeNull();
    cleanup();

    const props = mount({ viewUrl: "http://x/l/AAAAAAAA", templateUrl: "http://x/l/BBBBBBBB" });
    fireEvent.click(screen.getByTestId("share-stop-view"));
    expect(props.onStopView).toHaveBeenCalledTimes(1);
    expect(props.onStopTemplate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("share-stop-template"));
    expect(props.onStopTemplate).toHaveBeenCalledTimes(1);
    expect(props.onStopView).toHaveBeenCalledTimes(1);
  });

  it("disables the stop buttons while a share is in flight", () => {
    mount({ busy: true, viewUrl: "http://x/l/AAAAAAAA" });
    expect(screen.getByTestId<HTMLButtonElement>("share-stop-view").disabled).toBe(true);
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

describe("ShareDialog — compare with me", () => {
  it("offers nothing to compare until there is a view link", () => {
    mount();
    expect(screen.queryByTestId("share-url-compare")).toBeNull();
  });

  /**
   * The link the design doc calls "the flow that actually gets used": it opens
   * the comparison with one side already filled, so the recipient only has to
   * add their own.
   */
  it("derives a compare link carrying this list's code", () => {
    mount({ viewUrl: "http://tl.test/l/ABCD2345" });
    expect(screen.getByTestId<HTMLInputElement>("share-url-compare").value).toBe(
      "http://tl.test/compare?codes=ABCD2345",
    );
  });

  it("keeps the origin the view link came from", () => {
    mount({ viewUrl: "https://example.com:8443/l/ZZZZ9999" });
    expect(screen.getByTestId<HTMLInputElement>("share-url-compare").value).toBe(
      "https://example.com:8443/compare?codes=ZZZZ9999",
    );
  });

  it("copies the compare link independently of the view link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    mount({ viewUrl: "http://tl.test/l/ABCD2345" });
    await fireEvent.click(screen.getByTestId("share-copy-compare"));

    expect(writeText).toHaveBeenCalledWith("http://tl.test/compare?codes=ABCD2345");
  });
});
