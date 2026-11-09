/* =============================================================================
 * Accounts + cloud sync (Firebase Auth + Firestore) with a sign-in gate.
 *
 * Optional layer — the app works fully without it (local only). When signed in,
 * the whole plan (content, cards, rotation/journal, settings) is synced to the
 * user's Firestore document. Safety: an EMPTY cloud never overwrites a non-empty
 * local plan, so a fresh device can't wipe your data. Decoupled from app.js.
 * ============================================================================= */
(function () {
  "use strict";

  var box = document.getElementById("account-box");
  var gate = document.getElementById("auth-gate");
  var gateBody = document.getElementById("auth-gate-body");
  var skipBtn = document.getElementById("gate-skip");
  var cfg = window.PRAYER_FIREBASE || {};
  var hasLib = typeof window.firebase !== "undefined" && window.firebase && window.firebase.initializeApp;
  var configured = !!(cfg.apiKey && cfg.projectId);

  var KEYS = [
    "prayerPlan.content.v1", "prayerPlan.cards.v1", "prayerPlan.v3",
    "prayerPlan.theme", "prayerPlan.style", "prayerPlan.todayMode"
  ];
  function readLocal() { var b = {}; KEYS.forEach(function (k) { var v = localStorage.getItem(k); if (v != null) b[k] = v; }); return b; }
  function canon(b) { var o = {}; KEYS.forEach(function (k) { if (b && b[k] != null) o[k] = b[k]; }); return JSON.stringify(o); }
  // signature of the parts that actually need a reload to re-render (banks/people/cards).
  // Excludes the daily rotation state so a new day never triggers a pull/reload loop.
  function contentSig(b) { return JSON.stringify([(b && b["prayerPlan.content.v1"]) || "", (b && b["prayerPlan.cards.v1"]) || ""]); }
  // Which account the plan currently on this device belongs to. Used so one
  // person's plan is never copied into a different account on a shared device.
  var OWNER_KEY = "prayerPlan.owner";
  var PLAN_KEYS = ["prayerPlan.content.v1", "prayerPlan.cards.v1", "prayerPlan.v3", "prayerPlan.banks.v1"];
  function getOwner() { try { return localStorage.getItem(OWNER_KEY); } catch (e) { return null; } }
  function setOwner(uid) { try { localStorage.setItem(OWNER_KEY, uid); } catch (e) {} }
  // remove the personal plan (banks, people, cards, history) but keep display prefs
  function clearLocalPlan() { try { PLAN_KEYS.forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} }
  function writeLocal(b) { KEYS.forEach(function (k) { if (b && b[k] != null) localStorage.setItem(k, b[k]); else localStorage.removeItem(k); }); }
  // a bundle "has content" if any bank item or supplication person exists
  function bundleHasContent(b) {
    try {
      var c = JSON.parse((b && b["prayerPlan.content.v1"]) || "{}");
      if (c.banks && ((c.banks.adoration || []).length || (c.banks.confession || []).length || (c.banks.thanksgiving || []).length)) return true;
      if (c.supplication && (c.supplication.subjects || []).length) return true;
    } catch (e) {}
    return false;
  }

  function elc(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function field(labelText, inp) { var w = elc("label", "field"); w.appendChild(elc("span", "field-label", labelText)); w.appendChild(inp); return w; }
  function input(type, ph) { var i = elc("input", "field-input"); i.type = type; i.placeholder = ph; return i; }
  function button(txt, cls) { var b = elc("button", cls); b.type = "button"; b.textContent = txt; return b; }

  function showGate() { document.documentElement.classList.add("show-gate"); }
  function hideGate() { document.documentElement.classList.remove("show-gate"); }
  function setSkip() { try { localStorage.setItem("prayerPlan.gate", "off"); } catch (e) {} }
  function isSkipped() { try { return localStorage.getItem("prayerPlan.gate") === "off"; } catch (e) { return false; } }
  if (skipBtn) skipBtn.addEventListener("click", function () { setSkip(); hideGate(); });

  // Sync status shown on the More → account card ("Synced · just now").
  var lastStatus = "", lastSyncedAt = 0;
  function ago(t) {
    var m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.floor(m / 60);
    return h < 24 ? h + (h === 1 ? " hour ago" : " hours ago") : "a while ago";
  }
  function statusLine() {
    if (/^Synced/.test(lastStatus)) return lastSyncedAt ? "Synced · " + ago(lastSyncedAt) : "Synced";
    return lastStatus || "Signed in";
  }
  function setStatus(s) {
    lastStatus = s;
    if (/^Synced/.test(s)) lastSyncedAt = Date.now();
    var el = document.getElementById("sync-status"); if (el) el.textContent = statusLine();
  }
  setInterval(function () { var el = document.getElementById("sync-status"); if (el) el.textContent = statusLine(); }, 30000);

  // The account card: avatar initial, name, status, and an action on the right.
  function accountCard(initial, name, sub, action, onClick) {
    var c = elc(onClick ? "button" : "div", "acct-card");
    if (onClick) { c.type = "button"; c.addEventListener("click", onClick); }
    c.appendChild(elc("span", "acct-avatar", initial));
    var t = elc("span", "acct-text");
    t.appendChild(elc("span", "acct-name", name));
    var st = elc("span", "acct-sub", sub); t.appendChild(st);
    c.appendChild(t);
    if (action) c.appendChild(elc("span", "acct-action", action));
    return { card: c, sub: st };
  }

  if (!configured || !hasLib) {
    hideGate();
    if (box) {
      box.appendChild(accountCard("?", "Not signed in", !configured
        ? "Accounts aren't configured yet."
        : "Offline. Sign in once you're connected.", "", null).card);
    }
    return;
  }

  firebase.initializeApp(cfg);
  var auth = firebase.auth();
  var db = firebase.firestore();
  function planRef(uid) { return db.collection("plans").doc(uid); }
  // Store the whole bundle as ONE JSON string. Our keys contain dots
  // (prayerPlan.content.v1), and Firestore treats dotted map keys as nested
  // paths — which silently blanked the data. A single string field is dot-proof.
  function cloudFromSnap(snap) {
    if (!snap || !snap.exists) return null;
    var d = snap.data() || {};
    if (typeof d.blob === "string") { try { return JSON.parse(d.blob); } catch (e) { return null; } }
    if (d.data && typeof d.data === "object") return d.data; // legacy format
    return null;
  }

  var currentUser = null, lastPushed = null, timer = null, deleting = false;
  var authMode = "login"; // welcome screen defaults to Sign in (newcomers tap "Create one")

  function authMsg(err) {
    var c = (err && err.code) || "";
    if (c === "auth/invalid-email") return "That email looks invalid.";
    if (c === "auth/weak-password") return "Password must be at least 6 characters.";
    if (c === "auth/email-already-in-use") return "That email already has an account — try Log in.";
    if (c === "auth/invalid-credential" || c === "auth/wrong-password" || c === "auth/user-not-found") return "Email or password is incorrect.";
    if (c === "auth/too-many-requests") return "Too many attempts — please wait a minute and try again.";
    if (c === "auth/network-request-failed") return "Network error — check your connection.";
    return (err && err.message) || "Something went wrong.";
  }

  function renderAuthForm(container) {
    container.innerHTML = "";
    var signup = authMode === "signup";
    var form = elc("form", "welcome-fields"); form.noValidate = true;
    var em = input("email", "Email"); em.className = "field-box"; em.autocomplete = "email"; em.setAttribute("aria-label", "Email");
    var pw = input("password", signup ? "Choose a password (6+ characters)" : "Password");
    pw.className = "field-box"; pw.autocomplete = signup ? "new-password" : "current-password"; pw.setAttribute("aria-label", "Password");
    form.appendChild(em);
    form.appendChild(pw);
    var primary = elc("button", "btn-acc welcome-primary", signup ? "Create account" : "Sign in"); primary.type = "submit";
    form.appendChild(primary);
    var msg = elc("p", "welcome-msg"); msg.setAttribute("role", "status");
    form.appendChild(msg);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = em.value.trim(), pass = pw.value;
      if (!email) { msg.textContent = "Please enter your email."; em.focus(); return; }
      if (!pass) { msg.textContent = "Please enter your password."; pw.focus(); return; }
      if (signup && pass.length < 6) { msg.textContent = "Password must be at least 6 characters."; pw.focus(); return; }
      msg.textContent = signup ? "Creating your account…" : "Signing in…";
      var p = signup
        ? auth.createUserWithEmailAndPassword(email, pass)
        : auth.signInWithEmailAndPassword(email, pass);
      p.catch(function (err) { msg.textContent = authMsg(err); });
    });
    container.appendChild(form);
    var toggle = button(signup ? "I already have an account" : "Create an account", "welcome-link");
    toggle.addEventListener("click", function () {
      authMode = signup ? "login" : "signup"; renderAuthForm(container);
      var f = container.querySelector("input"); if (f) f.focus();
    });
    container.appendChild(toggle);
  }

  var acctOpen = false; // account actions expanded under the card
  function renderAccountBox(user) {
    if (!box) return;
    box.innerHTML = "";
    if (!user) {
      acctOpen = false;
      box.appendChild(accountCard("?", "Not signed in", "Sign in to sync across devices", "Sign in ›", function () {
        try { localStorage.removeItem("prayerPlan.gate"); } catch (e) {}
        showGate();
      }).card);
      return;
    }
    var name = user.displayName || user.email || "Your account";
    var ac = accountCard(name.charAt(0).toUpperCase(), name, statusLine(), "›", function () {
      acctOpen = !acctOpen; renderAccountBox(currentUser);
    });
    ac.sub.id = "sync-status";
    ac.card.setAttribute("aria-expanded", acctOpen ? "true" : "false");
    if (acctOpen) ac.card.classList.add("is-open");
    box.appendChild(ac.card);
    if (!acctOpen) return;

    var panel = elc("div", "acct-panel");
    panel.appendChild(elc("p", "acct-note", "Your plan syncs to this account across devices."));
    var bar = elc("div", "acct-btns");
    var bUp = button("Back up now", "btn-acc"); bUp.addEventListener("click", manualBackup); bar.appendChild(bUp);
    var bDown = button("Restore from cloud", "btn-outline"); bDown.addEventListener("click", manualRestore); bar.appendChild(bDown);
    panel.appendChild(bar);
    var out = button("Sign out", "btn-outline acct-signout");
    out.addEventListener("click", function () {
      // Signing out removes the plan from this device, so save it to the cloud first.
      setStatus("Saving before sign out…");
      pushNow().then(function (ok) {
        if (!ok && typeof window.confirm === "function" &&
          !window.confirm("Your latest changes couldn't be saved to the cloud. Signing out removes your plan from this device. Sign out anyway?")) return;
        auth.signOut();
      });
    });
    panel.appendChild(out);
    panel.appendChild(renderDeleteAccount(user));
    box.appendChild(panel);
  }

  // "Delete account": permanently removes this account's cloud plan and login.
  // Firebase requires a fresh sign-in to delete a login, so we ask for the password.
  function renderDeleteAccount(user) {
    var wrap = elc("div", "acct-del-wrap");
    var open = button("Delete account", "reset-link acct-delete");
    wrap.appendChild(open);
    open.addEventListener("click", function () {
      wrap.innerHTML = "";
      wrap.appendChild(elc("p", "acct-note",
        "This permanently deletes " + (user.email || "this account") + " and everything saved to it in the cloud " +
        "(banks, people, cards, and history), and removes the plan from this device. It can't be undone. " +
        "Want a copy first? Use More → Back up & restore."));
      var pw = input("password", "Your password");
      pw.setAttribute("aria-label", "Enter your password to confirm");
      pw.className = "field-box";
      wrap.appendChild(pw);
      var msg = elc("p", "acct-msg");
      var bar = elc("div", "acct-btns");
      var go = button("Permanently delete account", "btn-outline acct-danger");
      var cancel = button("Cancel", "btn-outline");
      cancel.addEventListener("click", function () { renderAccountBox(currentUser); });
      go.addEventListener("click", function () {
        if (!pw.value) { msg.textContent = "Please enter your password."; pw.focus(); return; }
        go.disabled = cancel.disabled = true;
        msg.textContent = "Deleting…";
        deleting = true; stopAuto(); // never re-upload the plan mid-delete
        var cred = firebase.auth.EmailAuthProvider.credential(user.email, pw.value);
        user.reauthenticateWithCredential(cred)
          .then(function () { return planRef(user.uid).delete(); })
          .then(function () { return user.delete(); })
          .then(function () {
            // onAuthStateChanged(null) -> onLogout clears this device and reloads
          })
          .catch(function (err) {
            deleting = false; startAuto();
            go.disabled = cancel.disabled = false;
            msg.textContent = authMsg(err);
          });
      });
      bar.appendChild(go); bar.appendChild(cancel);
      wrap.appendChild(bar);
      wrap.appendChild(msg);
      pw.focus();
    });
    return wrap;
  }

  function updateUI(user) {
    if (user) { hideGate(); renderAccountBox(user); }
    else {
      if (gateBody) renderAuthForm(gateBody);
      renderAccountBox(null);
      if (!isSkipped()) showGate(); else hideGate();
    }
  }

  function pushNow() {
    if (!currentUser || deleting) return Promise.resolve(false);
    var b = readLocal(), s = canon(b);
    return planRef(currentUser.uid).set({ blob: JSON.stringify(b), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
      .then(function () { lastPushed = s; setStatus("Synced ✓"); return true; })
      .catch(function (e) { setStatus("Sync error: " + ((e && e.message) || "unknown")); return false; });
  }
  function manualBackup() { setStatus("Backing up…"); return pushNow(); }
  function manualRestore() {
    setStatus("Restoring…");
    return planRef(currentUser.uid).get().then(function (snap) {
      var cloud = cloudFromSnap(snap);
      if (cloud && bundleHasContent(cloud)) { writeLocal(cloud); window.location.reload(); }
      else setStatus("Nothing is saved in the cloud yet — try Back up to cloud.");
    }).catch(function (e) { setStatus("Restore error: " + ((e && e.message) || "unknown")); });
  }

  function startAuto() {
    if (timer) return;
    timer = setInterval(function () {
      if (!currentUser) return;
      if (canon(readLocal()) !== lastPushed) { setStatus("Saving…"); pushNow(); }
    }, 4000);
  }
  function stopAuto() { if (timer) { clearInterval(timer); timer = null; } }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && currentUser && canon(readLocal()) !== lastPushed) pushNow();
  });

  function onLogin(user) {
    currentUser = user;
    try { localStorage.setItem("prayerPlan.authed", "1"); } catch (e) {}
    setStatus("Syncing…"); updateUI(user);
    planRef(user.uid).get().then(function (snap) {
      var cloud = cloudFromSnap(snap);
      var localB = readLocal();
      var localHas = bundleHasContent(localB);
      var cloudHas = cloud && bundleHasContent(cloud);
      var owner = getOwner();
      // The plan on this device belongs to a DIFFERENT account: never push it.
      // Replace it with this account's cloud plan (or a blank plan) instead.
      if (owner && owner !== user.uid) {
        if (cloudHas) writeLocal(cloud); else clearLocalPlan();
        setOwner(user.uid); window.location.reload(); return;
      }
      // A plan made on this device without an account (or before accounts tracked
      // ownership) and this account has nothing yet: ask before copying it in.
      if (!owner && localHas && !cloudHas) {
        var adopt = typeof window.confirm !== "function" || window.confirm(
          "This device already has a prayer plan on it. Copy it into " + (user.email || "this account") +
          "?\n\nChoose Cancel to start this account with a blank plan.");
        setOwner(user.uid);
        if (!adopt) { clearLocalPlan(); window.location.reload(); return; }
      }
      setOwner(user.uid);
      // Only reload for a real content/cards change from another device — never for
      // the routine daily rotation (that caused a reload loop on a new day).
      if (cloudHas && contentSig(cloud) !== contentSig(localB)) {
        var pulled = false; try { pulled = sessionStorage.getItem("pp_pulled") === "1"; } catch (e) {}
        if (!pulled) {
          try { sessionStorage.setItem("pp_pulled", "1"); } catch (e) {}
          writeLocal(cloud); window.location.reload(); return;
        }
      }
      if (!cloudHas && localHas) { setStatus("Saving…"); pushNow().then(startAuto); return; } // protect local from empty cloud
      lastPushed = canon(localB); setStatus("Synced ✓");
      if (!snap.exists || canon(cloud) !== canon(localB)) pushNow(); // reconcile day/journal without reloading
      startAuto();
    }).catch(function (e) { setStatus("Sync error: " + ((e && e.message) || "unknown")); startAuto(); });
  }
  function onLogout() {
    currentUser = null; stopAuto(); setStatus("");
    try {
      localStorage.removeItem("prayerPlan.authed"); localStorage.removeItem("prayerPlan.gate");
      localStorage.removeItem(OWNER_KEY); sessionStorage.removeItem("pp_pulled");
    } catch (e) {}
    // Remove the signed-out account's plan from this device so the next person
    // (or the next account) doesn't see it or inherit it. It's safe in the cloud.
    clearLocalPlan();
    window.location.reload();
  }

  // Until Firebase reports back, a returning user sees "Signing in…" rather than
  // a signed-out card (and no gate flash).
  var wasAuthed = false; try { wasAuthed = localStorage.getItem("prayerPlan.authed") === "1"; } catch (e) {}
  if (wasAuthed && box) { box.innerHTML = ""; box.appendChild(accountCard("·", "Signing in…", "Checking your account", "", null).card); }
  else updateUI(null);
  auth.onAuthStateChanged(function (user) {
    if (user) { if (!currentUser) onLogin(user); else updateUI(user); }
    else { if (currentUser) onLogout(); else updateUI(null); }
  });
})();
