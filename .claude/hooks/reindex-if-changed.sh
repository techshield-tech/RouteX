#!/usr/bin/env bash
# Stop hook: reindex codebase-memory only when the working tree changed since the last index.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
state="$(git rev-parse --git-dir)/codebase-memory-last-index"

# HEAD + tracked diffs + untracked file contents, so commits, edits and new files all count.
fingerprint=$(
  {
    git rev-parse HEAD
    git diff HEAD --binary
    git ls-files -z --others --exclude-standard | xargs -0 -r sha1sum
  } | sha1sum | cut -d' ' -f1
)

[ -f "$state" ] && [ "$(cat "$state")" = "$fingerprint" ] && exit 0

/root/.local/bin/codebase-memory-mcp cli index_repository "{\"repo_path\":\"$PWD\"}" >/dev/null 2>&1
echo "$fingerprint" > "$state"
