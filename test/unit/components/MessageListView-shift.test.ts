import { describe, expect, it } from "vitest";
import { shouldShiftAnchor } from "../../../src/mainview/components/chat/MessageListView";

describe("shouldShiftAnchor (virtua shift derivation)", () => {
  // Prepend (upward page-up): first id changes and the list grows → the
  // virtualizer must anchor from the end so the viewport stays put.
  it("returns true when older items are prepended", () => {
    expect(
      shouldShiftAnchor({
        prevFirstId: "msg-50",
        nextFirstId: "msg-10",
        prevCount: 50,
        nextCount: 100,
      }),
    ).toBe(true);
  });

  // Append (streaming / new messages): first id unchanged → shift off, the
  // list must keep anchoring from the start so bottom-follow works.
  it("returns false when items are appended at the tail", () => {
    expect(
      shouldShiftAnchor({
        prevFirstId: "msg-0",
        nextFirstId: "msg-0",
        prevCount: 50,
        nextCount: 51,
      }),
    ).toBe(false);
  });

  it("returns false when nothing changed", () => {
    expect(
      shouldShiftAnchor({
        prevFirstId: "msg-0",
        nextFirstId: "msg-0",
        prevCount: 50,
        nextCount: 50,
      }),
    ).toBe(false);
  });

  // First render / session switch / rollback: no previous baseline to anchor
  // against — leave anchoring to the normal scroll restore paths.
  it("returns false without a previous baseline", () => {
    expect(
      shouldShiftAnchor({
        prevFirstId: null,
        nextFirstId: "msg-10",
        prevCount: 0,
        nextCount: 100,
      }),
    ).toBe(false);
  });

  // Tail trim while loading more (bounded window drops newest items): first
  // id unchanged → not a prepend, no shift.
  it("returns false when the first id is stable even if the count shrinks", () => {
    expect(
      shouldShiftAnchor({
        prevFirstId: "msg-0",
        nextFirstId: "msg-0",
        prevCount: 300,
        nextCount: 300,
      }),
    ).toBe(false);
  });
});
