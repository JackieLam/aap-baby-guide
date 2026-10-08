/* 美国儿科学会育儿百科 · 重点摘要 —— 零构建静态站渲染器
 * 设计目标：内容与展示分离。新增一章 = 在 content/manifest.json 登记一行，
 * 并放入该章的 summary.json + raw.txt，无需改动本文件。
 */
(function () {
  "use strict";

  var state = { manifest: null, chapterCache: {} };

  /* ---------- 工具 ---------- */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") el.className = attrs[k];
      else if (k === "html") el.innerHTML = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("加载失败: " + url + " (" + r.status + ")");
      return r.json();
    });
  }
  function chapterById(id) {
    var all = (state.manifest.front || []).concat(state.manifest.chapters || []);
    return all.filter(function (c) { return c.id === id; })[0];
  }
  // 全站统一的阅读顺序：卷首(引言等) + 各部分中已完成的章节
  function orderedEntries() {
    var out = (state.manifest.front || []).filter(function (f) { return f.status === "done"; }).slice();
    var byNumber = {};
    state.manifest.chapters.forEach(function (c) { byNumber[c.number] = c; });
    state.manifest.parts.forEach(function (part) {
      part.chapters.forEach(function (num) {
        var c = byNumber[num];
        if (c && c.status === "done") out.push(c);
      });
    });
    return out;
  }

  /* ---------- 目录（侧边栏） ---------- */
  function renderTOC(activeId) {
    var toc = document.getElementById("toc");
    toc.innerHTML = "";
    var m = state.manifest;
    var byNumber = {};
    m.chapters.forEach(function (c) { byNumber[c.number] = c; });

    (m.front || []).forEach(function (f) {
      if (f.status !== "done") return;
      toc.appendChild(h("a", {
        href: "#/chapter/" + f.id,
        class: (f.id === activeId ? "active" : "")
      }, [h("span", { class: "num" }, ["引言"]), f.title.replace(/^引言\s*·?\s*/, "")]));
    });

    m.parts.forEach(function (part) {
      toc.appendChild(h("h3", null, [part.title]));
      part.chapters.forEach(function (num) {
        var c = byNumber[num];
        var done = c && c.status === "done";
        var label = (c && c.title) || "（待整理）";
        var a = h("a", {
          href: done ? "#/chapter/" + c.id : "#/",
          class: (done ? "" : "pending") + (c && c.id === activeId ? " active" : "")
        }, [h("span", { class: "num" }, ["第" + num + "章"]), label]);
        if (!done) a.addEventListener("click", function (e) { e.preventDefault(); });
        toc.appendChild(a);
      });
    });
  }

  /* ---------- 内容块渲染 ---------- */
  function renderBlock(block, ctx) {
    switch (block.type) {
      case "para":
        return h("div", { class: "block" }, [h("p", null, [block.text])]);

      case "keypoints": {
        var ul = h("ul", { class: "keypoints" },
          (block.items || []).map(function (it) { return h("li", null, [it]); }));
        return h("div", { class: "block" }, [
          block.title ? h("p", { class: "block-title" }, [block.title]) : null, ul
        ]);
      }

      case "warning":
        return callout("warning", "⚠️ " + (block.title || "注意"), block);
      case "position":
        return callout("position", "🏛️ " + (block.title || "我们的立场"), block);
      case "tip":
        return callout("tip", "💡 " + (block.title || "小贴士"), block);

      case "checklist": {
        var box = h("div", { class: "checklist" }, [
          block.title ? h("p", { class: "block-title" }, ["✅ " + block.title]) : null
        ]);
        (block.items || []).forEach(function (it, i) {
          var key = "chk:" + ctx.chapterId + ":" + (block.title || "list") + ":" + i;
          var input = h("input", { type: "checkbox" });
          if (localStorage.getItem(key) === "1") input.checked = true;
          input.addEventListener("change", function () {
            if (input.checked) localStorage.setItem(key, "1");
            else localStorage.removeItem(key);
          });
          box.appendChild(h("label", null, [input, h("span", null, [it])]));
        });
        return h("div", { class: "block" }, [box]);
      }

      case "table": {
        var thead = h("thead", null, [h("tr", null,
          (block.headers || []).map(function (th) { return h("th", null, [th]); }))]);
        var tbody = h("tbody", null, (block.rows || []).map(function (row) {
          return h("tr", null, row.map(function (cell) { return h("td", null, [cell]); }));
        }));
        var table = h("table", null, [
          block.title ? h("caption", null, [block.title]) : null, thead, tbody
        ]);
        return h("div", { class: "block table-wrap" }, [table]);
      }

      default:
        return h("div", { class: "block" }, [h("p", null, [block.text || ""])]);
    }
  }

  function callout(kind, title, block) {
    var kids = [h("p", { class: "block-title" }, [title])];
    if (block.text) kids.push(h("p", null, [block.text]));
    if (block.items) kids.push(h("ul", null, block.items.map(function (it) {
      return h("li", null, [it]);
    })));
    return h("div", { class: "block callout " + kind }, kids);
  }

  /* ---------- 页面：章节 ---------- */
  function showChapter(id, keepScroll) {
    var meta = chapterById(id);
    var content = document.getElementById("content");
    if (!meta || meta.status !== "done") { showHome(); return; }
    var scrollY = keepScroll ? window.scrollY : 0;
    if (!keepScroll) content.innerHTML = '<div class="loading">加载中…</div>';

    var loader = state.chapterCache[id]
      ? Promise.resolve(state.chapterCache[id])
      : getJSON(meta.summary).then(function (d) { state.chapterCache[id] = d; return d; });

    loader.then(function (data) {
      renderTOC(id);
      content.innerHTML = "";

      var partObj = state.manifest.parts.filter(function (p) { return p.id === data.part; })[0];
      var partTitle = partObj ? partObj.title : (data.partLabel || "");
      var headTitle = (typeof data.chapter === "number")
        ? ("第 " + data.chapter + " 章 · " + data.title)
        : data.title;
      content.appendChild(h("header", { class: "chapter-head" }, [
        h("div", { class: "chapter-eyebrow" }, [partTitle]),
        h("h1", null, [headTitle]),
        h("div", { class: "chapter-meta" }, [
          data.ageStage ? h("span", { class: "pill" }, ["阶段：" + data.ageStage]) : null,
          data.pdfPages ? h("span", { class: "pill" }, ["原书 PDF 第 " + data.pdfPages + " 页"]) : null
        ])
      ]));

      if (data.overview) content.appendChild(h("div", { class: "overview" }, [data.overview]));

      (data.sections || []).forEach(function (sec) {
        var secEl = h("section", { class: "chapter-section", id: sec.id }, [
          h("h2", null, [sec.heading])
        ]);
        (sec.blocks || []).forEach(function (b) {
          secEl.appendChild(renderBlock(b, { chapterId: id }));
        });
        content.appendChild(secEl);
      });

      if (data.glossary && data.glossary.length) {
        var dl = h("dl", null, []);
        data.glossary.forEach(function (g) {
          dl.appendChild(h("dt", null, [g.term]));
          dl.appendChild(h("dd", null, [g.def]));
        });
        content.appendChild(h("section", { class: "glossary" }, [
          h("h2", null, ["📖 名词解释"]), dl
        ]));
      }

      if (meta.raw) {
        content.appendChild(h("div", { class: "raw-link" }, [
          "需要核对原文？查看本章无损抽取的原文：",
          h("a", { href: meta.raw, target: "_blank", rel: "noopener" }, ["raw.txt（PDF 第 " + data.pdfPages + " 页）"])
        ]));
      }

      if (meta.raw) {
        content.appendChild(h("p", { class: "raw-link" }, [
          "💡 提示：选中正文任意文字即可「画重点」并添加笔记；所有笔记可在顶部 📝 Note 标签查看。"
        ]));
      }

      content.appendChild(chapterNav(meta));
      applyHighlights(id);
      window.scrollTo(0, scrollY);
      if (!keepScroll) content.focus();
      document.title = headTitle + " · 育儿百科摘要";
    }).catch(function (err) {
      content.innerHTML = "";
      content.appendChild(h("div", { class: "empty" }, [String(err.message || err)]));
    });
  }

  function navLabel(entry) {
    return (typeof entry.number === "number" ? "第" + entry.number + "章 " : "") + entry.title.replace(/^引言\s*·?\s*/, "引言 · ");
  }
  function chapterNav(meta) {
    var order = orderedEntries();
    var idx = -1;
    order.forEach(function (e, i) { if (e.id === meta.id) idx = i; });
    var prev = idx > 0 ? order[idx - 1] : null;
    var next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
    var nav = h("nav", { class: "chapter-nav" }, []);
    nav.appendChild(prev
      ? h("a", { class: "prev", href: "#/chapter/" + prev.id }, [h("div", { class: "dir" }, ["← 上一篇"]), navLabel(prev)])
      : h("span", null, []));
    nav.appendChild(next
      ? h("a", { class: "next", href: "#/chapter/" + next.id }, [h("div", { class: "dir" }, ["下一篇 →"]), navLabel(next)])
      : h("span", null, []));
    return nav;
  }

  /* ---------- 页面：首页 ---------- */
  function showHome() {
    renderTOC(null);
    var content = document.getElementById("content");
    content.innerHTML = "";
    var b = state.manifest.book;
    var home = h("div", { class: "home" }, [
      h("h1", null, [b.titleCn + " · 重点摘要"]),
      h("p", { class: "sub" }, [b.titleEn + "（" + b.edition + "，" + b.org + "）"]),
      h("p", { class: "sub" }, ["按章节整理重点内容与值得留意的细节，持续补充中。点击下方章节开始阅读。"])
    ]);

    (state.manifest.front || []).filter(function (f) { return f.status === "done"; }).forEach(function (f) {
      home.appendChild(h("div", { class: "part-card" }, [
        h("div", { class: "chip-grid" }, [
          h("a", { class: "chip done", href: "#/chapter/" + f.id }, [f.title])
        ])
      ]));
    });

    state.manifest.parts.forEach(function (part) {
      var byNumber = {};
      state.manifest.chapters.forEach(function (c) { byNumber[c.number] = c; });
      var chips = h("div", { class: "chip-grid" }, part.chapters.map(function (num) {
        var c = byNumber[num];
        var done = c && c.status === "done";
        var a = h("a", {
          class: "chip " + (done ? "done" : "pending"),
          href: done ? "#/chapter/" + c.id : "#/"
        }, ["第" + num + "章 " + ((c && c.title) || "")]);
        if (!done) a.addEventListener("click", function (e) { e.preventDefault(); });
        return a;
      }));
      home.appendChild(h("div", { class: "part-card" }, [
        h("h2", null, [part.title]),
        h("p", { class: "desc" }, [part.desc]),
        chips
      ]));
    });

    content.appendChild(home);
    document.title = b.titleCn + " · 重点摘要";
  }

  /* ---------- 搜索 ---------- */
  function doSearch(q) {
    q = (q || "").trim().toLowerCase();
    var content = document.getElementById("content");
    if (!q) { route(); return; }
    renderTOC(null);
    content.innerHTML = "";
    content.appendChild(h("h1", null, ['搜索：“' + q + '”']));

    var hits = [];
    state.manifest.chapters.forEach(function (c) {
      if (c.status !== "done") return;
      var hay = (c.title + " 第" + c.number + "章").toLowerCase();
      if (hay.indexOf(q) >= 0) hits.push({ c: c, where: "章节标题" });
    });

    // 深度搜索已加载到缓存的章节正文
    Object.keys(state.chapterCache).forEach(function (id) {
      var data = state.chapterCache[id];
      var text = JSON.stringify(data).toLowerCase();
      if (text.indexOf(q) >= 0 && !hits.some(function (x) { return x.c.id === id; })) {
        hits.push({ c: chapterById(id), where: "章节内容" });
      }
    });

    if (!hits.length) {
      content.appendChild(h("p", { class: "empty" }, ["未找到匹配章节。提示：打开过的章节会被纳入全文搜索。"]));
      return;
    }
    var ul = h("div", null, hits.map(function (hinfo) {
      return h("div", { class: "part-card" }, [
        h("a", { class: "chip done", href: "#/chapter/" + hinfo.c.id },
          ["第" + hinfo.c.number + "章 " + hinfo.c.title]),
        h("span", { class: "pill", style: "margin-left:8px" }, [hinfo.where])
      ]);
    }));
    content.appendChild(ul);
  }

  /* ================= 画重点 / 笔记 ================= */
  var NOTES_KEY = "aap-notes:v1";
  var HL_COLORS = [
    { name: "黄", value: "#fff3a3" },
    { name: "绿", value: "#bfe6c6" },
    { name: "粉", value: "#ffc7dd" },
    { name: "蓝", value: "#bcd9ff" }
  ];
  var sel = { range: null, text: "", chapterId: null };

  function getNotes() {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveNotes(list) { localStorage.setItem(NOTES_KEY, JSON.stringify(list)); }
  function upsertNote(note) {
    var list = getNotes();
    var i = list.findIndex(function (n) { return n.id === note.id; });
    if (i >= 0) list[i] = note; else list.push(note);
    saveNotes(list);
  }
  function removeNote(id) { saveNotes(getNotes().filter(function (n) { return n.id !== id; })); }
  function newId() { return "hl_" + Date.now() + "_" + Math.floor(Math.random() * 1e6); }

  // 当前路由对应的章节 id（仅章节页有效）
  function currentChapterId() {
    var m = (location.hash || "").match(/^#\/chapter\/(.+)$/);
    return m ? m[1] : null;
  }

  // 统计 needle 在某段文本中出现的次数
  function countOccurrences(hay, needle) {
    var i = 0, c = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) { c++; i += needle.length; }
    return c;
  }

  function textNodesIn(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // 在单个文本节点内把 [s,e) 包成 <mark class="hl">
  function wrapInNode(node, s, e, note) {
    var text = node.nodeValue;
    var mark = document.createElement("mark");
    mark.className = "hl" + (note.note ? " has-note" : "");
    mark.setAttribute("data-id", note.id);
    if (note.color) mark.style.background = note.color;
    if (note.note) mark.title = note.note;
    mark.textContent = text.slice(s, e);
    var frag = document.createDocumentFragment();
    if (s > 0) frag.appendChild(document.createTextNode(text.slice(0, s)));
    frag.appendChild(mark);
    if (e < text.length) frag.appendChild(document.createTextNode(text.slice(e)));
    node.parentNode.replaceChild(frag, node);
  }

  // 在 content 内包裹第 occ 次出现的 needle（支持跨节点）
  function wrapOccurrence(content, needle, occ, note) {
    var nodes = textNodesIn(content);
    var big = "", map = [];
    nodes.forEach(function (nd) { var s = big.length; big += nd.nodeValue; map.push({ node: nd, start: s, end: big.length }); });
    var from = 0, found = -1, count = 0, i;
    while ((i = big.indexOf(needle, from)) !== -1) {
      if (count === occ) { found = i; break; }
      count++; from = i + needle.length;
    }
    if (found === -1) found = big.indexOf(needle);
    if (found === -1) return false;
    var j = found + needle.length;
    var segs = [];
    map.forEach(function (m) {
      var s = Math.max(found, m.start), e = Math.min(j, m.end);
      if (s < e) segs.push({ node: m.node, ls: s - m.start, le: e - m.start });
    });
    segs.forEach(function (seg) {
      var p = seg.node.parentNode;
      if (p && p.classList && p.classList.contains("hl")) return; // 避免嵌套
      wrapInNode(seg.node, seg.ls, seg.le, note);
    });
    return true;
  }

  // 渲染后重新套用本章已保存的重点
  function applyHighlights(chapterId) {
    var content = document.getElementById("content");
    getNotes().filter(function (n) { return n.chapterId === chapterId && n.text; }).forEach(function (n) {
      if (content.querySelector('mark.hl[data-id="' + n.id + '"]')) return;
      wrapOccurrence(content, n.text, n.occ || 0, n);
    });
  }

  /* ----- 选区浮动工具条 ----- */
  function buildSelToolbar() {
    if (document.getElementById("selToolbar")) return;
    var bar = h("div", { class: "sel-toolbar", id: "selToolbar" }, []);
    HL_COLORS.forEach(function (c) {
      var sw = h("span", { class: "swatch", title: "画重点（" + c.name + "）" }, []);
      sw.style.background = c.value;
      sw.addEventListener("mousedown", function (e) { e.preventDefault(); createHighlight(c.value, false); });
      bar.appendChild(sw);
    });
    var noteBtn = h("button", { class: "mini-btn" }, ["📝 笔记"]);
    noteBtn.addEventListener("mousedown", function (e) { e.preventDefault(); createHighlight(HL_COLORS[0].value, true); });
    bar.appendChild(noteBtn);
    document.body.appendChild(bar);
  }
  function hideSelToolbar() {
    var bar = document.getElementById("selToolbar");
    if (bar) bar.classList.remove("show");
  }
  function onSelection() {
    var chapterId = currentChapterId();
    if (!chapterId) return;
    var s = window.getSelection();
    if (!s || s.isCollapsed || !s.toString().trim()) { hideSelToolbar(); return; }
    var content = document.getElementById("content");
    var range = s.getRangeAt(0);
    if (!content.contains(range.commonAncestorContainer)) { hideSelToolbar(); return; }
    sel.range = range.cloneRange();
    sel.text = s.toString();
    sel.chapterId = chapterId;
    var rect = range.getBoundingClientRect();
    var bar = document.getElementById("selToolbar");
    bar.classList.add("show");
    var top = rect.top + window.scrollY - bar.offsetHeight - 8;
    var left = rect.left + window.scrollX + rect.width / 2 - bar.offsetWidth / 2;
    bar.style.top = Math.max(window.scrollY + 4, top) + "px";
    bar.style.left = Math.max(6, left) + "px";
  }

  function createHighlight(color, openNote) {
    if (!sel.range || !sel.text.trim()) return;
    var content = document.getElementById("content");
    var text = sel.text;
    // 计算这是本章第几次出现（用选区之前的文本计数）
    var pre = document.createRange();
    pre.setStart(content, 0);
    try { pre.setEnd(sel.range.startContainer, sel.range.startOffset); } catch (e) {}
    var occ = countOccurrences(pre.toString(), text);
    var meta = chapterById(sel.chapterId) || {};
    var note = {
      id: newId(), chapterId: sel.chapterId, chapterTitle: meta.title || "",
      text: text, occ: occ, note: "", color: color, createdAt: Date.now()
    };
    upsertNote(note);
    window.getSelection().removeAllRanges();
    hideSelToolbar();
    wrapOccurrence(content, text, occ, note);
    if (openNote) {
      var mk = content.querySelector('mark.hl[data-id="' + note.id + '"]');
      openNotePop(note.id, mk);
    }
  }

  /* ----- 笔记编辑气泡 ----- */
  function buildNotePop() {
    if (document.getElementById("notePop")) return;
    var pop = h("div", { class: "note-pop", id: "notePop" }, [
      h("blockquote", { class: "quoted", id: "notePopQuote" }, []),
      h("textarea", { id: "notePopText", placeholder: "写下你的笔记…" }, []),
      h("div", { class: "row" }, [
        h("button", { class: "btn del", id: "notePopDel" }, ["删除重点"]),
        h("button", { class: "btn save", id: "notePopSave" }, ["保存"])
      ])
    ]);
    document.body.appendChild(pop);
    pop.addEventListener("click", function (e) { e.stopPropagation(); });
  }
  function hideNotePop() {
    var pop = document.getElementById("notePop");
    if (pop) pop.classList.remove("show");
  }
  function openNotePop(id, anchorEl) {
    buildNotePop();
    var pop = document.getElementById("notePop");
    var note = getNotes().filter(function (n) { return n.id === id; })[0];
    if (!note) return;
    document.getElementById("notePopQuote").textContent = "“" + note.text + "”";
    var ta = document.getElementById("notePopText");
    ta.value = note.note || "";
    pop.classList.add("show");
    var rect = (anchorEl || document.getElementById("content")).getBoundingClientRect();
    pop.style.top = (rect.bottom + window.scrollY + 8) + "px";
    pop.style.left = Math.min(
      Math.max(6, rect.left + window.scrollX),
      window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 6
    ) + "px";
    ta.focus();
    document.getElementById("notePopSave").onclick = function () {
      note.note = ta.value.trim();
      upsertNote(note);
      var mk = document.querySelector('mark.hl[data-id="' + id + '"]');
      if (mk) { mk.title = note.note; mk.classList.toggle("has-note", !!note.note); }
      hideNotePop();
    };
    document.getElementById("notePopDel").onclick = function () {
      removeNote(id);
      hideNotePop();
      if (currentChapterId() === note.chapterId) showChapter(note.chapterId, true);
    };
  }

  /* ----- 点击已有重点 → 编辑 ----- */
  function onContentClick(e) {
    var mk = e.target.closest && e.target.closest("mark.hl");
    if (mk) { e.stopPropagation(); openNotePop(mk.getAttribute("data-id"), mk); }
  }

  /* ---------- 页面：Note ---------- */
  function showNotes() {
    renderTOC(null);
    hideSelToolbar(); hideNotePop();
    var content = document.getElementById("content");
    content.innerHTML = "";
    var page = h("div", { class: "notes-page" }, [h("h1", null, ["📝 我的笔记"])]);
    var notes = getNotes();

    page.appendChild(h("div", { class: "notes-toolbar" }, [
      h("span", { class: "pill" }, ["共 " + notes.length + " 条"]),
      (function () {
        var btn = h("button", { class: "mini-btn" }, ["复制全部"]);
        btn.style.cssText = "border:1px solid var(--border);border-radius:8px;padding:5px 12px;cursor:pointer;background:var(--surface);color:var(--text)";
        btn.addEventListener("click", function () { copyAllNotes(notes); });
        return btn;
      })()
    ]));

    if (!notes.length) {
      page.appendChild(h("p", { class: "empty" }, ["还没有笔记。打开任意章节，选中正文文字即可画重点、写笔记。"]));
      content.appendChild(page);
      document.title = "我的笔记 · 育儿百科摘要";
      return;
    }

    // 按章节分组，保持 orderedEntries 的顺序
    var order = orderedEntries().map(function (e) { return e.id; });
    var groups = {};
    notes.forEach(function (n) { (groups[n.chapterId] = groups[n.chapterId] || []).push(n); });
    var ids = Object.keys(groups).sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });

    ids.forEach(function (cid) {
      var meta = chapterById(cid) || { title: n_title(cid) };
      var g = h("div", { class: "notes-group" }, [
        h("h2", null, [meta.title || cid])
      ]);
      groups[cid].sort(function (a, b) { return (a.occ || 0) - (b.occ || 0) || a.createdAt - b.createdAt; });
      groups[cid].forEach(function (n) {
        var quote = h("p", { class: "hl-quote" }, [n.text]);
        quote.style.borderLeftColor = n.color || "var(--brand)";
        var delBtn = h("button", null, ["删除"]);
        delBtn.addEventListener("click", function () { removeNote(n.id); showNotes(); });
        g.appendChild(h("div", { class: "note-card" }, [
          quote,
          h("p", { class: "note-text" + (n.note ? "" : " empty") }, [n.note || "（无笔记）"]),
          h("div", { class: "meta" }, [
            h("a", { href: "#/chapter/" + n.chapterId }, ["跳到原文 →"]),
            delBtn
          ])
        ]));
      });
      page.appendChild(g);
    });
    content.appendChild(page);
    document.title = "我的笔记 · 育儿百科摘要";
  }
  function n_title(cid) { var m = chapterById(cid); return m ? m.title : cid; }
  function copyAllNotes(notes) {
    var lines = notes.map(function (n) {
      return "【" + (n.chapterTitle || n.chapterId) + "】\n> " + n.text + (n.note ? "\n笔记：" + n.note : "") + "\n";
    });
    var text = lines.join("\n");
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { alert("已复制 " + notes.length + " 条笔记"); });
    else { window.prompt("复制以下内容：", text); }
  }

  function setActiveTab() {
    var isNotes = /^#\/notes/.test(location.hash || "");
    document.querySelectorAll(".tabs .tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === (isNotes ? "notes" : "read"));
    });
  }

  /* ---------- 路由 ---------- */
  function route() {
    closeSidebar();
    hideSelToolbar(); hideNotePop();
    setActiveTab();
    var hash = location.hash || "#/";
    if (/^#\/notes/.test(hash)) { showNotes(); return; }
    var m = hash.match(/^#\/chapter\/(.+)$/);
    if (m) showChapter(m[1]);
    else showHome();
  }

  /* ---------- 侧边栏（移动端） ---------- */
  function openSidebar() {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("backdrop").hidden = false;
  }
  function closeSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("backdrop").hidden = true;
  }

  /* ---------- 主题 ---------- */
  function initTheme() {
    var saved = localStorage.getItem("theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    document.getElementById("themeToggle").addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", cur);
      localStorage.setItem("theme", cur);
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    initTheme();
    document.getElementById("navToggle").addEventListener("click", openSidebar);
    document.getElementById("backdrop").addEventListener("click", closeSidebar);

    var searchTimer;
    document.getElementById("searchInput").addEventListener("input", function (e) {
      clearTimeout(searchTimer);
      var v = e.target.value;
      searchTimer = setTimeout(function () { doSearch(v); }, 200);
    });

    window.addEventListener("hashchange", route);

    // 画重点 / 笔记
    buildSelToolbar();
    buildNotePop();
    var content = document.getElementById("content");
    content.addEventListener("mouseup", function () { setTimeout(onSelection, 0); });
    content.addEventListener("click", onContentClick);
    document.addEventListener("mousedown", function (e) {
      var bar = document.getElementById("selToolbar");
      if (bar && !bar.contains(e.target)) hideSelToolbar();
      var pop = document.getElementById("notePop");
      if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest("mark.hl"))) hideNotePop();
    });
    window.addEventListener("scroll", hideSelToolbar, { passive: true });

    getJSON("content/manifest.json").then(function (m) {
      state.manifest = m;
      route();
    }).catch(function (err) {
      document.getElementById("content").innerHTML =
        '<div class="empty">无法加载目录 content/manifest.json：' + esc(String(err.message || err)) +
        '<br>若在本地直接双击打开，请改用本地服务器：<code>python3 -m http.server</code></div>';
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
