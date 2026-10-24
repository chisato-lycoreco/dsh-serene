#!/usr/bin/env bash
# macOS：在 Finder 里双击这个文件。第一次若被系统拦下，右键 → 打开。
cd "$(dirname "$0")" || exit 1
exec bash ./start-web.sh "$@"
