import { describe, expect, it } from "vitest";
import { setHash } from "../pages/Upload";

describe("setHash", () => {
  it("is the file hash for a single image and order-independent for several", async () => {
    expect(await setHash(["aaa"])).toBe("aaa");
    expect(await setHash(["a", "b", "c"])).toBe(await setHash(["c", "a", "b"]));
    expect(await setHash(["a", "b"])).not.toBe(await setHash(["a", "c"]));
  });
});
