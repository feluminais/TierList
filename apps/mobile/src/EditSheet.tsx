import { DEFAULT_STROKE_WIDTH, type ImageEdit, type Item, type TierListAction, type TileAspect } from "@tl/core";
import { EditCanvas } from "@tl/editor";
import {
  aspectRatioFor,
  cropReduce,
  editReduce,
  idleCrop,
  idleEdit,
  maxZoomFor,
  strokeWidthInTile,
  toTilePoint,
  zoomOf,
  type CropContext,
  type CropEvent,
  type CropState,
  type EditContext,
  type EditEvent,
  type EditState,
} from "@tl/editor-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { newId } from "@tl/app-core";

/** The samples one stroke may carry. Same ceiling, same reason, as the web. */
const MAX_STROKE_SAMPLES = 1200;

const STROKE_COLOR = "#e6edf3";

/**
 * How long after the last zoom step a zoom run counts as finished.
 *
 * A button press has no "end of gesture", so something has to decide where the
 * run stops, and `cropReduce` will not read a clock — the same division the
 * web sheet makes for the wheel and the slider. Long enough that a run of taps
 * stays one undo step.
 */
const ZOOM_IDLE_MS = 220;

/** One tap of the zoom buttons, as a factor. Multiplicative, so a step is the
 * same proportional move wherever the zoom currently sits. */
const ZOOM_STEP = 1.25;

export interface EditSheetProps {
  item: Item;
  /** The document's setting; the ratio is derived here through
   * `aspectRatioFor`, so this file never grows a second copy of that map. */
  tileAspect: TileAspect;
  assetUrl: (assetId: string) => string;
  onAction: (action: TierListAction) => void;
  onClose: () => void;
}

/**
 * The phone's crop-and-draw sheet.
 *
 * The same two pure machines as the web — `cropReduce` and `editReduce` — held
 * to the same contract: one gesture, one `item/setEdit`, emitted when the
 * gesture ends and never before. That is what makes a reframe one undo step,
 * one revision and one autosave on either platform.
 *
 * What differs is only how touches arrive. The web reads pointer events off a
 * DOM element; here the surface claims the responder, because a finger on this
 * canvas is competing with a `ScrollView` behind the modal and the responder
 * system is what settles that.
 *
 * Zoom is two buttons rather than a wheel or a slider: a phone has no wheel,
 * and `@react-native-community/slider` is a native module this app cannot
 * currently build. Pinch-to-zoom is the right gesture here and is on the
 * backlog; the buttons are what make the feature reachable in the meantime.
 */
export function EditSheet({ item, tileAspect, assetUrl, onAction, onClose }: EditSheetProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Crop is meaningless without an image, so a text tile opens on the pen and
  // is never offered the other tab.
  const croppable = !!item.assetId;
  const [mode, setMode] = useState<"crop" | "draw">(croppable ? "crop" : "draw");

  const [edit, setEdit] = useState<EditState>(idleEdit);
  const [crop, setCrop] = useState<CropState>(idleCrop);

  // The one source of truth the senders read and write. Touch moves arrive
  // faster than React renders and React batches state updates, so two moves in
  // one batch would both reduce against the state that last rendered and the
  // earlier one would be lost.
  const editRef = useRef(edit);
  const cropRef = useRef(crop);

  const canvas = useMemo(
    () => sheetSize(aspectRatioFor(tileAspect), screenWidth, screenHeight),
    [tileAspect, screenWidth, screenHeight],
  );
  const tile = useMemo(
    () => ({ x: 0, y: 0, width: canvas.width, height: canvas.height }),
    [canvas.width, canvas.height],
  );

  const penContext: EditContext = useMemo(
    () => ({ itemId: item.id, tile, edit: item.edit, tolerance: 0.002 }),
    [item.id, tile, item.edit],
  );
  const cropContext: CropContext = useMemo(
    () => ({ itemId: item.id, tile, edit: item.edit }),
    [item.id, tile, item.edit],
  );

  // Read by the responder callbacks and by the idle timer, both of which can
  // fire against a context newer than the one their closure captured. The
  // responder in particular is created once and lives for the sheet's life.
  const cropContextRef = useRef(cropContext);
  cropContextRef.current = cropContext;
  const penContextRef = useRef(penContext);
  penContextRef.current = penContext;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const sendCrop = useCallback(
    (event: CropEvent) => {
      const out = cropReduce(cropRef.current, event);
      cropRef.current = out.state;
      setCrop(out.state);
      if (out.action) onAction(out.action);
    },
    [onAction],
  );

  const sendPen = useCallback(
    (event: EditEvent) => {
      const out = editReduce(editRef.current, event);
      editRef.current = out.state;
      setEdit(out.state);
      if (out.action) onAction(out.action);
    },
    [onAction],
  );

  // Owned here rather than in the machine, which never reads a clock.
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endZoomSoon = useCallback(() => {
    if (zoomTimer.current !== null) clearTimeout(zoomTimer.current);
    zoomTimer.current = setTimeout(() => {
      zoomTimer.current = null;
      sendCrop({ type: "zoomEnd", context: cropContextRef.current });
    }, ZOOM_IDLE_MS);
  }, [sendCrop]);

  /**
   * Commit a zoom still sitting behind the idle timer, right now.
   *
   * Without this, zooming and immediately pressing Done loses the reframe: the
   * sheet unmounts, the timer is cleared on the way out, and the action that
   * would have carried the crop is never emitted.
   */
  const flushZoom = useCallback(() => {
    if (zoomTimer.current === null) return;
    clearTimeout(zoomTimer.current);
    zoomTimer.current = null;
    sendCrop({ type: "zoomEnd", context: cropContextRef.current });
  }, [sendCrop]);

  useEffect(() => {
    return () => {
      if (zoomTimer.current !== null) clearTimeout(zoomTimer.current);
    };
  }, []);

  /**
   * One responder for the sheet's life.
   *
   * Rebuilding it per render would hand the native side a new object mid-touch
   * and drop the rest of the gesture, which is why every callback reads its
   * inputs through refs rather than through the closure.
   */
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // The modal is over a ScrollView; without this a move past the touch
        // slop would hand the gesture back to the scroller.
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (event) => {
          const at = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
          if (modeRef.current === "crop") {
            sendCrop({ type: "panStart", at, context: cropContextRef.current });
            return;
          }
          sendPen({
            type: "penDown",
            at,
            context: penContextRef.current,
            strokeId: newId(),
            color: STROKE_COLOR,
            width: DEFAULT_STROKE_WIDTH,
          });
        },

        onPanResponderMove: (event) => {
          const at = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
          if (modeRef.current === "crop") {
            // `cropReduce` ignores a move with no pan under way, so no guard.
            sendCrop({ type: "panMove", at, context: cropContextRef.current });
            return;
          }
          // Reads the ref, not the state: the batching that drops points can
          // also leave a state-based guard looking at the previous render's
          // phase — still "idle" for the first move or two after `penDown` —
          // which would drop the start of every stroke.
          const current = editRef.current;
          if (current.phase !== "drawing") return;
          if (current.points.length / 2 >= MAX_STROKE_SAMPLES) return;
          sendPen({ type: "penMove", at, context: penContextRef.current });
        },

        onPanResponderRelease: (event) => {
          const at = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
          if (modeRef.current === "crop") {
            sendCrop({ type: "panEnd", at, context: cropContextRef.current });
            return;
          }
          sendPen({ type: "penUp", at, context: penContextRef.current });
        },

        onPanResponderTerminate: () => {
          if (modeRef.current === "crop") sendCrop({ type: "cancel" });
          else sendPen({ type: "cancel" });
        },
      }),
    [sendCrop, sendPen],
  );

  // What is on screen: the gesture's own crop while one is in flight, the
  // document's otherwise. The document deliberately does not move until the
  // gesture ends, so the sheet cannot render `item.edit` and be honest.
  const workingCrop = crop.phase === "active" ? crop.crop : item.edit.crop;
  const shownItem: Item = useMemo(
    () =>
      workingCrop === item.edit.crop
        ? item
        : { ...item, edit: { ...item.edit, crop: workingCrop } },
    [item, workingCrop],
  );

  // `edit.points` is source-normalized, exactly like a committed stroke's —
  // never tile coordinates and never the crop — so drawing it needs the same
  // `toTilePoint` a committed stroke goes through inside `EditCanvas`.
  const liveStroke =
    edit.phase === "drawing"
      ? {
          points: mapToTile(edit.points, tile, workingCrop),
          color: edit.color,
          width: strokeWidthInTile(edit.width, tile, workingCrop),
        }
      : null;

  const zoom = zoomOf(workingCrop);
  const zoomMax = maxZoomFor(workingCrop);
  const center = { x: canvas.width / 2, y: canvas.height / 2 };

  const zoomBy = (factor: number) => {
    sendCrop({ type: "zoomBy", factor, at: center, context: cropContextRef.current });
    endZoomSoon();
  };

  const close = () => {
    flushZoom();
    onClose();
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.tabs}>
            {croppable ? (
              <>
                <Tab label="Crop" testID="sheet-mode-crop" active={mode === "crop"} onPress={() => setMode("crop")} />
                <Tab label="Draw" testID="sheet-mode-draw" active={mode === "draw"} onPress={() => setMode("draw")} />
              </>
            ) : (
              <Text style={{ color: "#8b98a6", fontSize: 13 }}>Draw</Text>
            )}

            {mode === "crop" ? (
              <View style={styles.zoomGroup}>
                <Tab
                  label="−"
                  testID="crop-zoom-out"
                  active={false}
                  onPress={() => zoomBy(1 / ZOOM_STEP)}
                />
                <Text testID="crop-zoom-readout" style={styles.zoomReadout}>
                  {zoom.toFixed(1)}×
                </Text>
                <Tab
                  label="+"
                  testID="crop-zoom-in"
                  active={false}
                  // Refused rather than clamped silently: at the ceiling the
                  // crop cannot get smaller without leaving the image.
                  onPress={() => (zoom < zoomMax ? zoomBy(ZOOM_STEP) : undefined)}
                />
              </View>
            ) : null}
          </View>

          <View
            testID="edit-sheet-canvas"
            style={{ width: canvas.width, height: canvas.height }}
            {...responder.panHandlers}
          >
            <EditCanvas
              item={shownItem}
              width={canvas.width}
              height={canvas.height}
              assetUrl={assetUrl}
              liveStroke={liveStroke}
            />
          </View>

          <Text style={styles.hint}>
            {mode === "crop" ? "Drag to reframe · − and + to zoom" : "Drag to draw on the tile"}
          </Text>

          <View style={styles.actions}>
            <Pressable
              testID="sheet-remove"
              onPress={() => {
                // The sheet is the one surface that names a single item, so
                // deleting one belongs here. No confirmation: it is a single
                // undo step and the board shows immediately what went.
                onAction({ type: "item/remove", itemId: item.id });
                onClose();
              }}
              style={[styles.action, styles.danger]}
            >
              <Text style={styles.dangerText}>Remove</Text>
            </Pressable>
            <Pressable testID="sheet-done" onPress={close} style={styles.action}>
              <Text style={styles.actionText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Tab({
  label,
  testID,
  active,
  onPress,
}: {
  label: string;
  testID: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The sheet canvas's size for a given tile aspect (height ÷ width).
 *
 * Sized to the screen rather than to a fixed 600px as the web is: a phone has
 * no room to spare, and a canvas wider than the window would put part of the
 * crop the user is framing outside it.
 */
function sheetSize(
  tileAspect: number,
  screenWidth: number,
  screenHeight: number,
): { width: number; height: number } {
  // Leaves room for the tabs, the hint and the buttons above and below.
  const maxWidth = screenWidth - 32;
  const maxHeight = screenHeight - 260;
  // A non-finite or non-positive aspect can only reach here from a document
  // nothing validated. Square keeps the sheet usable rather than sizing the
  // canvas to NaN, which renders nothing and shows the user no error either.
  const ratio = tileAspect > 0 && Number.isFinite(tileAspect) ? tileAspect : 1;

  const width = Math.max(1, Math.round(Math.min(maxWidth, maxHeight / ratio)));
  return { width, height: Math.max(1, Math.round(width * ratio)) };
}

function mapToTile(
  points: number[],
  tile: { x: number; y: number; width: number; height: number },
  crop: ImageEdit["crop"],
): number[] {
  const out: number[] = [];
  for (let p = 0; p + 1 < points.length; p += 2) {
    const mapped = toTilePoint({ x: points[p]!, y: points[p + 1]! }, tile, crop);
    out.push(mapped.x, mapped.y);
  }
  return out;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: {
    backgroundColor: "#12161b",
    borderWidth: 1,
    borderColor: "#232a33",
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  tabs: { flexDirection: "row", alignItems: "center", gap: 8 },
  tab: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    backgroundColor: "#222b35",
    borderWidth: 1,
    borderColor: "#2c3540",
    borderRadius: 6,
  },
  tabActive: { backgroundColor: "#2f6feb", borderColor: "#2f6feb" },
  tabText: { color: "#e6edf3", fontSize: 15 },
  tabTextActive: { color: "#ffffff", fontWeight: "700" },
  zoomGroup: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto" },
  zoomReadout: { color: "#8b98a6", fontSize: 13, minWidth: 44, textAlign: "center" },
  hint: { color: "#5b6673", fontSize: 12 },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  action: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: "#222b35",
    borderWidth: 1,
    borderColor: "#2c3540",
    borderRadius: 6,
  },
  actionText: { color: "#e6edf3", fontSize: 15 },
  danger: { backgroundColor: "#2a1618", borderColor: "#5c2b2f" },
  dangerText: { color: "#f87171", fontSize: 15 },
});
