#!/usr/bin/env bash
set -euo pipefail

# install.sh — Copy PinheadOS agent definitions to a target tool's agents directory.
#
# Usage:
#   ./scripts/install.sh --tool claude-code          # install all agents
#   ./scripts/install.sh --tool claude-code --list    # list available agents
#   ./scripts/install.sh --tool claude-code --category engineering  # one category

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTS_SRC="$REPO_ROOT/agents"

TOOL=""
CATEGORY=""
LIST=false

usage() {
  cat <<EOF
Usage: $(basename "$0") --tool <tool-name> [OPTIONS]

Copy PinheadOS agent definitions to a tool's agents directory.

Options:
  --tool <name>        Target tool (required). Supported: claude-code
  --category <name>    Install only agents from a specific category
  --list               List available agent categories and files
  -h, --help           Show this help message

Examples:
  $(basename "$0") --tool claude-code
  $(basename "$0") --tool claude-code --category engineering
  $(basename "$0") --tool claude-code --list
EOF
  exit "${1:-0}"
}

# --- Parse arguments ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool)      TOOL="$2"; shift 2 ;;
    --category)  CATEGORY="$2"; shift 2 ;;
    --list)      LIST=true; shift ;;
    -h|--help)   usage 0 ;;
    *)           echo "Error: unknown option '$1'"; usage 1 ;;
  esac
done

if [[ -z "$TOOL" ]]; then
  echo "Error: --tool is required"
  usage 1
fi

# --- Resolve target directory ---
case "$TOOL" in
  claude-code)
    TARGET_DIR="${HOME}/.claude/agents"
    ;;
  *)
    echo "Error: unsupported tool '$TOOL'. Supported: claude-code"
    exit 1
    ;;
esac

# --- Check source ---
if [[ ! -d "$AGENTS_SRC" ]]; then
  echo "Error: agents directory not found at $AGENTS_SRC"
  exit 1
fi

# --- List mode ---
if $LIST; then
  echo "Available agents in $AGENTS_SRC:"
  echo ""
  for category_dir in "$AGENTS_SRC"/*/; do
    [[ -d "$category_dir" ]] || continue
    category="$(basename "$category_dir")"
    echo "  $category/"
    for agent_file in "$category_dir"*.md; do
      [[ -f "$agent_file" ]] || continue
      echo "    - $(basename "$agent_file")"
    done
  done
  exit 0
fi

# --- Install agents ---
mkdir -p "$TARGET_DIR"

copied=0

if [[ -n "$CATEGORY" ]]; then
  # Install single category
  src_dir="$AGENTS_SRC/$CATEGORY"
  if [[ ! -d "$src_dir" ]]; then
    echo "Error: category '$CATEGORY' not found in $AGENTS_SRC"
    echo "Run with --list to see available categories."
    exit 1
  fi
  for f in "$src_dir"/*.md; do
    [[ -f "$f" ]] || continue
    cp "$f" "$TARGET_DIR/"
    echo "  Installed: $(basename "$f")"
    copied=$((copied + 1))
  done
else

  # Install all categories
  for category_dir in "$AGENTS_SRC"/*/; do
    [[ -d "$category_dir" ]] || continue
    for f in "$category_dir"*.md; do
      [[ -f "$f" ]] || continue
      cp "$f" "$TARGET_DIR/"
      echo "  Installed: $(basename "$f")"
      copied=$((copied + 1))
    done
  done
fi

if [[ $copied -eq 0 ]]; then
  echo "No agent files found to install."
  exit 1
fi

echo ""
echo "Done! Installed $copied agent(s) to $TARGET_DIR"
