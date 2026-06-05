import type { ChannelContract } from "@dyyz1993/pi-coding-agent";
import { type Static } from "@sinclair/typebox";
export declare const BaseGuardConfigSchema: import("@sinclair/typebox").TObject<{
    /** Guard unique identifier */
    name: import("@sinclair/typebox").TString;
    /** Enable/disable this specific guard */
    enable: import("@sinclair/typebox").TBoolean;
}>;
export declare const TodoGuardConfigSchema: import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
    /** Guard unique identifier */
    name: import("@sinclair/typebox").TString;
    /** Enable/disable this specific guard */
    enable: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"todo">;
}>]>;
export declare const SpecsGuardConfigSchema: import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
    /** Guard unique identifier */
    name: import("@sinclair/typebox").TString;
    /** Enable/disable this specific guard */
    enable: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"specs">;
    /** Path to specs file, relative to project root */
    specsFile: import("@sinclair/typebox").TString;
    /** Max iterations for specs guard (0 = infinite) */
    maxIterations: import("@sinclair/typebox").TInteger;
}>]>;
export declare const CiGuardConfigSchema: import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
    /** Guard unique identifier */
    name: import("@sinclair/typebox").TString;
    /** Enable/disable this specific guard */
    enable: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"ci">;
    /** Command to check CI status */
    checkCommand: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    /** Polling interval in ms */
    pollIntervalMs: import("@sinclair/typebox").TInteger;
}>]>;
export declare const KeywordGuardConfigSchema: import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
    /** Guard unique identifier */
    name: import("@sinclair/typebox").TString;
    /** Enable/disable this specific guard */
    enable: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"keyword">;
    /** Keywords that indicate incomplete work */
    keywords: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
}>]>;
export declare const CustomGuardConfigSchema: import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
    /** Guard unique identifier */
    name: import("@sinclair/typebox").TString;
    /** Enable/disable this specific guard */
    enable: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"custom">;
    /** System prompt for the guard model */
    checkPrompt: import("@sinclair/typebox").TString;
    /** Prompt template for generating continue message */
    continuePromptTemplate: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>]>;
export declare const GuardConfigSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
    /** Guard unique identifier */
    name: import("@sinclair/typebox").TString;
    /** Enable/disable this specific guard */
    enable: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"todo">;
}>]>, import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
    /** Guard unique identifier */
    name: import("@sinclair/typebox").TString;
    /** Enable/disable this specific guard */
    enable: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"specs">;
    /** Path to specs file, relative to project root */
    specsFile: import("@sinclair/typebox").TString;
    /** Max iterations for specs guard (0 = infinite) */
    maxIterations: import("@sinclair/typebox").TInteger;
}>]>, import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
    /** Guard unique identifier */
    name: import("@sinclair/typebox").TString;
    /** Enable/disable this specific guard */
    enable: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"ci">;
    /** Command to check CI status */
    checkCommand: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    /** Polling interval in ms */
    pollIntervalMs: import("@sinclair/typebox").TInteger;
}>]>, import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
    /** Guard unique identifier */
    name: import("@sinclair/typebox").TString;
    /** Enable/disable this specific guard */
    enable: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"keyword">;
    /** Keywords that indicate incomplete work */
    keywords: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
}>]>, import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
    /** Guard unique identifier */
    name: import("@sinclair/typebox").TString;
    /** Enable/disable this specific guard */
    enable: import("@sinclair/typebox").TBoolean;
}>, import("@sinclair/typebox").TObject<{
    type: import("@sinclair/typebox").TLiteral<"custom">;
    /** System prompt for the guard model */
    checkPrompt: import("@sinclair/typebox").TString;
    /** Prompt template for generating continue message */
    continuePromptTemplate: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>]>]>;
export type GuardConfig = Static<typeof GuardConfigSchema>;
export declare const SupervisorConfigSchema: import("@sinclair/typebox").TObject<{
    /** Master switch — default OFF */
    enable: import("@sinclair/typebox").TBoolean;
    /** Check when agent ends a turn */
    checkOnAgentEnd: import("@sinclair/typebox").TBoolean;
    /** Small model for guard checks */
    smallModel: import("@sinclair/typebox").TString;
    /** Max auto-continue count (0 = infinite) */
    maxContinueCount: import("@sinclair/typebox").TInteger;
    /** Default delay before auto-continue */
    defaultDelayMs: import("@sinclair/typebox").TInteger;
    /** Delay threshold for pausing (vs immediate continue) */
    pauseThresholdMs: import("@sinclair/typebox").TInteger;
    /** Guard plugins */
    guards: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
        /** Guard unique identifier */
        name: import("@sinclair/typebox").TString;
        /** Enable/disable this specific guard */
        enable: import("@sinclair/typebox").TBoolean;
    }>, import("@sinclair/typebox").TObject<{
        type: import("@sinclair/typebox").TLiteral<"todo">;
    }>]>, import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
        /** Guard unique identifier */
        name: import("@sinclair/typebox").TString;
        /** Enable/disable this specific guard */
        enable: import("@sinclair/typebox").TBoolean;
    }>, import("@sinclair/typebox").TObject<{
        type: import("@sinclair/typebox").TLiteral<"specs">;
        /** Path to specs file, relative to project root */
        specsFile: import("@sinclair/typebox").TString;
        /** Max iterations for specs guard (0 = infinite) */
        maxIterations: import("@sinclair/typebox").TInteger;
    }>]>, import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
        /** Guard unique identifier */
        name: import("@sinclair/typebox").TString;
        /** Enable/disable this specific guard */
        enable: import("@sinclair/typebox").TBoolean;
    }>, import("@sinclair/typebox").TObject<{
        type: import("@sinclair/typebox").TLiteral<"ci">;
        /** Command to check CI status */
        checkCommand: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        /** Polling interval in ms */
        pollIntervalMs: import("@sinclair/typebox").TInteger;
    }>]>, import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
        /** Guard unique identifier */
        name: import("@sinclair/typebox").TString;
        /** Enable/disable this specific guard */
        enable: import("@sinclair/typebox").TBoolean;
    }>, import("@sinclair/typebox").TObject<{
        type: import("@sinclair/typebox").TLiteral<"keyword">;
        /** Keywords that indicate incomplete work */
        keywords: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    }>]>, import("@sinclair/typebox").TIntersect<[import("@sinclair/typebox").TObject<{
        /** Guard unique identifier */
        name: import("@sinclair/typebox").TString;
        /** Enable/disable this specific guard */
        enable: import("@sinclair/typebox").TBoolean;
    }>, import("@sinclair/typebox").TObject<{
        type: import("@sinclair/typebox").TLiteral<"custom">;
        /** System prompt for the guard model */
        checkPrompt: import("@sinclair/typebox").TString;
        /** Prompt template for generating continue message */
        continuePromptTemplate: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>]>]>>;
}>;
export type SupervisorConfig = Static<typeof SupervisorConfigSchema>;
export interface GuardCheckResult {
    /** This guard's name */
    guardName: string;
    /** Whether the guard thinks work is done */
    completed: boolean;
    /** Confidence 0-1 */
    confidence: number;
    /** Remaining items if not completed */
    remainingItems: string[];
    /** Optional detail message */
    detail?: string;
}
export interface GuardContinueMessage {
    /** The message to inject as supervisor continue */
    content: string;
    /** Whether this guard wants to block agent completion */
    blockCompletion: boolean;
}
export interface SupervisorChannelContract extends ChannelContract {
    methods: {
        getStatus: {
            params: Record<string, never>;
            return: SupervisorStatus;
        };
        requestPause: {
            params: {
                delayMs?: number;
                reason?: string;
            };
            return: {
                scheduled: boolean;
                scheduledAt?: number;
            };
        };
        cancelPause: {
            params: Record<string, never>;
            return: {
                cancelled: boolean;
            };
        };
        forceContinue: {
            params: {
                reason?: string;
            };
            return: {
                triggered: boolean;
            };
        };
        disable: {
            params: Record<string, never>;
            return: {
                disabled: boolean;
            };
        };
        enable: {
            params: Record<string, never>;
            return: {
                enabled: boolean;
            };
        };
        getTaskReport: {
            params: Record<string, never>;
            return: {
                tasks: TaskReport[];
            };
        };
        checkToolStatus: {
            params: {
                toolName: string;
                channelName?: string;
                method?: string;
            };
            return: {
                reachable: boolean;
                status?: string;
                error?: string;
            };
        };
    };
    events: {
        "supervisor.statusChanged": SupervisorStatus;
        "supervisor.pauseRequested": {
            delayMs: number;
            reason?: string;
        };
        "supervisor.pauseCancelled": {
            reason: string;
        };
        "supervisor.continueTriggered": {
            reason: string;
            delayMs: number;
        };
        "supervisor.taskReport": {
            tasks: TaskReport[];
        };
    };
}
export interface SupervisorStatus {
    enabled: boolean;
    state: "idle" | "checking" | "paused" | "continuing" | "disabled";
    continueCount: number;
    maxContinueCount: number;
    activeGuards: string[];
    lastCheckResult?: CheckResult;
    pendingPause?: {
        scheduledAt: number;
        delayMs: number;
        reason?: string;
    };
}
export interface CheckResult {
    completed: boolean;
    confidence: number;
    incompleteTasks: IncompleteTask[];
    modelResponse?: string;
    guardResults?: GuardCheckResult[];
}
export interface IncompleteTask {
    ruleName: string;
    description: string;
    severity: "high" | "medium" | "low";
}
export interface TaskReport {
    guardName: string;
    guardType: string;
    status: "completed" | "incomplete" | "unknown" | "error";
    details?: string;
    error?: string;
    remainingItems?: string[];
}
export declare const CompletionCheckSchema: import("@sinclair/typebox").TObject<{
    completed: import("@sinclair/typebox").TBoolean;
    confidence: import("@sinclair/typebox").TNumber;
    incompleteTasks: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        ruleName: import("@sinclair/typebox").TString;
        description: import("@sinclair/typebox").TString;
        severity: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"high">, import("@sinclair/typebox").TLiteral<"medium">, import("@sinclair/typebox").TLiteral<"low">]>;
    }>>;
    reasoning: import("@sinclair/typebox").TString;
}>;
export type CompletionCheckResult = Static<typeof CompletionCheckSchema>;
//# sourceMappingURL=types.d.ts.map