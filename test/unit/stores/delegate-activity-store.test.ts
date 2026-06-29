import { beforeEach, describe, expect, it } from "vitest";
import { useDelegateActivityStore } from "../../../src/mainview/stores/use-delegate-activity-store";

function textUpdate(text: string) {
  return {
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

describe("useDelegateActivityStore", () => {
  beforeEach(() => {
    useDelegateActivityStore.setState({ bySession: {} });
  });

  it("does not resurrect a completed delegate activity when a delayed message_update arrives", () => {
    const store = useDelegateActivityStore.getState();

    store.handleEvent("child-1", { type: "agent_start" });
    store.handleEvent("child-1", textUpdate("Working..."));
    store.handleEvent("child-1", { type: "agent_end" });

    expect(useDelegateActivityStore.getState().bySession["child-1"].status).toBe("done");
    expect(useDelegateActivityStore.getState().bySession["child-1"].rounds.at(-1)?.status).toBe(
      "done",
    );

    store.handleEvent("child-1", textUpdate("Late flushed output"));

    const activity = useDelegateActivityStore.getState().bySession["child-1"];
    expect(activity.status).toBe("done");
    expect(activity.rounds.at(-1)?.status).toBe("done");
  });

  it("normalizes repeated streaming text into a single meaningful summary", () => {
    const store = useDelegateActivityStore.getState();

    store.handleEvent("child-2", { type: "agent_start" });
    store.handleEvent(
      "child-2",
      textUpdate(
        "子会话已启动，准备执行任务... 让我先检查当前项目目录结构，然后创建临时文件。 子会话已启动，准备执行任务...",
      ),
    );

    const activity = useDelegateActivityStore.getState().bySession["child-2"];
    expect(activity.rounds.at(-1)?.summary).toBe("让我先检查当前项目目录结构，然后创建临时文件。");
  });
});
