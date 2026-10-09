/**
 * ion channel 声明式映射表 —— app channel 方法 → ion 调用。
 *
 * 铁律约束：本文件只准是数据（对象字面量 + 纯转换函数），出现 if/else 业务
 * 逻辑即违规。未映射的 channel/方法在运行时抛显式错误（缺口可见，不静默）。
 *
 * 形状依据：docs/plans/ion-backend/contract-matrix.md §2（2026-10-09 实测）：
 *  - file-review → worker_rpc 顶层 RPC（review_pending/review_approve/...）；
 *  - bash-ext → extension_rpc {extension:"bash"}（list/kill/send/remove）；
 *  - rules-engine → extension_rpc {extension:"rules-engine"}（list）。
 */

export interface IonChannelMapping {
  /** ion 顶层 session RPC（如 review_pending） */
  kind: "rpc";
  method: string;
  adaptParams?: (params: Record<string, unknown>) => Record<string, unknown>;
  adaptResult?: (result: unknown) => unknown;
}

export interface IonExtensionMapping {
  /** extension_rpc 路由（结果取 data.output） */
  kind: "extension";
  extension: string;
  method: string;
  adaptResult?: (output: unknown) => unknown;
}

export type IonChannelTarget = IonChannelMapping | IonExtensionMapping;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export const ION_CHANNEL_MAP: Readonly<Record<string, Readonly<Record<string, IonChannelTarget>>>> =
  {
    "file-review": {
      // ion 条目 {diffStat, path, status:"added"}（status 是文件状态）→ pi
      // PendingChangeResult（fileStatus 与审核 status 分离）。原样透传曾导致
      // 审核 tab 整树崩溃（ChangeItem2 读越界枚举 → undefined.Icon）。
      "review.pending": {
        kind: "rpc",
        method: "review_pending",
        adaptResult: (result) => ({
          result: (Array.isArray(asRecord(result).pending)
            ? (asRecord(result).pending as unknown[])
            : []
          ).map((item) => {
            const i = asRecord(item);
            const fileStatus =
              i.fileStatus ??
              (i.status === "added" || i.status === "deleted" ? i.status : "modified");
            const diffStat = typeof i.diffStat === "string" ? i.diffStat : "";
            const addedMatch = /(\d+)\+/.exec(diffStat);
            const deletedMatch = /(\d+)-/.exec(diffStat);
            return {
              turnIndex: typeof i.turnIndex === "number" ? i.turnIndex : 0,
              path: typeof i.path === "string" ? i.path : "",
              fileStatus,
              status: (i.reviewStatus as string) ?? "pending",
              timestamp: typeof i.timestamp === "number" ? i.timestamp : 0,
              oldContent: null,
              newContent: null,
              ...(addedMatch ? { addedLines: Number(addedMatch[1]) } : {}),
              ...(deletedMatch ? { deletedLines: Number(deletedMatch[1]) } : {}),
            };
          }),
        }),
      },
      "review.approvals": {
        kind: "rpc",
        method: "review_approvals",
        adaptResult: (result) => ({
          result: (Array.isArray(asRecord(result).approvals)
            ? (asRecord(result).approvals as unknown[])
            : []
          ).map((item) => {
            const i = asRecord(item);
            return {
              turnIndex: typeof i.turnIndex === "number" ? i.turnIndex : 0,
              path: typeof i.path === "string" ? i.path : "",
              status: (i.status as string) ?? "approved",
              timestamp: typeof i.timestamp === "number" ? i.timestamp : 0,
            };
          }),
        }),
      },
      "review.approve": { kind: "rpc", method: "review_approve" },
      "review.reject": { kind: "rpc", method: "review_reject" },
      "review.approveAll": { kind: "rpc", method: "review_approve_all" },
      "review.rejectAll": { kind: "rpc", method: "review_reject_all" },
    },
    "bash-ext": {
      list: {
        kind: "extension",
        extension: "bash",
        method: "list",
        adaptResult: (output) => asRecord(output).processes ?? [],
      },
      kill: { kind: "extension", extension: "bash", method: "kill" },
      write_stdin: { kind: "extension", extension: "bash", method: "send" },
      remove: { kind: "extension", extension: "bash", method: "remove" },
    },
    "rules-engine": {
      getSnapshot: { kind: "extension", extension: "rules-engine", method: "list" },
    },
  };

/** 查映射；未映射返回 undefined（调用方抛显式错误） */
export function lookupIonChannel(
  channelName: string,
  method: string,
): IonChannelTarget | undefined {
  return ION_CHANNEL_MAP[channelName]?.[method];
}
