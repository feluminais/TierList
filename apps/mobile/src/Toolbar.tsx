import type { Connection } from "@tl/app-core";
import { DOCUMENT_LIMITS } from "@tl/core";
import type { EditorSession } from "@tl/editor-core";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export interface ToolbarProps {
  session: EditorSession;
  connection: Connection;
  onTitleChange: (title: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddItem: () => void;
  onAddRow: () => void;
}

/**
 * The phone's chrome, beside the same Skia board the web renders.
 *
 * Deliberately the same *readouts* as `apps/web`'s toolbar and deliberately
 * not the same layout: a phone has one column and no hover, so the controls
 * are large targets on two lines rather than a wrapping strip. What must match
 * is the save state — a user who cannot tell whether their work is saved has
 * the same problem on either platform.
 */
export function Toolbar({
  session,
  connection,
  onTitleChange,
  onUndo,
  onRedo,
  onAddItem,
  onAddRow,
}: ToolbarProps) {
  const save = saveReadout(session, connection);

  return (
    <View style={styles.bar}>
      <TextInput
        accessibilityLabel="List title"
        testID="title-input"
        value={session.doc.title}
        maxLength={DOCUMENT_LIMITS.titleLength}
        onChangeText={onTitleChange}
        placeholder="Untitled tier list"
        placeholderTextColor="#5b6673"
        style={styles.title}
      />

      <View style={styles.row}>
        <Button label="Undo" testID="undo" onPress={onUndo} disabled={!session.canUndo} />
        <Button label="Redo" testID="redo" onPress={onRedo} disabled={!session.canRedo} />
        <Button
          label="+ Item"
          testID="add-item"
          onPress={onAddItem}
          disabled={session.doc.items.length >= DOCUMENT_LIMITS.items}
        />
        <Button
          label="+ Tier"
          testID="add-row"
          onPress={onAddRow}
          disabled={session.doc.rows.length >= DOCUMENT_LIMITS.rows}
        />
      </View>

      <Text testID="save-status" style={[styles.readout, { color: save.color }]}>
        {save.text}
      </Text>
    </View>
  );
}

function Button({
  label,
  testID,
  onPress,
  disabled,
}: {
  label: string;
  testID: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      // 44 is the smallest target a finger hits reliably; the web toolbar can
      // be smaller because a mouse cannot miss.
      style={[styles.button, disabled && styles.buttonDisabled]}
    >
      <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

interface Readout {
  text: string;
  color: string;
}

/**
 * The same states the web reports, in the same words.
 *
 * `conflict` and `rejected` are the ones meaning the work is *not going to be*
 * saved, so they are the ones that shout.
 */
function saveReadout(session: EditorSession, connection: Connection): Readout {
  if (connection.state === "disconnected") {
    return { text: "Not connected — nothing is saved", color: "#8b98a6" };
  }
  if (connection.state === "connecting") return { text: "Connecting…", color: "#8b98a6" };
  if (connection.state === "failed") {
    return { text: "Not connected — server unreachable", color: "#fbbf24" };
  }

  switch (session.status) {
    case "saved":
      return { text: "Saved", color: "#4ade80" };
    case "dirty":
      return { text: "Unsaved changes", color: "#8b98a6" };
    case "saving":
      return { text: "Saving…", color: "#8b98a6" };
    case "error":
      return { text: "Save failed — retrying", color: "#fbbf24" };
    case "conflict":
      return { text: "Conflict — edited elsewhere. Nothing is being saved.", color: "#f87171" };
    case "rejected":
      return {
        text: "The server refused this list. Nothing is being saved; your edits stay on this device.",
        color: "#f87171",
      };
  }
}

const styles = StyleSheet.create({
  bar: {
    padding: 10,
    gap: 8,
    backgroundColor: "#12161b",
    borderBottomWidth: 1,
    borderBottomColor: "#232a33",
  },
  title: {
    backgroundColor: "#0b0d10",
    borderWidth: 1,
    borderColor: "#2c3540",
    borderRadius: 6,
    color: "#e6edf3",
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 16,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 14,
    backgroundColor: "#222b35",
    borderWidth: 1,
    borderColor: "#2c3540",
    borderRadius: 6,
  },
  buttonDisabled: { backgroundColor: "#171c22" },
  buttonText: { color: "#e6edf3", fontSize: 15 },
  buttonTextDisabled: { color: "#5b6673" },
  readout: { fontSize: 13 },
});
