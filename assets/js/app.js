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
    return state.manifest.chapters.filter(function (c) { return c.id === id; })[0];
  }

  /* ---------- 目录（侧边栏） ---------- */
  function renderTOC(activeId) {
    var toc = document.getElementById("toc");
    toc.innerHTML = "";
    var m = state.manifest;
    var byNumber = {};
    m.chapters.forEach(function (c) { byNumber[c.number] = c; });

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
  function showChapter(id) {
    var meta = chapterById(id);
    var content = document.getElementById("content");
    if (!meta || meta.status !== "done") { showHome(); return; }
    content.innerHTML = '<div class="loading">加载中…</div>';

    var loader = state.chapterCache[id]
      ? Promise.resolve(state.chapterCache[id])
      : getJSON(meta.summary).then(function (d) { state.chapterCache[id] = d; return d; });

    loader.then(function (data) {
      renderTOC(id);
      content.innerHTML = "";

      var partTitle = (state.manifest.parts.filter(function (p) { return p.id === data.part; })[0] || {}).title || "";
      content.appendChild(h("header", { class: "chapter-head" }, [
        h("div", { class: "chapter-eyebrow" }, [partTitle]),
        h("h1", null, ["第 " + data.chapter + " 章 · " + data.title]),
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

      content.appendChild(chapterNav(meta));
      window.scrollTo(0, 0);
      content.focus();
      document.title = "第" + data.chapter + "章 " + data.title + " · 育儿百科摘要";
    }).catch(function (err) {
      content.innerHTML = "";
      content.appendChild(h("div", { class: "empty" }, [String(err.message || err)]));
    });
  }

  function chapterNav(meta) {
    var order = [];
    state.manifest.parts.forEach(function (p) { order = order.concat(p.chapters); });
    var idx = order.indexOf(meta.number);
    function neighbor(n) {
      var num = order[idx + n];
      var c = state.manifest.chapters.filter(function (x) { return x.number === num && x.status === "done"; })[0];
      return c || null;
    }
    var prev = neighbor(-1), next = neighbor(1);
    var nav = h("nav", { class: "chapter-nav" }, []);
    nav.appendChild(prev
      ? h("a", { class: "prev", href: "#/chapter/" + prev.id }, [h("div", { class: "dir" }, ["← 上一章"]), "第" + prev.number + "章 " + prev.title])
      : h("span", null, []));
    nav.appendChild(next
      ? h("a", { class: "next", href: "#/chapter/" + next.id }, [h("div", { class: "dir" }, ["下一章 →"]), "第" + next.number + "章 " + next.title])
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

  /* ---------- 路由 ---------- */
  function route() {
    closeSidebar();
    var hash = location.hash || "#/";
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
