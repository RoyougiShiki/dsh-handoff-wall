#!/bin/bash
# Build: compile src/ → lib/.
# 双模式依赖解析：
#   A) DSH_CHECKOUT 指向 monorepo 源码检出（含 packages/ 与 vendor/）
#   B) DSH_NPM_PKG 指向 npm 安装版 @deepseek-ai/dsh 包目录（或自动探测 npm root -g）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# 沙箱/只读 home 兜底：npm 缓存固定到仓库内可写目录
export npm_config_cache="${npm_config_cache:-$ROOT/.npm-cache}"

MODE=""; CHECKOUT=""
if [ -n "${DSH_CHECKOUT:-}" ] && [ -d "$DSH_CHECKOUT/packages" ]; then
  CHECKOUT="$DSH_CHECKOUT"; MODE="monorepo"
fi
if [ -z "$MODE" ]; then
  for candidate in "${DSH_NPM_PKG:-}" \
                   "$(npm root -g 2>/dev/null)/@deepseek-ai/dsh" \
                   "/home/h/.npm-global/lib/node_modules/@deepseek-ai/dsh" \
                   "/usr/lib/node_modules/@deepseek-ai/dsh"; do
    if [ -n "$candidate" ] && [ -d "$candidate/node_modules/@deepseek-ai/dsh-tools" ]; then
      CHECKOUT="$candidate"; MODE="npm"; break
    fi
  done
fi
if [ -z "$MODE" ]; then
  echo "build: 未找到依赖来源（设 DSH_CHECKOUT=<monorepo> 或 DSH_NPM_PKG=<npm版dsh目录>）" >&2
  exit 1
fi
echo "=== Ensuring devDependencies (tsdown/typescript) ==="
if [ ! -x "./node_modules/.bin/tsdown" ] || [ ! -x "./node_modules/.bin/tsc" ]; then
  npm install --legacy-peer-deps --no-audit --no-fund
fi

echo "=== Linking build dependencies (mode=$MODE checkout=$CHECKOUT) ==="
mkdir -p node_modules/@deepseek-ai
node -e "const fs=require('fs');fs.rmSync('node_modules/@standard-schema',{recursive:true,force:true})"

link_dep() { # $1=包名  $2=monorepo 相对路径
  local target
  if [ "$MODE" = "monorepo" ]; then
    target="$CHECKOUT/$2"
  else
    # npm 安装版：生态包被 vendor 进 @deepseek-ai 作用域
    case "$1" in
      cordis)      target="$CHECKOUT/node_modules/@deepseek-ai/cordis" ;;
      cosmokit)    target="$CHECKOUT/node_modules/@deepseek-ai/cosmokit" ;;
      schemastery) target="$CHECKOUT/node_modules/@deepseek-ai/schemastery" ;;
      *)           target="$CHECKOUT/node_modules/$1" ;;
    esac
  fi
  if [ ! -e "$target" ]; then echo "build: dependency missing: $target" >&2; exit 1; fi
  node -e "
    const fs=require('fs'),path=require('path');
    const link=path.resolve(process.argv[1]),target=path.resolve(process.argv[2]);
    fs.rmSync(link,{recursive:true,force:true});
    fs.mkdirSync(path.dirname(link),{recursive:true});
    fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
  " "node_modules/$1" "$target"
}

link_dep cordis vendor/cordis
link_dep cosmokit vendor/cosmokit
link_dep schemastery vendor/schemastery
link_dep "@deepseek-ai/dsh-tools" packages/core/tools
link_dep "@deepseek-ai/dsh-llm" packages/llm/llm
link_dep "@deepseek-ai/dsh-system-prompt" packages/core/system-prompt
link_dep "@types/node" node_modules/@types/node

# npm 安装版布局补充链接（monorepo 源码检出自带完整依赖，无需此段）
if [ "${MODE:-}" = "npm" ]; then
  link_dep "@deepseek-ai/dsh-storage-domain" packages/x
  link_dep "@deepseek-ai/schemastery" vendor/schemastery
  link_dep "zod" packages/x
fi

TSC="$CHECKOUT/node_modules/.bin/tsc"
if [ ! -x "$TSC" ] && [ ! -f "$TSC.cmd" ]; then TSC="./node_modules/.bin/tsc"; fi
"$TSC" -p tsconfig.json
echo "=== Bundling host+client (tsdown) ==="
"$ROOT/node_modules/.bin/tsdown"
echo "=== Build complete ==="
