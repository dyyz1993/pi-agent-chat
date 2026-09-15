import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AskUserQuestionCard } from "../../../src/mainview/components/chat/tool-renderers/UICardRenderer";

/**
 * Mobile approval-card regression (2026-09-15, reported from a 390x844 phone):
 * goal_approval contracts put the whole contract text into the first
 * question, which renders in the card header block. That block was
 * `shrink-0` with no height cap, so a long contract (914px natural height)
 * consumed the whole `max-h-[min(540px,62vh)]` card and pushed the options
 * strip (Approve/Refine/Reject) to a 15px sliver and the footer
 * (忽略/提交) past the card's overflow-hidden clip — buttons untappable.
 *
 * Layout contract: the header block must cap its own height and scroll
 * internally so the options area and footer always stay inside the card.
 */
describe("AskUserQuestionCard mobile layout", () => {
  function renderPendingCard(questionText: string) {
    return render(
      <AskUserQuestionCard
        block={{
          type: "uiInteraction",
          id: "req-1",
          method: "askUserQuestion",
          status: "pending",
          title: "Approve Goal contract",
          message: undefined,
          questions: [
            {
              id: "q1",
              header: "Goal contract",
              question: questionText,
              options: [
                { label: "Approve", description: "allow exactly" },
                { label: "Refine", description: "amend" },
                { label: "Reject", description: "decline" },
              ],
            },
          ],
          sessionId: "s1",
          timeout: undefined,
        }}
      />,
    );
  }

  const longContract = "契约正文".repeat(600); // ~2.4k chars → far taller than the card cap

  it("caps the question header block height and scrolls internally", () => {
    const { container } = renderPendingCard(longContract);
    const card = container.querySelector<HTMLElement>('[class*="62vh"]');
    expect(card).not.toBeNull();
    expect(card!.className).toContain("flex-col");
    // The header block (first child holding title + question text) must be
    // height-capped and internally scrollable instead of unbounded shrink-0.
    const header = card!.children[0] as HTMLElement;
    expect(header.className).toMatch(/max-h-\[/);
    expect(header.className).toContain("overflow-y-auto");
  });

  it("keeps the options strip as a bounded scroll area (not squeezed flat)", () => {
    const { container } = renderPendingCard(longContract);
    const card = container.querySelector<HTMLElement>('[class*="62vh"]')!;
    const optionsArea = card.querySelector<HTMLElement>(".overflow-y-auto.min-h-0, [class*='min-h-0'][class*='overflow-y-auto']");
    expect(optionsArea).not.toBeNull();
    expect(optionsArea!.className).toContain("flex-1");
    // options buttons still render in the DOM within that area
    const labels = [...optionsArea!.querySelectorAll("button")].map((b) =>
      (b.textContent ?? "").trim(),
    );
    expect(labels.some((t) => t.startsWith("Approve"))).toBe(true);
  });

  it("keeps the action footer inside the card (shrink-0, bordered)", () => {
    const { container } = renderPendingCard(longContract);
    const card = container.querySelector<HTMLElement>('[class*="62vh"]')!;
    const footer = [...card.children].find((c) =>
      (c as HTMLElement).className.includes("border-t"),
    ) as HTMLElement | undefined;
    expect(footer).toBeDefined();
    expect(footer!.className).toContain("shrink-0");
    const footerText = (footer!.textContent ?? "").trim();
    expect(footerText.length).toBeGreaterThan(0);
  });
});
