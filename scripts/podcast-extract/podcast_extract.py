#!/usr/bin/env python3
"""podcast-extract-summarize: 把一个 Apple Podcast 单集链接变成可读的文字稿。

流程：
  1. 从 Apple Podcast 链接里解出单集 ID（分享链接里 `i=` 后面那串数字）。
  2. 调用本 skill 自带的 FetchTranscript 二进制，下载该单集的 TTML 文字稿。
  3. 把 TTML（带说话人 ttm:agent 和逐词时间戳）转成按说话人分段、带时间戳的 Markdown。

用法：
  python3 podcast_extract.py "<Apple Podcast 链接或单集ID>" [--workdir DIR]

只在 macOS 上有效（FetchTranscript 依赖系统私有框架），目前确认 macOS 15.x 可用。
"""
import argparse
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
BIN_DIR = os.path.join(HERE, "bin")
FETCH_BIN = os.path.join(BIN_DIR, "FetchTranscript")

TTML_NS = "http://www.w3.org/ns/ttml"
META_NS = "http://www.w3.org/ns/ttml#metadata"
PODS_NS = "http://podcasts.apple.com/transcript-ttml-internal"
XML_NS = "http://www.w3.org/XML/1998/namespace"


def extract_episode_id(arg: str) -> str:
    """从链接/原始输入里解出 Apple Podcast 单集 ID。

    优先取 query 里的 `i=1000...`（单集 ID）；否则退回 URL 里的 id123...（节目 ID）；
    否则若整串就是数字，直接用。"""
    arg = arg.strip()
    m = re.search(r"[?&]i=(\d+)", arg)
    if m:
        return m.group(1)
    if arg.isdigit():
        return arg
    m = re.search(r"/id(\d+)", arg)
    if m:
        print("[warn] 链接里没有 `i=` 单集参数，只拿到节目 ID；"
              "请用某一「单集」的分享链接（含 i=...）。", file=sys.stderr)
        return m.group(1)
    raise SystemExit(f"无法从输入中解析出单集 ID：{arg!r}\n"
                     "请粘贴某一单集的分享链接，例如 "
                     "https://podcasts.apple.com/us/podcast/<name>/id123?i=1000755910276")


def run_fetch(episode_id: str) -> str:
    """调用 FetchTranscript 下载 TTML，返回 ttml 文件的绝对路径。
    在 bin 目录里运行，以便复用 bearer_token.txt 的 30 天缓存。"""
    if not os.path.exists(FETCH_BIN):
        raise SystemExit(f"找不到 FetchTranscript 二进制：{FETCH_BIN}")
    out_ttml = os.path.join(BIN_DIR, f"transcript_{episode_id}.ttml")
    if os.path.exists(out_ttml):
        os.remove(out_ttml)
    print(f"[info] 下载文字稿 ID={episode_id} ...", file=sys.stderr)
    proc = subprocess.run(
        [FETCH_BIN, episode_id, "--cache-bearer-token"],
        cwd=BIN_DIR, capture_output=True, text=True,
    )
    if proc.stdout.strip():
        print(proc.stdout.strip(), file=sys.stderr)
    if proc.returncode != 0 or not os.path.exists(out_ttml):
        raise SystemExit(
            "FetchTranscript 下载失败：\n" + (proc.stderr or proc.stdout) +
            "\n常见原因：该单集没有 Apple 提供的文字稿；或 bearer token 过期"
            "（删除 bin/bearer_token.txt 后在已登录 Apple Podcasts 的 Mac 上重试）；"
            "或 macOS 版本不兼容。")
    return out_ttml


def _parse_begin(ts: str) -> float:
    """TTML begin 时间 -> 秒。支持 '12.3' / '1:02.3' / '1:02:03.4'。"""
    if ts is None:
        return 0.0
    parts = ts.split(":")
    sec = 0.0
    for p in parts:
        sec = sec * 60 + float(p)
    return sec


def _fmt_ts(sec: float) -> str:
    sec = int(sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def ttml_to_markdown(ttml_path: str, episode_id: str) -> str:
    tree = ET.parse(ttml_path)
    root = tree.getroot()
    lang = root.get(f"{{{XML_NS}}}lang") or "?"

    body = root.find(f"{{{TTML_NS}}}body")
    dur = body.get("dur") if body is not None else None
    duration = _fmt_ts(float(dur)) if dur else "?"

    lines = [f"# Podcast Transcript ({episode_id})", "",
             f"_Language: {lang} · Duration: {duration}_", ""]

    word_q = f".//{{{TTML_NS}}}span[@{{{PODS_NS}}}unit='word']"
    for p in root.iter(f"{{{TTML_NS}}}p"):
        agent = p.get(f"{{{META_NS}}}agent") or "SPEAKER"
        begin = _fmt_ts(_parse_begin(p.get("begin")))
        words = [w.text for w in p.findall(word_q) if w.text]
        text = " ".join(words).strip()
        if not text:
            continue
        lines.append(f"**{agent}** `[{begin}]`")
        lines.append("")
        lines.append(text)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url_or_id", help="Apple Podcast 单集链接或单集 ID")
    ap.add_argument("--workdir", default="/tmp/podcast-extract",
                    help="输出目录（默认 /tmp/podcast-extract/<id>/）")
    args = ap.parse_args()

    episode_id = extract_episode_id(args.url_or_id)
    ttml_path = run_fetch(episode_id)

    outdir = os.path.join(args.workdir, episode_id)
    os.makedirs(outdir, exist_ok=True)
    # 保留一份原始 TTML，便于核对
    ttml_keep = os.path.join(outdir, f"transcript_{episode_id}.ttml")
    if os.path.abspath(ttml_path) != os.path.abspath(ttml_keep):
        import shutil
        shutil.move(ttml_path, ttml_keep)
        ttml_path = ttml_keep

    md = ttml_to_markdown(ttml_path, episode_id)
    md_path = os.path.join(outdir, f"transcript_{episode_id}.md")
    with open(md_path, "w") as f:
        f.write(md)

    header = md.split("\n", 4)[:3]
    print("\n".join(header))
    print(f"\n[done] Markdown 文字稿: {md_path}")
    print(f"[done] 原始 TTML:      {ttml_path}")


if __name__ == "__main__":
    main()
