import React, { useState } from "react";
import { View } from "react-native";
import { Canvas, Fill, Circle } from "@shopify/react-native-skia";

export interface SpikeCanvasProps {
  width: number;
  height: number;
}

/**
 * Throwaway. Proves three things at once:
 *   1. A Skia canvas mounts and paints.
 *   2. Touch input reaches it.
 *   3. The identical source renders on both Next.js and Expo.
 */
export function SpikeCanvas({ width, height }: SpikeCanvasProps) {
  const [pos, setPos] = useState({ x: width / 2, y: height / 2 });

  return (
    <View
      style={{ width, height }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) =>
        setPos({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY })
      }
      onResponderMove={(e) =>
        setPos({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY })
      }
    >
      <Canvas style={{ width, height }}>
        <Fill color="#14161a" />
        <Circle cx={pos.x} cy={pos.y} r={48} color="#4ade80" />
      </Canvas>
    </View>
  );
}
