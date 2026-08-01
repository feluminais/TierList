import { useWindowDimensions, View } from "react-native";
import { SpikeCanvas } from "@tl/editor-spike";

export default function Home() {
  const { width, height } = useWindowDimensions();
  return (
    <View style={{ flex: 1 }}>
      <SpikeCanvas width={width} height={height} />
    </View>
  );
}
