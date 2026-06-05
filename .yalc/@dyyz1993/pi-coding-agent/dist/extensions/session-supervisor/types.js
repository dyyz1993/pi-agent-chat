import { Type } from "@sinclair/typebox";
// ── Guard Configuration ──
export const BaseGuardConfigSchema = Type.Object({
    /** Guard unique identifier */
    name: Type.String(),
    /** Enable/disable this specific guard */
    enable: Type.Boolean({ default: true }),
});
export const TodoGuardConfigSchema = Type.Intersect([
    BaseGuardConfigSchema,
    Type.Object({
        type: Type.Literal("todo"),
    }),
]);
export const SpecsGuardConfigSchema = Type.Intersect([
    BaseGuardConfigSchema,
    Type.Object({
        type: Type.Literal("specs"),
        /** Path to specs file, relative to project root */
        specsFile: Type.String({ default: "specs.md" }),
        /** Max iterations for specs guard (0 = infinite) */
        maxIterations: Type.Integer({ default: 100 }),
    }),
]);
export const CiGuardConfigSchema = Type.Intersect([
    BaseGuardConfigSchema,
    Type.Object({
        type: Type.Literal("ci"),
        /** Command to check CI status */
        checkCommand: Type.Optional(Type.String()),
        /** Polling interval in ms */
        pollIntervalMs: Type.Integer({ default: 30_000 }),
    }),
]);
export const KeywordGuardConfigSchema = Type.Intersect([
    BaseGuardConfigSchema,
    Type.Object({
        type: Type.Literal("keyword"),
        /** Keywords that indicate incomplete work */
        keywords: Type.Array(Type.String()),
    }),
]);
export const CustomGuardConfigSchema = Type.Intersect([
    BaseGuardConfigSchema,
    Type.Object({
        type: Type.Literal("custom"),
        /** System prompt for the guard model */
        checkPrompt: Type.String(),
        /** Prompt template for generating continue message */
        continuePromptTemplate: Type.Optional(Type.String()),
    }),
]);
export const GuardConfigSchema = Type.Union([
    TodoGuardConfigSchema,
    SpecsGuardConfigSchema,
    CiGuardConfigSchema,
    KeywordGuardConfigSchema,
    CustomGuardConfigSchema,
]);
// ── Main Supervisor Config ──
export const SupervisorConfigSchema = Type.Object({
    /** Master switch — default OFF */
    enable: Type.Boolean({ default: false }),
    /** Check when agent ends a turn */
    checkOnAgentEnd: Type.Boolean({ default: true }),
    /** Small model for guard checks */
    smallModel: Type.String({ default: "fast" }),
    /** Max auto-continue count (0 = infinite) */
    maxContinueCount: Type.Integer({ default: 5 }),
    /** Default delay before auto-continue */
    defaultDelayMs: Type.Integer({ default: 30_000 }),
    /** Delay threshold for pausing (vs immediate continue) */
    pauseThresholdMs: Type.Integer({ default: 300_000 }),
    /** Guard plugins */
    guards: Type.Array(GuardConfigSchema, { default: [] }),
});
// ── Structured LLM output ──
export const CompletionCheckSchema = Type.Object({
    completed: Type.Boolean({ description: "会话是否已经真正完成" }),
    confidence: Type.Number({ description: "置信度 0-1", minimum: 0, maximum: 1 }),
    incompleteTasks: Type.Array(Type.Object({
        ruleName: Type.String(),
        description: Type.String(),
        severity: Type.Union([
            Type.Literal("high"),
            Type.Literal("medium"),
            Type.Literal("low"),
        ]),
    })),
    reasoning: Type.String({ description: "判断理由" }),
});
//# sourceMappingURL=types.js.map