import {
  newId,
  newListId,
  readDraft,
  removeDraft,
  useApiClient,
  useAutosave,
  useDraft,
  type AutosaveHandlers,
} from "@tl/app-core";
import { createTierList, TIER_PALETTE, type TierList, type TierListAction } from "@tl/core";
import {
  applyAction,
  createSession,
  redoSession,
  resumeSession,
  saveFailed,
  saveStarted,
  saveSucceeded,
  undoSession,
} from "@tl/editor-core";
import { InteractiveBoard } from "@tl/editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { EditSheet } from "./EditSheet";
import { draftStore, lastListId, rememberListId, tokenStore } from "./storage";
import { Toolbar } from "./Toolbar";

/** How long to wait before asking the server for the list again after a failed load. */
const LOAD_RETRY_MS = 3000;

/** The clock lives at the boundary, exactly as it does on the web. */
function now(): string {
  return new Date().toISOString();
}

/**
 * The Android editor.
 *
 * Everything that is not drawing is shared with the web: `useApiClient`,
 * `useAutosave` and the session reducers are the same code, so "saved" means
 * the same thing on both and a change to the save protocol cannot land on one
 * platform only. What is written twice is the chrome — a phone has one column,
 * no hover and no address bar — and that is the part that *should* differ.
 *
 * This screen is also the only place edge autoscroll is exercised, because it
 * is the only place the board sits in a scroll container. Three measurements
 * have to reach the board for that: the viewport height it compares the
 * pointer against (`onLayout`), where the scroller currently is (`onScroll`),
 * and a way to move it (`scrollTo`). The board owns none of them.
 */
export default function Editor() {
  const { width } = useWindowDimensions();

  // Which list this device is editing. Resolved once, from storage, because a
  // phone has no URL to carry it. Null until that read settles.
  const [listId, setListId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const remembered = (await lastListId().catch(() => null)) ?? newListId();
      if (!alive) return;
      setListId(remembered);
      void rememberListId(remembered);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const connection = useApiClient(process.env.EXPO_PUBLIC_API_URL, {
    storage: tokenStore,
  });
  const client = connection.state === "connected" ? connection.client : null;

  const [session, setSession] = useState(() => createSession(emptyDoc("pending"), null));
  // Autosave is gated on this for the same reason it is on the web: until the
  // load resolves, `syncedRevision: null` would make the first write a create
  // over a document the server already holds.
  const [loaded, setLoaded] = useState(false);

  // The same load policy as the web editor, and for the same reasons: wait
  // while the connection is still being established, retry a load that could
  // not be asked rather than treat it as "no such list", and resume whatever
  // this device kept through `resumeSession`.
  useEffect(() => {
    if (!listId || connection.state === "connecting") return;

    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;

    if (!client) {
      void (async () => {
        const draft = await readDraft(draftStore, listId);
        if (!alive) return;
        setSession(
          draft
            ? createSession(draft.doc, draft.baseRevision)
            : createSession(emptyDoc(listId), null),
        );
        setLoaded(true);
      })();
      return () => {
        alive = false;
      };
    }

    const load = async () => {
      let stored: TierList | null;
      try {
        stored = await client.getList(listId);
      } catch {
        if (alive) retry = setTimeout(() => void load(), LOAD_RETRY_MS);
        return;
      }
      if (!alive) return;

      const draft = await readDraft(draftStore, listId);
      const resumed = resumeSession(stored, draft, emptyDoc(listId), {
        id: newListId(),
        now: now(),
      });
      if (resumed.recovered) {
        try {
          await client.createList(resumed.recovered);
        } catch {
          if (alive) retry = setTimeout(() => void load(), LOAD_RETRY_MS);
          return;
        }
        await removeDraft(draftStore, listId);
      }
      if (!alive) return;
      setSession(resumed.session);
      setLoaded(true);
    };
    void load();

    return () => {
      alive = false;
      clearTimeout(retry);
    };
  }, [listId, client, connection.state]);

  const dispatch = useCallback((action: TierListAction) => {
    setSession((current) => applyAction(current, action, now()));
  }, []);

  const undo = useCallback(() => setSession((c) => undoSession(c, now())), []);
  const redo = useCallback(() => setSession((c) => redoSession(c, now())), []);

  const handlers = useMemo<AutosaveHandlers>(
    () => ({
      onSaveStarted: () => setSession((c) => saveStarted(c)),
      onSaveSucceeded: (acknowledged) => setSession((c) => saveSucceeded(c, acknowledged)),
      onSaveFailed: (failure) => setSession((c) => saveFailed(c, failure)),
    }),
    [],
  );
  const { flush } = useAutosave(session, loaded ? client : null, handlers);
  useDraft(listId ?? "", session, loaded && listId !== null, draftStore);

  // Leaving the foreground is the last moment a phone reliably lets the app
  // run; a save still waiting on its debounce goes now.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    return () => subscription.remove();
  }, [flush]);

  // Which tile the edit sheet is open on. Cleared when that item goes away —
  // removed, or undone back past when it was added.
  const [editing, setEditing] = useState<string | null>(null);
  const editingItem = editing ? session.doc.items.find((i) => i.id === editing) : undefined;
  useEffect(() => {
    if (editing && !editingItem) setEditing(null);
  }, [editing, editingItem]);

  const assetUrl = useCallback(
    (id: string) => (client ? client.assetUrl(id) : ""),
    [client],
  );

  // --- the scroll container, and the three measurements autoscroll needs ---
  const scroller = useRef<ScrollView>(null);
  const [scrollY, setScrollY] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [dragging, setDragging] = useState(false);

  // The same offset as `scrollY`, kept in a ref because the autoscroll tick
  // needs it *now*. React state is a commit behind, and each frame's target is
  // built from the last one — off a stale base the glide would stall.
  const offset = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    offset.current = y;
    setScrollY(y);
  }, []);
  const onAutoScroll = useCallback((delta: number) => {
    scroller.current?.scrollTo({ y: offset.current + delta, animated: false });
  }, []);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setViewportHeight(e.nativeEvent.layout.height);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#0b0d10" }}>
      <Toolbar
        session={session}
        connection={connection}
        onTitleChange={(title) => dispatch({ type: "meta/set", patch: { title } })}
        onUndo={undo}
        onRedo={redo}
        onAddItem={() =>
          dispatch({
            type: "item/addText",
            id: newId(),
            label: `Item ${session.doc.items.length + 1}`,
          })
        }
        onAddRow={() =>
          dispatch({
            type: "row/add",
            id: newId(),
            label: "",
            // The shared palette, indexed the same way the web indexes it, so
            // a tier added on a phone is the colour it would have been on a
            // desktop.
            color: TIER_PALETTE[session.doc.rows.length % TIER_PALETTE.length]!,
          })
        }
      />

      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        onLayout={onLayout}
        onScroll={onScroll}
        // Android's native default is already 0 — unthrottled, one event per
        // frame. This is for parity elsewhere; anything <= 16 is treated as no
        // throttle, and a throttled offset would make the drift correction
        // visibly steppy.
        scrollEventThrottle={16}
        // The lever that actually keeps a drag alive.
        //
        // `onResponderTerminationRequest` cannot do it: past the platform touch
        // slop the native `ReactScrollView` intercepts the touch stream itself
        // and the cancel that follows terminates the JS responder without ever
        // asking. `scrollEnabled: false` is checked first in
        // `onInterceptTouchEvent`, so the scroller never claims the gesture —
        // and it does not gate `scrollTo`, so autoscroll still drives it.
        scrollEnabled={!dragging}
      >
        <InteractiveBoard
          doc={session.doc}
          width={width}
          onAction={dispatch}
          onTap={setEditing}
          viewportHeight={viewportHeight}
          scrollY={scrollY}
          onAutoScroll={onAutoScroll}
          onDraggingChange={setDragging}
          assetUrl={assetUrl}
        />
        {session.doc.items.length === 0 ? (
          <Text style={{ color: "#5b6673", padding: 16, textAlign: "center" }}>
            Nothing here yet. “+ Item” adds a tile; drag it into a tier.
          </Text>
        ) : null}
      </ScrollView>

      {editingItem ? (
        <EditSheet
          item={editingItem}
          tileAspect={session.doc.display.tileAspect}
          assetUrl={assetUrl}
          onAction={dispatch}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

function emptyDoc(id: string): TierList {
  return createTierList({ id, now: "2026-08-01T12:00:00.000Z" });
}
