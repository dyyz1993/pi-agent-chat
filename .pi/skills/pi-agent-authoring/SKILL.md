---
name: pi-agent-authoring
description: Create, inspect, or fix Pi agent definition files. Use when editing .pi/agents, global agents, agent frontmatter, agent roles, tool permissions, coordinator/worker prompts, or recommended agent metadata fields.
---

# Pi Agent Authoring

Pi agents are role definitions. Keep role boundaries in the prompt and keep tool permissions broad enough for the role unless the user asks for a restricted agent.

## Frontmatter

- Validate supported fields against the current runtime parser before adding new metadata.
- Use `name` and `description` clearly.
- Use `permissionMode` or `permissionProfile` only when the role needs an explicit permission posture.
- Omit `tools` when the agent should have all registered tools. Do not add a narrow tool whitelist only to silence a recommended-field warning.
- Add `skills` only when the agent should reliably load reusable procedural knowledge.
- Keep unsupported fields out of production agent files, even if other ecosystems use them.

## Prompt Body

- State responsibility, boundaries, and handoff format.
- For coordinators, say how to split work, track delegated tasks, collect validation, and avoid direct code edits if that is the role boundary.
- For workers, say how to inspect, implement, validate, and report evidence.
- For reviewers, lead with findings, risks, file references, and test gaps.

## Validation

1. Parse or load the agent through the runtime path, not only by reading Markdown.
2. Confirm recommended-field warnings are either fixed intentionally or documented as safe.
3. Run a small task that exercises the role boundary.
4. Verify the agent does not silently merge, delete, publish, or change permissions.
