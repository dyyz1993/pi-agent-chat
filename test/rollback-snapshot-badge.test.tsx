import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { SnapshotBadge } from "../src/mainview/components/chat/snapshot/SnapshotBadge";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const baseData = {
  diff: { added: ["a.ts"], modified: ["b.ts"], deleted: ["c.ts"] },
};

describe("SnapshotBadge – cases 51-56", () => {
  afterEach(cleanup);

  it("51: renders badge with 1 added, 1 modified, 1 deleted", () => {
    render(<SnapshotBadge data={baseData} blockId="test" />);
    expect(screen.getByText("fileChanges")).toBeInTheDocument();
    const ones = screen.getAllByText("1");
    expect(ones).toHaveLength(3);
  });

  it("52: click badge to expand shows file paths", () => {
    render(<SnapshotBadge data={baseData} blockId="test" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
    expect(screen.getByText("c.ts")).toBeInTheDocument();
  });

  it("53: click expand then collapse hides file list", () => {
    render(<SnapshotBadge data={baseData} blockId="test" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("a.ts")).not.toBeInTheDocument();
  });

  it("54: returns null when totalCount is 0", () => {
    const { container } = render(
      <SnapshotBadge data={{ diff: { added: [], modified: [], deleted: [] } }} blockId="empty" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("55: uses snapshot namespace – shows fileChanges key", () => {
    render(<SnapshotBadge data={baseData} blockId="i18n" />);
    expect(screen.getByText("fileChanges")).toBeInTheDocument();
  });

  it("56: multiple badges render independently", () => {
    render(
      <>
        <SnapshotBadge
          data={{ diff: { added: ["x.ts"], modified: [], deleted: [] } }}
          blockId="badge-a"
        />
        <SnapshotBadge
          data={{ diff: { added: [], modified: ["y.ts"], deleted: ["z.ts"] } }}
          blockId="badge-b"
        />
      </>,
    );
    const badges = screen.getAllByText("fileChanges");
    expect(badges).toHaveLength(2);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(screen.getByText("x.ts")).toBeInTheDocument();
    expect(screen.getByText("y.ts")).toBeInTheDocument();
    expect(screen.getByText("z.ts")).toBeInTheDocument();
  });
});
