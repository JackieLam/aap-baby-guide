/* 孕期 + 育儿知识中心 —— 零构建静态站渲染器
 * 设计目标：内容与展示分离，天然可扩展。
 *   - 新增一本书：在 content/library.json 的 books 里登记一行，并放入该书的 manifest + 各章 summary.json/raw.txt。
 *   - 新增一档播客：在 content/library.json 的 podcasts 里登记一行，并放入该播客的 manifest + 各集 summary.json/transcript。
 * 书与播客共用同一套「章节/单集」渲染与「画重点/笔记」能力，无需改动本文件。
 */
(function () {
  "use strict";

  /* state.index：全站所有「条目」(书的章节 / 播客的单集) 的统一索引，键为全局唯一的条目 id。
   * 笔记正是以这个 id 关联，因此书与播客的条目 id 不能重复。 */
  var state = { library: null, books: {}, podcasts: {}, index: {}, entryCache: {} };

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

  /* ---------- 全局索引 / 导航辅助 ---------- */
  // 某本书 manifest 的有序条目（卷首 done + 各部分中 done 的章节）
  function bookOrderedEntries(m) {
    var out = (m.front || []).filter(function (f) { return f.status === "done"; }).slice();
    var byNumber = {};
    (m.chapters || []).forEach(function (c) { byNumber[c.number] = c; });
    (m.parts || []).forEach(function (part) {
      part.chapters.forEach(function (num) {
        var c = byNumber[num];
        if (c && c.status === "done") out.push(c);
      });
    });
    return out;
  }
  // 某档播客 manifest 的有序单集（done）
  function podcastOrderedEntries(m) {
    return (m.episodes || []).filter(function (e) { return e.status === "done"; });
  }
  // 扁平来源（「其他」「小红书」）：每个条目本身即一条内容（无子合集），done 的条目直接登记
  function othersOrderedEntries() {
    return (state.library.others || []).filter(function (o) { return o.status === "done"; });
  }
  function xhsOrderedEntries() {
    return (state.library.xiaohongshu || []).filter(function (o) { return o.status === "done"; });
  }
  // 某条目所在合集的有序条目（用于上一/下一篇）
  function collOrderedEntries(desc) {
    if (desc.kind === "book") return bookOrderedEntries(desc.manifest);
    if (desc.kind === "other") return othersOrderedEntries();
    if (desc.kind === "xhs") return xhsOrderedEntries();
    return podcastOrderedEntries(desc.manifest);
  }
  // 全站有序条目 id（书 → 播客 → 其他 → 小红书；用于笔记分组排序）
  function orderedEntryIds() {
    var ids = [];
    (state.library.books || []).forEach(function (b) {
      bookOrderedEntries(state.books[b.id] || {}).forEach(function (e) { ids.push(e.id); });
    });
    (state.library.podcasts || []).forEach(function (p) {
      podcastOrderedEntries(state.podcasts[p.id] || {}).forEach(function (e) { ids.push(e.id); });
    });
    othersOrderedEntries().forEach(function (e) { ids.push(e.id); });
    xhsOrderedEntries().forEach(function (e) { ids.push(e.id); });
    return ids;
  }
  function entryDesc(id) { return state.index[id]; }
  function kindLabel(kind) { return kind === "book" ? "书" : kind === "other" ? "其他" : kind === "xhs" ? "小红书" : "播客"; }
  function kindEmoji(kind) { return kind === "book" ? "📖 " : kind === "other" ? "🗂️ " : kind === "xhs" ? "📕 " : "🎙️ "; }
  // 扁平来源（条目即合集）统一判断
  function isFlatKind(kind) { return kind === "other" || kind === "xhs"; }
  function entryTitle(id) {
    var d = state.index[id];
    if (!d) return id;
    var e = d.entry;
    return (d.kind === "book" && typeof e.number === "number") ? ("第" + e.number + "章 " + e.title) : e.title;
  }
  // 条目对应的阅读路由；兼容旧笔记（仅存 chapterId）与旧书签 #/chapter/<id>
  function routeForEntry(id) {
    var d = state.index[id];
    if (!d) return "#/";
    if (d.kind === "other") return "#/other/" + id;
    if (d.kind === "xhs") return "#/xhs/" + id;
    return (d.kind === "book" ? "#/book/" : "#/podcast/") + d.collId + "/" + id;
  }

  /* ---------- 目录（侧边栏） ---------- */
  function renderTOC(ctx) {
    var toc = document.getElementById("toc");
    toc.innerHTML = "";
    ctx = ctx || { type: "library" };

    if (ctx.type === "book") { renderBookTOC(ctx.collId, ctx.activeId); return; }
    if (ctx.type === "podcast") { renderPodcastTOC(ctx.collId, ctx.activeId); return; }
    if (ctx.type === "other") { renderOtherTOC(ctx.activeId); return; }
    if (ctx.type === "xhs") { renderXhsTOC(ctx.activeId); return; }

    // 合集首页 / 笔记页：列出全部书、播客与其他
    var lib = state.library;
    if (lib.books && lib.books.length) {
      toc.appendChild(h("h3", null, ["📖 Books"]));
      lib.books.forEach(function (b) {
        toc.appendChild(h("a", { href: "#/book/" + b.id },
          [h("span", { class: "num" }, [b.emoji || "📘"]), b.titleCn || b.title]));
      });
    }
    if (lib.podcasts && lib.podcasts.length) {
      toc.appendChild(h("h3", null, ["🎙️ Podcasts"]));
      lib.podcasts.forEach(function (p) {
        toc.appendChild(h("a", { href: "#/podcast/" + p.id },
          [h("span", { class: "num" }, [p.emoji || "🎧"]), p.title]));
      });
    }
    if (lib.others && lib.others.length) {
      toc.appendChild(h("h3", null, ["🗂️ 其他"]));
      lib.others.forEach(function (o) {
        toc.appendChild(h("a", { href: "#/other/" + o.id },
          [h("span", { class: "num" }, [o.emoji || "🗂️"]), o.title]));
      });
    }
    if (lib.xiaohongshu && lib.xiaohongshu.length) {
      toc.appendChild(h("h3", null, ["📕 小红书"]));
      lib.xiaohongshu.forEach(function (o) {
        toc.appendChild(h("a", { href: "#/xhs/" + o.id },
          [h("span", { class: "num" }, [o.emoji || "📕"]), o.title]));
      });
    }
  }

  // 扁平来源的侧边目录（「其他」「小红书」通用）
  function renderFlatTOC(opts) {
    var toc = document.getElementById("toc");
    toc.appendChild(h("a", { href: opts.listRoute, class: "toc-back" }, [opts.back]));
    toc.appendChild(h("h3", null, [opts.heading]));
    (opts.items || []).forEach(function (o) {
      var done = o.status === "done";
      var a = h("a", {
        href: done ? opts.entryPrefix + o.id : opts.listRoute,
        class: (done ? "" : "pending") + (o.id === opts.activeId ? " active" : "")
      }, [h("span", { class: "num" }, [o.emoji || opts.fallbackEmoji]), o.title]);
      if (!done) a.addEventListener("click", function (ev) { ev.preventDefault(); });
      toc.appendChild(a);
    });
  }
  function renderOtherTOC(activeId) {
    renderFlatTOC({ items: state.library.others, activeId: activeId, listRoute: "#/others",
      entryPrefix: "#/other/", heading: "🗂️ 其他", back: "← 所有其他来源", fallbackEmoji: "🗂️" });
  }
  function renderXhsTOC(activeId) {
    renderFlatTOC({ items: state.library.xiaohongshu, activeId: activeId, listRoute: "#/xiaohongshu",
      entryPrefix: "#/xhs/", heading: "📕 小红书", back: "← 所有小红书", fallbackEmoji: "📕" });
  }

  function renderBookTOC(bookId, activeId) {
    var toc = document.getElementById("toc");
    var m = state.books[bookId];
    var b = (state.library.books || []).filter(function (x) { return x.id === bookId; })[0] || {};
    if (!m) return;
    toc.appendChild(h("a", { href: "#/books", class: "toc-back" }, ["← 所有书籍"]));
    toc.appendChild(h("h3", null, [b.titleCn || b.title || "书籍"]));
    var byNumber = {};
    (m.chapters || []).forEach(function (c) { byNumber[c.number] = c; });

    (m.front || []).forEach(function (f) {
      if (f.status !== "done") return;
      toc.appendChild(h("a", {
        href: "#/book/" + bookId + "/" + f.id,
        class: (f.id === activeId ? "active" : "")
      }, [h("span", { class: "num" }, ["引言"]), f.title.replace(/^引言\s*·?\s*/, "")]));
    });

    (m.parts || []).forEach(function (part) {
      toc.appendChild(h("h3", null, [part.title]));
      part.chapters.forEach(function (num) {
        var c = byNumber[num];
        var done = c && c.status === "done";
        var label = (c && c.title) || "（待整理）";
        var a = h("a", {
          href: done ? "#/book/" + bookId + "/" + c.id : "#/book/" + bookId,
          class: (done ? "" : "pending") + (c && c.id === activeId ? " active" : "")
        }, [h("span", { class: "num" }, ["第" + num + "章"]), label]);
        if (!done) a.addEventListener("click", function (e) { e.preventDefault(); });
        toc.appendChild(a);
      });
    });
  }

  function renderPodcastTOC(pid, activeId) {
    var toc = document.getElementById("toc");
    var m = state.podcasts[pid];
    var p = (state.library.podcasts || []).filter(function (x) { return x.id === pid; })[0] || {};
    if (!m) return;
    toc.appendChild(h("a", { href: "#/podcasts", class: "toc-back" }, ["← 所有播客"]));
    toc.appendChild(h("h3", null, [p.title || "播客"]));
    (m.episodes || []).forEach(function (e) {
      var done = e.status === "done";
      var a = h("a", {
        href: done ? "#/podcast/" + pid + "/" + e.id : "#/podcast/" + pid,
        class: (done ? "" : "pending") + (e.id === activeId ? " active" : "")
      }, [h("span", { class: "num" }, ["第" + (e.number || 1) + "集"]), e.title]);
      if (!done) a.addEventListener("click", function (ev) { ev.preventDefault(); });
      toc.appendChild(a);
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
          var key = "chk:" + ctx.entryId + ":" + (block.title || "list") + ":" + i;
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

  /* ---------- 页面：条目（书的章节 / 播客的单集） ---------- */
  function showEntry(id, keepScroll) {
    var desc = state.index[id];
    var content = document.getElementById("content");
    if (!desc || desc.entry.status !== "done") { showHome(); return; }
    var entry = desc.entry;
    var scrollY = keepScroll ? window.scrollY : 0;
    if (!keepScroll) content.innerHTML = '<div class="loading">加载中…</div>';

    var loader = state.entryCache[id]
      ? Promise.resolve(state.entryCache[id])
      : getJSON(entry.summary).then(function (d) { state.entryCache[id] = d; return d; });

    loader.then(function (data) {
      renderTOC({ type: desc.kind, collId: desc.collId, activeId: id });
      content.innerHTML = "";

      var eyebrow, headTitle, pills = [], rawLabel;
      if (desc.kind === "book") {
        var partObj = (desc.manifest.parts || []).filter(function (p) { return p.id === entry.part; })[0];
        eyebrow = partObj ? partObj.title : (desc.coll.titleCn || desc.coll.title || "");
        headTitle = (typeof entry.number === "number")
          ? ("第 " + entry.number + " 章 · " + entry.title) : entry.title;
        if (entry.ageStage) pills.push(h("span", { class: "pill" }, ["阶段：" + entry.ageStage]));
        if (entry.pdfPages) pills.push(h("span", { class: "pill" }, ["原书 PDF 第 " + entry.pdfPages + " 页"]));
        rawLabel = entry.pdfPages ? "raw.txt（PDF 第 " + entry.pdfPages + " 页）" : "raw.txt（无损抽取原文）";
      } else if (isFlatKind(desc.kind)) {
        eyebrow = entry.type || (desc.kind === "xhs" ? "小红书" : "其他来源");
        headTitle = entry.title;
        if (entry.type) pills.push(h("span", { class: "pill" }, ["📌 " + entry.type]));
        if (entry.source) pills.push(h("span", { class: "pill" }, ["🗣️ " + entry.source]));
        if (entry.link) pills.push(h("a", { class: "pill", href: entry.link, target: "_blank", rel: "noopener" }, ["🔗 打开" + (entry.type || "链接")]));
        rawLabel = desc.kind === "xhs" ? "原始抽取记录 raw.txt" : "原始文字稿 raw.txt";
      } else {
        var pod = desc.manifest.podcast || {};
        eyebrow = (pod.show || desc.coll.show || "") + (pod.host ? " · " + pod.host : "");
        headTitle = entry.title;
        if (pod.guest) pills.push(h("span", { class: "pill" }, ["🎙️ " + pod.guest]));
        if (entry.duration) pills.push(h("span", { class: "pill" }, ["⏱ " + entry.duration]));
        if (entry.lang) pills.push(h("span", { class: "pill" }, ["🌐 " + entry.lang]));
        if (entry.book) pills.push(h("span", { class: "pill" }, ["📘 " + entry.book]));
        rawLabel = "英文文字稿 transcript.md";
      }

      content.appendChild(h("header", { class: "chapter-head" }, [
        h("div", { class: "chapter-eyebrow" }, [eyebrow]),
        h("h1", null, [headTitle]),
        h("div", { class: "chapter-meta" }, pills)
      ]));

      if (isFlatKind(desc.kind) && entry.video) {
        var vid = h("video", {
          class: "note-video", controls: "", preload: "metadata", playsinline: "",
          "webkit-playsinline": "", src: entry.video
        }, ["你的浏览器不支持内嵌视频，请使用上方链接查看原片。"]);
        if (entry.poster) vid.setAttribute("poster", entry.poster);
        content.appendChild(h("div", { class: "note-video-wrap" }, [vid]));
      }

      if (isFlatKind(desc.kind) && entry.link) {
        content.appendChild(h("div", { class: "raw-link" }, [
          "来源（" + (entry.type || "链接") + "）：",
          h("a", { href: entry.link, target: "_blank", rel: "noopener" }, [entry.link])
        ]));
      }

      if (data.overview) content.appendChild(h("div", { class: "overview" }, [data.overview]));

      (data.sections || []).forEach(function (sec) {
        var secEl = h("section", { class: "chapter-section", id: sec.id }, [
          h("h2", null, [sec.heading])
        ]);
        (sec.blocks || []).forEach(function (b) {
          secEl.appendChild(renderBlock(b, { entryId: id }));
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

      if (entry.raw) {
        var rawLead = desc.kind === "book" ? "需要核对原文？查看本章无损抽取的原文："
          : desc.kind === "xhs" ? "想核对原片？查看字幕 + 语音转写的原始抽取记录："
          : desc.kind === "other" ? "想看完整原话？查看本次分享的文字稿："
          : "想听原话？查看本集英文文字稿：";
        content.appendChild(h("div", { class: "raw-link" }, [
          rawLead,
          h("a", { href: entry.raw, target: "_blank", rel: "noopener" }, [rawLabel])
        ]));
      }

      content.appendChild(h("p", { class: "raw-link" }, [
        "💡 提示：选中正文任意文字即可「画重点」并添加笔记；所有笔记可在顶部 📝 Note 标签查看。"
      ]));

      content.appendChild(entryNav(desc));
      applyHighlights(id);
      window.scrollTo(0, scrollY);
      if (!keepScroll) content.focus();
      document.title = headTitle + " · 知识中心";
    }).catch(function (err) {
      content.innerHTML = "";
      content.appendChild(h("div", { class: "empty" }, [String(err.message || err)]));
    });
  }

  function navLabel(desc, entry) {
    if (desc.kind === "book") {
      return (typeof entry.number === "number" ? "第" + entry.number + "章 " : "") +
        entry.title.replace(/^引言\s*·?\s*/, "引言 · ");
    }
    return (entry.number ? "第" + entry.number + "集 " : "") + entry.title;
  }
  function entryNav(desc) {
    var order = collOrderedEntries(desc);
    var idx = -1;
    order.forEach(function (e, i) { if (e.id === desc.entry.id) idx = i; });
    var prev = idx > 0 ? order[idx - 1] : null;
    var next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
    var nav = h("nav", { class: "chapter-nav" }, []);
    nav.appendChild(prev
      ? h("a", { class: "prev", href: routeForEntry(prev.id) }, [h("div", { class: "dir" }, ["← 上一篇"]), navLabel(desc, prev)])
      : h("span", null, []));
    nav.appendChild(next
      ? h("a", { class: "next", href: routeForEntry(next.id) }, [h("div", { class: "dir" }, ["下一篇 →"]), navLabel(desc, next)])
      : h("span", null, []));
    return nav;
  }

  /* ---------- 页面：合集首页（全部书 + 全部播客） ---------- */
  function showHome() {
    renderTOC({ type: "library" });
    var content = document.getElementById("content");
    content.innerHTML = "";
    var s = state.library.site || {};
    var home = h("div", { class: "home" }, [
      h("h1", null, [s.title || "孕期 + 育儿知识中心"]),
      s.subtitle ? h("p", { class: "sub" }, [s.subtitle]) : null
    ]);
    home.appendChild(sectionHeading("📖 Books", "我读过的书，按章节整理的重点摘要。"));
    home.appendChild(booksGrid());
    home.appendChild(sectionHeading("🎙️ Podcasts", "我听过的播客，归纳讨论过的知识要点。"));
    home.appendChild(podcastsGrid());
    if ((state.library.others || []).length) {
      home.appendChild(sectionHeading("🗂️ 其他", "来自讲座、会议、视频等其他来源的知识整理。"));
      home.appendChild(othersGrid());
    }
    if ((state.library.xiaohongshu || []).length) {
      home.appendChild(sectionHeading("📕 小红书", "小红书笔记的提取与总结（含安全性标注）。"));
      home.appendChild(xhsGrid());
    }
    content.appendChild(home);
    document.title = s.title || "孕期 + 育儿知识中心";
  }
  function sectionHeading(title, desc) {
    return h("div", { class: "lib-heading" }, [h("h2", null, [title]), desc ? h("p", { class: "desc" }, [desc]) : null]);
  }
  function sourceCard(opts) {
    var m = (opts.manifest || {});
    var doneCount = opts.kind === "book"
      ? bookOrderedEntries(m).length
      : podcastOrderedEntries(m).length;
    var unit = opts.kind === "book" ? "章" : "集";
    return h("a", { class: "source-card", href: opts.href }, [
      h("div", { class: "source-emoji" }, [opts.emoji]),
      h("div", { class: "source-body" }, [
        h("div", { class: "source-title" }, [opts.title]),
        opts.sub ? h("div", { class: "source-sub" }, [opts.sub]) : null,
        opts.desc ? h("p", { class: "source-desc" }, [opts.desc]) : null,
        h("div", { class: "source-foot" }, [h("span", { class: "pill" }, ["已整理 " + doneCount + " " + unit])])
      ])
    ]);
  }
  function booksGrid() {
    var grid = h("div", { class: "source-grid" }, []);
    (state.library.books || []).forEach(function (b) {
      grid.appendChild(sourceCard({
        kind: "book", emoji: b.emoji || "📘", title: b.titleCn || b.title,
        sub: [b.titleEn, b.edition, b.author].filter(Boolean).join(" · "),
        desc: b.desc, href: "#/book/" + b.id, manifest: state.books[b.id]
      }));
    });
    return grid;
  }
  function podcastsGrid() {
    var grid = h("div", { class: "source-grid" }, []);
    (state.library.podcasts || []).forEach(function (p) {
      grid.appendChild(sourceCard({
        kind: "podcast", emoji: p.emoji || "🎧", title: p.title,
        sub: [p.show, p.guest].filter(Boolean).join(" · "),
        desc: p.desc, href: "#/podcast/" + p.id, manifest: state.podcasts[p.id]
      }));
    });
    return grid;
  }
  // 扁平条目（「其他」「小红书」）的卡片：直接指向该条目的阅读页，并标注来源类型
  function flatGrid(items, entryPrefix, listRoute, fallbackEmoji) {
    var grid = h("div", { class: "source-grid" }, []);
    (items || []).forEach(function (o) {
      var done = o.status === "done";
      grid.appendChild(h("a", { class: "source-card" + (done ? "" : " pending"), href: done ? entryPrefix + o.id : listRoute }, [
        h("div", { class: "source-emoji" }, [o.emoji || fallbackEmoji]),
        h("div", { class: "source-body" }, [
          h("div", { class: "source-title" }, [o.title]),
          o.source ? h("div", { class: "source-sub" }, [o.source]) : null,
          o.desc ? h("p", { class: "source-desc" }, [o.desc]) : null,
          h("div", { class: "source-foot" }, [
            o.type ? h("span", { class: "pill" }, ["📌 " + o.type]) : null,
            done ? null : h("span", { class: "pill" }, ["待整理"])
          ])
        ])
      ]));
    });
    return grid;
  }
  function othersGrid() { return flatGrid(state.library.others, "#/other/", "#/others", "🗂️"); }
  function xhsGrid() { return flatGrid(state.library.xiaohongshu, "#/xhs/", "#/xiaohongshu", "📕"); }

  // Books 标签页：书籍列表
  function showBooks() {
    renderTOC({ type: "library" });
    var content = document.getElementById("content");
    content.innerHTML = "";
    content.appendChild(h("div", { class: "home" }, [
      h("h1", null, ["📖 Books"]),
      h("p", { class: "sub" }, ["我读过的书，按章节整理的重点摘要。点击进入某本书。"]),
      booksGrid()
    ]));
    document.title = "Books · 知识中心";
  }

  // Podcasts 标签页：播客列表
  function showPodcasts() {
    renderTOC({ type: "library" });
    var content = document.getElementById("content");
    content.innerHTML = "";
    content.appendChild(h("div", { class: "home" }, [
      h("h1", null, ["🎙️ Podcasts"]),
      h("p", { class: "sub" }, ["我听过的播客，归纳讨论过的知识要点。点击进入某档播客。"]),
      podcastsGrid()
    ]));
    document.title = "Podcasts · 知识中心";
  }

  // 其他标签页：讲座 / 会议 / 视频等其他来源列表
  function showOthers() {
    renderTOC({ type: "library" });
    var content = document.getElementById("content");
    content.innerHTML = "";
    content.appendChild(h("div", { class: "home" }, [
      h("h1", null, ["🗂️ 其他"]),
      h("p", { class: "sub" }, ["来自讲座、会议、视频等其他来源的知识整理。点击进入某一条。"]),
      othersGrid()
    ]));
    document.title = "其他 · 知识中心";
  }

  // 小红书标签页：小红书笔记列表
  function showXhs() {
    renderTOC({ type: "library" });
    var content = document.getElementById("content");
    content.innerHTML = "";
    content.appendChild(h("div", { class: "home" }, [
      h("h1", null, ["📕 小红书"]),
      h("p", { class: "sub" }, ["小红书笔记的提取与总结（含安全性标注，网红做法请谨慎对待）。点击进入某一条。"]),
      xhsGrid()
    ]));
    document.title = "小红书 · 知识中心";
  }

  // 单本书：卷首 + 各部分章节
  function showBook(bookId) {
    var m = state.books[bookId];
    var b = (state.library.books || []).filter(function (x) { return x.id === bookId; })[0];
    var content = document.getElementById("content");
    if (!m || !b) { showBooks(); return; }
    renderTOC({ type: "book", collId: bookId, activeId: null });
    content.innerHTML = "";
    var home = h("div", { class: "home" }, [
      h("h1", null, [(b.titleCn || b.title) + " · 重点摘要"]),
      h("p", { class: "sub" }, [[b.titleEn, b.edition, b.author].filter(Boolean).join("，")]),
      b.desc ? h("p", { class: "sub" }, [b.desc]) : null
    ]);

    (m.front || []).filter(function (f) { return f.status === "done"; }).forEach(function (f) {
      home.appendChild(h("div", { class: "part-card" }, [
        h("div", { class: "chip-grid" }, [
          h("a", { class: "chip done", href: "#/book/" + bookId + "/" + f.id }, [f.title])
        ])
      ]));
    });

    var byNumber = {};
    (m.chapters || []).forEach(function (c) { byNumber[c.number] = c; });
    (m.parts || []).forEach(function (part) {
      var chips = h("div", { class: "chip-grid" }, part.chapters.map(function (num) {
        var c = byNumber[num];
        var done = c && c.status === "done";
        var a = h("a", {
          class: "chip " + (done ? "done" : "pending"),
          href: done ? "#/book/" + bookId + "/" + c.id : "#/book/" + bookId
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
    document.title = (b.titleCn || b.title) + " · 重点摘要";
  }

  // 单档播客：简介 + 单集列表
  function showPodcast(pid) {
    var m = state.podcasts[pid];
    var p = (state.library.podcasts || []).filter(function (x) { return x.id === pid; })[0];
    var content = document.getElementById("content");
    if (!m || !p) { showPodcasts(); return; }
    renderTOC({ type: "podcast", collId: pid, activeId: null });
    content.innerHTML = "";
    var pod = m.podcast || {};
    var home = h("div", { class: "home" }, [
      h("h1", null, [p.title]),
      h("p", { class: "sub" }, [[pod.show || p.show, pod.host ? "主持：" + pod.host : null, pod.guest ? "嘉宾：" + pod.guest : null].filter(Boolean).join("　·　")]),
      p.desc ? h("p", { class: "sub" }, [p.desc]) : null
    ]);
    var list = h("div", { class: "part-card" }, [h("h2", null, ["单集"])]);
    (m.episodes || []).forEach(function (e) {
      var done = e.status === "done";
      var meta = [e.duration ? "⏱ " + e.duration : null, e.lang ? "🌐 " + e.lang : null].filter(Boolean).join("　");
      var card = h("a", {
        class: "episode-card" + (done ? "" : " pending"),
        href: done ? "#/podcast/" + pid + "/" + e.id : "#/podcast/" + pid
      }, [
        h("div", { class: "episode-title" }, ["第" + (e.number || 1) + "集 · " + e.title]),
        meta ? h("div", { class: "episode-meta" }, [meta]) : null,
        e.book ? h("div", { class: "episode-meta" }, ["📘 " + e.book]) : null
      ]);
      if (!done) card.addEventListener("click", function (ev) { ev.preventDefault(); });
      list.appendChild(card);
    });
    home.appendChild(list);
    content.appendChild(home);
    document.title = p.title + " · 播客";
  }

  /* ---------- 搜索 ---------- */
  function doSearch(q) {
    q = (q || "").trim().toLowerCase();
    var content = document.getElementById("content");
    if (!q) { route(); return; }
    renderTOC({ type: "library" });
    content.innerHTML = "";
    content.appendChild(h("h1", null, ['搜索：“' + q + '”']));

    var hits = [];
    function consider(id, where) {
      if (!hits.some(function (x) { return x.id === id; })) hits.push({ id: id, where: where });
    }
    // 标题搜索
    Object.keys(state.index).forEach(function (id) {
      var d = state.index[id];
      if (d.entry.status !== "done") return;
      var hay = (entryTitle(id) + " " + (d.coll.titleCn || d.coll.title || "") + " " + (d.coll.show || "")).toLowerCase();
      if (hay.indexOf(q) >= 0) consider(id, kindLabel(d.kind) + " · 标题");
    });
    // 深度搜索：已加载到缓存的条目正文
    Object.keys(state.entryCache).forEach(function (id) {
      var text = JSON.stringify(state.entryCache[id]).toLowerCase();
      if (text.indexOf(q) >= 0) consider(id, kindLabel(state.index[id] && state.index[id].kind) + " · 内容");
    });

    if (!hits.length) {
      content.appendChild(h("p", { class: "empty" }, ["未找到匹配项。提示：打开过的章节/单集会被纳入全文搜索。"]));
      return;
    }
    var order = orderedEntryIds();
    hits.sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
    var ul = h("div", null, hits.map(function (hinfo) {
      return h("div", { class: "part-card" }, [
        h("a", { class: "chip done", href: routeForEntry(hinfo.id) }, [entryTitle(hinfo.id)]),
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
  var sel = { range: null, text: "", entryId: null };

  /* 笔记存储：可插拔后端。
   * - "local"：浏览器 localStorage（未登录 / 未配置账号系统时）
   * - "cloud"：Supabase，由 auth.js 通过 window.CloudNotes 提供（登录后）
   * 渲染始终读内存缓存 notesCache（同步），写入再异步同步到后端。
   * 为兼容历史笔记，note 仍以 chapterId/chapterTitle 字段存放「条目 id / 条目标题」。 */
  var notesCache = null;
  var notesMode = "local";

  function loadLocalNotes() {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function persistLocal() { localStorage.setItem(NOTES_KEY, JSON.stringify(notesCache || [])); }

  function getNotes() {
    if (!notesCache) notesCache = loadLocalNotes();
    return notesCache;
  }
  function upsertNote(note) {
    var list = getNotes();
    var i = list.findIndex(function (n) { return n.id === note.id; });
    if (i >= 0) list[i] = note; else list.push(note);
    if (notesMode === "cloud" && window.CloudNotes) window.CloudNotes.upsert(note);
    else persistLocal();
  }
  function removeNote(id) {
    notesCache = getNotes().filter(function (n) { return n.id !== id; });
    if (notesMode === "cloud" && window.CloudNotes) window.CloudNotes.remove(id);
    else persistLocal();
  }
  function newId() { return "hl_" + Date.now() + "_" + Math.floor(Math.random() * 1e6); }

  // 供 auth.js 调用：登录后切到云端笔记，登出后切回本地
  window.setNotesMode = function (mode, cloudList) {
    notesMode = (mode === "cloud") ? "cloud" : "local";
    notesCache = (notesMode === "cloud") ? (cloudList || []) : loadLocalNotes();
    route();
  };
  // 供 auth.js 调用：把本机 localStorage 的笔记取出（用于迁移到账号）
  window.getLocalNotes = loadLocalNotes;

  // 当前路由对应的条目 id（仅条目页有效）；兼容旧书签 #/chapter/<id>
  function currentEntryId() {
    var hash = location.hash || "";
    var m = hash.match(/^#\/(?:book|podcast)\/[^/]+\/(.+)$/) || hash.match(/^#\/(?:other|xhs)\/(.+)$/) || hash.match(/^#\/chapter\/(.+)$/);
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

  // 渲染后重新套用本条目已保存的重点
  function applyHighlights(entryId) {
    var content = document.getElementById("content");
    getNotes().filter(function (n) { return n.chapterId === entryId && n.text; }).forEach(function (n) {
      if (content.querySelector('mark.hl[data-id="' + n.id + '"]')) return;
      wrapOccurrence(content, n.text, n.occ || 0, n);
    });
  }

  /* 触摸 + 鼠标统一的「按下即触发」绑定 */
  function bindPress(el, handler) {
    var touched = false;
    el.addEventListener("touchstart", function (e) {
      touched = true;
      e.preventDefault();
      handler(e);
    }, { passive: false });
    el.addEventListener("mousedown", function (e) {
      if (touched) { touched = false; return; }
      e.preventDefault();
      handler(e);
    });
  }

  /* ----- 选区浮动工具条 ----- */
  function buildSelToolbar() {
    if (document.getElementById("selToolbar")) return;
    var bar = h("div", { class: "sel-toolbar", id: "selToolbar" }, []);
    HL_COLORS.forEach(function (c) {
      var sw = h("span", { class: "swatch", title: "画重点（" + c.name + "）" }, []);
      sw.style.background = c.value;
      bindPress(sw, function () { createHighlight(c.value, false); });
      bar.appendChild(sw);
    });
    var noteBtn = h("button", { class: "mini-btn" }, ["📝 笔记"]);
    bindPress(noteBtn, function () { createHighlight(HL_COLORS[0].value, true); });
    bar.appendChild(noteBtn);
    document.body.appendChild(bar);
  }
  function hideSelToolbar() {
    var bar = document.getElementById("selToolbar");
    if (bar) bar.classList.remove("show");
  }
  function onSelection() {
    var entryId = currentEntryId();
    if (!entryId) return;
    var s = window.getSelection();
    if (!s || s.isCollapsed || !s.toString().trim()) { hideSelToolbar(); return; }
    var content = document.getElementById("content");
    var range = s.getRangeAt(0);
    if (!content.contains(range.commonAncestorContainer)) { hideSelToolbar(); return; }
    sel.range = range.cloneRange();
    sel.text = s.toString();
    sel.entryId = entryId;
    var bar = document.getElementById("selToolbar");
    bar.classList.add("show");
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (coarse) {
      bar.classList.add("docked");
      bar.style.top = "";
      bar.style.left = "";
      return;
    }
    bar.classList.remove("docked");
    var rect = range.getBoundingClientRect();
    var top = rect.top + window.scrollY - bar.offsetHeight - 8;
    var left = rect.left + window.scrollX + rect.width / 2 - bar.offsetWidth / 2;
    var maxLeft = window.scrollX + document.documentElement.clientWidth - bar.offsetWidth - 6;
    bar.style.top = Math.max(window.scrollY + 4, top) + "px";
    bar.style.left = Math.min(Math.max(6, left), Math.max(6, maxLeft)) + "px";
  }

  function createHighlight(color, openNote) {
    if (!sel.range || !sel.text.trim()) return;
    var content = document.getElementById("content");
    var text = sel.text;
    var pre = document.createRange();
    pre.setStart(content, 0);
    try { pre.setEnd(sel.range.startContainer, sel.range.startOffset); } catch (e) {}
    var occ = countOccurrences(pre.toString(), text);
    var note = {
      id: newId(), chapterId: sel.entryId, chapterTitle: entryTitle(sel.entryId),
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
      if (currentEntryId() === note.chapterId) showEntry(note.chapterId, true);
    };
  }

  /* ----- 点击已有重点 → 编辑 ----- */
  function onContentClick(e) {
    var mk = e.target.closest && e.target.closest("mark.hl");
    if (mk) { e.stopPropagation(); openNotePop(mk.getAttribute("data-id"), mk); }
  }

  /* ---------- 页面：Note ---------- */
  function showNotes() {
    renderTOC({ type: "library" });
    hideSelToolbar(); hideNotePop();
    var content = document.getElementById("content");
    content.innerHTML = "";
    var page = h("div", { class: "notes-page" }, [h("h1", null, ["📝 我的笔记"])]);
    var notes = getNotes();

    page.appendChild(h("div", { class: "notes-toolbar" }, [
      h("span", { class: "pill" }, ["共 " + notes.length + " 条"]),
      h("span", { class: "pill" }, [notesMode === "cloud" ? "☁️ 已登录，云端同步" : "💾 本地存储（登录后可跨设备同步）"]),
      (function () {
        var btn = h("button", { class: "mini-btn" }, ["复制全部"]);
        btn.style.cssText = "border:1px solid var(--border);border-radius:8px;padding:5px 12px;cursor:pointer;background:var(--surface);color:var(--text)";
        btn.addEventListener("click", function () { copyAllNotes(notes); });
        return btn;
      })()
    ]));

    if (!notes.length) {
      page.appendChild(h("p", { class: "empty" }, ["还没有笔记。打开任意章节或播客单集，选中正文文字即可画重点、写笔记。"]));
      content.appendChild(page);
      document.title = "我的笔记 · 知识中心";
      return;
    }

    // 按条目分组，保持全站有序
    var order = orderedEntryIds();
    var groups = {};
    notes.forEach(function (n) { (groups[n.chapterId] = groups[n.chapterId] || []).push(n); });
    var ids = Object.keys(groups).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    });

    ids.forEach(function (cid) {
      var d = state.index[cid];
      var title = d ? (kindEmoji(d.kind) + (isFlatKind(d.kind) ? entryTitle(cid) : (d.coll.titleCn || d.coll.title || "") + " · " + entryTitle(cid))) : (groups[cid][0].chapterTitle || cid);
      var g = h("div", { class: "notes-group" }, [h("h2", null, [title])]);
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
            h("a", { href: routeForEntry(n.chapterId) }, ["跳到原文 →"]),
            delBtn
          ])
        ]));
      });
      page.appendChild(g);
    });
    content.appendChild(page);
    document.title = "我的笔记 · 知识中心";
  }
  function copyAllNotes(notes) {
    var lines = notes.map(function (n) {
      return "【" + (n.chapterTitle || n.chapterId) + "】\n> " + n.text + (n.note ? "\n笔记：" + n.note : "") + "\n";
    });
    var text = lines.join("\n");
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { alert("已复制 " + notes.length + " 条笔记"); });
    else { window.prompt("复制以下内容：", text); }
  }

  function setActiveTab() {
    var hash = location.hash || "";
    var active = "";
    if (/^#\/notes/.test(hash)) active = "notes";
    else if (/^#\/(?:xiaohongshu|xhs)(\/|$)/.test(hash)) active = "xhs";
    else if (/^#\/others?(\/|$)/.test(hash)) active = "others";
    else if (/^#\/podcasts?(\/|$)/.test(hash)) active = "podcasts";
    else if (/^#\/books?(\/|$)/.test(hash)) active = "books";
    document.querySelectorAll(".tabs .tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === active);
    });
  }

  /* ---------- 路由 ---------- */
  function route() {
    closeSidebar();
    hideSelToolbar(); hideNotePop();
    setActiveTab();
    var hash = location.hash || "#/";
    var m;
    if (/^#\/notes/.test(hash)) { showNotes(); return; }
    if ((m = hash.match(/^#\/book\/([^/]+)\/(.+)$/))) { showEntry(m[2]); return; }
    if ((m = hash.match(/^#\/book\/([^/]+)\/?$/))) { showBook(m[1]); return; }
    if (/^#\/books\/?$/.test(hash)) { showBooks(); return; }
    if ((m = hash.match(/^#\/podcast\/([^/]+)\/(.+)$/))) { showEntry(m[2]); return; }
    if ((m = hash.match(/^#\/podcast\/([^/]+)\/?$/))) { showPodcast(m[1]); return; }
    if (/^#\/podcasts\/?$/.test(hash)) { showPodcasts(); return; }
    if (/^#\/others\/?$/.test(hash)) { showOthers(); return; }
    if ((m = hash.match(/^#\/other\/(.+)$/))) { showEntry(m[1]); return; }
    if (/^#\/xiaohongshu\/?$/.test(hash)) { showXhs(); return; }
    if ((m = hash.match(/^#\/xhs\/(.+)$/))) { showEntry(m[1]); return; }
    // 兼容旧书签：#/chapter/<id> → 定位到条目
    if ((m = hash.match(/^#\/chapter\/(.+)$/))) {
      if (state.index[m[1]]) { location.replace(routeForEntry(m[1])); return; }
    }
    showHome();
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
  function loadLibrary() {
    return getJSON("content/library.json").then(function (lib) {
      state.library = lib;
      var jobs = [];
      (lib.books || []).forEach(function (b) {
        jobs.push(getJSON(b.manifest).then(function (m) { state.books[b.id] = m; }));
      });
      (lib.podcasts || []).forEach(function (p) {
        jobs.push(getJSON(p.manifest).then(function (m) { state.podcasts[p.id] = m; }));
      });
      return Promise.all(jobs);
    }).then(function () {
      // 建立全局条目索引（笔记据此关联与跳转）
      state.index = {};
      (state.library.books || []).forEach(function (b) {
        var m = state.books[b.id] || {};
        (m.front || []).concat(m.chapters || []).forEach(function (e) {
          state.index[e.id] = { kind: "book", collId: b.id, coll: b, manifest: m, entry: e };
        });
      });
      (state.library.podcasts || []).forEach(function (p) {
        var m = state.podcasts[p.id] || {};
        (m.episodes || []).forEach(function (e) {
          state.index[e.id] = { kind: "podcast", collId: p.id, coll: p, manifest: m, entry: e };
        });
      });
      // 扁平条目（「其他」「小红书」）：条目本身即合集（coll 指向自身，无 manifest）
      (state.library.others || []).forEach(function (o) {
        state.index[o.id] = { kind: "other", collId: o.id, coll: o, manifest: null, entry: o };
      });
      (state.library.xiaohongshu || []).forEach(function (o) {
        state.index[o.id] = { kind: "xhs", collId: o.id, coll: o, manifest: null, entry: o };
      });
    });
  }

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
    var selTimer = null;
    document.addEventListener("selectionchange", function () {
      if (selTimer) clearTimeout(selTimer);
      selTimer = setTimeout(onSelection, 250);
    });
    content.addEventListener("click", onContentClick);
    var dismiss = function (e) {
      var bar = document.getElementById("selToolbar");
      if (bar && !bar.contains(e.target)) hideSelToolbar();
      var pop = document.getElementById("notePop");
      if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest("mark.hl"))) hideNotePop();
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("touchstart", dismiss, { passive: true });
    window.addEventListener("scroll", function () {
      var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
      if (!coarse) hideSelToolbar();
    }, { passive: true });

    loadLibrary().then(function () {
      route();
    }).catch(function (err) {
      document.getElementById("content").innerHTML =
        '<div class="empty">无法加载目录 content/library.json：' + esc(String(err.message || err)) +
        '<br>若在本地直接双击打开，请改用本地服务器：<code>python3 -m http.server</code></div>';
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
