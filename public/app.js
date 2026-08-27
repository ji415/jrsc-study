/* 金基私塾 · local-only study app */
const LS = "jrsc-study-v1";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  meta: null,
  chapters: [],
  sections: [],
  questions: [],
  outlines: [],
  cards: [],
  search: [],
  store: loadStore(),
  exam: null,
};

function loadStore() {
  try {
    return Object.assign(
      {
        read: {},
        quiz: {},
        wrong: {},
        fav: {},
        bookmarks: {},
        notes: {},
        cards: {},
        last: {},
      },
      JSON.parse(localStorage.getItem(LS) || "{}")
    );
  } catch {
    return { read: {}, quiz: {}, wrong: {}, fav: {}, bookmarks: {}, notes: {}, cards: {}, last: {} };
  }
}
function saveStore() {
  localStorage.setItem(LS, JSON.stringify(state.store));
  paintSide();
}

function hash() {
  const h = location.hash.slice(1) || "/";
  const [path, qs] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  return { parts, q, path: "/" + parts.join("/") };
}

function go(to) {
  location.hash = to.startsWith("#") ? to.slice(1) : to;
}

function chById(id) {
  return state.chapters.find((c) => c.id === id);
}
function secById(id) {
  return state.sections.find((s) => s.id === id);
}
function qById(id) {
  return state.questions.find((q) => q.id === id);
}

function lectureChapters() {
  return state.chapters.filter((c) => c.kind === "lecture");
}
function paperChapters() {
  return state.chapters.filter((c) => c.kind === "true" || c.kind === "mock");
}

function fmtPct(n) {
  return `${Math.round(n * 100)}%`;
}

function readProgress(ch) {
  if (!ch || !ch.sectionIds.length) return 0;
  const n = ch.sectionIds.filter((id) => state.store.read[id]).length;
  return n / ch.sectionIds.length;
}

function quizStats(ids) {
  let ok = 0, n = 0;
  for (const id of ids || []) {
    const r = state.store.quiz[id];
    if (r) {
      n++;
      if (r.correct) ok++;
    }
  }
  return { ok, n, acc: n ? ok / n : 0 };
}

function paintSide() {
  const lec = lectureChapters();
  const readN = lec.reduce((s, c) => s + c.sectionIds.filter((id) => state.store.read[id]).length, 0);
  const readD = lec.reduce((s, c) => s + c.sectionIds.length, 0);
  const qn = Object.keys(state.store.quiz).length;
  const wrong = Object.keys(state.store.wrong).length;
  const el = $("#sideStat");
  if (!el) return;
  el.innerHTML = `
    <div>讲义进度 <b>${readD ? fmtPct(readN / readD) : "0%"}</b></div>
    <div class="bar"><i style="width:${readD ? (readN / readD) * 100 : 0}%"></i></div>
    <div>已做题 <b>${qn}</b> · 错题 <b>${wrong}</b></div>
    <div>题库 ${state.questions.length} 道</div>
  `;
}

function setActiveNav() {
  const { parts } = hash();
  const key = parts[0] || "home";
  $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === (key === undefined ? "home" : key) || (key === "" && a.dataset.route === "home")));
  if (!parts.length) $$(".nav a[data-route=home]")[0]?.classList.add("active");
}

function crumb(text) {
  $("#crumb").textContent = text;
}

async function boot() {
  const [meta, chapters, sections, questions, outlines, cards, search] = await Promise.all(
    ["meta", "chapters", "sections", "questions", "outlines", "cards", "search"].map((n) =>
      fetch(`data/${n}.json`).then((r) => r.json())
    )
  );
  Object.assign(state, { meta, chapters, sections, questions, outlines, cards, search });
  paintSide();
  tickClock();
  setInterval(tickClock, 1000);
  route();
}

function tickClock() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  $("#clockPill").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

window.addEventListener("hashchange", route);
$("#toggleSide").addEventListener("click", () => {
  if (window.innerWidth <= 980) $(".app").classList.toggle("show-side");
  else $(".app").classList.toggle("collapse");
});
$("#quickSearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const q = e.target.value.trim();
    if (q) go("#/search?q=" + encodeURIComponent(q));
  }
});
function closeLightbox() {
  const box = $("#lightbox");
  box.hidden = true;
  box.classList.remove("is-open");
  $("#lightboxImg").src = "";
}
function openLightbox(src) {
  const box = $("#lightbox");
  $("#lightboxImg").src = src;
  box.hidden = false;
  box.classList.add("is-open");
}
$("#lightbox").addEventListener("click", closeLightbox);

document.addEventListener("click", (e) => {
  const goEl = e.target.closest("[data-go]");
  if (goEl) go(goEl.dataset.go);
  const img = e.target.closest(".paper img");
  if (img) {
    openLightbox(img.src);
  }
});

function route() {
  document.onkeydown = null;
  if (window._examTick) {
    clearInterval(window._examTick);
    window._examTick = null;
  }
  setActiveNav();
  const { parts, q } = hash();
  const view = $("#view");
  const page = parts[0] || "home";
  try {
    if (page === "home") renderHome(view);
    else if (page === "read") renderRead(view, parts[1], parts[2]);
    else if (page === "practice") renderPractice(view, q);
    else if (page === "exam") renderExam(view, parts[1], q);
    else if (page === "cards") renderCards(view, q);
    else if (page === "wrong") renderWrong(view);
    else if (page === "fav") renderFav(view);
    else if (page === "search") renderSearch(view, q.q || "");
    else renderHome(view);
  } catch (err) {
    view.innerHTML = `<div class="card"><h3>页面出错</h3><p>${escapeHtml(String(err))}</p></div>`;
    console.error(err);
  }
  view.scrollTop = 0;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderHome(view) {
  crumb("总览");
  const lec = lectureChapters();
  const papers = paperChapters();
  const last = state.store.last;
  const lastCh = last.chapterId ? chById(last.chapterId) : lec[0];
  const lastSec = last.sectionId ? secById(last.sectionId) : lastCh ? secById(lastCh.sectionIds[0]) : null;
  const qn = Object.keys(state.store.quiz).length;
  const ok = Object.values(state.store.quiz).filter((x) => x.correct).length;
  const wrong = Object.keys(state.store.wrong).length;
  const readN = lec.reduce((s, c) => s + c.sectionIds.filter((id) => state.store.read[id]).length, 0);
  const readD = lec.reduce((s, c) => s + c.sectionIds.length, 0);

  view.innerHTML = `
    <h1 class="page">金融市场基础知识</h1>
    <p class="lead">证券业从业人员一般从业资格考试 · 讲义 ${lec.length} 章 · 题库 ${state.questions.length} 道 · ${state.meta.notice}</p>
    <div class="grid stats">
      <div class="stat"><div class="k">讲义进度</div><div class="v">${readD ? fmtPct(readN / readD) : "0%"}</div></div>
      <div class="stat"><div class="k">已做题</div><div class="v">${qn}</div></div>
      <div class="stat"><div class="k">正确率</div><div class="v">${qn ? fmtPct(ok / qn) : "—"}</div></div>
      <div class="stat"><div class="k">待消灭错题</div><div class="v">${wrong}</div></div>
    </div>
    <div class="row" style="margin-bottom:18px">
      ${
        lastSec
          ? `<button class="btn" data-go="#/read/${lastCh.id}/${lastSec.id}">继续阅读 · ${escapeHtml(lastCh.title.replace(/^第.+章\s*/, ""))}</button>`
          : `<button class="btn" data-go="#/read/${lec[0].id}">开始阅读</button>`
      }
      <button class="btn ghost" data-go="#/practice?bank=drill">章节过关</button>
      <button class="btn ghost" data-go="#/exam">计时模考</button>
      <button class="btn ghost" data-go="#/cards">考纲闪卡</button>
    </div>
    <h3 style="margin:8px 0 10px">名师讲义</h3>
    <div class="grid cards">
      ${lec
        .map((c) => {
          const st = quizStats(c.questionIds);
          return `<div class="card" data-go="#/read/${c.id}" style="cursor:pointer">
            <h3>${escapeHtml(c.title)}</h3>
            <p>${c.sectionIds.length} 节 · ${c.questionIds.length} 题</p>
            <div class="bar"><i style="width:${readProgress(c) * 100}%"></i></div>
            <div class="meta">
              <span class="chip">阅读 ${fmtPct(readProgress(c))}</span>
              <span class="chip">正确率 ${st.n ? fmtPct(st.acc) : "—"}</span>
            </div>
          </div>`;
        })
        .join("")}
    </div>
    <div class="space"></div>
    <h3 style="margin:8px 0 10px">真题 / 模拟（100 题 · 120 分钟）</h3>
    <div class="grid cards">
      ${papers
        .map(
          (c) => `<div class="card" data-go="#/exam/${c.id}" style="cursor:pointer">
            <h3>${escapeHtml(c.title)}</h3>
            <p>${c.kind === "true" ? "历年真题" : "模拟试卷"} · ${c.questionIds.length} 题</p>
            <div class="meta"><span class="chip">及格线 60</span><span class="chip">闭卷计时</span></div>
          </div>`
        )
        .join("")}
      <div class="card" data-go="#/exam/random" style="cursor:pointer">
        <h3>随机组卷</h3>
        <p>从全书题库抽 100 道，按真实考试节奏练手。</p>
        <div class="meta"><span class="chip">题库乱序</span></div>
      </div>
    </div>
  `;
}

function renderRead(view, chapterId, sectionId) {
  const lec = [...state.chapters.filter((c) => c.kind === "guide" || c.kind === "lecture")];
  const ch = chById(chapterId) || lec[1] || lec[0];
  const sid = sectionId || ch.sectionIds.find((id) => secById(id)?.kind !== "drill") || ch.sectionIds[0];
  const sec = secById(sid);
  crumb(`${ch.title}  /  ${sec ? sec.title : ""}`);
  state.store.last = { chapterId: ch.id, sectionId: sid };
  if (sid) state.store.read[sid] = Date.now();
  saveStore();

  const toc = ch.sectionIds
    .map((id) => {
      const s = secById(id);
      if (!s) return "";
      if (s.kind === "lecture") return "";
      const lv = s.level >= 4 ? "l4" : "l3";
      return `<a class="${lv} ${id === sid ? "active" : ""}" href="#/read/${ch.id}/${id}">${escapeHtml(s.title)}</a>`;
    })
    .join("");

  view.innerHTML = `
    <div class="read-layout">
      <aside class="toc">
        <select class="ch-pick" id="chPick">
          ${lec.map((c) => `<option value="${c.id}" ${c.id === ch.id ? "selected" : ""}>${escapeHtml(c.title)}</option>`).join("")}
        </select>
        ${toc}
        <div class="space"></div>
        <div class="row">
          <button class="btn ghost" data-go="#/practice?chapter=${ch.id}&bank=inline">本节真题</button>
          ${ch.kind === "lecture" ? `<button class="btn ghost" data-go="#/practice?chapter=${ch.id}&bank=drill">过关演练</button>` : ""}
        </div>
      </aside>
      <article class="paper" id="paper"></article>
    </div>
  `;
  $("#chPick").addEventListener("change", (e) => go(`#/read/${e.target.value}`));
  renderPaper($("#paper"), ch, sec);
}

function renderPaper(el, ch, sec) {
  if (!sec) {
    el.innerHTML = "<p>没有找到这一节。</p>";
    return;
  }
  const note = state.store.notes[sec.id] || "";
  const bookmarked = !!state.store.bookmarks[sec.id];
  if (sec.kind === "drill") {
    const qs = state.questions.filter((q) => q.chapterId === ch.id && q.bank === "drill");
    el.innerHTML = `
      <h3>${escapeHtml(ch.title)} · 过关演练</h3>
      <p>本章 ${qs.length} 道过关题，建议读完讲义后再做。答案与解析已收录，做完即可对照。</p>
      <p><button class="btn" data-go="#/practice?chapter=${ch.id}&bank=drill">开始过关演练</button></p>
    `;
    return;
  }
  if (sec.kind === "paper") {
    el.innerHTML = `<h3>${escapeHtml(sec.title)}</h3><p>试卷已收入刷题/模考，建议用计时模式作答。</p>
      <p><button class="btn" data-go="#/exam/${ch.id}">进入模考</button>
      <button class="btn ghost" data-go="#/practice?chapter=${ch.id}">逐题练习</button></p>`;
    return;
  }

  const html = enhanceLectureHtml(sec.html, sec.id);
  el.innerHTML = `
    <div class="row" style="font-family:var(--ui);font-size:13px;margin-bottom:8px;color:#6b6254">
      <button class="btn ghost" id="bmBtn">${bookmarked ? "已加书签" : "书签"}</button>
      <span>${sec.kind === "outline" ? "考纲" : sec.kind === "mindmap" ? "导图" : "讲义"}</span>
    </div>
    ${html}
    <div class="space"></div>
    <div style="font-family:var(--ui)">
      <div class="q-hd" style="color:#8a6d42;font-size:12px;letter-spacing:.08em">本节笔记（只存在本机）</div>
      <textarea class="notes" id="noteBox" placeholder="记下容易混的点…">${escapeHtml(note)}</textarea>
    </div>
    <div class="row" style="margin-top:16px;font-family:var(--ui)">
      ${navSectionBtn(ch, sec, -1, "上一节")}
      ${navSectionBtn(ch, sec, 1, "下一节")}
    </div>
  `;
  $("#bmBtn").addEventListener("click", () => {
    if (state.store.bookmarks[sec.id]) delete state.store.bookmarks[sec.id];
    else state.store.bookmarks[sec.id] = Date.now();
    saveStore();
    renderPaper(el, ch, sec);
  });
  $("#noteBox").addEventListener("input", (e) => {
    state.store.notes[sec.id] = e.target.value;
    saveStore();
  });
  bindInlineQuizzes(el);
}

function navSectionBtn(ch, sec, dir, label) {
  const ids = ch.sectionIds;
  const i = ids.indexOf(sec.id);
  const nid = ids[i + dir];
  if (!nid) return "";
  return `<button class="btn ghost" data-go="#/read/${ch.id}/${nid}">${label}</button>`;
}

function enhanceLectureHtml(html, sectionId) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const nodes = [...wrap.children];
  const out = document.createElement("div");
  let i = 0;
  while (i < nodes.length) {
    const n = nodes[i];
    const t = (n.textContent || "").trim();
    if (n.tagName === "P" && t.startsWith("【真题")) {
      const group = [n];
      i++;
      while (i < nodes.length) {
        const t2 = (nodes[i].textContent || "").trim();
        if (nodes[i].tagName !== "P") break;
        if (t2.startsWith("【真题")) break;
        if (/^（[一二三四五六七八九十]）/.test(t2) && !t2.startsWith("【")) break;
        if (/^[1-9][0-9]?．/.test(t2) && !t2.startsWith("【") && !/^[ABCD]/.test(t2) && !/^[ⅠⅡ]/.test(t2)) {
          if (!t2.includes("（") && !t2.startsWith("【答案") && !t2.startsWith("【解析")) break;
        }
        group.push(nodes[i]);
        i++;
        if (t2.startsWith("【解析】")) {
          // keep consuming short follow-up? stop after parse
          break;
        }
      }
      const widget = buildInlineWidget(group, sectionId);
      out.appendChild(widget);
      continue;
    }
    if (n.tagName === "P" && (t.startsWith("【答案】") || t.startsWith("【解析】"))) {
      i++;
      continue;
    }
    out.appendChild(n);
    i++;
  }
  return out.innerHTML;
}

function buildInlineWidget(group, sectionId) {
  const texts = group.map((p) => p.textContent.trim());
  const first = texts[0] || "";
  const m = first.match(/^【真题([^】]+)】\s*(.*)$/);
  const label = m ? m[1] : "";
  const stem = m ? m[2] : first;
  const q = state.questions.find(
    (x) => x.sectionId === sectionId && (x.label === label || x.stem === stem || x.stem.startsWith(stem.slice(0, 20)))
  ) || state.questions.find((x) => x.stem === stem);
  const div = document.createElement("div");
  if (q) {
    div.className = "q-widget";
    div.dataset.qid = q.id;
    div.innerHTML = renderQuestionInner(q, { hideAnswer: true, compact: true, title: `讲义真题 ${q.label || ""}` });
  } else {
    div.className = "q-widget";
    div.innerHTML = group.map((p) => p.outerHTML).join("");
  }
  return div;
}

function renderQuestionInner(q, { hideAnswer = true, compact = false, title = "" } = {}) {
  const items = (q.items || [])
    .map((it) => `<div>${escapeHtml(it.key)}．${escapeHtml(it.text)}</div>`)
    .join("");
  const opts = (q.options || [])
    .map(
      (o) =>
        `<button type="button" class="opt" data-k="${o.key}"><b>${o.key}．</b> ${escapeHtml(o.text)}</button>`
    )
    .join("");
  return `
    <div class="q-hd">${escapeHtml(title || (q.kind === "combo" ? "组合型选择题" : "选择题"))}${
      q.bank === "drill" ? " · 过关" : q.bank === "true" ? " · 真题" : q.bank === "mock" ? " · 模拟" : ""
    }</div>
    <div class="q-stem ${compact ? "" : ""}">${escapeHtml(q.stem)}</div>
    ${items ? `<div class="items">${items}</div>` : ""}
    <div class="q-opt">${opts}</div>
    <div class="row">
      <button class="btn" data-act="submit">提交</button>
      <button class="btn ghost" data-act="fav">${state.store.fav[q.id] ? "已收藏" : "收藏"}</button>
    </div>
    <div class="explain hidden" data-explain></div>
  `;
}

function bindInlineQuizzes(root) {
  $$(".q-widget[data-qid]", root).forEach((box) => bindQuestionBox(box, qById(box.dataset.qid)));
}

function bindQuestionBox(box, q, { onSubmit } = {}) {
  if (!q || !box) return;
  let pick = null;
  box.addEventListener("click", (e) => {
    const opt = e.target.closest(".opt");
    if (opt && !box.dataset.done) {
      $$(".opt", box).forEach((x) => x.classList.remove("on"));
      opt.classList.add("on");
      pick = opt.dataset.k;
    }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "fav") {
      if (state.store.fav[q.id]) delete state.store.fav[q.id];
      else state.store.fav[q.id] = Date.now();
      saveStore();
      act.textContent = state.store.fav[q.id] ? "已收藏" : "收藏";
    }
    if (act.dataset.act === "submit") {
      if (!pick) return;
      gradeQuestion(q, pick, box);
      if (onSubmit) onSubmit(pick);
    }
  });
}

function gradeQuestion(q, pick, box) {
  const ok = String(pick).toUpperCase() === String(q.answer).toUpperCase();
  state.store.quiz[q.id] = { pick, correct: ok, ts: Date.now() };
  if (ok) delete state.store.wrong[q.id];
  else state.store.wrong[q.id] = (state.store.wrong[q.id] || 0) + 1;
  saveStore();
  box.dataset.done = "1";
  $$(".opt", box).forEach((el) => {
    if (el.dataset.k === q.answer) el.classList.add("right");
    if (el.dataset.k === pick && !ok) el.classList.add("wrong");
  });
  const exp = $("[data-explain]", box);
  exp.classList.remove("hidden");
  exp.innerHTML = `<b>${ok ? "正确" : "错误"} · 答案 ${escapeHtml(q.answer)}</b><br>${escapeHtml(q.explain || "（原书未附解析）")}`;
  return ok;
}

function filterQuestions(q) {
  let list = state.questions.slice();
  if (q.qid && !q.bank && !q.chapter && !q.wrong && !q.fav) {
    const one = state.questions.find((x) => x.id === q.qid);
    return one ? [one] : [];
  }
  if (q.bank) list = list.filter((x) => x.bank === q.bank);
  if (q.chapter) list = list.filter((x) => x.chapterId === q.chapter);
  if (q.wrong) list = list.filter((x) => state.store.wrong[x.id]);
  if (q.fav) list = list.filter((x) => state.store.fav[x.id]);
  if (q.qid) {
    const i = list.findIndex((x) => x.id === q.qid);
    if (i > 0) list = list.slice(i).concat(list.slice(0, i));
  }
  return list;
}

function renderPractice(view, q) {
  const list = filterQuestions(q);
  crumb("刷题");
  if (!list.length) {
    view.innerHTML = `<h1 class="page">刷题</h1><p class="lead">这一组还没有题目。</p>
      <div class="row">
        <button class="btn" data-go="#/practice?bank=drill">章节过关</button>
        <button class="btn ghost" data-go="#/practice?bank=inline">讲义真题</button>
        <button class="btn ghost" data-go="#/practice?bank=true">历年真题</button>
        <button class="btn ghost" data-go="#/practice?bank=mock">模拟题</button>
      </div>`;
    return;
  }
  const idx = Math.max(0, Math.min(list.length - 1, parseInt(q.i || "0", 10) || 0));
  const cur = list[idx];
  const queryBase = new URLSearchParams({ ...q, i: undefined });
  queryBase.delete("i");
  const mk = (i) => {
    const p = new URLSearchParams(q);
    p.set("i", String(i));
    return `#/practice?${p.toString()}`;
  };
  view.innerHTML = `
    <div class="practice">
      <div class="q-bar">
        <div>
          <select id="bankSel">
            <option value="">全部题库</option>
            <option value="drill" ${q.bank === "drill" ? "selected" : ""}>过关演练</option>
            <option value="inline" ${q.bank === "inline" ? "selected" : ""}>讲义真题</option>
            <option value="true" ${q.bank === "true" ? "selected" : ""}>历年真题</option>
            <option value="mock" ${q.bank === "mock" ? "selected" : ""}>模拟试题</option>
          </select>
          <select id="chSel">
            <option value="">全部章节</option>
            ${state.chapters
              .map((c) => `<option value="${c.id}" ${q.chapter === c.id ? "selected" : ""}>${escapeHtml(c.title)}</option>`)
              .join("")}
          </select>
        </div>
        <div>${idx + 1} / ${list.length}</div>
      </div>
      <div class="bar"><i style="width:${((idx + 1) / list.length) * 100}%"></i></div>
      <div class="card" style="padding:22px">
        <div class="q-widget" id="qbox" data-qid="${cur.id}"></div>
        <div class="row" style="margin-top:12px">
          ${idx > 0 ? `<button class="btn ghost" data-go="${mk(idx - 1)}">上一题</button>` : ""}
          ${idx < list.length - 1 ? `<button class="btn ghost" id="nextBtn" data-go="${mk(idx + 1)}">下一题</button>` : `<button class="btn" data-go="#/">完成本组</button>`}
        </div>
      </div>
      <p class="lead">键盘：A–D 选择，Enter 提交 / 下一题</p>
    </div>
  `;
  const box = $("#qbox");
  box.innerHTML = renderQuestionInner(cur);
  bindQuestionBox(box, cur);
  $("#bankSel").addEventListener("change", (e) => {
    const p = new URLSearchParams();
    if (e.target.value) p.set("bank", e.target.value);
    if (q.chapter) p.set("chapter", q.chapter);
    go("#/practice?" + p.toString());
  });
  $("#chSel").addEventListener("change", (e) => {
    const p = new URLSearchParams();
    if (q.bank) p.set("bank", q.bank);
    if (e.target.value) p.set("chapter", e.target.value);
    go("#/practice?" + p.toString());
  });
  bindKeys(cur, box, () => {
    if (idx < list.length - 1) go(mk(idx + 1));
  });
}

function bindKeys(q, box, onNext) {
  const handler = (e) => {
    if (e.target.matches("input, textarea, select")) return;
    const map = { a: "A", b: "B", c: "C", d: "D", 1: "A", 2: "B", 3: "C", 4: "D" };
    const k = map[e.key.toLowerCase()];
    if (k && !box.dataset.done) {
      const opt = box.querySelector(`.opt[data-k="${k}"]`);
      if (opt) opt.click();
    }
    if (e.key === "Enter") {
      if (!box.dataset.done) {
        const on = box.querySelector(".opt.on");
        if (on) $("[data-act=submit]", box).click();
      } else if (onNext) onNext();
    }
  };
  document.onkeydown = handler;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderExam(view, examId, q) {
  crumb("模考");
  if (!examId) {
    const papers = paperChapters();
    view.innerHTML = `
      <h1 class="page">计时模考</h1>
      <p class="lead">与考试一致：100 题、120 分钟、60 分及格。交卷前不显示答案。</p>
      <div class="grid cards">
        ${papers
          .map(
            (c) => `<div class="card" data-go="#/exam/${c.id}" style="cursor:pointer">
              <h3>${escapeHtml(c.title)}</h3>
              <p>${c.questionIds.length} 题</p>
            </div>`
          )
          .join("")}
        <div class="card" data-go="#/exam/random" style="cursor:pointer"><h3>随机组卷</h3><p>从 662 道题中抽 100 道</p></div>
      </div>
    `;
    return;
  }
  if (q.report && state.exam && state.exam.id === examId && state.exam.submitted) {
    return renderExamReport(view, state.exam);
  }
  if (!state.exam || state.exam.id !== examId || state.exam.submitted) {
    let ids;
    if (examId === "random") {
      ids = shuffle(state.questions.map((x) => x.id)).slice(0, 100);
    } else {
      const ch = chById(examId);
      ids = ch ? ch.questionIds.slice() : [];
    }
    state.exam = {
      id: examId,
      ids,
      picks: {},
      i: 0,
      start: Date.now(),
      end: Date.now() + 120 * 60 * 1000,
      submitted: false,
    };
  }
  paintExam(view);
}

function paintExam(view) {
  const ex = state.exam;
  const ids = ex.ids;
  const i = ex.i;
  const q = qById(ids[i]);
  const left = Math.max(0, ex.end - Date.now());
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left / 1000) % 60);
  const pad = (n) => String(n).padStart(2, "0");
  const done = Object.keys(ex.picks).length;
  view.innerHTML = `
    <div class="exam-wrap">
      <div class="q-bar">
        <div>第 ${i + 1} / ${ids.length} 题 · 已答 ${done}</div>
        <div class="timer ${left < 5 * 60 * 1000 ? "warn" : ""}" id="examTimer">${pad(mm)}:${pad(ss)}</div>
      </div>
      <div class="sheet" id="sheet">
        ${ids
          .map((id, n) => `<button data-i="${n}" class="${n === i ? "cur" : ""} ${ex.picks[id] ? "done" : ""}">${n + 1}</button>`)
          .join("")}
      </div>
      <div class="card" style="padding:22px">
        <div class="q-stem">${escapeHtml(q.stem)}</div>
        ${(q.items || []).map((it) => `<div class="items">${escapeHtml(it.key)}．${escapeHtml(it.text)}</div>`).join("")}
        <div class="q-opt" id="examOpts">
          ${(q.options || [])
            .map(
              (o) =>
                `<button type="button" class="opt ${ex.picks[q.id] === o.key ? "on" : ""}" data-k="${o.key}"><b>${o.key}．</b> ${escapeHtml(o.text)}</button>`
            )
            .join("")}
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn ghost" id="prevQ" ${i === 0 ? "disabled" : ""}>上一题</button>
          <button class="btn ghost" id="nextQ" ${i === ids.length - 1 ? "disabled" : ""}>下一题</button>
          <button class="btn danger" id="handIn">交卷</button>
        </div>
      </div>
    </div>
  `;
  $("#sheet").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    ex.i = Number(b.dataset.i);
    paintExam(view);
  });
  $("#examOpts").addEventListener("click", (e) => {
    const b = e.target.closest(".opt");
    if (!b) return;
    ex.picks[q.id] = b.dataset.k;
    paintExam(view);
  });
  $("#prevQ").addEventListener("click", () => {
    ex.i = Math.max(0, i - 1);
    paintExam(view);
  });
  $("#nextQ").addEventListener("click", () => {
    ex.i = Math.min(ids.length - 1, i + 1);
    paintExam(view);
  });
  $("#handIn").addEventListener("click", () => submitExam(view));
  if (window._examTick) clearInterval(window._examTick);
  window._examTick = setInterval(() => {
    if (!state.exam || state.exam.submitted) {
      clearInterval(window._examTick);
      return;
    }
    if (Date.now() >= state.exam.end) {
      submitExam(view);
      return;
    }
    if (location.hash.startsWith("#/exam/") || location.hash === "#/exam/random") {
      const left2 = Math.max(0, state.exam.end - Date.now());
      const el = $("#examTimer");
      if (el) {
        const m2 = Math.floor(left2 / 60000);
        const s2 = Math.floor((left2 / 1000) % 60);
        el.textContent = `${pad(m2)}:${pad(s2)}`;
        el.classList.toggle("warn", left2 < 5 * 60 * 1000);
      }
    }
  }, 1000);
}

function submitExam(view) {
  const ex = state.exam;
  if (!ex || ex.submitted) return;
  if (Object.keys(ex.picks).length < ex.ids.length) {
    if (!confirm(`还有 ${ex.ids.length - Object.keys(ex.picks).length} 题未答，确认交卷？`)) return;
  }
  ex.submitted = true;
  if (window._examTick) clearInterval(window._examTick);
  let score = 0;
  for (const id of ex.ids) {
    const q = qById(id);
    const pick = ex.picks[id];
    const ok = pick && String(pick).toUpperCase() === String(q.answer).toUpperCase();
    if (ok) score++;
    if (!pick) continue;
    state.store.quiz[id] = { pick, correct: !!ok, ts: Date.now(), exam: true };
    if (ok) delete state.store.wrong[id];
    else state.store.wrong[id] = (state.store.wrong[id] || 0) + 1;
  }
  ex.score = score;
  saveStore();
  renderExamReport(view, ex);
}

function renderExamReport(view, ex) {
  const pass = ex.score >= 60;
  view.innerHTML = `
    <div class="result">
      <div>${pass ? "及格" : "未及格"}</div>
      <div class="score">${ex.score}</div>
      <p class="lead">100 题中答对 ${ex.score} 道 · 及格线 60</p>
      <div class="row" style="justify-content:center">
        <button class="btn" data-go="#/wrong">去错题本</button>
        <button class="btn ghost" data-go="#/exam">再考一套</button>
      </div>
    </div>
    <div class="space"></div>
    <div class="sheet">
      ${ex.ids
        .map((id, n) => {
          const q = qById(id);
          const ok = ex.picks[id] && ex.picks[id].toUpperCase() === q.answer.toUpperCase();
          return `<button class="${ok ? "good" : "bad"}" data-go="#/practice?chapter=${q.chapterId}&i=0">${n + 1}</button>`;
        })
        .join("")}
    </div>
    <div class="space"></div>
    ${ex.ids
      .map((id, n) => {
        const q = qById(id);
        const pick = ex.picks[id] || "未答";
        const ok = pick !== "未答" && pick.toUpperCase() === q.answer.toUpperCase();
        if (ok) return "";
        return `<div class="card" style="margin-bottom:10px">
          <div class="q-hd">${n + 1} · 答 ${escapeHtml(pick)} · 正解 ${escapeHtml(q.answer)}</div>
          <div>${escapeHtml(q.stem)}</div>
          <div class="explain">${escapeHtml(q.explain || "")}</div>
        </div>`;
      })
      .join("")}
  `;
}

function dueCards() {
  const now = Date.now();
  return state.cards.filter((c) => {
    const s = state.store.cards[c.id];
    if (!s) return true;
    return (s.due || 0) <= now;
  });
}

function renderCards(view, q) {
  crumb("闪卡");
  const due = dueCards();
  if (q.level) {
    /* keep */
  }
  let deck = due;
  if (q.chapter) deck = deck.filter((c) => c.chapterId === q.chapter);
  if (!deck.length) deck = state.cards.slice(0, 1);
  const i = Math.max(0, Math.min(deck.length - 1, parseInt(q.i || "0", 10) || 0));
  const card = deck[i] || state.cards[0];
  const lvClass = { 掌握: "master", 熟悉: "familiar", 了解: "know" }[card.level] || "familiar";
  view.innerHTML = `
    <h1 class="page">考纲闪卡</h1>
    <p class="lead">共 ${state.cards.length} 张 · 今日待复习 ${due.length} 张。点击卡片看解析，再按熟悉程度安排下次出现。</p>
    <div class="row">
      <select id="cardCh">
        <option value="">全部章节</option>
        ${lectureChapters()
          .map((c) => `<option value="${c.id}" ${q.chapter === c.id ? "selected" : ""}>${escapeHtml(c.title)}</option>`)
          .join("")}
      </select>
    </div>
    <div class="flash" id="flash">
      <div class="lv-tag chip ${lvClass}">${escapeHtml(card.level)}</div>
      <h2>${escapeHtml(card.front)}</h2>
      <div class="back hidden" id="cardBack">${escapeHtml(card.back)}</div>
      <div class="lead" id="hint">点击卡片显示讲义摘要</div>
    </div>
    <div class="row" style="justify-content:center">
      <button class="btn danger" data-grade="again">没记住</button>
      <button class="btn ghost" data-grade="hard">模糊</button>
      <button class="btn ok" data-grade="good">记住了</button>
    </div>
    <p class="lead" style="text-align:center">${i + 1} / ${deck.length}</p>
  `;
  const flash = $("#flash");
  flash.addEventListener("click", () => {
    $("#cardBack").classList.toggle("hidden");
    $("#hint").classList.add("hidden");
  });
  $("#cardCh").addEventListener("change", (e) => {
    go("#/cards" + (e.target.value ? `?chapter=${e.target.value}` : ""));
  });
  $$("[data-grade]", view).forEach((btn) => {
    btn.addEventListener("click", () => {
      const days = { again: 0.01, hard: 1, good: 3 }[btn.dataset.grade];
      const box = (state.store.cards[card.id]?.box || 1) + (btn.dataset.grade === "good" ? 1 : btn.dataset.grade === "again" ? -1 : 0);
      state.store.cards[card.id] = {
        box: Math.max(1, Math.min(5, box)),
        due: Date.now() + days * 86400000 * Math.max(1, box),
      };
      saveStore();
      const next = i + 1 < deck.length ? i + 1 : 0;
      const p = new URLSearchParams(q);
      p.set("i", String(next));
      go("#/cards?" + p.toString());
    });
  });
}

function renderWrong(view) {
  crumb("错题本");
  const ids = Object.keys(state.store.wrong);
  view.innerHTML = `
    <h1 class="page">错题本</h1>
    <p class="lead">${ids.length} 道待消灭。答对后会自动移出。</p>
    ${
      ids.length
        ? `<button class="btn" data-go="#/practice?wrong=1">开始订正</button>
           <div class="space"></div>
           ${ids
             .map((id) => {
               const q = qById(id);
               if (!q) return "";
               return `<div class="search-item" data-go="#/practice?wrong=1">
                 <div>${escapeHtml(q.stem)}</div>
                 <p>错 ${state.store.wrong[id]} 次 · 答案 ${escapeHtml(q.answer)}</p>
               </div>`;
             })
             .join("")}`
        : `<p>还没有错题。去刷一套过关演练吧。</p>`
    }
  `;
}

function renderFav(view) {
  crumb("收藏");
  const ids = Object.keys(state.store.fav);
  const bms = Object.keys(state.store.bookmarks);
  view.innerHTML = `
    <h1 class="page">收藏与书签</h1>
    <p class="lead">题目 ${ids.length} · 讲义书签 ${bms.length}</p>
    ${ids.length ? `<button class="btn" data-go="#/practice?fav=1">练习收藏题</button>` : ""}
    <div class="space"></div>
    <h3>书签</h3>
    ${
      bms
        .map((id) => {
          const s = secById(id);
          if (!s) return "";
          return `<div class="search-item" data-go="#/read/${s.chapterId}/${s.id}">
            <b>${escapeHtml(s.title)}</b>
            <p>${escapeHtml((s.text || "").slice(0, 80))}</p>
          </div>`;
        })
        .join("") || "<p class='lead'>阅读时点「书签」即可。</p>"
    }
  `;
}

function renderSearch(view, q) {
  crumb("检索");
  const kw = (q || "").trim();
  let hits = [];
  if (kw) {
    const k = kw.toLowerCase();
    hits = state.search.filter((d) => (d.text || "").toLowerCase().includes(k) || (d.title || "").includes(kw)).slice(0, 60);
  }
  view.innerHTML = `
    <h1 class="page">检索</h1>
    <input class="search-mini" style="width:min(480px,100%)" id="qInput" value="${escapeHtml(kw)}" placeholder="输入考点、关键词…" />
    <p class="lead">${kw ? `找到 ${hits.length} 条` : "从讲义与题干中搜索。"}</p>
    <div class="search-list">
      ${hits
        .map((h) => {
          const goHref =
            h.type === "question"
              ? `#/practice?qid=${h.id}`
              : `#/read/${h.chapterId}/${h.id}`;
          return `<div class="search-item" data-go="${goHref}">
            <b>${escapeHtml(h.title)}</b>
            <p>${escapeHtml(h.snippet || "")}</p>
          </div>`;
        })
        .join("")}
    </div>
  `;
  const input = $("#qInput");
  input.focus();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go("#/search?q=" + encodeURIComponent(input.value.trim()));
  });
}

boot();
