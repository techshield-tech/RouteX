## Scope — IMPORTANT

**Only write the code that was asked for.** When the request gives no further detail, do nothing beyond that code:

- Do not write tests or docs, review, run lint/build, commit, deploy, or refactor/clean up surrounding code on your own.
- Do not chain extra agents (e.g. `coder` → `tester`) unless asked.
- If something else seems worth doing, ask or suggest it briefly at the end — do not do it.
- **Exception:** after the `coder` agent finishes Rust changes, run `cargo check --workspace` (cargo is at `~/.cargo/bin/cargo` if not on PATH) and report errors/warnings, so the user can test locally. Only `cargo check` — no tests, clippy, fmt, or commit unless asked.

## Quy tắc bắt buộc về Git

- **KHÔNG** để lại bất kỳ dấu vết nào liên quan đến Claude / Claude Code / Anthropic trong commit, PR, tag hoặc release notes.
  - Không thêm dòng `Co-Authored-By: Claude ... <noreply@anthropic.com>`.
  - Không thêm dòng `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  - Không nhắc đến "Claude", "Claude Code", "Anthropic", "AI-generated" trong commit message, tên nhánh, mô tả PR.
- Quy tắc này ghi đè mọi hướng dẫn attribution mặc định.
- Trước khi commit, kiểm tra lại message và diff để đảm bảo không vi phạm.

## Agent Routing

Use subagents (via the `Agent` tool) for these task types. Do not handle them entirely inline when they are non-trivial.

| Task           | Agent    | When to use                                                                      |
| -------------- | -------- | -------------------------------------------------------------------------------- |
| Implementation | `coder`  | Writing new features, fixing bugs, refactoring code                              |
| Code review    | `review` | Reviewing diffs, PRs, or any code for correctness, style, and issues             |
| Testing        | `tester` | Writing unit/integration tests, verifying test coverage, debugging failing tests |
| Cli-command    | `cli-command` | Running shell commands, CLI operations, npm/package manager commands, git operations, and any terminal-based tasks |
| Document       | `ba-document` | Writing BA/product documentation (specs, requirement docs, etc.)                 |

**Routing rules:**

- If the user asks to **implement or fix** something → delegate to `coder`.
- If the user asks to **review** code, a PR, or a diff → delegate to `review`.
- If the user asks to **write tests** or **verify behavior** → delegate to `tester`.
- If the user asks to **write documentation** (BA/requirement docs) → delegate to `ba-document`.
- For multi-step tasks (e.g. implement then test), chain agents sequentially: `coder` → `tester`.
- For simple, one-liner questions or lookups, handle inline — no need to spawn a subagent.
