import { describe, expect, it } from "vitest";
import {
  getPreviewRenderablePath,
  getPreviewRenderableSource,
  isPreviewRemoteUrl,
  normalizePreviewDetails,
} from "../../../src/mainview/components/chat/preview/types";

describe("normalizePreviewDetails", () => {
  it("preserves full preview details from toolResult", () => {
    expect(
      normalizePreviewDetails({
        source: "/tmp/demo.png",
        absolutePath: "/tmp/demo.png",
        resourceType: "image",
        mimeType: "image/png",
        status: "ok",
        size: 1234,
        title: "demo",
      }),
    ).toEqual({
      source: "/tmp/demo.png",
      absolutePath: "/tmp/demo.png",
      resourceType: "image",
      mimeType: "image/png",
      status: "ok",
      size: 1234,
      title: "demo",
      error: undefined,
    });
  });

  it("upgrades custom preview data into renderable preview details", () => {
    expect(
      normalizePreviewDetails({
        source: "/tmp/demo.png",
        type: "image",
        mimeType: "image/png",
        status: "ok",
        size: 1234,
        title: "demo",
      }),
    ).toEqual({
      source: "/tmp/demo.png",
      absolutePath: "/tmp/demo.png",
      resourceType: "image",
      mimeType: "image/png",
      status: "ok",
      size: 1234,
      title: "demo",
      error: undefined,
    });
  });

  it("does not treat remote urls as local absolute paths", () => {
    expect(
      normalizePreviewDetails({
        source: "https://example.com/demo.png",
        type: "image",
        mimeType: "image/png",
        status: "ok",
      }),
    ).toEqual({
      source: "https://example.com/demo.png",
      absolutePath: undefined,
      resourceType: "image",
      mimeType: "image/png",
      status: "ok",
      size: undefined,
      title: undefined,
      error: undefined,
    });
  });

  it("resolves relative preview sources against known project roots", () => {
    expect(
      normalizePreviewDetails(
        {
          source: "assets/demo.png",
          type: "image",
          mimeType: "image/png",
          status: "ok",
          title: "demo",
        },
        ["/Users/xuyingzhou/Project/temporary/pi-agent-chat"],
      ),
    ).toEqual({
      source: "assets/demo.png",
      absolutePath: "/Users/xuyingzhou/Project/temporary/pi-agent-chat/assets/demo.png",
      resourceType: "image",
      mimeType: "image/png",
      status: "ok",
      size: undefined,
      title: "demo",
      error: undefined,
    });
  });

  it("uses a local absolute source as the renderable path when absolutePath is missing", () => {
    expect(
      getPreviewRenderablePath({
        source: "/tmp/demo.png",
        resourceType: "image",
        status: "ok",
        title: "demo",
      }),
    ).toBe("/tmp/demo.png");
  });

  it("uses an http source as the renderable source", () => {
    expect(
      getPreviewRenderableSource({
        source: "https://example.com/demo.png",
        resourceType: "image",
        status: "ok",
        title: "demo",
      }),
    ).toBe("https://example.com/demo.png");
  });

  it("identifies renderable http sources as remote urls", () => {
    expect(isPreviewRemoteUrl("https://example.com/demo.png")).toBe(true);
    expect(isPreviewRemoteUrl("/tmp/demo.png")).toBe(false);
  });
});
