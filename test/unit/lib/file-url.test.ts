import { describe, expect, it } from "vitest";
import { toLocalFileUrl } from "../../../src/mainview/lib/file-url";

describe("toLocalFileUrl", () => {
  it("encodes spaces and unicode characters in posix paths", () => {
    expect(toLocalFileUrl("/tmp/修复后 - 游戏中.png")).toBe(
      "file:///tmp/%E4%BF%AE%E5%A4%8D%E5%90%8E%20-%20%E6%B8%B8%E6%88%8F%E4%B8%AD.png",
    );
  });

  it("normalizes windows paths into valid file urls", () => {
    expect(toLocalFileUrl("C:\\Users\\Alice\\My File.png")).toBe(
      "file:///C:/Users/Alice/My%20File.png",
    );
  });
});
