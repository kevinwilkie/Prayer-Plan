/* =============================================================================
 * Prayer Plan — "Sanctuary" build.
 *
 * Rotation engine, day history, check-off & notes, bank editor, Prayer Cards
 * (inspired by Paul Miller's "A Praying Life"), answered-prayer timeline, and a
 * combined More screen (theme, Attributes of God, back up / import, about).
 *
 * Each day draws a fresh set from the banks in data.js, shuffled and
 * non-repeating until a bank is exhausted, then reshuffled. Draws are saved per
 * day; past days stay browsable. Check-offs/notes save per day. All additions
 * persist in this browser (localStorage) and sync via sync.js when signed in.
 * ============================================================================= */
(function () {
  "use strict";

  var STATE_KEY = "prayerPlan.v3";
  var CUSTOM_KEY = "prayerPlan.banks.v1";
  var CONTENT_KEY = "prayerPlan.content.v1";
  var CARDS_KEY = "prayerPlan.cards.v1";
  var THEME_KEY = "prayerPlan.theme";   // legacy (light/dark) — no longer used
  var STYLE_KEY = "prayerPlan.style";   // now holds the palette (sanctuary/candlelight/night)

  var banks = PRAYER_PLAN.banks;
  var subjects = PRAYER_PLAN.supplication.subjects;
  var counts = PRAYER_PLAN.dailyCounts || {};

  // ---- element handles ------------------------------------------------------
  var thSeasonEl = document.getElementById("th-season");
  var thNextEl = document.getElementById("th-next");
  var thProgressEl = document.getElementById("th-progress");
  var thDateEl = document.getElementById("th-date");
  var thJumpEl = document.getElementById("th-jump");
  var prevDayBtn = document.getElementById("prev-day");
  var nextDayBtn = document.getElementById("next-day");
  var todayOverviewEl = document.getElementById("today-overview");
  var todayContentEl = document.getElementById("today-content");
  var continueEl = document.getElementById("continue-wrap");
  var sessionEl = document.getElementById("today-session");
  var bankTabChipsEl = document.getElementById("bank-tab-chips");
  var bankContentEl = document.getElementById("bank-content");
  var libListEl = document.getElementById("lib-list");
  var libRotationEl = document.getElementById("lib-rotation");
  var libCardEl = document.getElementById("lib-card");
  var libFab = document.getElementById("lib-fab");
  var sheetEl = document.getElementById("sheet");
  var sheetPanel = document.getElementById("sheet-panel");
  var journalSegEl = document.getElementById("journal-seg");
  var journalContentEl = document.getElementById("journal-content");
  var moreContentEl = document.getElementById("more-content");
  var moreMainEl = document.getElementById("more-main");
  var moreSubEl = document.getElementById("more-sub");
  var themeMeta = document.getElementById("theme-color-meta");
  var tabs = document.querySelectorAll(".tab");
  var screens = document.querySelectorAll(".screen");

  // ---- tiny helpers ---------------------------------------------------------
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function keyFor(date) { return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()); }
  function dateFromKey(key) { var p = key.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  function todayShort() {
    var d = new Date();
    return MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate() + ", " + d.getFullYear();
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function confirmDelete(label) { return (typeof window.confirm !== "function") || window.confirm("Delete “" + label + "”?"); }

  // ===========================================================================
  // EDITABLE CONTENT STORE (banks + supplication)
  // ===========================================================================
  function seedContent() {
    return { version: 1, banks: clone(PRAYER_PLAN.banks),
      supplication: { subjects: clone(PRAYER_PLAN.supplication.subjects) } };
  }
  function migrateLegacy(c) {
    try {
      var raw = localStorage.getItem(CUSTOM_KEY);
      if (!raw) return;
      var legacy = JSON.parse(raw);
      ["adoration", "confession", "thanksgiving"].forEach(function (b) {
        (legacy[b] || []).forEach(function (it) { c.banks[b].push(it); });
      });
      var sup = legacy.supplication || {};
      (sup.subjects || []).forEach(function (s) {
        if (!c.supplication.subjects.some(function (x) { return x.name === s.name; }))
          c.supplication.subjects.push({ name: s.name, requests: [] });
      });
      var reqs = sup.requests || {};
      Object.keys(reqs).forEach(function (name) {
        var subj = c.supplication.subjects.filter(function (s) { return s.name === name; })[0];
        if (subj) reqs[name].forEach(function (r) { subj.requests.push(r); });
      });
    } catch (e) {}
  }
  function loadContent() {
    try {
      var raw = localStorage.getItem(CONTENT_KEY);
      if (raw) {
        var c = JSON.parse(raw);
        if (c && c.banks && c.supplication) {
          c.banks.adoration = c.banks.adoration || [];
          c.banks.confession = c.banks.confession || [];
          c.banks.thanksgiving = c.banks.thanksgiving || [];
          c.supplication.subjects = c.supplication.subjects || [];
          return c;
        }
      }
    } catch (e) {}
    var fresh = seedContent();
    migrateLegacy(fresh);
    return fresh;
  }
  var content = loadContent();
  function saveContent() { try { localStorage.setItem(CONTENT_KEY, JSON.stringify(content)); } catch (e) {} }
  banks = content.banks;
  subjects = content.supplication.subjects;
  if (!localStorage.getItem(CONTENT_KEY)) saveContent();

  // Prayer-card extras (Scripture + answered/reflection log), keyed by card key.
  function loadCards() {
    try { var c = JSON.parse(localStorage.getItem(CARDS_KEY)); return (c && c.extras) ? c : { extras: {} }; }
    catch (e) { return { extras: {} }; }
  }
  var cards = loadCards();
  function saveCards() { try { localStorage.setItem(CARDS_KEY, JSON.stringify(cards)); } catch (e) {} }
  function extrasFor(name) {
    if (!cards.extras[name]) cards.extras[name] = { scripture: null, answers: [] };
    if (!cards.extras[name].answers) cards.extras[name].answers = [];
    return cards.extras[name];
  }

  // ---- bank + supplication ops ----------------------------------------------
  function addBankItem(name, item) { banks[name].push(item); saveContent(); resetQueue(name); }
  function editBankItem(name, idx, item) { if (idx >= 0 && idx < banks[name].length) { banks[name][idx] = item; saveContent(); } }
  function deleteBankItem(name, idx) { if (idx >= 0 && idx < banks[name].length) { banks[name].splice(idx, 1); saveContent(); resetQueue(name); } }
  function subjectByName(name) { return subjects.filter(function (s) { return s.name === name; })[0]; }
  function addRequest(name, text) { var s = subjectByName(name); if (s) { s.requests.push(text); saveContent(); resetReqQueue(name); } }
  function removeRequestAt(name, idx) { var s = subjectByName(name); if (s) { s.requests.splice(idx, 1); saveContent(); resetReqQueue(name); } }
  function addSubject(name) { if (!name || subjectByName(name)) return false; subjects.push({ name: name, requests: [] }); saveContent(); resetReqQueue(name); return true; }
  function renameSubject(oldName, newName) {
    newName = (newName || "").trim();
    if (!newName) return false;
    if (newName !== oldName && subjectByName(newName)) return false;
    var subj = subjectByName(oldName); if (!subj) return false;
    subj.name = newName;
    if (state.queues.supplication[oldName]) {
      state.queues.supplication[newName] = state.queues.supplication[oldName];
      delete state.queues.supplication[oldName]; saveState();
    }
    if (cards.extras[oldName]) { cards.extras[newName] = cards.extras[oldName]; delete cards.extras[oldName]; saveCards(); }
    saveContent(); return true;
  }
  function removeSubject(name) {
    var subj = subjectByName(name); var i = subjects.indexOf(subj);
    if (i > -1) subjects.splice(i, 1);
    delete state.queues.supplication[name];
    if (cards.extras[name]) { delete cards.extras[name]; saveCards(); }
    saveContent(); saveState();
  }

  // ===========================================================================
  // PERSISTENT ROTATION STATE
  // ===========================================================================
  function freshState() {
    return { version: 3, queues: { adoration: [], confession: [], thanksgiving: [], supplication: {} },
      history: {}, order: [], journal: {}, settings: {} };
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (!raw) return freshState();
      var s = JSON.parse(raw);
      if (!s || s.version !== 3) return freshState();
      s.queues = s.queues || { adoration: [], confession: [], thanksgiving: [], supplication: {} };
      s.queues.supplication = s.queues.supplication || {};
      s.history = s.history || {}; s.order = s.order || []; s.journal = s.journal || {};
      s.settings = s.settings || {};
      return s;
    } catch (e) { return freshState(); }
  }
  var state = loadState();
  function saveState() { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) {} }
  function resetQueue(bank) { state.queues[bank] = []; saveState(); }
  function resetReqQueue(name) { state.queues.supplication[name] = []; saveState(); }

  function draw(queue, bankLen, count) {
    var picked = [];
    if (bankLen === 0) return picked;
    count = Math.min(count, bankLen);
    var guard = 0;
    while (picked.length < count && guard++ < bankLen * 4) {
      if (!queue.length) { var deck = shuffle(range(bankLen)); for (var i = 0; i < deck.length; i++) queue.push(deck[i]); }
      var idx = queue.shift();
      if (idx < bankLen && picked.indexOf(idx) === -1) picked.push(idx);
    }
    return picked;
  }
  // How many items to draw per bank each day: the user's setting (More → Daily
  // draw, saved in state.settings.dailyCounts and synced), else the data.js default.
  var DRAW_MIN = 1, DRAW_MAX = 5;
  function dailyCount(bank) {
    var set = state.settings && state.settings.dailyCounts;
    var n = set && set[bank] != null ? +set[bank] : (counts[bank] || 1);
    if (!(n >= DRAW_MIN)) n = DRAW_MIN;
    return Math.min(DRAW_MAX, Math.round(n));
  }
  function setDailyCount(bank, n) {
    if (!state.settings) state.settings = {};
    if (!state.settings.dailyCounts) state.settings.dailyCounts = {};
    state.settings.dailyCounts[bank] = Math.max(DRAW_MIN, Math.min(DRAW_MAX, n));
    saveState();
  }
  function generatePlan(key) {
    var date = dateFromKey(key);
    var q = state.queues;
    var aIdx = draw(q.adoration, banks.adoration.length, dailyCount("adoration"));
    var cIdx = draw(q.confession, banks.confession.length, dailyCount("confession"));
    var tIdx = draw(q.thanksgiving, banks.thanksgiving.length, dailyCount("thanksgiving"));
    var supp = subjects.map(function (subj) {
      if (!q.supplication[subj.name]) q.supplication[subj.name] = [];
      var idx = draw(q.supplication[subj.name], subj.requests.length, 1)[0];
      return { name: subj.name, request: subj.requests[idx] };
    });
    return { key: key, weekday: WEEKDAYS[date.getDay()],
      label: WEEKDAYS[date.getDay()] + ", " + MONTHS[date.getMonth()] + " " + date.getDate(),
      adoration: aIdx.map(function (i) { return banks.adoration[i]; }),
      confession: cIdx.map(function (i) { return banks.confession[i]; }),
      thanksgiving: tIdx.map(function (i) { return banks.thanksgiving[i]; }),
      supplication: supp };
  }
  function ensureToday() {
    var key = keyFor(new Date());
    if (!state.history[key]) { state.history[key] = generatePlan(key); state.order.push(key); saveState(); }
    return key;
  }
  var todayKey = ensureToday();
  var viewKey = todayKey;
  function journalFor(key) { if (!state.journal[key]) state.journal[key] = { checks: {}, notes: "" }; return state.journal[key]; }

  // Guided session position: null (overview) | step index | "done". Not persisted.
  var session = null;

  // ===========================================================================
  // LITURGICAL SEASON (Western/Roman) + palette
  // ===========================================================================
  function ymd(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return ymd(r); }
  function gregorianEaster(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, mth = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * mth + 114) / 31), day = ((h + l - 7 * mth + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  function adventSunday(y) { var d = new Date(y, 10, 30), dow = d.getDay(); return addDays(d, dow <= 3 ? -dow : 7 - dow); }
  function liturgicalSeason(t) {
    var day = ymd(t), Y = day.getFullYear();
    var easter = ymd(gregorianEaster(Y));
    var ashWed = addDays(easter, -46);
    var pentecost = addDays(easter, 49);
    var advent1 = adventSunday(Y);
    var christmas = new Date(Y, 11, 25);
    var epiphany = new Date(Y, 0, 6);
    if (day <= epiphany) return "christmas";
    if (day >= ashWed && day < easter) return "lent";
    if (day.getTime() === pentecost.getTime()) return "pentecost";
    if (day >= easter && day < pentecost) return "easter";
    if (day >= advent1 && day < christmas) return "advent";
    if (day >= christmas) return "christmas";
    return "ordinary";
  }
  var SEASON_LABEL = { ordinary: "Ordinary Time", advent: "Advent", lent: "Lent",
    easter: "Easter", christmas: "Christmas", pentecost: "Pentecost" };
  var SEASON_ACC = { ordinary: "#3f7d4f", advent: "#5d4a86", lent: "#6b4a8a",
    easter: "#b5862c", christmas: "#b5862c", pentecost: "#b3402f" };
  var season = liturgicalSeason(new Date());
  // The next season boundary after `from`, e.g. { season: "advent", days: 20 }.
  function nextSeason(from) {
    var cur = liturgicalSeason(from);
    for (var i = 1; i < 400; i++) {
      var s2 = liturgicalSeason(addDays(from, i));
      if (s2 !== cur) return { season: s2, days: i };
    }
    return null;
  }
  function applySeason() {
    document.documentElement.setAttribute("data-season", season);
    if (themeMeta) themeMeta.setAttribute("content", SEASON_ACC[season] || SEASON_ACC.ordinary);
  }

  var STYLES = ["sanctuary", "candlelight", "night"];
  var STYLE_LABEL = { sanctuary: "Sanctuary", candlelight: "Candlelight", night: "Night" };
  var STYLE_SWATCH = {
    sanctuary: { bg: "#faf8f4", ink: "#2b2822" },
    candlelight: { bg: "#f1e6cd", ink: "#3a2c1a" },
    night: { bg: "#211f1a", ink: "#ece7da" }
  };
  function currentStyle() {
    try { var s = localStorage.getItem(STYLE_KEY); if (STYLES.indexOf(s) > -1) return s; } catch (e) {}
    return "sanctuary";
  }
  function applyStyle(choice) {
    if (STYLES.indexOf(choice) < 0) choice = "sanctuary";
    document.documentElement.setAttribute("data-style", choice);
    try { localStorage.setItem(STYLE_KEY, choice); } catch (e) {}
  }

  // ===========================================================================
  // TODAY — overview + guided session
  // ===========================================================================
  var SECTIONS = [
    { key: "adoration", label: "Adoration", short: "Adore" },
    { key: "confession", label: "Confession", short: "Confess" },
    { key: "thanksgiving", label: "Thanksgiving", short: "Thank" },
    { key: "supplication", label: "Supplication", short: "Ask" }
  ];
  var SECTION_KEYS = SECTIONS.map(function (s) { return s.key; });
  var CAT_LABEL = { adoration: "Adoration", confession: "Confession", thanksgiving: "Thanksgiving", supplication: "Supplication" };
  var CAT_COLOR = { adoration: "var(--adoration)", confession: "var(--confession)",
    thanksgiving: "var(--thanksgiving)", supplication: "var(--supplication)" };
  var COUNT_WORD = ["", "one", "two", "three", "four"];

  function scripturesOf(item, type) {
    if (type === "thanksgiving") return item.scriptures || [];
    return item.scripture ? [item.scripture] : [];
  }
  function itemTitle(item) { return item.term || item.title || ""; }
  function personScripture(name) {
    var ex = cards.extras[name];
    return (ex && ex.scripture && (ex.scripture.ref || ex.scripture.text)) ? ex.scripture : null;
  }
  function presentSections(plan) { return SECTION_KEYS.filter(function (k) { return plan[k] && plan[k].length; }); }
  // One step per item in ACTS order; Supplication is one step per person.
  function sessionSteps(plan) {
    var out = [];
    SECTION_KEYS.forEach(function (sec) {
      var list = plan[sec] || [];
      list.forEach(function (x, i) { out.push({ sec: sec, idx: i, count: list.length, entry: x }); });
    });
    return out;
  }
  function stepTitle(st) { return st.sec === "supplication" ? st.entry.name : itemTitle(st.entry); }

  function renderToday() {
    var plan = state.history[viewKey];
    if (session !== null) { renderSession(plan); return; }
    document.documentElement.classList.remove("hide-tabbar");
    sessionEl.hidden = true; sessionEl.innerHTML = "";
    todayOverviewEl.hidden = false;
    var jr = journalFor(viewKey);
    var present = presentSections(plan);

    // header
    thSeasonEl.textContent = SEASON_LABEL[season] || "Ordinary Time";
    var nx = nextSeason(dateFromKey(viewKey));
    thNextEl.textContent = nx ? (SEASON_LABEL[nx.season] + " in " + nx.days + (nx.days === 1 ? " day" : " days")) : "";
    thDateEl.textContent = plan.label;
    var pos = state.order.indexOf(viewKey);
    prevDayBtn.disabled = pos <= 0;
    nextDayBtn.disabled = pos >= state.order.length - 1;
    thJumpEl.innerHTML = "";
    if (viewKey !== todayKey) {
      var jb = el("button", "th-jump-btn", "Jump to today"); jb.type = "button";
      jb.addEventListener("click", function () { viewKey = todayKey; renderToday(); });
      thJumpEl.appendChild(jb);
    }
    thProgressEl.innerHTML = "";
    SECTIONS.forEach(function (s) {
      var col = el("div", "thp-col" + (jr.checks[s.key] ? " is-on" : ""));
      col.appendChild(el("div", "thp-bar"));
      col.appendChild(el("span", "thp-label", s.short));
      thProgressEl.appendChild(col);
    });

    // rows
    todayContentEl.innerHTML = "";
    present.forEach(function (sec) { todayContentEl.appendChild(todayRow(plan, sec)); });
    if (!present.length) {
      todayContentEl.appendChild(el("div", "empty-copy", "Your Library is empty. Add prayers in Library to start drawing a daily plan."));
    }

    // continue bar
    continueEl.innerHTML = "";
    if (present.length) {
      var steps = sessionSteps(plan);
      var firstOpen = present.filter(function (k) { return !jr.checks[k]; })[0];
      var anyDone = present.some(function (k) { return jr.checks[k]; });
      var eyebrow, title, start;
      if (firstOpen) {
        eyebrow = anyDone ? "Continue" : "Begin"; title = CAT_LABEL[firstOpen];
        start = steps.map(function (x) { return x.sec; }).indexOf(firstOpen);
      } else {
        eyebrow = present.length === 4 ? "All four prayed" : "All prayed"; title = "Pray through again"; start = 0;
      }
      var bar = el("button", "continue-bar"); bar.type = "button";
      var txt = el("span", "cb-text");
      txt.appendChild(el("span", "cb-eyebrow", eyebrow));
      txt.appendChild(el("span", "cb-title", title));
      bar.appendChild(txt);
      bar.appendChild(el("span", "cb-arrow", "→"));
      bar.addEventListener("click", function () { startSession(start); });
      continueEl.appendChild(bar);
    }
  }

  function todayRow(plan, sec) {
    var jr = journalFor(viewKey);
    var list = plan[sec], on = !!jr.checks[sec];
    var label = CAT_LABEL[sec], title, sub;
    if (sec === "supplication") {
      title = list.map(function (x) { return x.name; }).join(", ");
      sub = "One request each, drawn in rotation.";
      label += " · " + list.length + (list.length === 1 ? " person" : " people");
    } else {
      title = list.map(itemTitle).join(", ");
      if (list.length === 1) {
        var sc = scripturesOf(list[0], sec)[0];
        sub = (sec !== "thanksgiving" && list[0].definition) || (sc && sc.ref) || "";
      } else {
        sub = list.map(function (x) { var s0 = scripturesOf(x, sec)[0]; return s0 && s0.ref; }).filter(Boolean).join(" · ");
        label += " · " + list.length;
      }
    }
    var row = el("div", "t-row" + (on ? " is-on" : ""));
    var check = el("button", "t-check"); check.type = "button";
    check.setAttribute("aria-pressed", on ? "true" : "false");
    check.setAttribute("aria-label", "Mark " + CAT_LABEL[sec] + " as prayed");
    check.appendChild(el("span", "t-ring", on ? "✓" : ""));
    check.addEventListener("click", function () { jr.checks[sec] = !jr.checks[sec]; saveState(); renderToday(); });
    row.appendChild(check);
    var open = el("button", "t-open"); open.type = "button";
    var body = el("span", "t-body");
    var lab = el("span", "sec-label t-label", label); lab.style.color = CAT_COLOR[sec];
    body.appendChild(lab);
    body.appendChild(el("span", "t-title", title));
    if (sub) body.appendChild(el("span", "t-sub", sub));
    open.appendChild(body);
    open.appendChild(el("span", "t-chev", "›"));
    open.addEventListener("click", function () {
      var steps = sessionSteps(plan);
      startSession(steps.map(function (x) { return x.sec; }).indexOf(sec));
    });
    row.appendChild(open);
    return row;
  }

  function startSession(idx) { session = idx < 0 ? 0 : idx; renderToday(); window.scrollTo({ top: 0 }); }
  function exitSession() { session = null; renderToday(); window.scrollTo({ top: 0 }); }

  function renderSession(plan) {
    document.documentElement.classList.add("hide-tabbar");
    todayOverviewEl.hidden = true;
    sessionEl.hidden = false;
    sessionEl.innerHTML = "";
    var steps = sessionSteps(plan);
    if (session !== "done" && !steps[session]) { session = null; renderToday(); return; }
    if (session === "done") { renderDone(plan); return; }
    var jr = journalFor(viewKey);
    var present = presentSections(plan);
    var cur = steps[session], nx = steps[session + 1];
    var curPos = SECTION_KEYS.indexOf(cur.sec);
    var lastInSec = !nx || nx.sec !== cur.sec;

    var top = el("div", "s-top");
    var close = el("button", "s-close"); close.type = "button"; close.setAttribute("aria-label", "Close session");
    close.appendChild(el("span", "s-close-ring", "✕"));
    close.addEventListener("click", exitSession);
    top.appendChild(close);
    top.appendChild(el("span", "s-step", "Step " + (present.indexOf(cur.sec) + 1) + " of " + present.length));
    top.appendChild(el("span", "s-spacer"));
    sessionEl.appendChild(top);

    var segs = el("div", "s-segs");
    SECTION_KEYS.forEach(function (k, i) {
      var seg = el("div", "s-seg");
      if (plan[k] && plan[k].length && (jr.checks[k] || i <= curPos)) seg.style.background = CAT_COLOR[k];
      segs.appendChild(seg);
    });
    sessionEl.appendChild(segs);

    var bodyEl = el("div", "s-body");
    var card = el("div", "s-card");
    var head = el("div", "s-card-head");
    var lab = el("span", "sec-label", CAT_LABEL[cur.sec]); lab.style.color = CAT_COLOR[cur.sec];
    head.appendChild(lab);
    head.appendChild(el("span", "s-counter", cur.count > 1 ? (cur.idx + 1) + " of " + cur.count : ""));
    card.appendChild(head);
    card.appendChild(el("div", "s-title", stepTitle(cur)));
    var verses;
    if (cur.sec === "supplication") {
      card.appendChild(el("div", "mini-label s-prayfor", "Pray for"));
      card.appendChild(el("div", "s-req", cur.entry.request || "No requests yet"));
      var ps = personScripture(cur.entry.name);
      verses = ps ? [ps] : [];
    } else {
      if (cur.sec !== "thanksgiving" && cur.entry.definition) card.appendChild(el("div", "s-def", cur.entry.definition));
      verses = scripturesOf(cur.entry, cur.sec).filter(function (v) { return v.text || v.ref; });
    }
    if (verses.length) {
      card.appendChild(el("div", "s-rule"));
      verses.forEach(function (v, i) {
        if (v.text) { var q = el("div", "verse s-verse", "“" + v.text + "”"); if (i) q.style.marginTop = "14px"; card.appendChild(q); }
        if (v.ref) card.appendChild(el("div", "verse-ref s-ref", v.ref));
      });
    }
    bodyEl.appendChild(card);

    if (nx) {
      var nxt = el("div", "s-next");
      var nl = el("div");
      var nlab = el("span", "sec-label s-next-label", "Next · " + CAT_LABEL[nx.sec]); nlab.style.color = CAT_COLOR[nx.sec];
      nl.appendChild(nlab);
      nl.appendChild(el("div", "s-next-title", stepTitle(nx)));
      nxt.appendChild(nl);
      if (nx.count > 1) nxt.appendChild(el("span", "s-counter", (nx.idx + 1) + " of " + nx.count));
      bodyEl.appendChild(nxt);
    }

    var noteWrap = el("label", "s-note");
    noteWrap.appendChild(el("span", "sec-label s-note-label", "Note to today"));
    var ta = el("textarea", "s-note-area"); ta.rows = 3;
    ta.placeholder = "Write what God brings to mind…";
    ta.value = jr.notes || "";
    var timer = null;
    ta.addEventListener("input", function () {
      jr.notes = ta.value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(saveState, 400);
    });
    ta.addEventListener("blur", saveState);
    noteWrap.appendChild(ta);
    bodyEl.appendChild(noteWrap);
    sessionEl.appendChild(bodyEl);

    var foot = el("div", "s-foot");
    var back = el("button", "s-back", "‹"); back.type = "button"; back.setAttribute("aria-label", "Previous step");
    back.addEventListener("click", function () { saveState(); session = session > 0 ? session - 1 : null; renderToday(); });
    var amen = el("button", "s-amen", !nx ? "Amen" : (lastInSec ? "Amen · " + CAT_LABEL[nx.sec] : "Amen · next"));
    amen.type = "button";
    amen.style.background = CAT_COLOR[cur.sec];
    amen.addEventListener("click", function () {
      if (lastInSec) jr.checks[cur.sec] = true;
      saveState();
      session = nx ? session + 1 : "done";
      renderToday(); window.scrollTo({ top: 0 });
    });
    foot.appendChild(back); foot.appendChild(amen);
    sessionEl.appendChild(foot);
  }

  function renderDone(plan) {
    var present = presentSections(plan), n = present.length;
    var jr = journalFor(viewKey);
    var prayed = present.filter(function (k) { return jr.checks[k]; }).length;
    var done = el("div", "s-done");
    var dots = el("div", "s-dots");
    SECTION_KEYS.forEach(function (k) { var d = el("span", "s-dot"); d.style.background = CAT_COLOR[k]; dots.appendChild(d); });
    done.appendChild(dots);
    done.appendChild(el("div", "s-amen-big", "Amen."));
    var word = COUNT_WORD[n] || String(n);
    var lead = prayed < n ? prayed + " of " + n + " prayed" : (n === 1 ? "Prayed" : "All " + word + " prayed");
    done.appendChild(el("div", "s-done-sub", lead + " for " + plan.label + "."));
    done.appendChild(el("div", "s-done-quote", "“Pray without ceasing.” — 1 Thess. 5:17"));
    var btn = el("button", "s-done-btn", "Back to Today"); btn.type = "button";
    btn.addEventListener("click", exitSession);
    done.appendChild(btn);
    sessionEl.appendChild(done);
  }

  function stepDay(delta) {
    var pos = state.order.indexOf(viewKey);
    var next = pos + delta;
    if (next >= 0 && next < state.order.length) { viewKey = state.order[next]; renderToday(); }
  }

  // ===========================================================================
  // LIBRARY — bank lists (was Banks) + prayer card detail (was Prayer Cards)
  // ===========================================================================
  // "people" is the Library name for the Supplication subjects list.
  var LIB_BANKS = [["adoration", "Adore"], ["confession", "Confess"], ["thanksgiving", "Thanks"], ["people", "People"]];
  var BANK_LABEL = { adoration: "Adoration", confession: "Confession", thanksgiving: "Thanksgiving", people: "People" };
  var BANK_META = {
    adoration: { term: true, termPh: "Attribute (e.g. Patient)" },
    confession: { term: true, termPh: "Sin (e.g. Envy)" },
    thanksgiving: { term: false, termPh: "Theme (e.g. Adoption)" }
  };
  // The open bank is remembered for this browser tab, so a refresh keeps it.
  var BANK_TAB_KEY = "prayerPlan.bankTab";
  var bankTab = "adoration";
  try {
    var savedTab = sessionStorage.getItem(BANK_TAB_KEY);
    if (savedTab === "supplication") savedTab = "people"; // pre-redesign name
    if (BANK_LABEL[savedTab]) bankTab = savedTab;
  } catch (e) {}
  var openItem = null; // null | { bank, idx } | { bank: "people", name }
  var sheetState = null; // null | { mode: "add" | "edit", bank, idx?, name? }

  function monthDay(d) { return MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate(); }
  function shortLogDate(a) {
    var d = a.ts ? new Date(a.ts) : null;
    if (d && !isNaN(d)) return d.getFullYear() === new Date().getFullYear() ? monthDay(d) : monthDay(d) + ", " + d.getFullYear();
    return (a.date || "").replace(", " + new Date().getFullYear(), "");
  }
  function itemKey(bank, item) { return bank + ":" + itemTitle(item); } // cards.extras key (reflections)
  function planHas(plan, bank, item) {
    return !!(plan && plan[bank] && plan[bank].some(function (x) { return itemTitle(x) === itemTitle(item); }));
  }
  // Indices still waiting in the current shuffle (valid + unique).
  function pendingQueue(bank) {
    var len = banks[bank].length, seen = {};
    return (state.queues[bank] || []).filter(function (i) { if (i >= len || seen[i]) return false; seen[i] = 1; return true; });
  }
  function lastPrayedKey(bank, item) {
    for (var i = state.order.length - 1; i >= 0; i--) {
      var k = state.order[i];
      if (k !== todayKey && planHas(state.history[k], bank, item)) return k;
    }
    return null;
  }
  function libStatus(bank, item, idx, upNext) {
    if (planHas(state.history[todayKey], bank, item)) return { text: "Today", cls: "is-today" };
    if (upNext.indexOf(idx) > -1) return { text: "Up next", cls: "is-next" };
    var k = lastPrayedKey(bank, item);
    if (k) return { text: monthDay(dateFromKey(k)), cls: "" };
    return { text: "New", cls: "" };
  }
  function rotationInfo(bank) {
    var len = banks[bank].length, pending = pendingQueue(bank).length, prayed;
    if (pending) prayed = len - pending;
    else prayed = banks[bank].filter(function (it) { return planHas(state.history[todayKey], bank, it) || lastPrayedKey(bank, it); }).length;
    return { prayed: Math.min(prayed, len), len: len };
  }
  function todayRequestFor(name) {
    var plan = state.history[todayKey];
    var hit = plan && plan.supplication.filter(function (x) { return x.name === name; })[0];
    return hit ? hit.request : null;
  }

  function renderLibrary() {
    try { sessionStorage.setItem(BANK_TAB_KEY, bankTab); } catch (e) {}
    if (openItem && !resolveOpen()) openItem = null;
    libListEl.hidden = !!openItem;
    libCardEl.hidden = !openItem;
    if (openItem) { renderPrayerCard(); return; }
    libCardEl.innerHTML = "";

    // chips
    bankTabChipsEl.innerHTML = "";
    LIB_BANKS.forEach(function (o) {
      var n = o[0] === "people" ? subjects.length : banks[o[0]].length;
      var chip = el("button", "lib-chip" + (bankTab === o[0] ? " is-active" : ""), o[1] + " " + n);
      chip.type = "button"; chip.setAttribute("role", "tab"); chip.setAttribute("aria-selected", bankTab === o[0] ? "true" : "false");
      chip.addEventListener("click", function () { bankTab = o[0]; renderLibrary(); });
      bankTabChipsEl.appendChild(chip);
    });

    // rotation card
    libRotationEl.innerHTML = "";
    if (bankTab !== "people" && banks[bankTab].length) {
      var r = rotationInfo(bankTab);
      var rc = el("div", "rot-card");
      var top = el("div", "rot-top");
      top.appendChild(el("span", null, "This rotation"));
      top.appendChild(el("span", "rot-count", r.prayed + " of " + r.len + " prayed"));
      rc.appendChild(top);
      var track = el("div", "rot-track"); var fill = el("div", "rot-fill");
      fill.style.width = (r.len ? Math.round(r.prayed / r.len * 100) : 0) + "%";
      fill.style.background = CAT_COLOR[bankTab];
      track.appendChild(fill); rc.appendChild(track);
      rc.appendChild(el("div", "rot-note", "Reshuffles after every item has had its day."));
      libRotationEl.appendChild(rc);
    }

    // rows
    bankContentEl.innerHTML = "";
    if (bankTab === "people") {
      subjects.forEach(function (subj) {
        var req = todayRequestFor(subj.name);
        bankContentEl.appendChild(libRow(subj.name, req ? "Today: " + req : "", { text: subj.requests.length + " req", cls: "" },
          function () { openItem = { bank: "people", name: subj.name }; renderLibrary(); window.scrollTo({ top: 0 }); }));
      });
    } else {
      var upNext = pendingQueue(bankTab).slice(0, dailyCount(bankTab));
      banks[bankTab].forEach(function (item, idx) {
        var sc = scripturesOf(item, bankTab)[0];
        bankContentEl.appendChild(libRow(itemTitle(item), (sc && sc.ref) || item.definition || "", libStatus(bankTab, item, idx, upNext),
          function () { openItem = { bank: bankTab, idx: idx }; renderLibrary(); window.scrollTo({ top: 0 }); }));
      });
    }
    var count = bankTab === "people" ? subjects.length : banks[bankTab].length;
    if (!count) bankContentEl.appendChild(el("div", "empty-copy", "Nothing here yet. Tap + Add to start this bank."));
  }

  function libRow(title, sub, status, onClick) {
    var row = el("button", "lib-row"); row.type = "button";
    var body = el("span", "lib-row-body");
    body.appendChild(el("span", "lib-row-title", title));
    if (sub) body.appendChild(el("span", "lib-row-sub", sub));
    row.appendChild(body);
    row.appendChild(el("span", "lib-status " + status.cls, status.text));
    row.addEventListener("click", onClick);
    return row;
  }

  // The open card's data, or null if it no longer exists.
  function resolveOpen() {
    if (!openItem) return null;
    if (openItem.bank === "people") return subjectByName(openItem.name) || null;
    return banks[openItem.bank] && banks[openItem.bank][openItem.idx] || null;
  }

  function renderPrayerCard() {
    var o = openItem, isPerson = o.bank === "people";
    var data = resolveOpen();
    libCardEl.innerHTML = "";

    var bar = el("div", "pc-bar");
    var back = el("button", "pc-back", "‹ " + BANK_LABEL[o.bank]); back.type = "button";
    back.addEventListener("click", function () { openItem = null; renderLibrary(); });
    bar.appendChild(back);
    var acts = el("div", "pc-acts");
    var edit = el("button", "pc-edit", "Edit"); edit.type = "button";
    edit.addEventListener("click", function () { openSheet({ mode: "edit", bank: o.bank, idx: o.idx, name: o.name }); });
    var del = el("button", "pc-delete", "Delete"); del.type = "button";
    del.addEventListener("click", function () {
      var nm = isPerson ? data.name : itemTitle(data);
      if (!confirmDelete(nm)) return;
      if (isPerson) removeSubject(data.name);
      else {
        if (cards.extras[itemKey(o.bank, data)]) { delete cards.extras[itemKey(o.bank, data)]; saveCards(); }
        deleteBankItem(o.bank, o.idx);
      }
      openItem = null; renderLibrary();
    });
    acts.appendChild(edit); acts.appendChild(del);
    bar.appendChild(acts);
    libCardEl.appendChild(bar);

    var body = el("div", "pc-body");
    var sec = isPerson ? "supplication" : o.bank;
    var lab = el("div", "sec-label", CAT_LABEL[sec]); lab.style.color = CAT_COLOR[sec];
    body.appendChild(lab);
    body.appendChild(el("h1", "pc-title", isPerson ? data.name : itemTitle(data)));
    if (!isPerson && o.bank !== "thanksgiving" && data.definition) body.appendChild(el("div", "pc-def", data.definition));

    var verses = isPerson ? (personScripture(data.name) ? [personScripture(data.name)] : [])
      : scripturesOf(data, o.bank).filter(function (v) { return v.text || v.ref; });
    if (verses.length) {
      var vc = el("div", "pc-verse");
      vc.appendChild(el("div", "mini-label", "Pray this"));
      verses.forEach(function (v, i) {
        if (v.text) { var q = el("div", "verse pc-verse-text", "“" + v.text + "”"); if (i) q.style.marginTop = "14px"; vc.appendChild(q); }
        if (v.ref) vc.appendChild(el("div", "verse-ref pc-verse-ref", v.ref));
      });
      body.appendChild(vc);
    }

    if (isPerson) {
      body.appendChild(el("div", "mini-label pc-section", "Requests · in rotation"));
      var list = el("div", "pc-reqs");
      var todayReq = todayRequestFor(data.name);
      data.requests.forEach(function (req, idx) {
        var r = el("div", "pc-req");
        r.appendChild(el("span", "pc-req-text", req));
        if (req === todayReq) r.appendChild(el("span", "pc-req-tag", "Today"));
        var x = el("button", "x-btn", "×"); x.type = "button"; x.setAttribute("aria-label", "Remove request: " + req);
        x.addEventListener("click", function () { removeRequestAt(data.name, idx); renderLibrary(); });
        r.appendChild(x);
        list.appendChild(r);
      });
      var addRow = el("div", "pc-req pc-req-add");
      var rin = el("input", "pc-req-input"); rin.type = "text"; rin.placeholder = "Add a request…";
      rin.setAttribute("aria-label", "Add a request");
      var rb = el("button", "plus-btn", "+"); rb.type = "button"; rb.setAttribute("aria-label", "Add request");
      function commitReq() {
        var v = rin.value.trim(); if (!v) { rin.focus(); return; }
        addRequest(data.name, v); renderLibrary();
        var again = libCardEl.querySelector(".pc-req-input"); if (again) again.focus();
      }
      rb.addEventListener("click", commitReq);
      rin.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); commitReq(); } });
      addRow.appendChild(rin); addRow.appendChild(rb);
      list.appendChild(addRow);
      body.appendChild(list);
    }

    // Log: Answered (people, feeds the Journal) or Reflections (other banks).
    var key = isPerson ? data.name : itemKey(o.bank, data);
    var ex = extrasFor(key);
    body.appendChild(el("div", "mini-label pc-section", isPerson ? "Answered" : "Reflections"));
    var logs = el("div", "pc-logs");
    var entries = ex.answers.map(function (a, i) { return { a: a, i: i }; })
      .sort(function (x, y) { return (y.a.ts || 0) - (x.a.ts || 0); });
    entries.forEach(function (en) {
      var row = el("div", "pc-log");
      row.appendChild(el("span", "pc-log-date", shortLogDate(en.a)));
      row.appendChild(el("span", "pc-log-text", en.a.text));
      var x = el("button", "x-btn", "×"); x.type = "button"; x.setAttribute("aria-label", "Delete entry");
      x.addEventListener("click", function () {
        if (!confirmDelete(en.a.text)) return;
        ex.answers.splice(en.i, 1); saveCards(); renderLibrary();
      });
      row.appendChild(x);
      logs.appendChild(row);
    });
    if (!entries.length) logs.appendChild(el("div", "pc-log-empty",
      isPerson ? "None logged yet. Record how God answers." : "No reflections yet. Jot what God shows you."));
    body.appendChild(logs);
    var logAdd = el("div", "pc-log-add");
    var lin = el("input", "field-box"); lin.type = "text";
    lin.placeholder = isPerson ? "Log an answered prayer" : "Add a reflection";
    lin.setAttribute("aria-label", lin.placeholder);
    var lb = el("button", "btn-acc", "Add"); lb.type = "button";
    function commitLog() {
      var v = lin.value.trim(); if (!v) { lin.focus(); return; }
      ex.answers.push({ text: v, date: todayShort(), ts: Date.now() }); saveCards(); renderLibrary();
    }
    lb.addEventListener("click", commitLog);
    lin.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); commitLog(); } });
    logAdd.appendChild(lin); logAdd.appendChild(lb);
    body.appendChild(logAdd);
    libCardEl.appendChild(body);
  }

  // ---- bottom sheet: add to / edit a Library item ---------------------------
  var sheetReturnFocus = null;
  function openSheet(st) {
    sheetState = st;
    sheetReturnFocus = document.activeElement;
    renderSheet();
    sheetEl.hidden = false;
    document.documentElement.classList.add("sheet-open");
    var first = sheetPanel.querySelector("input, textarea"); if (first) first.focus();
  }
  function closeSheet() {
    sheetState = null;
    sheetEl.hidden = true; sheetPanel.innerHTML = "";
    document.documentElement.classList.remove("sheet-open");
    if (sheetReturnFocus && sheetReturnFocus.focus) try { sheetReturnFocus.focus(); } catch (e) {}
  }
  function renderSheet() {
    var st = sheetState, isPerson = st.bank === "people", editing = st.mode === "edit";
    var meta = BANK_META[st.bank];
    var existing = editing ? (isPerson ? subjectByName(st.name) : banks[st.bank][st.idx]) : null;
    sheetPanel.innerHTML = "";
    sheetPanel.appendChild(el("div", "sheet-grab"));
    var head = el("div", "sheet-head");
    var h = el("h2", "sheet-title", editing ? "Edit " + (isPerson ? existing.name : itemTitle(existing)) : "Add to " + BANK_LABEL[st.bank]);
    h.id = "sheet-title";
    head.appendChild(h);
    var cancel = el("button", "sheet-cancel", "Cancel"); cancel.type = "button";
    cancel.addEventListener("click", closeSheet);
    head.appendChild(cancel);
    sheetPanel.appendChild(head);

    function input(ph, val, tag) {
      var i = el(tag || "input", "field-box"); if (!tag) i.type = "text";
      i.placeholder = ph; i.setAttribute("aria-label", ph.replace(/ \(.*\)$/, "")); i.value = val || "";
      sheetPanel.appendChild(i); return i;
    }
    var s0 = existing ? (isPerson ? personScripture(existing.name) : scripturesOf(existing, st.bank)[0]) : null;
    var fA = input(isPerson ? "Name (person or area)" : meta.termPh, existing ? (isPerson ? existing.name : itemTitle(existing)) : "");
    var fB = null;
    if (isPerson && !editing) fB = input("First request");
    else if (!isPerson && meta.term) fB = input("Short definition", existing ? existing.definition : "");
    var fC = input("Scripture reference (e.g. Psalm 23:1)", s0 ? s0.ref : "");
    var fD = input("Verse text", s0 ? s0.text : "", "textarea"); fD.rows = 2;
    var msg = el("div", "sheet-msg");
    var save = el("button", "btn-acc sheet-save", editing ? "Save changes" : "Add to Library"); save.type = "button";
    function sync() { save.classList.toggle("is-dim", !fA.value.trim()); }
    fA.addEventListener("input", sync); sync();
    save.addEventListener("click", function () {
      var name = fA.value.trim();
      if (!name) { fA.focus(); return; }
      var ref = fC.value.trim(), txt = fD.value.trim();
      var scripture = (ref || txt) ? { ref: ref, text: txt } : null;
      if (isPerson) {
        if (editing) {
          if (name !== existing.name && !renameSubject(existing.name, name)) { msg.textContent = "“" + name + "” is already in People."; fA.focus(); return; }
          extrasFor(name).scripture = scripture; saveCards();
          if (openItem && openItem.bank === "people") openItem.name = name;
        } else {
          if (!addSubject(name)) { msg.textContent = "“" + name + "” is already in People."; fA.focus(); return; }
          if (fB.value.trim()) addRequest(name, fB.value.trim());
          if (scripture) { extrasFor(name).scripture = scripture; saveCards(); }
        }
      } else {
        var item;
        if (meta.term) item = { term: name, definition: fB.value.trim(), scripture: scripture };
        else {
          var rest = (existing && existing.scriptures) ? existing.scriptures.slice(1) : [];
          item = { title: name, scriptures: (scripture ? [scripture] : []).concat(rest) };
        }
        if (editing) {
          var oldKey = itemKey(st.bank, existing), newKey = itemKey(st.bank, item);
          if (oldKey !== newKey && cards.extras[oldKey]) { cards.extras[newKey] = cards.extras[oldKey]; delete cards.extras[oldKey]; saveCards(); }
          editBankItem(st.bank, st.idx, item);
        } else addBankItem(st.bank, item);
      }
      closeSheet(); renderLibrary();
    });
    sheetPanel.appendChild(msg);
    sheetPanel.appendChild(save);
    sheetPanel.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); save.click(); }
    });
  }
  document.getElementById("sheet-scrim").addEventListener("click", closeSheet);
  libFab.addEventListener("click", function () { openSheet({ mode: "add", bank: bankTab }); });

  // ===========================================================================
  // JOURNAL — Answered (from people's cards) + Notes (from each day)
  // ===========================================================================
  var JOURNAL_TAB_KEY = "prayerPlan.journalTab";
  var journalTab = "answered";
  try { if (sessionStorage.getItem(JOURNAL_TAB_KEY) === "notes") journalTab = "notes"; } catch (e) {}

  function logDate(a) {
    if (a.ts) { var d = new Date(a.ts); if (!isNaN(d)) return d; }
    var p = new Date(a.date || ""); return isNaN(p) ? null : p;
  }

  function renderJournal() {
    try { sessionStorage.setItem(JOURNAL_TAB_KEY, journalTab); } catch (e) {}
    journalSegEl.innerHTML = "";
    [["answered", "Answered"], ["notes", "Notes"]].forEach(function (o) {
      var b = el("button", "seg-btn" + (journalTab === o[0] ? " is-active" : ""), o[1]); b.type = "button";
      b.setAttribute("role", "tab"); b.setAttribute("aria-selected", journalTab === o[0] ? "true" : "false");
      b.addEventListener("click", function () { journalTab = o[0]; renderJournal(); });
      journalSegEl.appendChild(b);
    });
    journalContentEl.innerHTML = "";
    if (journalTab === "answered") renderAnsweredList(); else renderNotesList();
  }

  function renderAnsweredList() {
    var entries = [];
    subjects.forEach(function (subj) {
      var ex = cards.extras[subj.name];
      if (!ex || !ex.answers) return;
      ex.answers.forEach(function (a) {
        var d = logDate(a);
        entries.push({ name: subj.name, text: a.text, a: a, d: d, sort: d ? d.getTime() : (a.ts || 0) });
      });
    });
    entries.sort(function (x, y) { return y.sort - x.sort; });
    if (!entries.length) {
      journalContentEl.appendChild(el("div", "empty-copy", "Nothing logged yet. Open a person in Library and record how God answers."));
      return;
    }
    var thisYear = new Date().getFullYear(), lastGroup = null;
    entries.forEach(function (en) {
      var group = en.d ? MONTHS[en.d.getMonth()] + (en.d.getFullYear() !== thisYear ? " " + en.d.getFullYear() : "") : "Earlier";
      if (group !== lastGroup) { journalContentEl.appendChild(el("div", "sec-label j-month", group)); lastGroup = group; }
      var row = el("button", "j-entry"); row.type = "button";
      var top = el("span", "j-top");
      top.appendChild(el("span", "j-name", en.name));
      top.appendChild(el("span", "j-date", shortLogDate(en.a)));
      row.appendChild(top);
      row.appendChild(el("span", "j-text", en.text));
      row.addEventListener("click", function () {
        bankTab = "people"; openItem = { bank: "people", name: en.name };
        showView("library");
      });
      journalContentEl.appendChild(row);
    });
  }

  function renderNotesList() {
    var keys = state.order.slice().reverse().filter(function (k) {
      var j = state.journal[k]; return state.history[k] && j && j.notes && j.notes.trim();
    });
    if (!keys.length) {
      journalContentEl.appendChild(el("div", "empty-copy", "No notes yet. Jot one during today's session."));
      return;
    }
    keys.forEach(function (k) {
      var row = el("button", "j-entry j-note"); row.type = "button";
      row.appendChild(el("span", "sec-label j-note-label", state.history[k].label));
      row.appendChild(el("span", "j-note-text", state.journal[k].notes.trim()));
      row.addEventListener("click", function () { viewKey = k; session = null; showView("today"); });
      journalContentEl.appendChild(row);
    });
  }

  // ===========================================================================
  // MORE SCREEN
  // ===========================================================================
  function importPlan(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, msg: "That isn't valid JSON." }; }
    var c = data.content || data;
    if (!c || !c.banks || !c.supplication || !c.supplication.subjects) {
      return { ok: false, msg: "This doesn't look like a prayer-plan export." };
    }
    content.banks = {
      adoration: c.banks.adoration || [],
      confession: c.banks.confession || [],
      thanksgiving: c.banks.thanksgiving || []
    };
    content.supplication = { subjects: c.supplication.subjects || [] };
    saveContent();
    banks = content.banks; subjects = content.supplication.subjects;
    cards.extras = (data.cards && data.cards.extras) ? data.cards.extras : (data.cards || {});
    saveCards();
    state.queues = { adoration: [], confession: [], thanksgiving: [], supplication: {} };
    var oi = state.order.indexOf(todayKey); if (oi > -1) state.order.splice(oi, 1);
    delete state.history[todayKey];
    saveState();
    todayKey = ensureToday(); viewKey = todayKey; session = null;
    return { ok: true, msg: "Imported — your plan was loaded." };
  }
  function exportText() { return JSON.stringify({ content: content, cards: cards.extras }, null, 1); }

  var openAttr = -1;
  var moreSub = null; // null | "attrs" | "backup" | "about"
  var SUB_TITLE = { attrs: "Attributes of God", backup: "Back up & restore", about: "About" };

  function renderMore() {
    moreMainEl.hidden = !!moreSub;
    moreSubEl.hidden = !moreSub;
    if (moreSub) { renderMoreSub(); return; }
    moreSubEl.innerHTML = "";
    moreContentEl.innerHTML = "";
    // (the account card is #account-box, above this, filled by sync.js)

    // Theme
    var themeSec = el("div");
    themeSec.appendChild(el("div", "sec-label more-label", "Theme"));
    var swRow = el("div", "swatches");
    var cur = currentStyle();
    STYLES.forEach(function (k) {
      var sw = el("button", "swatch" + (cur === k ? " is-active" : "")); sw.type = "button";
      sw.setAttribute("aria-pressed", cur === k ? "true" : "false");
      sw.style.background = STYLE_SWATCH[k].bg; sw.style.color = STYLE_SWATCH[k].ink;
      sw.appendChild(el("span", "swatch-aa", "Aa"));
      sw.appendChild(el("span", "swatch-name", STYLE_LABEL[k]));
      sw.addEventListener("click", function () { applyStyle(k); renderMore(); });
      swRow.appendChild(sw);
    });
    themeSec.appendChild(swRow);
    moreContentEl.appendChild(themeSec);

    // Daily draw
    var drawSec = el("div");
    drawSec.appendChild(el("div", "sec-label more-label", "Daily draw"));
    var dcard = el("div", "info-card");
    ["adoration", "confession", "thanksgiving"].forEach(function (k) {
      var n = dailyCount(k);
      var row = el("div", "draw-row");
      row.appendChild(el("span", "draw-label", CAT_LABEL[k]));
      var ctl = el("div", "stepper");
      var dec = el("button", "step-btn", "−"); dec.type = "button";
      dec.setAttribute("aria-label", "Fewer " + CAT_LABEL[k] + " items per day"); dec.disabled = n <= DRAW_MIN;
      dec.addEventListener("click", function () { setDailyCount(k, n - 1); renderMore(); });
      var val = el("span", "step-val", String(n)); val.setAttribute("aria-live", "polite");
      var inc = el("button", "step-btn is-plus", "+"); inc.type = "button";
      inc.setAttribute("aria-label", "More " + CAT_LABEL[k] + " items per day"); inc.disabled = n >= DRAW_MAX;
      inc.addEventListener("click", function () { setDailyCount(k, n + 1); renderMore(); });
      ctl.appendChild(dec); ctl.appendChild(val); ctl.appendChild(inc);
      row.appendChild(ctl);
      dcard.appendChild(row);
    });
    drawSec.appendChild(dcard);
    drawSec.appendChild(el("div", "more-caption", "Applies from tomorrow's draw."));
    moreContentEl.appendChild(drawSec);

    // Reference list
    var ref = el("div", "info-card");
    [["attrs", "Attributes of God"], ["backup", "Back up & restore"], ["about", "About"]].forEach(function (o) {
      var r = el("button", "ref-row"); r.type = "button";
      r.appendChild(el("span", null, o[1]));
      r.appendChild(el("span", "ref-chev", "›"));
      r.addEventListener("click", function () { moreSub = o[0]; renderMore(); window.scrollTo({ top: 0 }); });
      ref.appendChild(r);
    });
    moreContentEl.appendChild(ref);

    var reset = el("button", "reset-link", "Reset this device"); reset.type = "button";
    reset.addEventListener("click", function () {
      if (typeof window.confirm === "function" &&
        !window.confirm("Reset erases your Library, people, cards, and history on this device. If you're signed in, your cloud copy is untouched. Continue?")) return;
      try {
        localStorage.removeItem(CONTENT_KEY); localStorage.removeItem(CARDS_KEY);
        localStorage.removeItem(STATE_KEY); localStorage.removeItem(CUSTOM_KEY);
      } catch (e) {}
      window.location.reload();
    });
    moreContentEl.appendChild(reset);
  }

  function renderMoreSub() {
    moreSubEl.innerHTML = "";
    var head = el("div", "sub-head");
    var back = el("button", "pc-back", "‹ More"); back.type = "button";
    back.addEventListener("click", function () { moreSub = null; renderMore(); });
    head.appendChild(back);
    head.appendChild(el("h1", "screen-title", SUB_TITLE[moreSub]));
    moreSubEl.appendChild(head);
    var body = el("div", "sub-body");
    moreSubEl.appendChild(body);

    if (moreSub === "attrs") {
      body.appendChild(el("div", "more-caption", "A reference for Adoration. Tap any to read."));
      PRAYER_PLAN.attributes.forEach(function (attr, i) {
        var open = openAttr === i;
        var row = el("div", "attr-row");
        var btn = el("button", "attr-top"); btn.type = "button";
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.appendChild(el("span", "attr-name", attr.name));
        btn.appendChild(el("span", "attr-chev", open ? "–" : "+"));
        btn.addEventListener("click", function () { openAttr = open ? -1 : i; renderMore(); });
        row.appendChild(btn);
        if (open) row.appendChild(el("div", "attr-def", attr.definition));
        body.appendChild(row);
      });
    } else if (moreSub === "backup") {
      body.appendChild(el("div", "sub-prose", "Copy this to back up your plan, or paste a backup and import it."));
      var ta = el("textarea", "backup-area"); ta.rows = 12; ta.value = exportText();
      ta.setAttribute("aria-label", "Backup text");
      body.appendChild(ta);
      var btns = el("div", "backup-btns");
      var copy = el("button", "btn-acc", "Copy"); copy.type = "button";
      copy.addEventListener("click", function () {
        ta.select();
        var done = function () { copy.textContent = "Copied ✓"; setTimeout(function () { copy.textContent = "Copy"; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { try { document.execCommand("copy"); done(); } catch (e) {} });
        else { try { document.execCommand("copy"); done(); } catch (e) {} }
      });
      var imp = el("button", "btn-outline", "Import…"); imp.type = "button";
      var msg = el("div", "backup-msg");
      imp.addEventListener("click", function () {
        if (!ta.value.trim() || ta.value === exportText()) { msg.className = "backup-msg"; msg.textContent = "Paste a backup into the box above, then tap Import."; ta.focus(); ta.select(); return; }
        if (typeof window.confirm === "function" && !window.confirm("Import this plan? It replaces your current Library, people, and prayer cards.")) return;
        var r = importPlan(ta.value);
        msg.textContent = r.msg;
        msg.className = "backup-msg " + (r.ok ? "ok" : "err");
      });
      btns.appendChild(copy); btns.appendChild(imp);
      body.appendChild(btns);
      body.appendChild(msg);
    } else if (moreSub === "about") {
      var about = el("div", "sub-prose about-text");
      about.appendChild(document.createTextNode("Prayer Plan draws a fresh ACTS set from your Library each day, working through every item before it repeats. Everything is saved on this device and syncs to your account when signed in. Prayer cards are inspired by Paul Miller's "));
      about.appendChild(el("i", null, "A Praying Life"));
      about.appendChild(document.createTextNode("."));
      body.appendChild(about);
    }
  }

  // ===========================================================================
  // VIEW SWITCHING
  // ===========================================================================
  // The current screen is remembered for this browser tab (sessionStorage), so a
  // refresh keeps you where you were; opening the app fresh starts on Today.
  var VIEW_KEY = "prayerPlan.view";
  var VIEWS = ["today", "library", "journal", "more"];
  // Tabs from before the redesign: Banks + Prayer Cards became Library, Answered became Journal.
  var VIEW_MIGRATE = { banks: "library", cards: "library", answered: "journal" };
  function normalizeView(name) { name = VIEW_MIGRATE[name] || name; return VIEWS.indexOf(name) > -1 ? name : "today"; }
  var currentView = "today";
  function showView(name) {
    name = normalizeView(name);
    if (name !== "today" || currentView !== "today") session = null;
    currentView = name;
    try { sessionStorage.setItem(VIEW_KEY, name); } catch (e) {}
    screens.forEach(function (s) { s.classList.toggle("is-active", s.dataset.view === name); });
    tabs.forEach(function (t) { t.classList.toggle("is-active", t.dataset.view === name); });
    if (name === "today") renderToday();
    else if (name === "library") renderLibrary();
    else if (name === "journal") renderJournal();
    else if (name === "more") renderMore();
    if (name !== "more") moreSub = null;
    window.scrollTo({ top: 0 });
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { openItem = null; moreSub = null; showView(t.dataset.view); });
  });

  // ---- day arrows + keyboard ------------------------------------------------
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (sheetState) closeSheet();
    else if (currentView === "today" && session !== null) exitSession();
  });
  prevDayBtn.addEventListener("click", function () { stepDay(-1); });
  nextDayBtn.addEventListener("click", function () { stepDay(1); });

  // ---- swipe navigation -----------------------------------------------------
  var touchX = null, touchY = null;
  document.addEventListener("touchstart", function (e) {
    touchX = e.changedTouches[0].clientX; touchY = e.changedTouches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (currentView === "today" && session === null) stepDay(dx < 0 ? 1 : -1);
    }
    touchX = touchY = null;
  }, { passive: true });

  // ---- go -------------------------------------------------------------------
  applyStyle(currentStyle());
  applySeason();
  var savedView = null;
  try { savedView = sessionStorage.getItem(VIEW_KEY); } catch (e) {}
  savedView = savedView ? normalizeView(savedView) : null;
  if (savedView && savedView !== "today") showView(savedView);
  else renderToday();

  // expose a couple of hooks for sync.js (re-render after cloud pulls)
  window.PrayerApp = {
    reload: function () {
      content = loadContent(); banks = content.banks; subjects = content.supplication.subjects;
      cards = loadCards(); state = loadState();
      todayKey = ensureToday(); viewKey = todayKey; session = null;
      showView(currentView);
    }
  };
})();
