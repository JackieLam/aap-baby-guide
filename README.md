# 美国儿科学会育儿百科 · 重点摘要

把《美国儿科学会育儿百科（第 7 版）》（*Caring for Your Baby and Young Child: Birth to Age 5*, AAP）又长又多的章节，整理成按章节组织、方便快速阅读的网页。

> 本站为个人学习用的重点摘要。原书版权归原作者及出版方所有；每章附带的 `raw.txt` 为无损抽取的原文片段，仅用于检索与核对。

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
├── index.html                 # 页面外壳（顶栏 + 侧边目录 + 内容区）
├── assets/
│   ├── css/styles.css         # 样式（含深色模式、移动端）
│   └── js/app.js              # 渲染器：哈希路由 + 目录 + 内容块 + 搜索
├── content/
│   ├── manifest.json          # 目录登记表（全站唯一的“章节注册处”）
│   └── chapters/
│       └── ch01/
│           ├── summary.json   # 结构化人读摘要（渲染器据此生成页面）
│           └── raw.txt        # PDF 无损抽取原文（带页码标记，供检索/未来 AI）
├── scripts/
│   └── extract_chapter.sh     # 从 PDF 抽取某章原文的辅助脚本
└── README.md
```

## 设计理念：内容与展示分离，天然可扩展

- **展示层**（`index.html` / `styles.css` / `app.js`）通用、固定，不随章节变化。
- **内容层**（`content/`）是纯数据。每一章两份产物：
  - `summary.json` —— 给人读的结构化摘要（见下方 schema）。
  - `raw.txt` —— 给机器读的无损原文，为未来的「AI 问答 / 原文检索」预留底本。

### 新增一章的步骤（零改码）

1. 抽取原文：
   ```bash
   ./scripts/extract_chapter.sh ../version7.pdf <起始页> <结束页> content/chapters/chNN/raw.txt
   ```
2. 阅读原文，编写 `content/chapters/chNN/summary.json`。
3. 在 `content/manifest.json` 的 `chapters` 数组里加一条，并把该章 `status` 设为 `"done"`。

完成后导航、首页、上一章/下一章、搜索都会自动包含这一章。

### summary.json 的内容块（block）类型

| type | 用途 | 字段 |
|------|------|------|
| `para` | 普通段落 | `text` |
| `keypoints` | 要点列表 | `title?`, `items[]` |
| `warning` | ⚠️ 安全警示（红） | `title`, `text?` / `items[]` |
| `position` | 🏛️ 我们的立场（AAP 观点，蓝） | `title`, `text` |
| `tip` | 💡 小贴士（黄） | `title`, `text?` / `items[]` |
| `checklist` | ✅ 可勾选清单（勾选状态存本地） | `title`, `items[]` |
| `table` | 表格 | `title?`, `headers[]`, `rows[][]` |

想支持新的展示样式，只需在 `app.js` 的 `renderBlock()` 里加一个 `case`，内容层不受影响。

## 后续规划

- [ ] 逐章补充 summary.json（当前已完成：第 1 章）
- [ ] 全站搜索索引（目前为已加载章节的即时搜索）
- [ ] 速查卡片：疫苗接种时间表、急救步骤、发育里程碑
- [ ] 按月龄/年龄的时间轴导航
- [ ] AI 问答：以 `raw.txt` 为检索底本，接入 serverless 后端调用大模型（不改动现有静态架构）
