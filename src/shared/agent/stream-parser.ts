import type { AgentEvent } from "../modules/agent";

export class StreamParser {
  private buffer = "";

  feed(data: string): AgentEvent[] {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    const events: AgentEvent[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as AgentEvent);
      } catch {
        continue;
      }
    }
    return events;
  }
}
