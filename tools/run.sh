#!/usr/bin/env bash
# 用法: tools/run.sh <electron 入口（脚本或目录）> [额外参数...]
set -uo pipefail
cd "$(dirname "$0")/.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/run.ps1 "$@"
