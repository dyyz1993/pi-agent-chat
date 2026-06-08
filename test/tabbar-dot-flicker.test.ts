import { describe, it, expect } from "vitest";
import {
  resolveDotClass,
  hasPermissionPending,
} from "../src/mainview/components/tab-bar/tab-dot";

describe("TabBar dot resolution: 区分 unknown / idle / running / permission", () => {
  describe("resolveDotClass", () => {
    it("未知状态（未加载）应该显示中性加载色，不应该和 idle 都用绿色", () => {
      // 修复前：未知会被默认为 bg-status-success（绿），与已加载的 idle 撞色，
      // 导致用户看到「项目闪一下变绿，又被纠正成黄/红」的 strobe 错觉。
      // 修复后：未知单独走中性色（bg-text-tertiary/40），与已加载的 idle 区分开。
      const classes = resolveDotClass("unknown", [], {});
      expect(classes).not.toContain("bg-status-success");
      // 中性态不能是 streaming 颜色
      expect(classes).not.toContain("bg-status-warning");
      expect(classes).not.toContain("animate-pulse");
      // 中性态不能是 error 颜色
      expect(classes).not.toContain("bg-status-error");
    });

    it("已加载且所有 session 都是 idle，应该显示绿色 bg-status-success", () => {
      const classes = resolveDotClass("loaded", [{ sessionId: "s1" }, { sessionId: "s2" }], {
        s1: "idle",
        s2: "idle",
      });
      expect(classes).toContain("bg-status-success");
      expect(classes).not.toContain("animate-pulse");
    });

    it("有 streaming / compacting 的 session，应该显示黄色 + pulse", () => {
      const classes = resolveDotClass(
        "loaded",
        [{ sessionId: "s1" }, { sessionId: "s2" }],
        { s1: "idle", s2: "streaming" },
      );
      expect(classes).toContain("bg-status-warning");
      expect(classes).toContain("animate-pulse");
    });

    it("有 permission / retrying 的 session，应该显示红色，优先级高于 streaming", () => {
      const classes = resolveDotClass(
        "loaded",
        [{ sessionId: "s1" }, { sessionId: "s2" }],
        { s1: "streaming", s2: "permission" },
      );
      expect(classes).toContain("bg-status-error");
      expect(classes).not.toContain("animate-pulse");
    });

    it("已加载但无 session（如新建的空项目），应该按 idle 绿色显示", () => {
      const classes = resolveDotClass("loaded", [], {});
      expect(classes).toContain("bg-status-success");
    });
  });

  describe("hasPermissionPending", () => {
    it("未知状态不应误报 permission pending", () => {
      expect(hasPermissionPending("unknown", [], { s1: "permission" })).toBe(false);
    });

    it("已加载且有 session 在 permission 状态，返回 true", () => {
      expect(
        hasPermissionPending("loaded", [{ sessionId: "s1" }], { s1: "permission" }),
      ).toBe(true);
    });

    it("已加载但所有 session 都非 permission，返回 false", () => {
      expect(
        hasPermissionPending(
          "loaded",
          [{ sessionId: "s1" }, { sessionId: "s2" }],
          { s1: "idle", s2: "streaming" },
        ),
      ).toBe(false);
    });
  });

  describe("防 flicker：未知 → 已加载的过渡应当是确定性单步", () => {
    it("未知和 idle 必须用不同的 className，避免 '绿→其他' 的视觉跳变", () => {
      // 这是 strobe 的最小可复现特征：渲染 unknown 时是 A，渲染 idle 时是 B，
      // A !== B 即可被肉眼察觉（中性 vs 绿）。
      const unknownClasses = resolveDotClass("unknown", [], {});
      const idleClasses = resolveDotClass("loaded", [], {});
      expect(unknownClasses).not.toBe(idleClasses);
    });

    it("未知 → idle → streaming 必须串成中性→绿→黄 的确定性单步过渡", () => {
      // 模拟首屏加载：unknown → idle → streaming 三态
      // 修复后应该是 unknown（中性）→ idle（绿）→ streaming（黄+pulse）
      // 修复前是 idle（绿）默认 → idle（绿）保持 → streaming（黄+pulse）
      // 关键：unknown 不能和 idle 同色，否则用户看到「绿一下又变绿然后变黄」的假闪烁
      const seq = [
        resolveDotClass("unknown", [], {}), // 首屏
        resolveDotClass("loaded", [], {}), // sessions 加载完但都 idle
        resolveDotClass("loaded", [{ sessionId: "s1" }], { s1: "streaming" }), // 用户发消息
      ];
      // 第一次必须是中性色，不与第二次同色
      expect(seq[0]).not.toBe(seq[1]);
      // 第二次与第三次必须不同（语义不同）
      expect(seq[1]).not.toBe(seq[2]);
      // 三态应当构成显式可区分的视觉序列
      expect(new Set(seq).size).toBe(3);
    });
  });
});
