#!/usr/bin/env bash
# 从 version7.pdf 无损抽取某一章的原文，输出带页码标记的纯文本。
# 不做任何总结、删改，仅作为 agent 检索 / 未来 AI 问答的原文底本。
#
# 用法:
#   ./scripts/extract_chapter.sh <PDF路径> <起始页> <结束页> <输出文件>
# 例:
#   ./scripts/extract_chapter.sh ../version7.pdf 64 102 content/chapters/ch01/raw.txt
set -euo pipefail

PDF="${1:?需要 PDF 路径}"
START="${2:?需要起始页}"
END="${3:?需要结束页}"
OUT="${4:?需要输出文件}"

if ! command -v pdftotext >/dev/null 2>&1; then
  echo "错误: 需要 pdftotext (poppler)。macOS: brew install poppler" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
: > "$OUT"
for ((p=START; p<=END; p++)); do
  {
    printf '\n===== 【PDF 第 %s 页】 =====\n\n' "$p"
    pdftotext -f "$p" -l "$p" "$PDF" - 2>/dev/null
  } >> "$OUT"
done

chars=$(wc -m < "$OUT" | tr -d ' ')
echo "已抽取 PDF 第 ${START}-${END} 页 -> ${OUT} (${chars} 字符)"
