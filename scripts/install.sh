#!/usr/bin/env bash
set -euo pipefail

# install.sh — Копирует агентов PinheadOS в директорию агентов целевого инструмента.
#
# Использование:
#   ./scripts/install.sh --tool claude-code                        # установить всех агентов
#   ./scripts/install.sh --tool claude-code --list                 # показать доступных агентов
#   ./scripts/install.sh --tool claude-code --category engineering # одна категория

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTS_SRC="$REPO_ROOT/agency-agents"

TOOL=""
CATEGORY=""
LIST=false

usage() {
  cat <<EOF
Использование: $(basename "$0") --tool <имя> [ОПЦИИ]

Копирует агентов PinheadOS в директорию агентов целевого инструмента.

Опции:
  --tool <имя>         Целевой инструмент (обязательно). Поддерживается: claude-code
  --category <имя>     Установить агентов только из указанной категории
  --list               Показать доступные категории и файлы агентов
  -h, --help           Показать эту справку

Примеры:
  $(basename "$0") --tool claude-code
  $(basename "$0") --tool claude-code --category engineering
  $(basename "$0") --tool claude-code --list
EOF
  exit "${1:-0}"
}

# --- Разбор аргументов ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool)      TOOL="$2"; shift 2 ;;
    --category)  CATEGORY="$2"; shift 2 ;;
    --list)      LIST=true; shift ;;
    -h|--help)   usage 0 ;;
    *)           echo "Ошибка: неизвестная опция '$1'"; usage 1 ;;
  esac
done

if [[ -z "$TOOL" ]]; then
  echo "Ошибка: --tool обязателен"
  usage 1
fi

# --- Определение целевой директории ---
case "$TOOL" in
  claude-code)
    TARGET_DIR="${HOME}/.claude/agents"
    ;;
  *)
    echo "Ошибка: инструмент '$TOOL' не поддерживается. Поддерживается: claude-code"
    exit 1
    ;;
esac

# --- Проверка источника ---
if [[ ! -d "$AGENTS_SRC" ]]; then
  echo "Ошибка: директория агентов не найдена: $AGENTS_SRC"
  exit 1
fi

# --- Режим списка ---
if $LIST; then
  echo "Доступные агенты в $AGENTS_SRC:"
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

# --- Установка агентов ---
mkdir -p "$TARGET_DIR"

copied=0

if [[ -n "$CATEGORY" ]]; then
  # Установка одной категории
  src_dir="$AGENTS_SRC/$CATEGORY"
  if [[ ! -d "$src_dir" ]]; then
    echo "Ошибка: категория '$CATEGORY' не найдена в $AGENTS_SRC"
    echo "Запустите с --list чтобы увидеть доступные категории."
    exit 1
  fi
  for f in "$src_dir"/*.md; do
    [[ -f "$f" ]] || continue
    cp "$f" "$TARGET_DIR/"
    echo "  Установлен: $(basename "$f")"
    copied=$((copied + 1))
  done
else
  # Установка всех категорий
  for category_dir in "$AGENTS_SRC"/*/; do
    [[ -d "$category_dir" ]] || continue
    for f in "$category_dir"*.md; do
      [[ -f "$f" ]] || continue
      cp "$f" "$TARGET_DIR/"
      echo "  Установлен: $(basename "$f")"
      copied=$((copied + 1))
    done
  done
fi

if [[ $copied -eq 0 ]]; then
  echo "Файлы агентов не найдены."
  exit 1
fi

echo ""
echo "Готово! Установлено агентов: $copied → $TARGET_DIR"
