import { DEFAULT_EXPORT_SETTINGS, type ExportPlan, type ExportSettings } from "@tl/editor-core";
import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "../app/editor/ExportDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

/** A stand-in for `exportPlan` whose answer depends on every setting, so a wrong one shows. */
function fakePlan(settings: ExportSettings): ExportPlan {
  const width = settings.columns !== null ? 100 + settings.columns * 110 : (settings.width ?? 1200);
  const height = settings.includeTray ? 700 : 500;
  const scale = settings.scale > 3 ? 3 : settings.scale;
  return {
    layout: {} as ExportPlan["layout"],
    width,
    height,
    scale,
    scaleReduced: scale < settings.scale,
    pixelWidth: Math.ceil(width * scale),
    pixelHeight: Math.ceil(height * scale),
    columns: 5,
  };
}

function mount(overrides: Partial<Parameters<typeof ExportDialog>[0]> = {}) {
  const props = {
    plan: vi.fn(fakePlan),
    onExport: vi.fn(async () => {}),
    onClose: vi.fn(),
    busy: false,
    error: null,
    ...overrides,
  };
  render(createElement(ExportDialog, props));
  return props;
}

const lastSettings = (props: ReturnType<typeof mount>) => {
  const calls = (props.onExport as unknown as { mock: { calls: [ExportSettings, string][] } }).mock.calls;
  return calls[calls.length - 1]!;
};

describe("ExportDialog", () => {
  it("starts from the defaults and shows the size the picture will be", () => {
    mount();
    // Tiles-per-line mode by default; the fake gives 100 + columns * 110 wide.
    expect(screen.getByTestId("export-size").textContent).toMatch(/\d+ × \d+ px/);
  });

  it("exports with the tiles per line the person typed", async () => {
    const props = mount();
    fireEvent.change(screen.getByTestId("export-columns"), { target: { value: "4" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("export-go"));
    });
    const [settings] = lastSettings(props);
    expect(settings.columns).toBe(4);
    expect(settings.width).toBeNull();
  });

  it("switches to a width in pixels, which then wins and leaves columns unset", async () => {
    const props = mount();
    fireEvent.click(screen.getByTestId("export-mode-width"));
    fireEvent.change(screen.getByTestId("export-width"), { target: { value: "1500" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("export-go"));
    });
    const [settings] = lastSettings(props);
    expect(settings.width).toBe(1500);
    expect(settings.columns).toBeNull();
  });

  it("passes the scale, the tray choice and the format through", async () => {
    const props = mount();
    fireEvent.change(screen.getByTestId("export-scale"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("export-tray"));
    fireEvent.click(screen.getByTestId("export-format-jpg"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("export-go"));
    });
    const [settings, format] = lastSettings(props);
    expect(settings.scale).toBe(2);
    expect(settings.includeTray).toBe(!DEFAULT_EXPORT_SETTINGS.includeTray);
    expect(format).toBe("jpg");
  });

  it("updates the readout as the settings change", () => {
    mount();
    const before = screen.getByTestId("export-size").textContent;
    fireEvent.change(screen.getByTestId("export-scale"), { target: { value: "2" } });
    expect(screen.getByTestId("export-size").textContent).not.toBe(before);
    fireEvent.click(screen.getByTestId("export-tray"));
    expect(screen.getByTestId("export-size").textContent).toMatch(/× \d+ px/);
  });

  it("says when the scale was lowered to stay within the size limit", () => {
    mount();
    fireEvent.change(screen.getByTestId("export-scale"), { target: { value: "4" } });
    expect(screen.getByTestId("export-reduced").textContent).toMatch(/3/);
  });

  it("does not say so when the scale stands", () => {
    mount();
    expect(screen.queryByTestId("export-reduced")).toBeNull();
  });

  it("disables the export while one is running, and shows an error", () => {
    mount({ busy: true, error: "could not render" });
    expect((screen.getByTestId("export-go") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("export-error").textContent).toBe("could not render");
  });

  it("closes on the button, on Escape and on the backdrop", () => {
    let props = mount();
    fireEvent.click(screen.getByTestId("export-close"));
    expect(props.onClose).toHaveBeenCalled();
    cleanup();

    props = mount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
    cleanup();

    props = mount();
    fireEvent.click(screen.getByTestId("export-dialog").parentElement!);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("does not close when a click starts inside", () => {
    const props = mount();
    fireEvent.click(screen.getByTestId("export-size"));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("keeps a typed value that is out of range as typed, and lets the plan clamp it", async () => {
    const props = mount();
    fireEvent.change(screen.getByTestId("export-columns"), { target: { value: "999" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("export-go"));
    });
    // The dialog does not second-guess: `exportPlan` clamps every setting.
    expect(lastSettings(props)[0].columns).toBe(999);
  });
});
