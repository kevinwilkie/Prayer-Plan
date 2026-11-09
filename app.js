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
  var cardFilterChipsEl = document.getElementById("card-filter-chips");
  var cardsContentEl = document.getElementById("cards-content");
  var bankTabChipsEl = document.getElementById("bank-tab-chips");
  var bankContentEl = document.getElementById("bank-content");
  var answeredContentEl = document.getElementById("answered-content");
  var moreContentEl = document.getElementById("more-content");
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
      history: {}, order: [], journal: {} };
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
  function generatePlan(key) {
    var date = dateFromKey(key);
    var q = state.queues;
    var aIdx = draw(q.adoration, banks.adoration.length, counts.adoration || 1);
    var cIdx = draw(q.confession, banks.confession.length, counts.confession || 1);
    var tIdx = draw(q.thanksgiving, banks.thanksgiving.length, counts.thanksgiving || 1);
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
  // PRAYER CARDS SCREEN
  // ===========================================================================
  var cardIndex = 0;
  var cardFilter = "all";
  var scrEditing = false;

  function buildDeck() {
    var deck = [];
    banks.adoration.forEach(function (item, i) { deck.push({ type: "adoration", index: i, item: item }); });
    banks.confession.forEach(function (item, i) { deck.push({ type: "confession", index: i, item: item }); });
    banks.thanksgiving.forEach(function (item, i) { deck.push({ type: "thanksgiving", index: i, item: item }); });
    subjects.forEach(function (subj) { deck.push({ type: "supplication", subject: subj }); });
    return cardFilter === "all" ? deck : deck.filter(function (e) { return e.type === cardFilter; });
  }
  function cardKey(entry) {
    if (entry.type === "supplication") return entry.subject.name;
    return entry.type + ":" + (entry.item.term || entry.item.title);
  }
  function removeCard(entry) {
    if (entry.type === "supplication") { removeSubject(entry.subject.name); return; }
    if (cards.extras[cardKey(entry)]) { delete cards.extras[cardKey(entry)]; saveCards(); }
    deleteBankItem(entry.type, entry.index);
  }

  // A dated log block (Answered prayers / Reflections).
  function logBlock(key, label, placeholder, emptyText) {
    var ex = extrasFor(key);
    var blk = el("div", "blk");
    blk.appendChild(el("div", "blk-label", label));
    var ul = el("ul", "log-list");
    if (ex.answers.length === 0) ul.appendChild(el("li", "log-empty", emptyText));
    ex.answers.forEach(function (a, idx) {
      var li = el("li", "log-item");
      li.appendChild(el("span", "log-date", a.date));
      li.appendChild(el("span", "log-text", a.text));
      var x = el("button", "xbtn", "×"); x.type = "button"; x.setAttribute("aria-label", "Delete");
      x.addEventListener("click", function () { ex.answers.splice(idx, 1); saveCards(); renderCards(); });
      li.appendChild(x);
      ul.appendChild(li);
    });
    blk.appendChild(ul);
    var addRow = el("div", "inline-add");
    var inp = el("input", "tinput"); inp.type = "text"; inp.placeholder = placeholder;
    var btn = el("button", "acc-btn", "Add"); btn.type = "button";
    function commit() { var v = inp.value.trim(); if (!v) return; ex.answers.push({ text: v, date: todayShort(), ts: Date.now() }); saveCards(); renderCards(); }
    btn.addEventListener("click", commit);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") commit(); });
    addRow.appendChild(inp); addRow.appendChild(btn);
    blk.appendChild(addRow);
    return blk;
  }

  function renderCardFilterChips() {
    cardFilterChipsEl.innerHTML = "";
    [["all", "All"], ["adoration", "Adoration"], ["confession", "Confession"],
     ["thanksgiving", "Thanksgiving"], ["supplication", "Supplication"]].forEach(function (o) {
      var chip = el("button", "chip" + (cardFilter === o[0] ? " is-active" : ""), o[1]); chip.type = "button";
      chip.addEventListener("click", function () { cardFilter = o[0]; cardIndex = 0; scrEditing = false; renderCards(); });
      cardFilterChipsEl.appendChild(chip);
    });
  }

  function renderCards() {
    renderCardFilterChips();
    cardsContentEl.innerHTML = "";
    var deck = buildDeck();
    if (deck.length === 0) {
      cardsContentEl.appendChild(el("div", "empty-note", "No cards in this group yet — add some in Banks."));
      return;
    }
    if (cardIndex < 0) cardIndex = 0;
    if (cardIndex > deck.length - 1) cardIndex = deck.length - 1;
    var entry = deck[cardIndex];

    var card = el("div", "pcard");
    var head = el("div", "deck-head");
    head.appendChild(el("div", "deck-kind k-" + entry.type, CAT_LABEL[entry.type]));
    var right = el("div", "item-actions");
    right.appendChild(el("div", "deck-counter", (cardIndex + 1) + " / " + deck.length));
    var del = el("button", "xbtn", "×"); del.type = "button"; del.setAttribute("aria-label", "Delete card");
    del.addEventListener("click", function () {
      var nm = entry.type === "supplication" ? entry.subject.name : (entry.item.term || entry.item.title);
      if (confirmDelete(nm)) { removeCard(entry); scrEditing = false; renderCards(); }
    });
    right.appendChild(del);
    head.appendChild(right);
    card.appendChild(head);

    var title = entry.type === "supplication" ? entry.subject.name : (entry.item.term || entry.item.title);
    card.appendChild(el("div", "deck-title", title));

    if (entry.type === "supplication") renderSupplicationCard(card, entry);
    else renderActsCard(card, entry);
    cardsContentEl.appendChild(card);

    var nav = el("div", "deck-nav");
    var prev = el("button", "round-btn", "‹"); prev.type = "button"; prev.setAttribute("aria-label", "Previous card");
    var next = el("button", "round-btn", "›"); next.type = "button"; next.setAttribute("aria-label", "Next card");
    var single = deck.length <= 1;
    prev.disabled = single; next.disabled = single;
    prev.addEventListener("click", function () { stepCard(-1); });
    next.addEventListener("click", function () { stepCard(1); });
    nav.appendChild(prev);
    nav.appendChild(el("div", "swipe-hint", "swipe through your deck"));
    nav.appendChild(next);
    cardsContentEl.appendChild(nav);
  }

  function renderActsCard(card, entry) {
    var item = entry.item;
    if (entry.type !== "thanksgiving" && item.definition) card.appendChild(el("div", "deck-def", item.definition));
    var scrips = scripturesOf(item, entry.type);
    if (scrips.length) {
      var blk = el("div", "blk");
      blk.appendChild(el("div", "blk-label", "Pray this"));
      scrips.forEach(function (s) {
        if (s.text) blk.appendChild(el("div", "blk-quote", "“" + s.text + "”"));
        if (s.ref) blk.appendChild(el("div", "blk-ref", s.ref));
      });
      card.appendChild(blk);
    }
    card.appendChild(logBlock(cardKey(entry), "Reflections", "Add a reflection or prayer", "No reflections yet — jot what God shows you."));
    var editBlk = el("div", "blk");
    var eb = el("button", "acc-link", "Edit in " + CAT_LABEL[entry.type] + " bank"); eb.type = "button";
    eb.style.marginTop = "0";
    eb.addEventListener("click", function () { bankTab = entry.type; showView("library"); });
    editBlk.appendChild(eb);
    card.appendChild(editBlk);
  }

  function renderSupplicationCard(card, entry) {
    var subj = entry.subject;
    var ex = extrasFor(subj.name);

    var scrBlk = el("div", "blk");
    scrBlk.appendChild(el("div", "blk-label", "Pray this"));
    if (scrEditing) {
      var refIn = el("input", "tinput"); refIn.type = "text"; refIn.placeholder = "Reference (e.g. Colossians 1:9)";
      var txtIn = el("textarea", "tinput"); txtIn.placeholder = "Verse text"; txtIn.rows = 2;
      refIn.value = ex.scripture ? ex.scripture.ref : "";
      txtIn.value = ex.scripture ? ex.scripture.text : "";
      refIn.style.marginTop = "10px"; txtIn.style.marginTop = "8px";
      scrBlk.appendChild(refIn); scrBlk.appendChild(txtIn);
      var bar = el("div", "pc-btnbar");
      var save = el("button", "acc-btn", "Save"); save.type = "button";
      save.addEventListener("click", function () {
        var r = refIn.value.trim(), t = txtIn.value.trim();
        ex.scripture = (r || t) ? { ref: r, text: t } : null;
        saveCards(); scrEditing = false; renderCards();
      });
      var cancel = el("button", "ghost-btn", "Cancel"); cancel.type = "button"; cancel.style.padding = "0 16px";
      cancel.addEventListener("click", function () { scrEditing = false; renderCards(); });
      bar.appendChild(save); bar.appendChild(cancel); scrBlk.appendChild(bar);
    } else {
      if (ex.scripture && (ex.scripture.ref || ex.scripture.text)) {
        if (ex.scripture.text) scrBlk.appendChild(el("div", "blk-quote", "“" + ex.scripture.text + "”"));
        if (ex.scripture.ref) scrBlk.appendChild(el("div", "blk-ref", ex.scripture.ref));
      } else {
        scrBlk.appendChild(el("div", "log-empty", "No verse yet — choose a Scripture to pray over " + subj.name + "."));
      }
      var edit = el("button", "acc-link", ex.scripture ? "Edit verse" : "Add a verse"); edit.type = "button";
      edit.addEventListener("click", function () { scrEditing = true; renderCards(); });
      scrBlk.appendChild(edit);
    }
    card.appendChild(scrBlk);

    var reqBlk = el("div", "blk");
    reqBlk.appendChild(el("div", "blk-label", "Pray for"));
    var ul = el("ul", "req-list");
    subj.requests.forEach(function (req, idx) {
      var li = el("li", "req-item");
      li.appendChild(el("span", "req-bullet", "•"));
      li.appendChild(el("span", "req-text", req));
      var x = el("button", "xbtn", "×"); x.type = "button"; x.setAttribute("aria-label", "Delete");
      x.addEventListener("click", function () { removeRequestAt(subj.name, idx); renderCards(); });
      li.appendChild(x);
      ul.appendChild(li);
    });
    if (subj.requests.length === 0) ul.appendChild(el("li", "log-empty", "No requests yet — add one below."));
    reqBlk.appendChild(ul);
    var addRow = el("div", "inline-add");
    var rin = el("input", "tinput"); rin.type = "text"; rin.placeholder = "Add a request";
    var rb = el("button", "acc-btn", "Add"); rb.type = "button";
    function commitReq() { var v = rin.value.trim(); if (!v) return; addRequest(subj.name, v); renderCards(); }
    rb.addEventListener("click", commitReq);
    rin.addEventListener("keydown", function (e) { if (e.key === "Enter") commitReq(); });
    addRow.appendChild(rin); addRow.appendChild(rb);
    reqBlk.appendChild(addRow);
    card.appendChild(reqBlk);

    card.appendChild(logBlock(subj.name, "Answered prayers", "Log an answered prayer", "None logged yet — record how God answers."));
  }

  function stepCard(delta) {
    var len = buildDeck().length;
    if (len === 0) return;
    cardIndex = ((cardIndex + delta) % len + len) % len;
    scrEditing = false; renderCards();
  }

  // ===========================================================================
  // BANKS SCREEN
  // ===========================================================================
  // Remember the open bank tab for this browser tab, so a refresh keeps it.
  var BANK_TAB_KEY = "prayerPlan.bankTab";
  var bankTab = "adoration";
  try {
    var savedTab = sessionStorage.getItem(BANK_TAB_KEY);
    if (["adoration", "confession", "thanksgiving", "supplication"].indexOf(savedTab) > -1) bankTab = savedTab;
  } catch (e) {}
  var editBank = null;   // { name, idx }
  var renameSubj = null; // subject name
  var openReqSubj = null; // subject name whose add-request input is open
  var BANK_META = {
    adoration: { label: "Adoration", term: true, termPh: "Attribute (e.g. Patient)" },
    confession: { label: "Confession", term: true, termPh: "Sin (e.g. Envy)" },
    thanksgiving: { label: "Thanksgiving", term: false, termPh: "Theme (e.g. Adoption)" }
  };

  function renderBankChips() {
    try { sessionStorage.setItem(BANK_TAB_KEY, bankTab); } catch (e) {}
    bankTabChipsEl.innerHTML = "";
    [["adoration", "Adoration"], ["confession", "Confession"], ["thanksgiving", "Thanksgiving"], ["supplication", "Supplication"]].forEach(function (o) {
      var chip = el("button", "chip" + (bankTab === o[0] ? " is-active" : ""), o[1]); chip.type = "button";
      chip.addEventListener("click", function () { bankTab = o[0]; editBank = null; renameSubj = null; openReqSubj = null; renderBanks(); });
      bankTabChipsEl.appendChild(chip);
    });
  }

  function bankItemForm(meta, existing, onSave, onCancel) {
    var form = el("form", "form-card");
    form.appendChild(el("div", "form-label", (existing ? "Edit " : "Add to ") + meta.label));
    var termIn = el("input", "tinput"); termIn.type = "text"; termIn.placeholder = meta.termPh;
    form.appendChild(termIn);
    var defIn = null;
    if (meta.term) { defIn = el("input", "tinput"); defIn.type = "text"; defIn.placeholder = "Short definition"; form.appendChild(defIn); }
    var refIn = el("input", "tinput"); refIn.type = "text"; refIn.placeholder = "Scripture reference (e.g. Psalm 23:1)"; form.appendChild(refIn);
    var textIn = el("input", "tinput"); textIn.type = "text"; textIn.placeholder = "Verse text"; form.appendChild(textIn);
    if (existing) {
      termIn.value = meta.term ? existing.term : existing.title;
      if (meta.term) defIn.value = existing.definition || "";
      var s0 = meta.term ? existing.scripture : (existing.scriptures && existing.scriptures[0]);
      if (s0) { refIn.value = s0.ref || ""; textIn.value = s0.text || ""; }
    }
    var submit = el("button", "acc-btn block", existing ? "Save changes" : "Add to bank"); submit.type = "submit";
    form.appendChild(submit);
    if (existing) {
      var cancel = el("button", "ghost-btn", "Cancel"); cancel.type = "button";
      cancel.addEventListener("click", onCancel); form.appendChild(cancel);
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nm = termIn.value.trim(); if (!nm) { termIn.focus(); return; }
      var ref = refIn.value.trim(), txt = textIn.value.trim();
      var scripture = (ref || txt) ? { ref: ref, text: txt } : null;
      var item;
      if (meta.term) item = { term: nm, definition: defIn.value.trim(), scripture: scripture };
      else {
        var rest = (existing && existing.scriptures) ? existing.scriptures.slice(1) : [];
        item = { title: nm, scriptures: (scripture ? [scripture] : []).concat(rest) };
      }
      onSave(item);
    });
    return form;
  }

  function renderBanks() {
    renderBankChips();
    bankContentEl.innerHTML = "";
    if (bankTab === "supplication") { renderSupplicationBank(); return; }
    var meta = BANK_META[bankTab];
    bankContentEl.appendChild(bankItemForm(meta, null, function (item) { addBankItem(bankTab, item); renderBanks(); }, null));
    banks[bankTab].forEach(function (item, idx) {
      if (editBank && editBank.name === bankTab && editBank.idx === idx) {
        bankContentEl.appendChild(bankItemForm(meta, item,
          function (updated) { editBankItem(bankTab, idx, updated); editBank = null; renderBanks(); },
          function () { editBank = null; renderBanks(); }));
        return;
      }
      var cardEl = el("div", "item-card");
      var top = el("div", "item-top");
      top.appendChild(el("div", "item-title", meta.term ? item.term : item.title));
      var actions = el("div", "item-actions");
      var edit = el("button", "link-btn", "Edit"); edit.type = "button";
      edit.addEventListener("click", function () { editBank = { name: bankTab, idx: idx }; renderBanks(); });
      var x = el("button", "xbtn", "×"); x.type = "button"; x.setAttribute("aria-label", "Delete");
      x.addEventListener("click", function () { if (confirmDelete(meta.term ? item.term : item.title)) { deleteBankItem(bankTab, idx); renderBanks(); } });
      actions.appendChild(edit); actions.appendChild(x);
      top.appendChild(actions);
      cardEl.appendChild(top);
      if (meta.term && item.definition) cardEl.appendChild(el("div", "item-def", item.definition));
      var scrips = meta.term ? (item.scripture ? [item.scripture] : []) : (item.scriptures || []);
      scrips.forEach(function (s) {
        if (s.text) cardEl.appendChild(el("div", "item-quote", "“" + s.text + "”"));
        if (s.ref) cardEl.appendChild(el("div", "item-ref", s.ref));
      });
      bankContentEl.appendChild(cardEl);
    });
  }

  function renderSupplicationBank() {
    var addWrap = el("div", "add-row on-bg");
    var pIn = el("input", "tinput"); pIn.type = "text"; pIn.placeholder = "Add a person or area";
    var pBtn = el("button", "acc-btn", "Add"); pBtn.type = "button";
    function addPerson() { if (addSubject(pIn.value.trim())) { renderBanks(); } else pIn.focus(); }
    pBtn.addEventListener("click", addPerson);
    pIn.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addPerson(); } });
    addWrap.appendChild(pIn); addWrap.appendChild(pBtn);
    bankContentEl.appendChild(addWrap);

    subjects.forEach(function (subj) {
      var cardEl = el("div", "person-card");
      var top = el("div", "person-top");
      if (renameSubj === subj.name) {
        var nin = el("input", "tinput"); nin.type = "text"; nin.value = subj.name;
        var save = el("button", "acc-btn sm", "Save"); save.type = "button";
        function commitName() { if (renameSubject(subj.name, nin.value)) { renameSubj = null; renderBanks(); } else nin.focus(); }
        save.addEventListener("click", commitName);
        nin.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); commitName(); } });
        var wrap = el("div", "add-row"); wrap.style.flex = "1"; wrap.appendChild(nin); wrap.appendChild(save);
        top.appendChild(wrap);
      } else {
        top.appendChild(el("div", "person-name", subj.name));
        var actions = el("div", "item-actions");
        actions.appendChild(el("span", "person-count", subj.requests.length + " in rotation"));
        var edit = el("button", "link-btn", "Rename"); edit.type = "button";
        edit.addEventListener("click", function () { renameSubj = subj.name; openReqSubj = null; renderBanks(); });
        var x = el("button", "xbtn", "×"); x.type = "button"; x.setAttribute("aria-label", "Delete");
        x.addEventListener("click", function () { if (confirmDelete(subj.name)) { removeSubject(subj.name); renderBanks(); } });
        actions.appendChild(edit); actions.appendChild(x);
        top.appendChild(actions);
      }
      cardEl.appendChild(top);

      var reqs = el("div", "person-reqs");
      subj.requests.forEach(function (req, idx) {
        var r = el("div", "person-req");
        r.appendChild(el("span", "req-bullet", "•"));
        r.appendChild(el("span", "req-text", req));
        var x = el("button", "xbtn", "×"); x.type = "button"; x.setAttribute("aria-label", "Delete");
        x.addEventListener("click", function () { removeRequestAt(subj.name, idx); renderBanks(); });
        r.appendChild(x);
        reqs.appendChild(r);
      });
      cardEl.appendChild(reqs);

      if (openReqSubj === subj.name) {
        var addReq = el("div", "add-row"); addReq.style.marginTop = "10px";
        var rin = el("input", "tinput"); rin.type = "text"; rin.placeholder = "New request";
        var rb = el("button", "acc-btn sm", "Add"); rb.type = "button";
        function commitReq() { var v = rin.value.trim(); if (!v) return; addRequest(subj.name, v); renderBanks(); }
        rb.addEventListener("click", commitReq);
        rin.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); commitReq(); } });
        addReq.appendChild(rin); addReq.appendChild(rb);
        cardEl.appendChild(addReq);
      } else {
        var openBtn = el("button", "acc-link", "+ Add a request"); openBtn.type = "button";
        openBtn.addEventListener("click", function () { openReqSubj = subj.name; renameSubj = null; renderBanks(); });
        cardEl.appendChild(openBtn);
      }
      bankContentEl.appendChild(cardEl);
    });
  }

  // ===========================================================================
  // ANSWERED SCREEN
  // ===========================================================================
  function renderAnswered() {
    answeredContentEl.innerHTML = "";
    var entries = [];
    subjects.forEach(function (subj) {
      var ex = cards.extras[subj.name];
      if (!ex || !ex.answers) return;
      ex.answers.forEach(function (a, idx) {
        entries.push({ name: subj.name, text: a.text, date: a.date, ts: a.ts || 0, idx: idx });
      });
    });
    entries.sort(function (a, b) { return b.ts - a.ts; });
    if (entries.length === 0) {
      answeredContentEl.appendChild(el("div", "ans-empty",
        "Nothing logged yet. On a Supplication prayer card, record how God answers — it gathers here as a timeline of His faithfulness."));
      return;
    }
    entries.forEach(function (en) {
      var row = el("div", "ans-row");
      var top = el("div", "ans-top");
      top.appendChild(el("div", "ans-name", en.name));
      var right = el("div", "item-actions");
      right.appendChild(el("div", "ans-date", en.date));
      var x = el("button", "xbtn", "×"); x.type = "button"; x.setAttribute("aria-label", "Delete");
      x.addEventListener("click", function () {
        var ex = cards.extras[en.name];
        if (ex && ex.answers) { ex.answers.splice(en.idx, 1); saveCards(); renderAnswered(); }
      });
      right.appendChild(x);
      top.appendChild(right);
      row.appendChild(top);
      row.appendChild(el("div", "ans-text", en.text));
      answeredContentEl.appendChild(row);
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
  function renderMore() {
    moreContentEl.innerHTML = "";

    // (account / sync box is a static element above #more-content, filled by sync.js)

    // Theme
    var themeSec = el("div", "more-section");
    themeSec.appendChild(el("div", "more-label", "Theme"));
    var swRow = el("div", "swatch-row");
    var cur = currentStyle();
    STYLES.forEach(function (k) {
      var sw = el("button", "swatch" + (cur === k ? " is-active" : "")); sw.type = "button";
      sw.style.background = STYLE_SWATCH[k].bg; sw.style.color = STYLE_SWATCH[k].ink;
      sw.appendChild(el("div", "swatch-aa", "Aa"));
      sw.appendChild(el("div", "swatch-name", STYLE_LABEL[k]));
      sw.addEventListener("click", function () { applyStyle(k); renderMore(); });
      swRow.appendChild(sw);
    });
    themeSec.appendChild(swRow);
    moreContentEl.appendChild(themeSec);

    // Attributes of God
    var attrSec = el("div", "more-section");
    attrSec.appendChild(el("div", "more-label", "Attributes of God"));
    attrSec.appendChild(el("div", "more-note", "A reference for Adoration — tap any to read."));
    var list = el("div", "attr-list");
    PRAYER_PLAN.attributes.forEach(function (attr, i) {
      var row = el("div", "attr-row");
      var top = el("div", "attr-top");
      top.appendChild(el("div", "attr-name", attr.name));
      top.appendChild(el("div", "attr-chev", openAttr === i ? "–" : "+"));
      row.appendChild(top);
      if (openAttr === i) row.appendChild(el("div", "attr-def", attr.definition));
      row.addEventListener("click", function () { openAttr = openAttr === i ? -1 : i; renderMore(); });
      list.appendChild(row);
    });
    attrSec.appendChild(list);
    moreContentEl.appendChild(attrSec);

    // Back up / move devices
    var backSec = el("div", "more-section");
    backSec.appendChild(el("div", "more-label", "Back up / move devices"));
    backSec.appendChild(el("div", "more-note", "Copy this to back up your plan, or paste a backup below and import it."));
    var ta = el("textarea", "backup-area"); ta.rows = 4; ta.value = exportText();
    backSec.appendChild(ta);
    var btns = el("div", "backup-btns");
    var copy = el("button", "acc-btn", "Copy"); copy.type = "button";
    copy.addEventListener("click", function () {
      ta.select();
      var done = function () { copy.textContent = "Copied ✓"; setTimeout(function () { copy.textContent = "Copy"; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { try { document.execCommand("copy"); done(); } catch (e) {} });
      else { try { document.execCommand("copy"); done(); } catch (e) {} }
    });
    var imp = el("button", "ghost-btn", "Import"); imp.type = "button";
    var msg = el("div", "backup-msg");
    imp.addEventListener("click", function () {
      if (!ta.value.trim()) { ta.focus(); return; }
      if (typeof window.confirm === "function" && !window.confirm("Import this plan? It replaces your current banks, people, and prayer cards.")) return;
      var r = importPlan(ta.value);
      msg.textContent = r.msg;
      msg.className = "backup-msg " + (r.ok ? "ok" : "err");
      if (r.ok) { renderToday(); }
    });
    btns.appendChild(copy); btns.appendChild(imp);
    backSec.appendChild(btns);
    backSec.appendChild(msg);
    moreContentEl.appendChild(backSec);

    // About + reset
    var aboutSec = el("div", "more-section");
    aboutSec.appendChild(el("div", "more-label", "About"));
    var about = el("div", "about-text");
    about.appendChild(document.createTextNode("Prayer Plan draws a fresh ACTS set from your banks each day. Everything you add is saved on this device and syncs to your account when signed in. Inspired by Paul Miller's "));
    var italic = el("span", null, "A Praying Life"); italic.style.fontStyle = "italic";
    about.appendChild(italic);
    about.appendChild(document.createTextNode("."));
    aboutSec.appendChild(about);
    var reset = el("button", "reset-link", "Reset this device"); reset.type = "button";
    reset.addEventListener("click", function () {
      if (typeof window.confirm === "function" &&
        !window.confirm("Reset erases your banks, people, cards, and history on this device. If you're signed in, your cloud copy is untouched. Continue?")) return;
      try {
        localStorage.removeItem(CONTENT_KEY); localStorage.removeItem(CARDS_KEY);
        localStorage.removeItem(STATE_KEY); localStorage.removeItem(CUSTOM_KEY);
      } catch (e) {}
      window.location.reload();
    });
    aboutSec.appendChild(reset);
    moreContentEl.appendChild(aboutSec);
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
    else if (name === "library") renderBanks();
    else if (name === "journal") renderAnswered();
    else if (name === "more") renderMore();
    window.scrollTo({ top: 0 });
  }
  tabs.forEach(function (t) { t.addEventListener("click", function () { showView(t.dataset.view); }); });

  // ---- day arrows + keyboard ------------------------------------------------
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && currentView === "today" && session !== null) exitSession();
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
