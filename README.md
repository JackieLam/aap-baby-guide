# 孕期 + 育儿知识中心

一个集中整理「孕期 + 育儿」知识的个人站点：把我读过的书、听过的播客，以及其他来源的要点，归纳成按来源与章节组织、方便快速阅读并可随手记笔记的网页。

> 本站为个人学习用的知识摘要与笔记。原书/音频版权归原作者及出版方所有；每章附带的 `raw.txt` / `transcript.md` 为无损抽取的原文/文字稿，仅用于检索与核对。

顶部分五个标签：

- **📖 Books** —— 我读过的书，按章节整理的重点摘要。首本为《美国儿科学会育儿百科（第 7 版）》，后续会引入更多书。
- **🎙️ Podcasts** —— 我听过的播客，归纳讨论过的知识要点（同样支持画重点、记笔记）。
- **🗂️ 其他** —— 讲座、会议、视频等其他来源的知识整理（扁平条目，每条标注来源类型与原始链接）。
- **📕 小红书** —— 小红书笔记的提取与总结（含安全性标注），扁平条目，附原始链接。
- **📝 Note** —— 跨所有来源的个人笔记汇总。

## 在线访问

GitHub Pages：<https://jackielam.github.io/aap-baby-guide/>

## 本地预览

因为页面用 `fetch()` 加载 JSON 内容，不能直接双击打开 `index.html`，需用本地服务器：

```bash
cd aap-baby-guide
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 项目结构

```
aap-baby-guide/
├── index.html                      # 页面外壳（顶栏三标签 + 侧边目录 + 内容区）
├── assets/
│   ├── css/styles.css              # 样式（含深色模式、移动端、来源卡片）
│   └── js/app.js                   # 渲染器：哈希路由 + 目录 + 内容块 + 搜索 + 画重点/笔记
├── content/
│   ├── library.json                # 全站索引：登记所有书籍与播客（唯一的“来源注册处”）
│   ├── books/
│   │   └── aap/
│   │       ├── manifest.json       # 该书的章节登记表
│   │       └── chapters/chNN/
│   │           ├── summary.json    # 结构化人读摘要（渲染器据此生成页面）
│   │           └── raw.txt         # PDF 无损抽取原文（供检索/未来 AI）
│   ├── podcasts/
│   │   └── <podcast-id>/
│   │       ├── manifest.json       # 该播客的单集登记表
│   │       └── episodes/epNN/
│   │           ├── summary.json    # 结构化人读摘要
│   │           └── transcript.md   # 英文文字稿（供检索/核对）
│   ├── others/                     # 「其他」来源：扁平条目（讲座/会议/视频等）
│   │   └── <other-id>/
│   │       ├── summary.json        # 结构化人读摘要
│   │       └── raw.txt             # 原始文字稿（供检索/核对）
│   └── xiaohongshu/                # 「小红书」来源：扁平条目
│       └── <xhs-id>/
│           ├── summary.json        # 结构化人读摘要（含安全性标注）
│           └── raw.txt             # 字幕 + 语音转写的原始抽取记录
├── scripts/
│   └── extract_chapter.sh          # 从 PDF 抽取某章原文的辅助脚本
└── README.md
```

## 设计理念：内容与展示分离，天然可扩展

- **展示层**（`index.html` / `styles.css` / `app.js`）通用、固定，不随内容变化。书与播客复用同一套「章节/单集」渲染与「画重点/笔记」能力。
- **内容层**（`content/`）是纯数据：
  - `summary.json` —— 给人读的结构化摘要（见下方 schema）。
  - `raw.txt` / `transcript.md` —— 给机器读的无损原文/文字稿，为未来的「AI 问答 / 原文检索」预留底本。

> ⚠️ 全站以「条目 id」（书的章节 id、播客的单集 id）关联笔记，因此所有条目 id 必须全局唯一（例如书用 `ch01`、播客单集用带前缀的 `doac-ep-9months`）。

### 新增一本书（零改码）

1. 在 `content/books/<book-id>/` 下建好 `manifest.json` 与各章 `chapters/chNN/{summary.json,raw.txt}`。
2. 在 `content/library.json` 的 `books` 数组里登记一行（`id` / `titleCn` / `manifest` 等）。

### 新增一档播客 / 一集（零改码）

1. 在 `content/podcasts/<podcast-id>/` 下建好 `manifest.json` 与各集 `episodes/epNN/{summary.json,transcript.md}`。
2. 在 `content/library.json` 的 `podcasts` 数组里登记一行。
3. 把该集 `status` 设为 `"done"`，导航、首页、上一/下一篇、搜索都会自动包含它。

### 新增一条「其他」来源（零改码）

「其他」是扁平来源：每条内容本身就是一个条目，没有子合集。

1. 在 `content/others/<other-id>/` 下放好 `summary.json`（结构同下方 schema）与 `raw.txt`（原始文字稿）。
2. 在 `content/library.json` 的 `others` 数组里登记一行：`id` / `emoji` / `title` / `type`（来源类型，如「腾讯会议」）/ `source` / `link`（原始链接）/ `desc` / `status` / `summary` / `raw`。
3. 把 `status` 设为 `"done"`，顶部「🗂️ 其他」标签、首页、搜索、笔记都会自动包含它。

### 新增一条「小红书」来源（零改码）

与「其他」同为扁平来源，结构一致，只是登记到 `content/library.json` 的 `xiaohongshu` 数组、内容放 `content/xiaohongshu/<xhs-id>/{summary.json,raw.txt}`，`type` 填「小红书」、`link` 填原链接。涉及婴幼儿内容需按权威安全原则标注风险。可配合项目技能 `/xhs-extract` 自动抓取与转写小红书视频/图文。

### summary.json 的内容块（block）类型

| type | 用途 | 字段 |
|------|------|------|
| `para` | 普通段落 | `text` |
| `keypoints` | 要点列表 | `title?`, `items[]` |
| `warning` | ⚠️ 安全警示 / 需避开（红） | `title`, `text?` / `items[]` |
| `position` | 🏛️ 立场 / 核心观点（蓝） | `title`, `text` |
| `tip` | 💡 小贴士 / 实用技巧（黄） | `title`, `text?` / `items[]` |
| `checklist` | ✅ 可勾选清单（勾选状态存本地） | `title`, `items[]` |
| `table` | 表格 | `title?`, `headers[]`, `rows[][]` |

想支持新的展示样式，只需在 `app.js` 的 `renderBlock()` 里加一个 `case`，内容层不受影响。

## 后续规划

- [ ] 引入更多书籍与播客来源
- [ ] 速查卡片：疫苗接种时间表、急救步骤、发育里程碑
- [ ] 按月龄/年龄的时间轴导航
- [ ] AI 问答：以 `raw.txt` / `transcript.md` 为检索底本，接入 serverless 后端调用大模型（不改动现有静态架构）
