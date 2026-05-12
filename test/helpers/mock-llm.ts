export interface MockStep {
  delay?: number;
  event: {
    type: string;
    [key: string]: unknown;
  };
}

export interface MockScenario {
  id: string;
  description: string;
  userInput: string;
  steps: MockStep[];
}

export function agentStart(): MockStep {
  return {
    delay: 0,
    event: { type: "agent_start" },
  };
}

export function agentEnd(): MockStep {
  return {
    delay: 50,
    event: { type: "agent_end" },
  };
}

export function messageStart(role: string, content: unknown[] = []): MockStep {
  return {
    delay: 30,
    event: {
      type: "message_start",
      message: { role, content },
    },
  };
}

export function messageUpdate(content: unknown[]): MockStep {
  return {
    delay: 40,
    event: {
      type: "message_update",
      message: { content },
    },
  };
}

export function messageEnd(tokenUsage?: {
  input: number;
  output: number;
  total: number;
}): MockStep {
  const usage = tokenUsage
    ? { input_tokens: tokenUsage.input, output_tokens: tokenUsage.output }
    : undefined;
  return {
    delay: 30,
    event: {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        ...(usage ? { usage } : {}),
      },
      ...(tokenUsage ? { entryId: `entry-${Date.now()}` } : {}),
    },
  };
}

export function toolCallStart(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): MockStep {
  return {
    delay: 20,
    event: {
      type: "tool_execution_start",
      toolCallId,
      toolName,
      args,
      timestamp: Date.now(),
    },
  };
}

export function toolCallUpdate(toolCallId: string, partialResult: string): MockStep {
  return {
    delay: 30,
    event: {
      type: "tool_execution_update",
      toolCallId,
      partialResult: { content: [{ type: "text", text: partialResult }] },
    },
  };
}

export function toolCallEnd(toolCallId: string, result: string, isError = false): MockStep {
  return {
    delay: 20,
    event: {
      type: "tool_execution_end",
      toolCallId,
      result: { content: [{ type: "text", text: result }] },
      isError,
    },
  };
}

export function thinkingBlockStart(): MockStep {
  return {
    delay: 10,
    event: {
      type: "message_update",
      message: {
        content: [{ type: "thinking", thinking: "" }],
      },
    },
  };
}

export function thinkingUpdate(text: string): MockStep {
  return {
    delay: 20,
    event: {
      type: "message_update",
      message: {
        content: [{ type: "thinking", thinking: text }],
      },
    },
  };
}

export class ScenarioPlayer {
  private aborted = false;

  constructor(
    private readonly handleEvent: (sessionId: string, event: Record<string, unknown>) => void,
    private readonly flushFn: () => void,
    private readonly sessionId: string,
  ) {}

  async play(scenario: MockScenario): Promise<void> {
    this.aborted = false;
    for (const step of scenario.steps) {
      if (this.aborted) break;
      const delay = step.delay ?? 50;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (this.aborted) break;
      this.handleEvent(this.sessionId, step.event as Parameters<typeof this.handleEvent>[1]);
      this.flushFn();
    }
  }

  abort(): void {
    this.aborted = true;
  }
}

export function matchScenario(userInput: string, scenarios: MockScenario[]): MockScenario | null {
  const normalized = userInput.trim().toLowerCase();
  for (const scenario of scenarios) {
    if (scenario.userInput.trim().toLowerCase() === normalized) {
      return scenario;
    }
  }
  for (const scenario of scenarios) {
    const keywords = scenario.userInput.trim().toLowerCase().split(/\s+/);
    if (keywords.length > 1 && keywords.every((kw) => normalized.includes(kw))) {
      return scenario;
    }
  }
  return null;
}
