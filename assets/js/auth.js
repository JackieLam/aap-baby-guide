/* 账号系统 + 云端笔记（Supabase）
 * - 邮箱 + 密码 注册/登录
 * - 登录后：拉取该用户的笔记 → 通知 app.js 切到云端模式（window.setNotesMode）
 * - 未配置 Supabase（config.js 仍是占位）时：整体禁用，站点继续用本地笔记
 *
 * 依赖：index.html 中先加载 @supabase/supabase-js(UMD, 暴露 window.supabase) 与 config.js。
 * 数据隔离：靠数据库 RLS（见 docs/账号系统设置指南.md），本文件不保存任何机密。
 */
(function () {
  "use strict";

  var URL_ = window.SUPABASE_URL || "";
  var KEY_ = window.SUPABASE_ANON_KEY || "";
  var configured = URL_ && KEY_ && URL_.indexOf("YOUR_") === -1 && KEY_.indexOf("YOUR_") === -1;

  var authArea = document.getElementById("authArea");
  if (!configured) {
    // 未配置：不显示登录入口，站点保持纯本地笔记
    if (authArea) authArea.innerHTML = "";
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    console.warn("supabase-js 未加载，账号系统不可用");
    return;
  }

  var sb = window.supabase.createClient(URL_, KEY_);

  /* ---------- 应用笔记 <-> 数据库行 的字段映射 ---------- */
  function rowToNote(r) {
    return {
      id: r.id, chapterId: r.chapter_id, chapterTitle: r.chapter_title || "",
      text: r.quote_text, note: r.note_text || "", color: r.color,
      occ: r.occ, createdAt: r.created_at ? Date.parse(r.created_at) : 0
    };
  }
  function noteToRow(n) {
    return {
      id: n.id, chapter_id: n.chapterId, chapter_title: n.chapterTitle || "",
      quote_text: n.text, note_text: n.note || "", color: n.color, occ: n.occ
    };
  }

  /* ---------- 暴露给 app.js 的云端写接口 ---------- */
  window.CloudNotes = {
    upsert: function (note) {
      sb.from("notes").upsert(noteToRow(note)).then(function (res) {
        if (res.error) console.warn("保存笔记失败", res.error.message);
      });
    },
    remove: function (id) {
      sb.from("notes").delete().eq("id", id).then(function (res) {
        if (res.error) console.warn("删除笔记失败", res.error.message);
      });
    }
  };

  function loadCloudNotes() {
    return sb.from("notes").select("*").order("created_at", { ascending: true })
      .then(function (res) {
        if (res.error) { console.warn("加载笔记失败", res.error.message); return []; }
        return (res.data || []).map(rowToNote);
      });
  }

  /* ---------- 登录弹窗 UI ---------- */
  function buildModal() {
    if (document.getElementById("authModal")) return;
    var wrap = document.createElement("div");
    wrap.id = "authModal";
    wrap.className = "auth-modal";
    wrap.innerHTML =
      '<div class="auth-box">' +
      '  <button class="auth-close" id="authClose" aria-label="关闭">✕</button>' +
      '  <h2 id="authTitle">登录</h2>' +
      '  <input id="authEmail" type="email" placeholder="邮箱" autocomplete="username" />' +
      '  <input id="authPass" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password" />' +
      '  <p class="auth-msg" id="authMsg"></p>' +
      '  <button class="auth-submit" id="authSubmit">登录</button>' +
      '  <p class="auth-switch">还没有账号？<a href="#" id="authToggle">注册一个</a></p>' +
      '</div>';
    document.body.appendChild(wrap);

    var mode = "login"; // login | signup
    function setMode(m) {
      mode = m;
      document.getElementById("authTitle").textContent = m === "login" ? "登录" : "注册";
      document.getElementById("authSubmit").textContent = m === "login" ? "登录" : "注册";
      document.getElementById("authToggle").textContent = m === "login" ? "注册一个" : "去登录";
      document.querySelector("#authModal .auth-switch").childNodes[0].nodeValue =
        m === "login" ? "还没有账号？" : "已有账号？";
      msg("");
    }
    function msg(t, ok) {
      var el = document.getElementById("authMsg");
      el.textContent = t || "";
      el.className = "auth-msg" + (ok ? " ok" : "");
    }
    function close() { wrap.classList.remove("show"); }

    document.getElementById("authClose").onclick = close;
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    document.getElementById("authToggle").onclick = function (e) {
      e.preventDefault(); setMode(mode === "login" ? "signup" : "login");
    };
    document.getElementById("authSubmit").onclick = function () {
      var email = document.getElementById("authEmail").value.trim();
      var pass = document.getElementById("authPass").value;
      if (!email || !pass) { msg("请输入邮箱和密码"); return; }
      msg("处理中…");
      var p = mode === "login"
        ? sb.auth.signInWithPassword({ email: email, password: pass })
        : sb.auth.signUp({ email: email, password: pass });
      p.then(function (res) {
        if (res.error) { msg(res.error.message); return; }
        if (mode === "signup" && !res.data.session) {
          msg("注册成功，请到邮箱点击确认链接后再登录。", true); return;
        }
        close();
      });
    };
    wrap.setMode = setMode;
    return wrap;
  }
  function openModal() {
    var m = buildModal();
    document.getElementById("authMsg").textContent = "";
    m.classList.add("show");
    document.getElementById("authEmail").focus();
  }

  /* ---------- 顶栏账号区 ---------- */
  function renderAuthArea(user) {
    if (!authArea) return;
    authArea.innerHTML = "";
    if (user) {
      var who = document.createElement("span");
      who.className = "auth-user";
      who.textContent = user.email;
      var out = document.createElement("button");
      out.className = "auth-btn";
      out.textContent = "退出";
      out.onclick = function () { sb.auth.signOut(); };
      authArea.appendChild(who);
      authArea.appendChild(out);
    } else {
      var login = document.createElement("button");
      login.className = "auth-btn";
      login.textContent = "登录 / 注册";
      login.onclick = openModal;
      authArea.appendChild(login);
    }
  }

  /* ---------- 首次登录：把本地笔记迁移到账号 ---------- */
  function maybeMigrateLocal(cloudList) {
    var local = (window.getLocalNotes ? window.getLocalNotes() : []) || [];
    if (!local.length) return Promise.resolve(cloudList);
    var cloudIds = {};
    cloudList.forEach(function (n) { cloudIds[n.id] = 1; });
    var toMigrate = local.filter(function (n) { return !cloudIds[n.id]; });
    if (!toMigrate.length) return Promise.resolve(cloudList);
    if (!window.confirm("检测到本机有 " + toMigrate.length + " 条本地笔记，是否同步到当前账号？")) {
      return Promise.resolve(cloudList);
    }
    return sb.from("notes").upsert(toMigrate.map(noteToRow)).then(function (res) {
      if (res.error) { console.warn("迁移失败", res.error.message); return cloudList; }
      try { localStorage.removeItem("aap-notes:v1"); } catch (e) {}
      return loadCloudNotes();
    });
  }

  /* ---------- 监听登录状态 ---------- */
  sb.auth.onAuthStateChange(function (_event, session) {
    var user = session && session.user;
    renderAuthArea(user);
    if (user) {
      loadCloudNotes()
        .then(maybeMigrateLocal)
        .then(function (list) { if (window.setNotesMode) window.setNotesMode("cloud", list); });
    } else {
      if (window.setNotesMode) window.setNotesMode("local");
    }
  });

  // 页面载入先按当前会话渲染一次
  sb.auth.getSession().then(function (res) {
    var user = res.data.session && res.data.session.user;
    renderAuthArea(user);
  });
})();
