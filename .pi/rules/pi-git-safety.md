---
description: Prevent accidental merge, deletion, revert, publish, or unrelated commit mistakes.
severity: critical
---

# Pi Git Safety

- Do not run destructive commands such as `git reset --hard`, `git checkout -- <path>`, force push, branch deletion, or worktree deletion unless the user explicitly requested that exact action.
- Do not merge to `master` or another integration branch until the changed modules, dirty files, validation evidence, and user acceptance are clear.
- Do not stage or commit unrelated files.
- Before any merge-sensitive summary, name the files that are newly changed by this task and separate them from pre-existing dirty worktree state.
