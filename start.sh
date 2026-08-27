#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f public/data/questions.json ]]; then
  echo "首次启动，正在从 EPUB 抽取内容…"
  python3 scripts/build.py
fi
PORT="${PORT:-8765}"
URL="http://127.0.0.1:${PORT}"
echo ""
echo "金基私塾  ·  仅绑定 127.0.0.1"
echo "打开: ${URL}"
echo "退出: Ctrl+C"
echo ""
if command -v open >/dev/null 2>&1; then
  (sleep 0.6 && open "${URL}") &
fi
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory public
