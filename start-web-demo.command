#!/usr/bin/env bash
# macOS：双击看演示。不需要 key，也不联网。
cd "$(dirname "$0")" || exit 1
exec bash ./start-web.sh --demo
