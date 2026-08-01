import { createTierList, reduce, type TierList } from "@tl/core";
import { TierBoard } from "@tl/editor";
import { useMemo } from "react";
import { ScrollView, useWindowDimensions } from "react-native";

export default function Home() {
  const { width } = useWindowDimensions();
  const doc = useMemo(() => sampleDoc(), []);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#0b0d10" }}>
      <TierBoard doc={doc} width={width} />
    </ScrollView>
  );
}

/** A throwaway document so there is something to look at. Milestone 2D loads a real one. */
function sampleDoc(): TierList {
  const now = "2026-08-01T12:00:00.000Z";
  let doc = createTierList({ id: "preview", now });
  const labels = ["Ramen", "Udon", "Soba", "Pho", "Laksa", "Bun bo Hue"];
  labels.forEach((label, i) => {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label }, now);
  });
  doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: "preview-row-0", index: 0 }, now);
  doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: "preview-row-0", index: 1 }, now);
  doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: "preview-row-1", index: 0 }, now);
  return doc;
}
