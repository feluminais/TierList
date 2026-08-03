"use client";

import type { AssetResponse } from "@tl/api-client";
import {
  createTierList,
  defaultImageEdit,
  fillProgress,
  isFill,
  type TierList,
  type TierListAction,
} from "@tl/core";
import {
  applyAction,
  aspectRatioFor,
  createSession,
  defaultCropFor,
  layoutBoard,
  type BoardLayout,
  redoSession,
  saveFailed,
  saveStarted,
  saveSucceeded,
  undoSession,
} from "@tl/editor-core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { AnnotateLayer } from "./AnnotateLayer";
import { downloadBytes, filenameFor } from "./download";
import { newId } from "./ids";
import { EditSheet, type EditCanvasComponent } from "./EditSheet";
import { NewItemSheet } from "./NewItemSheet";
import { ShareDialog } from "./ShareDialog";
import { TierOverlay } from "./TierOverlay";
import { TileEditOverlay } from "./TileEditButton";
import { Toolbar } from "./Toolbar";
import { useApiClient } from "./useApiClient";
import { useAssetUpload } from "./useAssetUpload";
import { useAutosave, type AutosaveHandlers } from "./useAutosave";
import { useShare } from "./useShare";

/**
 * `@tl/editor`'s `BoardExporter`, restated rather than imported — the same
 * constraint that makes `EditSheet` restate `EditCanvas`'s props. Nothing
 * Skia-related may be named at module scope in this file, and a type-only
 * import still ties the module to a package that builds its Skia API object
 * when it loads.
 */
type BoardExporterLike = {
  toImage: (format: "png" | "jpg") => { bytes: Uint8Array; contentType: string } | null;
};

type BoardProps = {
  doc: TierList;
  width: number;
  onAction: (action: TierListAction) => void;
  onTap?: (itemId: string) => void;
  onDraggingChange?: (dragging: boolean) => void;
  immediateDrag?: boolean;
  onExporterReady?: (exporter: BoardExporterLike | null) => void;
  layout?: BoardLayout;
  liveAnnotation?: { points: number[]; color: string; width: number } | null;
  assetIds?: readonly string[];
  assetUrl?: (assetId: string) => string;
};

/**
 * The board fills the width it is given, within limits, and is centred in it.
 *
 * This is also the width of the surface below that claims touch input, so the
 * two cannot drift apart.
 *
 * The floor stops a narrow screen collapsing the tiles area to nothing. The
 * ceiling stops a tier becoming an unscannable ribbon on a wide monitor, where
 * the eye has to cross the whole screen to compare two tiles.
 *
 * The width is measured rather than guessed from a breakpoint, because
 * `layoutBoard` takes a number and everything downstream — hit-testing, drag
 * targeting, the hover overlay — must be given the same number the canvas was
 * drawn with.
 */
const MIN_BOARD_WIDTH = 320;
const MAX_BOARD_WIDTH = 1400;

/**
 * What the board is laid out at before it has been measured. Only ever visible
 * for the first paint, and the canvas itself does not mount until CanvasKit has
 * loaded, so this is never seen as a reflow.
 */
const DEFAULT_BOARD_WIDTH = 800;

/**
 * The list this browser was last editing.
 *
 * Not the authority on which list is open — the route is — but what `/editor`
 * with no id resolves to, so returning to a bare link lands where the user
 * left off rather than on a new empty board.
 */
export const LIST_ID_KEY = "tl.listId";

/**
 * Nothing Skia-related may be imported at module scope in this file.
 *
 * `@shopify/react-native-skia/lib/module/skia/Skia.web.js` builds its API
 * object at module scope:
 *
 *     export const Skia = JsiSkApi(global.CanvasKit);
 *
 * so that module must not be evaluated until CanvasKit is on the global. Doing
 * both imports dynamically, in order, inside the effect makes that ordering
 * explicit rather than relying on bundler chunking, which differs between dev
 * and production builds.
 */
export interface SkiaHostProps {
  /** The list this editor edits. Comes from the route, never from storage. */
  listId: string;
}

export default function SkiaHost({ listId }: SkiaHostProps) {
  const [Board, setBoard] = useState<ComponentType<BoardProps> | null>(null);
  const [EditCanvasComp, setEditCanvasComp] = useState<EditCanvasComponent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { LoadSkiaWeb } = await import(
          "@shopify/react-native-skia/lib/module/web/LoadSkiaWeb"
        );
        // CanvasKit derives its own WASM URL from a module URL that Turbopack
        // rewrites with a ROOT/ prefix, producing a 404. Naming the path
        // explicitly is the fix.
        await LoadSkiaWeb({ locateFile: (file: string) => `/${file}` });

        const mod = await import("@tl/editor");
        if (!alive) return;
        setBoard(() => mod.InteractiveBoard);
        setEditCanvasComp(() => mod.EditCanvas);
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Remembered so `/editor` with no id returns here. Written rather than read:
  // the route already decided which list this is, and storage is only a
  // convenience for getting back to it. In an effect because `localStorage`
  // does not exist on the server.
  useEffect(() => {
    window.localStorage.setItem(LIST_ID_KEY, listId);
  }, [listId]);

  // Whether this device has a mouse (or other precise pointer) rather than
  // only touch. Read in an effect, not during render, for the same reason
  // `listId` is: `matchMedia` does not exist on the server, and a render-time
  // read would make the server and the first client render disagree. Starts
  // false — the touch-first behaviour — so hydration matches, then flips
  // immediately after mount on a device that actually has one.
  //
  // Decided here, not inside `@tl/editor`: `dragReduce` and `InteractiveBoard`
  // are shared with the Android app and must stay platform-agnostic, so the
  // device check belongs to this web-only caller.
  const [pointerFine, setPointerFine] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: fine)");
    const update = () => setPointerFine(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // True for the span of a drag. `InteractiveBoard` reports it precisely so a
  // parent can react — here, to hide the hover edit button while a tile is
  // being dragged rather than edited.
  const [dragging, setDragging] = useState(false);

  // The document, its history and its saved state, together. `null` for the
  // synced revision says the server has never seen this document, so the first
  // write will be a create. Starts as an empty document under the real id,
  // replaced once the load below resolves.
  const [session, setSession] = useState(() => createSession(emptyDoc(listId), null));
  // Whether `session` is the loaded document rather than the empty placeholder
  // above. Gates autosave: without it, a slow `getList` round trip leaves the
  // placeholder's `syncedRevision: null` in place for a whole debounce window,
  // which is long enough for autosave to `createList` an empty document over
  // the top of one the server already holds.
  const [loaded, setLoaded] = useState(false);
  // Reset when the route changes to another list, so the previous document is
  // never shown as though it were this one — and, more importantly, never
  // saved under this id.
  useEffect(() => {
    setSession(createSession(emptyDoc(listId), null));
    setLoaded(false);
  }, [listId]);

  // `process.env.NEXT_PUBLIC_API_URL` is written out in full so the bundler can
  // inline it; a destructured or computed read is not substituted.
  const connection = useApiClient(process.env.NEXT_PUBLIC_API_URL);
  const client = connection.state === "connected" ? connection.client : null;

  useEffect(() => {
    if (!client) {
      // No API configured is the normal state of this route. Start a local
      // document under the real id so nothing downstream has to special-case it.
      setSession(createSession(emptyDoc(listId), null));
      setLoaded(true);
      return;
    }
    let alive = true;
    (async () => {
      const existing = await client.getList(listId).catch(() => null);
      if (!alive) return;
      // A document the server already holds starts *synced* at its own
      // revision. Starting at null would make the first write a create, which
      // the create-only PUT rejects with a 409 — landing a returning visitor
      // straight in conflict. That is exactly the open item this fixes.
      setSession(
        existing
          ? createSession(existing, existing.revision)
          : createSession(emptyDoc(listId), null),
      );
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [listId, client]);

  // The clock lives here, at the boundary, exactly as it does in the gesture
  // hook. A drag emits at most one action, so this runs once per completed
  // drag and not once per frame.
  //
  // `applyAction` returns the *same session* for a no-op, so React bails out of
  // the re-render and the autosave debounce is never restarted by an edit that
  // changed nothing.
  const dispatch = useCallback((action: TierListAction) => {
    setSession((current) => applyAction(current, action, now()));
  }, []);

  const undo = useCallback(() => {
    setSession((current) => undoSession(current, now()));
  }, []);
  const redo = useCallback(() => {
    setSession((current) => redoSession(current, now()));
  }, []);

  const onTitleChange = useCallback(
    (title: string) => dispatch({ type: "meta/set", patch: { title } }),
    [dispatch],
  );
  // The id is minted here, at the call site, and never inside the component
  // that collected the label.
  const onAddItem = useCallback(
    (label: string) => dispatch({ type: "item/addText", id: newId(), label }),
    [dispatch],
  );

  // Reads `display.tileAspect` from the functional `setSession` update rather
  // than from the `session` this callback closed over: `useAssetUpload` holds
  // this callback for the lifetime of an upload, which can outlive several
  // re-renders (a tile-size change, an unrelated edit) between the upload
  // starting and the server responding. Reading a captured `session` here
  // would silently lock the crop to whatever aspect was current when the
  // *upload started*, not when it finished — exactly the stale-read bug this
  // fix exists to avoid.
  const onUploaded = useCallback((asset: AssetResponse) => {
    const id = newId();
    setSession((current) => {
      const crop = defaultCropFor(
        { width: asset.width, height: asset.height },
        aspectRatioFor(current.doc.display.tileAspect),
      );
      const edit = { ...defaultImageEdit(), crop };
      return applyAction(
        current,
        { type: "item/addImage", id, assetId: asset.id, edit },
        now(),
      );
    });
  }, []);
  const upload = useAssetUpload(client, onUploaded);
  const onAddImage = useCallback((file: File) => void upload.upload(file), [upload]);

  const assetUrl = useCallback(
    (id: string) => (client ? client.assetUrl(id) : ""),
    [client],
  );
  // Gated on `client` rather than only on the document: an id with nowhere to
  // fetch from would still get handed to `Skia.Data.fromURI("")`, which
  // resolves against *this page's own URL* rather than rejecting or hanging —
  // a wasted request that decodes as garbage and marks the tile "failed" for
  // no reason a user could act on. Simplest to just not ask.
  const assetIds = useMemo(
    () =>
      client ? session.doc.items.map((i) => i.assetId).filter((a): a is string => !!a) : [],
    [session.doc.items, client],
  );

  // Adding a tier is the one tier action that reaches `dispatch` through a
  // callback: it needs an id, and the reducer generates none, so this boundary
  // is where that rule meets the UI. Everything else a tier can have done to
  // it — rename, recolour, reorder, resize, remove — is dispatched by
  // `TierOverlay` itself, because none of it needs anything this component
  // owns and a pass-through per action would be five more places to keep in
  // step with the reducer.
  const onAddRow = useCallback(
    (label: string, color: string) => dispatch({ type: "row/add", id: newId(), label, color }),
    [dispatch],
  );

  // Handed over by `InteractiveBoard` once its canvas exists, and taken back
  // on unmount. Null means "there is nothing to snapshot yet", which is what
  // greys out the image export buttons rather than letting a click fail.
  const [exporter, setExporter] = useState<BoardExporterLike | null>(null);
  // Stable: it keys the effect inside `InteractiveBoard` that calls it, and an
  // unstable one would hand over a fresh exporter on every render.
  const onExporterReady = useCallback(
    (next: BoardExporterLike | null) => setExporter(() => next),
    [],
  );

  const onExportImage = useCallback(
    (format: "png" | "jpg") => {
      const image = exporter?.toImage(format);
      if (!image) return;
      downloadBytes(image.bytes, image.contentType, filenameFor(session.doc.title, format));
    },
    [exporter, session.doc.title],
  );

  /**
   * The document itself, as a file.
   *
   * The design doc's answer to "it's just a picture after you create it", and
   * cheap precisely because the document already *is* the source of truth —
   * there is nothing to serialise that autosave does not already send. Pretty
   * printed: this is meant to be readable by whoever receives it.
   */
  const onExportJson = useCallback(() => {
    downloadBytes(
      JSON.stringify(session.doc, null, 2),
      "application/json",
      filenameFor(session.doc.title, "json"),
    );
  }, [session.doc]);

  // JPEG for the link preview rather than PNG: a board of photographs encodes
  // far smaller, and a preview card has to load quickly. Every consumer of an
  // OG image accepts JPEG.
  const ogImage = useCallback(() => exporter?.toImage("jpg") ?? null, [exporter]);
  const shareUrlFor = useCallback(
    (code: string) => `${window.location.origin}/l/${code}`,
    [],
  );
  const [addingItem, setAddingItem] = useState(false);
  const [annotating, setAnnotating] = useState(false);

  const sharing = useShare(client, listId, session.doc, ogImage, shareUrlFor);
  const [shareOpen, setShareOpen] = useState(false);
  const openShare = useCallback(() => setShareOpen(true), []);

  // How much of a fill is done. Computed for every document — the readout is
  // only shown for a fill, but `fillProgress` is cheap and branching on the
  // document here would put the "is this a fill" question in two places.
  const progress = useMemo(() => fillProgress(session.doc), [session.doc]);
  const filling = isFill(session.doc);

  // Which tile a sheet is open for, if any.
  //
  // This reaches the board as `onTap` only when `!pointerFine`. A
  // hover-capable device gets the corner button instead: a drag there starts
  // on movement, so a plain tap opening the sheet would compete with the click
  // a drag also wants. Touch keeps `onTap`, having no hover and otherwise no
  // way to reach the sheet at all.
  const [editing, setEditing] = useState<string | null>(null);
  const onTap = useCallback((itemId: string) => setEditing(itemId), []);
  const editingItem = editing
    ? session.doc.items.find((i) => i.id === editing)
    : undefined;
  useEffect(() => {
    // The item a sheet is open on can vanish from under it — removed, or an
    // undo reaching back past when it was added. `item/setEdit` guards on a
    // missing item and is a no-op (packages/core/src/reduce.ts), so nothing
    // corrupts, but a sheet left open over a tile that no longer exists is a
    // worse experience than one that closes.
    if (editing && !editingItem) setEditing(null);
  }, [editing, editingItem]);

  // Stable, and every one of them a functional update, so the hook can hold
  // them behind a ref without ever reading a stale session.
  const handlers = useMemo<AutosaveHandlers>(
    () => ({
      onSaveStarted: () => setSession((current) => saveStarted(current)),
      onSaveSucceeded: (acknowledged) =>
        setSession((current) => saveSucceeded(current, acknowledged)),
      onSaveFailed: (failure) =>
        setSession((current) => saveFailed(current, failure)),
    }),
    [],
  );

  useAutosave(session, loaded ? client : null, handlers);

  // Measured rather than read from a media query: `layoutBoard` takes a number,
  // and the canvas, the hit-testing and the hover overlay must all be handed
  // the same one or a drop lands somewhere the user did not aim.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [boardWidth, setBoardWidth] = useState(DEFAULT_BOARD_WIDTH);
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = () => {
      setBoardWidth(
        Math.max(MIN_BOARD_WIDTH, Math.min(MAX_BOARD_WIDTH, shell.clientWidth)),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  /**
   * The one layout everything reads.
   *
   * The canvas, the tile overlay and the tier overlay all position themselves
   * in board coordinates, so they must be given the *same* rectangles — and
   * `trayAddSlot` changes where every tray tile sits, which is exactly the
   * kind of option that would otherwise be passed to one consumer and not the
   * others.
   */
  const layout = useMemo(
    () => layoutBoard(session.doc, { width: boardWidth, trayAddSlot: true }),
    [session.doc, boardWidth],
  );

  return (
    <div ref={shellRef} style={{ width: "100%" }}>
    <div style={{ width: boardWidth, maxWidth: "100%", margin: "0 auto" }}>
      <Toolbar
        session={session}
        connection={connection}
        onTitleChange={onTitleChange}
        onUndo={undo}
        onRedo={redo}
        uploadError={upload.error}
        onExportImage={exporter ? onExportImage : null}
        onExportJson={onExportJson}
        onShare={client ? openShare : null}
        onAnnotate={() => setAnnotating(true)}
      />

      {filling ? <FillBanner placed={progress.placed} total={progress.total} /> : null}

      {addingItem ? (
        <NewItemSheet
          onAddImage={onAddImage}
          onAddText={onAddItem}
          uploading={upload.uploading}
          error={upload.error}
          onClose={() => setAddingItem(false)}
        />
      ) : null}

      {shareOpen ? (
        <ShareDialog
          onShareView={() => void sharing.share()}
          viewUrl={sharing.url}
          onShareTemplate={() => void sharing.shareTemplate()}
          templateUrl={sharing.templateUrl}
          busy={sharing.sharing}
          error={sharing.error}
          onClose={() => setShareOpen(false)}
        />
      ) : null}

      {error ? (
        <pre style={{ color: "#f88", padding: 16 }}>{error}</pre>
      ) : !Board ? (
        <p style={{ color: "#888", padding: 16 }}>Loading canvas…</p>
      ) : (
        // `touch-action: none` is the only thing that stops a mobile browser
        // stealing a drag. Once Chrome decides a touch belongs to a scroll it
        // fires `touchcancel`, and react-native-web's responder system
        // terminates on that path unconditionally — it consults
        // `onResponderTerminationRequest` only for `contextmenu`, `scroll` and
        // `selectionchange` (ResponderSystem.js, `isTerminateEvent`). Returning
        // `false` cannot save the gesture, so the browser has to be stopped
        // from claiming it at all. react-native-web reaches for the same lever
        // for the same reason, and says so: see the comment above
        // `scrollDisabled` in ScrollViewBase.
        //
        // The cost is that this surface no longer pans the page on a touch
        // screen. Sized to the board rather than the block default so it costs
        // exactly the board and not the empty column beside it.
        //
        // Autoscroll is deliberately not wired here. This route still has no
        // scroll container of its own — the page scrolls — so there is no
        // viewport to measure a pointer against and no scroller to drive. It is
        // exercised on mobile, where the board sits inside a ScrollView.
        //
        // The hover overlay is only mounted on a hover-capable device: touch
        // has no hover to track and no need for the extra wrapper, so the
        // touch path stays exactly what it was.
        // `TierOverlay` wraps the tile overlay rather than sitting beside it,
        // so its layer is later in the DOM and therefore above — a tier's
        // handle has to win over the tile layer beneath, which is transparent
        // to pointer events everywhere except the one button in it.
        annotating ? (
          // The pen replaces the drag and tier overlays rather than joining
          // them: while it is out a press means a mark, and offering both
          // would make every gesture a guess about which was intended.
          <AnnotateLayer
            doc={session.doc}
            layout={layout}
            width={boardWidth}
            onAction={dispatch}
            onDone={() => setAnnotating(false)}
          >
            {(live) => (
              // `pointerEvents: none` is what stops a mark also starting a
              // tile drag. The canvas is inside the pen's surface, so without
              // it a press would reach the responder system underneath and
              // both would claim the gesture.
              <div style={{ pointerEvents: "none", width: boardWidth }}>
                <Board
                  doc={session.doc}
                  width={boardWidth}
                  layout={layout}
                  liveAnnotation={live}
                  onAction={dispatch}
                  onExporterReady={onExporterReady}
                  assetIds={assetIds}
                  assetUrl={assetUrl}
                />
              </div>
            )}
          </AnnotateLayer>
        ) : (
        <TierOverlay
          doc={session.doc}
          layout={layout}
          dragging={dragging}
          immediate={pointerFine}
          onAction={dispatch}
          onAddRow={onAddRow}
          onAddItem={() => setAddingItem(true)}
        >
          {pointerFine ? (
            <TileEditOverlay layout={layout} dragging={dragging} onEdit={onTap}>
              <div style={{ touchAction: "none", width: boardWidth }}>
                <Board
                  doc={session.doc}
                  width={boardWidth}
                  layout={layout}
                  onAction={dispatch}
                  onDraggingChange={setDragging}
                  immediateDrag
                  onExporterReady={onExporterReady}
                  assetIds={assetIds}
                  assetUrl={assetUrl}
                />
              </div>
            </TileEditOverlay>
          ) : (
            <div style={{ touchAction: "none", width: boardWidth }}>
              <Board
                doc={session.doc}
                width={boardWidth}
                layout={layout}
                onAction={dispatch}
                onTap={onTap}
                onExporterReady={onExporterReady}
                assetIds={assetIds}
                assetUrl={assetUrl}
              />
            </div>
          )}
        </TierOverlay>
        )
      )}
      {editingItem && EditCanvasComp ? (
        <EditSheet
          item={editingItem}
          EditCanvas={EditCanvasComp}
          // The number, not the name: `aspectRatioFor` is the one place the
          // mapping lives, and `layoutBoard` reads it from there too, so the
          // sheet and the board cannot drift into disagreeing about what
          // "portrait" means.
          tileAspect={aspectRatioFor(session.doc.display.tileAspect)}
          assetUrl={assetUrl}
          onAction={dispatch}
          onClose={() => setEditing(null)}
        />
      ) : null}
      </div>
    </div>
  );
}

function now(): string {
  return new Date().toISOString();
}

/**
 * The document a list starts from: the default tiers and an empty tray.
 *
 * Empty rather than seeded with example items. This is not a preview — with an
 * API connected it is created on the server as the user's real list, so
 * anything in it is content they did not add and have to remove.
 *
 * The timestamp is fixed rather than read from the clock so the same id always
 * produces the same document, and a render on the server matches the first
 * render in the browser.
 */
function emptyDoc(id: string): TierList {
  return createTierList({ id, now: "2026-08-01T12:00:00.000Z" });
}

/**
 * The readout that says this list is somebody else's template being filled in.
 *
 * Worth stating plainly: a fill looks exactly like an ordinary list, and
 * without this the only clue that these items came from someone else is that
 * the user did not add them. The count is the useful half — "anything left?" is
 * the question a filler actually has.
 */
function FillBanner({ placed, total }: { placed: number; total: number }) {
  const done = total > 0 && placed === total;
  return (
    <div data-testid="fill-banner" style={fillBanner(done)}>
      <strong>{done ? "All ranked" : "Filling in a template"}</strong>
      <span data-testid="fill-progress" style={{ color: "#8b98a6" }}>
        {placed} of {total} placed
      </span>
      <div
        aria-hidden="true"
        style={{
          flex: 1,
          height: 4,
          minWidth: 60,
          borderRadius: 4,
          background: "#232a33",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${total === 0 ? 100 : Math.round((placed / total) * 100)}%`,
            height: "100%",
            background: done ? "#4ade80" : "#3b8beb",
          }}
        />
      </div>
      {done ? (
        <span style={{ color: "#4ade80" }}>Share it back with whoever sent it</span>
      ) : (
        <span style={{ color: "#5b6673" }}>Drag tiles from the tray into a tier</span>
      )}
    </div>
  );
}

function fillBanner(done: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    marginBottom: 12,
    background: "#12161b",
    border: `1px solid ${done ? "#2f5d3f" : "#2c3540"}`,
    borderRadius: 8,
    color: "#e6edf3",
    fontFamily: "system-ui, sans-serif",
    fontSize: 13,
  };
}
