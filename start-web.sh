#!/usr/bin/env bash
# 知遥 · 网页版启动脚本（macOS / Linux）
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先安装 Node 22.19 或更新版本：https://nodejs.org/"
  exit 1
fi

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)"; then
  echo "Node.js 版本太旧：$(node -v)"
  echo "这个网页需要 Node 22.19 或更新版本。"
  echo "打开 https://nodejs.org/ ，下载 LTS 覆盖安装，再运行一次。"
  exit 1
fi

exec node web/server.mjs --open "$@"
