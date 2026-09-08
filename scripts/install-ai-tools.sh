#!/usr/bin/env bash
#
# Установка AI-инструментов, которые НЕ раздаются репозиторием: Strix и OmniRoute.
# Это отдельные программы со своими процессами, портами и ключами — в git живёт
# только конфигурация Claude Code (см. docs/ai-tooling.md).
#
#   ./scripts/install-ai-tools.sh strix
#   ./scripts/install-ai-tools.sh omniroute
#   ./scripts/install-ai-tools.sh all
#
# Скрипт ничего не делает молча: проверяет предусловия, показывает команду
# и спрашивает подтверждение перед каждой установкой.

set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

confirm() {
  # Неинтерактивный запуск (CI, пайп) — отказ, а не «молча да»:
  # обе установки ставят софт глобально.
  if [ ! -t 0 ]; then
    warn "нет терминала — пропускаю (подтверждение обязательно)"
    return 1
  fi
  printf '%s [y/N] ' "$1"
  read -r answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ]
}

install_strix() {
  say "Strix — AI-пентестер (usestrix/strix, Apache-2.0)"

  command -v docker >/dev/null 2>&1 \
    || die "нужен Docker: https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 \
    || die "Docker установлен, но не запущен — стартуйте демон и повторите"

  if command -v strix >/dev/null 2>&1; then
    warn "strix уже установлен: $(command -v strix)"
    return 0
  fi

  echo "Будет выполнено: curl -sSL https://strix.ai/install | bash"
  echo "Это скачивание и запуск установочного скрипта с strix.ai."
  confirm "Ставим Strix?" || { warn "пропущено"; return 0; }

  curl -sSL https://strix.ai/install | bash

  cat <<'EOF'

Дальше нужны переменные окружения (в ~/.zshrc или ~/.bashrc):

    export STRIX_LLM="openrouter/z-ai/glm-5.3"   # или другой провайдер
    export LLM_API_KEY="..."

Запуск против локальной сборки Pinhead:

    strix --target ./pinhead-react

Первый прогон тянет Docker-образ песочницы — это займёт время.
Отчёты пишутся в strix_runs/ (в .gitignore).

Сканируйте только свой стенд: инструмент шлёт настоящие атакующие запросы
и на боевой базе способен создать и испортить данные.
EOF
}

install_omniroute() {
  say "OmniRoute — AI-шлюз (diegosouzapw/OmniRoute, MIT)"

  command -v npm >/dev/null 2>&1 || die "нужен Node.js с npm"

  if command -v omniroute >/dev/null 2>&1; then
    warn "omniroute уже установлен: $(command -v omniroute)"
    return 0
  fi

  cat <<'EOF'
Будет выполнено: npm install -g omniroute

Прежде чем направлять в шлюз работу по Pinhead: через него проходит
содержимое запросов — исходники, схема БД, данные заказов из отладочного
вывода — и уходит выбранному провайдеру. Pinhead — закрытая ERP с данными
клиентов. Подробности и рекомендация в docs/ai-tooling.md.
EOF
  confirm "Ставим OmniRoute?" || { warn "пропущено"; return 0; }

  npm install -g omniroute

  cat <<'EOF'

Запуск:

    omniroute        # дашборд http://localhost:20128, API .../v1

Провайдеры подключаются в дашборде (Providers), ключ endpoint'а — в Endpoints.
Ключи провайдеров живут там же, в .env проекта им не место.
EOF
}

case "${1:-}" in
  strix)     install_strix ;;
  omniroute) install_omniroute ;;
  all)       install_strix; install_omniroute ;;
  *)
    cat <<EOF
Использование: $0 {strix|omniroute|all}

  strix      AI-пентестер (нужен Docker и ключ LLM)
  omniroute  AI-шлюз, один endpoint поверх многих провайдеров
  all        оба

Подробности: docs/ai-tooling.md
EOF
    exit 1 ;;
esac
