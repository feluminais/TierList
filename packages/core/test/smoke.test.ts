import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index";

describe("@tl/core", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@tl/core");
  });
});
