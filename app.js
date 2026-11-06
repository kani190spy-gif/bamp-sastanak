// BAMP Sastanak: group availability for BAMP, BAPA and friends.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBP2hNt44apjO5GB4XiZ-BgGVFvjtzFCOQ",
  authDomain: "bamp-sastanak.firebaseapp.com",
  projectId: "bamp-sastanak",
  storageBucket: "bamp-sastanak.firebasestorage.app",
  messagingSenderId: "864099506997",
  appId: "1:864099506997:web:d0574dc19195cabfb9ca7c"
};
const OWNER_EMAIL = "kani190spy@gmail.com";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

// ---------- helpers ----------
const $ = s => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const SLOT = 30;
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DOWL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const parseD = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmtD = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nice = s => { const d = parseD(s); return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`; };
const niceL = s => { const d = parseD(s); return `${DOWL[d.getDay()]}, ${MONL[d.getMonth()]} ${d.getDate()}`; };
const tl = min => { let h = Math.floor(min / 60); const m = min % 60, ap = h >= 12 && h < 24 ? "pm" : "am"; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, "0")} ${ap}` : `${h} ${ap}`; };
const slotsOf = ev => { const o = []; for (let t = ev.dayStart * 60; t < ev.dayEnd * 60; t += SLOT) o.push(t); return o; };
const today = () => fmtD(new Date());
// Meetings are open-ended: any day from today on (older meetings may still carry a start/end)
const dayOk = (ev, key) => key >= today() && (!ev.start || key >= ev.start) && (!ev.end || key <= ev.end);
const hours = n => { const h = n * SLOT / 60; return `${h} ${h === 1 ? "hour" : "hours"}`; };
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200); }
const ROLES = [["new", "New to BAMP"], ["board", "BAMP board"], ["other", "Other"]];
const roleText = r => r?.role === "other" ? (r.roleOther?.trim() ? `Other: ${r.roleOther.trim()}` : "Other") : (ROLES.find(x => x[0] === r?.role)?.[1] || "No group picked");
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

// ---------- shared state ----------
const S = {
  user: null, isAdmin: false, isOwner: false, adminChecked: false,
  events: {}, eventsLoaded: false, settings: {}, responses: {}, admins: [], weekOpen: {}, inclWeekly: true,
  mine: null, evId: null, dirty: false, saving: false, savedOnce: false,
  aTab: "results", aEv: null, roleFilter: "", cell: null, monthOff: 0, showPast: false, pEv: null, newAud: "all",
};
function generalEvent() { return { title: "Upcoming BAMP meetings", dayStart: 8, dayEnd: 21, tz: "Eastern Time", note: "" }; }
const evById = id => id === "general" ? generalEvent() : id === "weekly" ? WEEK_EV : S.events[id];
const byNewest = () => Object.entries(S.events).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
// Before open/closed existed, only one meeting was shown. Meetings without an "open" setting keep that behavior.
function legacyShownId() {
  if (S.settings.current && S.events[S.settings.current]) return S.settings.current;
  return byNewest()[0]?.[0] || null;
}
// "Usual week": weekday keys "0" (Sun) … "6" (Sat), times in minutes, 8 am – 9 pm
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEK_EV = { title: "Everyone’s weekly availability", dayStart: 8, dayEnd: 21, tz: "Eastern Time" };
const BLOCKS = [["Morning", 8, 12], ["Afternoon", 12, 17], ["Evening", 17, 21]];
const weeklyOf = r => r?.avail?.weekly || {};
const hasWeekly = r => Object.values(weeklyOf(r)).some(a => a?.length);
const isOpen = (id, ev) => typeof ev.open === "boolean" ? ev.open : id === legacyShownId();
const isBoardOnly = ev => ev.audience === "board";
const myEmail = () => (S.user?.email || "").toLowerCase();
// Who may change a meeting: the owner, the admin who created it, and admins they added as co-managers
const canManage = ev => !!ev && (S.isOwner || (S.isAdmin && ((ev.createdBy || "").toLowerCase() === myEmail() || (ev.managers || []).includes(myEmail()))));
const isSet = ev => !!ev?.confirmed?.date;
const setText = ev => `${niceL(ev.confirmed.date)}, ${tl(ev.confirmed.start)}–${tl(ev.confirmed.end)} ${ev.tz || "Eastern Time"}`;
const patchEv = async (id, data, msg) => { try { await setDoc(doc(db, "events", id), data, { merge: true }); toast(msg); return true; } catch (e) { console.error(e); toast("Couldn’t save that change. Only the meeting’s managers can change it."); return false; } };
// Meetings this participant can sign up for, newest first
function visibleMeetings(role) {
  if (!Object.keys(S.events).length) return [["general", generalEvent()]];
  return byNewest().filter(([id, ev]) => isOpen(id, ev) && (!isBoardOnly(ev) || role === "board"));
}
const route = () => location.hash === "#admin" ? "admin" : "home";

// ---------- data subscriptions ----------
let unsubs = [];
function subscribePublic() {
  unsubs.push(onSnapshot(collection(db, "events"), q => { S.events = {}; q.forEach(d => (S.events[d.id] = d.data())); S.eventsLoaded = true; render(); }, e => fail("meetings", e)));
  unsubs.push(onSnapshot(doc(db, "settings", "main"), s => { S.settings = s.exists() ? s.data() : {}; render(); }, e => fail("settings", e)));
}
let adminUnsubs = [];
function subscribeAdmin() {
  adminUnsubs.forEach(u => u()); adminUnsubs = [];
  adminUnsubs.push(onSnapshot(collection(db, "responses"), q => { S.responses = {}; q.forEach(d => (S.responses[d.id] = d.data())); render(); }, e => fail("responses", e)));
  adminUnsubs.push(onSnapshot(collection(db, "admins"), q => { S.admins = q.docs.map(d => d.id); render(); }, e => fail("admins", e)));
}
function fail(what, e) { console.error(what, e); toast(`Couldn’t load ${what}. Check your connection and refresh.`); }

async function checkAdmin(user) {
  S.isOwner = !!user?.email && user.email.toLowerCase() === OWNER_EMAIL;
  S.isAdmin = S.isOwner;
  if (!S.isAdmin && user?.email) {
    try { S.isAdmin = (await getDoc(doc(db, "admins", user.email.toLowerCase()))).exists(); } catch { S.isAdmin = false; }
  }
  S.adminChecked = true;
}

async function loadMine() {
  const uid = S.user?.uid; if (!uid) return;
  try {
    const s = await getDoc(doc(db, "responses", uid));
    const d = s.exists() ? s.data() : {};
    S.mine = { name: d.name || store.get("sastanak-name") || "", role: d.role || "", roleOther: d.roleOther || "", note: d.note || "", avail: d.avail || {}, work: null, picks: null };
    S.savedOnce = s.exists();
  } catch (e) {
    S.mine = { name: "", role: "", roleOther: "", note: "", avail: {} };
  }
  render();
}

onAuthStateChanged(auth, async user => {
  S.user = user; S.adminChecked = false; S.isAdmin = false; S.isOwner = false;
  if (!user) {
    if (route() === "home") { try { await signInAnonymously(auth); } catch (e) { console.error(e); $("#app").replaceChildren(el("div", { class: "card" }, el("h2", {}, "We couldn’t start the page"), el("p", { class: "hint" }, "Please refresh. If it keeps happening, let the organizer know."), el("p", { class: "hint", style: "font-size:14px" }, `Error code: ${e?.code || e?.message || "unknown"}`))); } }
    else render();
    return;
  }
  await checkAdmin(user);
  if (S.isAdmin) subscribeAdmin();
  await loadMine();
});
subscribePublic();
window.addEventListener("hashchange", () => {
  if (route() === "home" && !S.user) signInAnonymously(auth).catch(() => {});
  window.scrollTo(0, 0); render();
});
window.addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

// ---------- render ----------
function render() {
  renderHead();
  const app = $("#app");
  const keep = document.activeElement?.id, sel = keep && document.activeElement.selectionStart != null ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  if (route() === "admin") renderAdmin(app); else renderHome(app);
  if (keep) { const n = document.getElementById(keep); if (n && n !== document.activeElement) { n.focus({ preventScroll: true }); if (sel && n.setSelectionRange) try { n.setSelectionRange(...sel); } catch {} } }
}
function renderHead() {
  const h = $("#headActions"); h.replaceChildren();
  $("#footAdmin").hidden = route() === "admin";
  if (route() === "admin") {
    h.append(el("a", { class: "btn gold sm", href: "#" }, "See participant view"));
    if (S.user && !S.user.isAnonymous) h.append(el("span", { class: "who" }, S.user.email), el("button", { class: "btn ghost sm", onclick: () => signOut(auth) }, "Sign out"));
  } else if (S.isAdmin) {
    h.append(el("a", { class: "btn gold sm", href: "#admin" }, "Back to admin view"));
  }
}

// ===== Participant page =====
function renderHome(app) {
  app.replaceChildren();
  if (!S.mine) { app.append(el("p", { class: "loading" }, "Loading…")); return; }
  const mine = S.mine;
  const change = () => { S.dirty = true; render(); };
  const meetings = visibleMeetings(mine.role);
  const responded = mid => Object.values(mine.avail[mid] || {}).some(a => a.length);

  app.append(el("p", { class: "welcome" }, "Welcome to ", el("b", {}, "BAMP Sastanak"), ", please pick the days you can meet, set hours of availability and we will try to match the best dates."));

  const confirmed = byNewest().filter(([, m]) => isSet(m) && m.confirmed.date >= today() && (!isBoardOnly(m) || mine.role === "board"))
    .sort((a, b) => (a[1].confirmed.date + String(a[1].confirmed.start).padStart(4, "0")).localeCompare(b[1].confirmed.date + String(b[1].confirmed.start).padStart(4, "0")));
  if (confirmed.length) app.append(el("section", { class: "card setcard" },
    el("h2", { style: "font-size:22px" }, confirmed.length === 1 ? "Confirmed meeting" : "Confirmed meetings"),
    el("div", { class: "setlist" }, confirmed.map(([, m]) => el("div", { class: "setitem" },
      el("span", { class: "mtitle" }, m.title, isBoardOnly(m) ? el("span", { class: "pill blue" }, "Board") : null),
      el("span", { class: "when" }, setText(m)),
      m.confirmed.details ? el("span", { class: "hint", style: "overflow-wrap:anywhere" }, m.confirmed.details) : null)))));

  if (S.justSaved) {
    app.append(el("div", { class: "thanks", role: "status" },
      el("h2", {}, `Thank you${mine.name ? ", " + mine.name.split(" ")[0] : ""}!`),
      el("p", { style: "margin:0" }, "Your availability is saved. If anything changes, come back to this same page on this device and update it."),
      el("div", {}, el("button", { class: "btn ghost sm", onclick: () => { S.justSaved = false; render(); } }, "Make changes"))));
  }

  // Step 1: name
  const nameIn = el("input", { type: "text", id: "fName", autocomplete: "name", maxlength: "80", placeholder: "First and last name", value: mine.name });
  nameIn.addEventListener("input", () => { mine.name = nameIn.value; S.dirty = true; renderSaveBar(); });
  app.append(el("section", { class: "card" }, stepH(1, "Your name"), nameIn));

  // Step 2: group
  const otherIn = el("input", { type: "text", id: "fOther", maxlength: "80", placeholder: "For example: BAPA member, family, friend of BAMP", value: mine.roleOther });
  otherIn.addEventListener("input", () => { mine.roleOther = otherIn.value; S.dirty = true; renderSaveBar(); });
  app.append(el("section", { class: "card" }, stepH(2, "Which describes you?"),
    el("div", { class: "choices", role: "radiogroup", "aria-label": "Which describes you?" },
      ROLES.map(([v, l]) => el("button", { type: "button", class: "choice", role: "radio", "aria-checked": String(mine.role === v), onclick: () => { mine.role = v; change(); } }, l))),
    mine.role === "other" ? el("div", { class: "field" }, el("label", { class: "lbl", for: "fOther" }, "Tell us a little more (optional)"), otherIn) : null));

  // Lazily set up the shared working calendar once meetings have loaded
  if (!mine.work && S.eventsLoaded) {
    const vis = meetings.map(([mid]) => mid);
    mine.picks = new Set(vis.filter(responded));
    if (vis.length === 1) mine.picks.add(vis[0]);
    mine.work = {};
    for (const mid of mine.picks) for (const [d, arr] of Object.entries(mine.avail[mid] || {})) mine.work[d] = [...new Set([...(mine.work[d] || []), ...arr])].sort((a, b) => a - b);
  }
  if (!mine.work) { app.append(el("p", { class: "loading" }, "Loading meetings…")); renderSaveBar(); return; }

  // Consistent weekly availability (shown after the meeting steps)
  let stepNo = 3;
  const weekly = (mine.avail.weekly ||= {});
  const wSlots = slotsOf(WEEK_EV);
  const wk = el("section", { class: "card" },
    el("p", { class: "hint" }, "If you have a consistent time that you’re available each week, mark it here. It helps us plan future meetings, even ones that aren’t posted yet. Tap a part of the day to mark it."));
  const wlist = el("div", { class: "weeklist" });
  for (const w of WEEK_ORDER) {
    const set = new Set(weekly[w] || []);
    const commit = () => { weekly[w] = [...set].sort((a, b) => a - b); change(); };
    const blockState = (a, b) => { const r = wSlots.filter(t => t >= a * 60 && t < b * 60); const n = r.filter(t => set.has(t)).length; return n === 0 ? "false" : n === r.length ? "true" : "mixed"; };
    wlist.append(el("div", { class: "weekrow" },
      el("span", { class: "wday" }, DOWL[w]),
      el("div", { class: "quick" },
        BLOCKS.map(([l, a, b]) => { const st = blockState(a, b); return el("button", { type: "button", class: "block", "aria-pressed": st,
          onclick: () => { const r = wSlots.filter(t => t >= a * 60 && t < b * 60); r.forEach(t => st === "true" ? set.delete(t) : set.add(t)); commit(); } }, l, st === "mixed" ? " (some)" : ""); }),
        el("button", { type: "button", class: "btn ghost sm", "aria-expanded": String(!!S.weekOpen[w]), onclick: () => { S.weekOpen[w] = !S.weekOpen[w]; render(); } }, S.weekOpen[w] ? "Hide exact times" : "Exact times")),
      S.weekOpen[w] ? el("div", { class: "slots" }, wSlots.map(t => el("button", { type: "button", class: "slot", "aria-pressed": String(set.has(t)), onclick: () => { set.has(t) ? set.delete(t) : set.add(t); commit(); } }, tl(t)))) : null));
  }
  wk.append(wlist);

  // Step 4: which meetings
  const list4 = el("section", { class: "card" }, stepH(stepNo++, meetings.length > 1 ? "Which meetings could you come to?" : "The meeting"));
  if (!meetings.length) {
    list4.append(el("p", { class: "hint" }, "No meetings are open for sign-up right now. You can still fill in your consistent weekly availability below and save."));
    app.append(list4);
  } else {
    if (meetings.length > 1) list4.append(el("p", { class: "hint" }, "Tick every meeting you could attend. The days and times you pick below count for all the ones you tick."));
    list4.append(el("div", { class: "mlist" }, meetings.map(([mid, m]) => {
      const on = mine.picks.has(mid);
      return el("button", { type: "button", class: "mcard", role: "checkbox", "aria-checked": String(on), "aria-pressed": String(on),
        onclick: () => { on ? mine.picks.delete(mid) : mine.picks.add(mid); change(); } },
        el("span", { class: "mtitle" }, el("span", { class: "tick", "aria-hidden": "true" }, on ? "✓" : ""), m.title, isBoardOnly(m) ? el("span", { class: "pill" }, "Board only") : null),
        el("span", { class: "hint" }, `${tl(m.dayStart * 60)}–${tl(m.dayEnd * 60)}, ${m.tz || "Eastern Time"}${m.note ? " · " + m.note : ""}`));
    })));
    app.append(list4);

    const chosen = meetings.filter(([mid]) => mine.picks.has(mid)).map(([, m]) => m);
    if (!chosen.length) {
      app.append(el("section", { class: "card" }, stepH(stepNo++, "Pick your days and times"), el("p", { class: "hint" }, "Tick at least one meeting above to pick specific days.")));
    } else {
      const win = { dayStart: Math.min(...chosen.map(m => m.dayStart)), dayEnd: Math.max(...chosen.map(m => m.dayEnd)) };
      const slots = slotsOf(win);
      const days = mine.work;
      const picked = Object.keys(days).filter(d => d >= today()).sort();

      // Step 5: days
      const months = el("div", { class: "months" });
      const now = new Date();
      for (let k = 0; k < 2; k++) {
        const m = new Date(now.getFullYear(), now.getMonth() + S.monthOff + k, 1);
        const g = el("div", { class: "g7" }, DOW.map(d => el("div", { class: "dow", "aria-hidden": "true" }, d.slice(0, 2))));
        for (let i = 0; i < m.getDay(); i++) g.append(el("div"));
        const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
        for (let d = 1; d <= last; d++) {
          const key = fmtD(new Date(m.getFullYear(), m.getMonth(), d)), ok = key >= today(), on = ok && key in days;
          g.append(el("button", { type: "button", class: `day ${ok ? "in" : "out"} ${on ? "sel" : ""}`, disabled: !ok, "aria-pressed": ok ? String(on) : null, "aria-label": ok ? niceL(key) : null,
            onclick: () => {
              if (key in days) delete days[key];
              else days[key] = (weekly[parseD(key).getDay()] || []).filter(t => slots.includes(t)); // start from their usual week
              change();
            } }, String(d)));
        }
        months.append(el("div", { class: "month" }, el("h3", {}, `${MONL[m.getMonth()]} ${m.getFullYear()}`), g));
      }
      app.append(el("section", { class: "card" }, stepH(stepNo++, "Pick the days you could meet"),
        el("p", { class: "hint" }, "Tap each day that might work. Tap it again to remove it. Use the arrows to see later months."),
        el("div", { class: "row", style: "justify-content:space-between" },
          el("button", { type: "button", class: "btn ghost sm", disabled: S.monthOff <= 0, onclick: () => { S.monthOff--; render(); } }, "← Earlier months"),
          el("button", { type: "button", class: "btn ghost sm", onclick: () => { S.monthOff++; render(); } }, "Later months →")),
        months,
        picked.length ? el("p", { class: "sumline", style: "margin:0" }, `${picked.length} ${picked.length === 1 ? "day" : "days"} picked`) : null));

      // Step 6: hours per day
      const quick = [...BLOCKS, ["All day", 0, 24]];
      const step6 = el("section", { class: "card" }, stepH(stepNo++, "Set your hours for each day"));
      if (!picked.length) step6.append(el("p", { class: "hint" }, "Pick at least one day above, and it will show up here."));
      else {
        step6.append(el("p", { class: "hint" }, hasWeekly(mine) ? "We started each day with your weekly availability. Tap times to change them. Blue means free." : "Tap the times you’re free. Blue means free. Each day can have different hours."));
        const list = el("div", { class: "daylist" });
        picked.forEach((d, i) => {
          const set = new Set(days[d]);
          const toggleRange = (a, b) => { const r = slots.filter(t => t >= a * 60 && t < b * 60); const all = r.length && r.every(t => set.has(t)); r.forEach(t => all ? set.delete(t) : set.add(t)); days[d] = [...set].sort((x, y) => x - y); change(); };
          list.append(el("div", { class: "dayblock" },
            el("div", { class: "dayblock-h" }, el("h3", {}, niceL(d)), el("span", { class: "hint" }, set.size ? `Free ${hours(set.size)}` : "No times yet")),
            el("div", { class: "quick" },
              quick.map(([l, a, b]) => el("button", { type: "button", class: "btn ghost sm", onclick: () => toggleRange(a, b) }, l)),
              set.size ? el("button", { type: "button", class: "btn ghost sm", onclick: () => { days[d] = []; change(); } }, "Clear") : null,
              i > 0 ? el("button", { type: "button", class: "btn ghost sm", onclick: () => { days[d] = [...days[picked[i - 1]]]; change(); } }, "Same as day above") : null),
            el("div", { class: "slots" }, slots.map(t => el("button", { type: "button", class: "slot", "aria-pressed": String(set.has(t)),
              onclick: () => { set.has(t) ? set.delete(t) : set.add(t); days[d] = [...set].sort((x, y) => x - y); change(); } }, tl(t))))));
        });
        step6.append(list);
      }
      app.append(step6);
    }
  }

  wk.prepend(stepH(stepNo++, "Consistent weekly availability (optional)"));
  app.append(wk);

  // Note
  const noteIn = el("textarea", { id: "fNote", maxlength: "1000", rows: "3", placeholder: "Anything you’d like us to know: topics, questions, how you prefer to meet…" });
  noteIn.value = mine.note;
  noteIn.addEventListener("input", () => { mine.note = noteIn.value; S.dirty = true; renderSaveBar(); });
  app.append(el("section", { class: "card" }, el("div", { class: "step-h" }, el("h2", {}, "Anything else? (optional)")), noteIn));

  renderSaveBar();
}
function stepH(n, t) { return el("div", { class: "step-h" }, el("span", { class: "num", "aria-hidden": "true" }, n), el("h2", {}, t)); }

function renderSaveBar() {
  let bar = $("#savebar");
  if (route() !== "home") { bar?.remove(); return; }
  if (!bar) { bar = el("div", { class: "savebar", id: "savebar" }); document.body.append(bar); }
  const m = S.mine; if (!m) return;
  const missing = !m.name.trim() ? "Add your name (step 1)" : !m.role ? "Pick which describes you (step 2)" : null;
  const status = S.saving ? "Saving…" : missing ? missing : S.dirty ? "You have changes that aren’t saved yet" : S.savedOnce ? "✓ Saved" : "";
  bar.replaceChildren(el("div", { class: "wrap" },
    el("span", { class: `status ${!S.dirty && S.savedOnce && !missing ? "ok" : ""}` }, status),
    el("button", { class: "btn gold", disabled: S.saving || !!missing || (!S.dirty && S.savedOnce), onclick: save }, "Save my availability")));
}

async function save() {
  const m = S.mine, uid = S.user?.uid; if (!uid) return;
  S.saving = true; renderSaveBar();
  // Meetings this person can see on the page: ticked ones get the shared calendar, unticked ones are cleared.
  // Meetings they can't see (closed, board-only) keep whatever they had.
  if (m.work) for (const [mid, ev] of visibleMeetings(m.role)) {
    if (!m.picks.has(mid)) { delete m.avail[mid]; continue; }
    const win = slotsOf(ev), o = {};
    for (const [d, arr] of Object.entries(m.work)) { if (!dayOk(ev, d)) continue; const a = arr.filter(t => win.includes(t)); if (a.length) o[d] = a; }
    m.avail[mid] = o;
  }
  const avail = {};
  for (const [key, days] of Object.entries(m.avail)) { const o = {}; for (const [d, arr] of Object.entries(days || {})) if (arr?.length) o[d] = arr; if (Object.keys(o).length) avail[key] = o; }
  try {
    await setDoc(doc(db, "responses", uid), { name: m.name.trim(), role: m.role, roleOther: m.roleOther.trim(), note: m.note.trim(), avail, updatedAt: serverTimestamp() });
    store.set("sastanak-name", m.name.trim());
    S.dirty = false; S.savedOnce = true; S.justSaved = true;
    toast("Saved. Thank you!"); window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    console.error(e); toast("Your availability wasn’t saved. Check your internet connection and press Save again.");
  }
  S.saving = false; render();
}

// ===== Admin =====
function renderAdmin(app) {
  app.replaceChildren();
  if (!S.user || S.user.isAnonymous) {
    app.append(el("section", { class: "card", style: "max-width:560px" },
      el("h2", {}, "Organizer sign in"),
      el("p", { class: "hint" }, "Admins sign in with Google to create meetings and see everyone’s availability."),
      el("div", {}, el("button", { class: "btn", onclick: googleIn }, "Sign in with Google"))));
    return;
  }
  if (!S.adminChecked) { app.append(el("p", { class: "loading" }, "Checking access…")); return; }
  if (!S.isAdmin) {
    app.append(el("section", { class: "card", style: "max-width:560px" },
      el("h2", {}, "You’re not an admin yet"),
      el("p", { class: "hint" }, `You’re signed in as ${S.user.email}. Ask the page owner to add this email as an admin, then refresh this page.`),
      el("div", { class: "row" }, el("button", { class: "btn ghost", onclick: () => signOut(auth) }, "Use a different account"), el("a", { class: "btn", href: "#" }, "Go to the sign-up page"))));
    return;
  }
  const tabs = [["results", "Results"], ["meetings", "Meetings"], ...(S.isOwner ? [["admins", "Admins"]] : [])];
  app.append(el("div", { class: "tabs", role: "tablist" }, tabs.map(([k, l]) => el("button", { class: "tab", role: "tab", "aria-selected": String(S.aTab === k), onclick: () => { S.aTab = k; S.cell = null; render(); } }, l))));
  if (S.aTab === "results") adminResults(app);
  else if (S.aTab === "meetings") adminMeetings(app);
  else adminAdmins(app);
}
async function googleIn() {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { if (e?.code !== "auth/popup-closed-by-user") toast("Sign-in didn’t work: " + (e?.code || e?.message || "unknown error")); }
}

function meetingPicker() {
  const ids = ["weekly", ...byNewest().map(([id]) => id), "general"];
  // Until an admin picks something, follow the newest meeting (meetings may still be loading)
  if (!S.aEvPicked || !evById(S.aEv)) S.aEv = byNewest()[0]?.[0] || "weekly";
  const tag = id => { if (id === "general") return " (general calendar)"; if (id === "weekly") return ""; const ev = S.events[id]; return [isOpen(id, ev) ? "" : " (closed)", isBoardOnly(ev) ? " (board only)" : ""].join(""); };
  const sel = el("select", { id: "aEv", onchange: e => { S.aEv = e.target.value; S.aEvPicked = true; S.cell = null; render(); } },
    ids.map(id => el("option", { value: id, selected: id === S.aEv }, `${evById(id).title}${tag(id)}`)));
  return el("div", { class: "field" }, el("label", { class: "lbl", for: "aEv" }, "Show results for"), sel);
}

function adminResults(app) {
  const card = el("section", { class: "card" }, meetingPicker());
  const evId = S.aEv, ev = evById(evId);
  card.append(el("div", { class: "row" }, el("span", { class: "lbl" }, "Show:"),
    [["", "Everyone"], ...ROLES].map(([v, l]) => el("button", { class: "choice", role: "radio", style: "padding:6px 14px;font-size:16px", "aria-checked": String(S.roleFilter === v), onclick: () => { S.roleFilter = v; S.cell = null; render(); } }, l))));
  app.append(card);

  const isWeek = evId === "weekly";
  const roleOk = r => !S.roleFilter || r.role === S.roleFilter;
  const datePeople = isWeek ? [] : Object.entries(S.responses).filter(([, r]) => r.avail?.[evId] && Object.values(r.avail[evId]).some(a => a.length) && roleOk(r));
  const dateIds = new Set(datePeople.map(([id]) => id));
  // People who only gave a usual week. Board-only meetings only count board members.
  const weekPeople = (isWeek || S.inclWeekly) ? Object.entries(S.responses).filter(([id, r]) => !dateIds.has(id) && hasWeekly(r) && roleOk(r) && (isWeek || !isBoardOnly(ev) || r.role === "board")) : [];
  const weekIds = new Set(weekPeople.map(([id]) => id));
  const people = [...datePeople, ...weekPeople];
  const total = people.length;
  const nameOf = id => (S.responses[id]?.name || "").trim() || "Unnamed";
  const isFree = (id, d, t) => weekIds.has(id) ? (weeklyOf(S.responses[id])[isWeek ? d.slice(1) : parseD(d).getDay()] || []).includes(t) : (S.responses[id]?.avail?.[evId]?.[d] || []).includes(t);
  if (!isWeek) {
    card.append(el("label", { class: "row", style: "gap:8px;font-size:16px" }, el("input", { type: "checkbox", id: "aWeek", checked: S.inclWeekly, onchange: e => { S.inclWeekly = e.target.checked; S.cell = null; render(); } }), "Also count people’s weekly availability (for those who didn’t pick dates)"));
    card.append(el("label", { class: "row", style: "gap:8px;font-size:16px" }, el("input", { type: "checkbox", id: "aPast", checked: S.showPast, onchange: e => { S.showPast = e.target.checked; S.cell = null; render(); } }), "Include past dates"));
  } else card.append(el("p", { class: "hint" }, "Each person’s usual weekly availability, from the “Consistent weekly availability” step. Use it to pick good days before posting a meeting."));
  if (!total) { app.append(el("div", { class: "empty" }, isWeek ? "No one has filled in their weekly availability yet." : S.roleFilter ? "No one in this group has responded to this meeting yet." : "No responses for this meeting yet. Share the sign-up link and they’ll appear here as people save.")); const sc = setMeetingCard(evId, ev, [], () => false, () => ""); if (sc) app.append(sc); return; }

  let days;
  if (isWeek) days = WEEK_ORDER.map(w => "w" + w);
  else {
    const set = new Set();
    for (const [, r] of datePeople) Object.keys(r.avail[evId]).forEach(d => set.add(d));
    if (weekPeople.length) for (let i = 0; i < 14; i++) { const x = new Date(); x.setDate(x.getDate() + i); const k = fmtD(x); if (dayOk(ev, k)) set.add(k); }
    days = [...set].filter(d => S.showPast || d >= today()).sort();
  }
  const map = {};
  for (const d of days) for (const t of slotsOf(ev)) for (const [id] of people) if (isFree(id, d, t)) ((map[d] ||= {})[t] ||= []).push(id);
  for (const d of days) map[d] ||= {};
  const colHead = d => isWeek ? [DOW[+d.slice(1)]] : (x => [DOW[x.getDay()], el("br"), `${MON[x.getMonth()]} ${x.getDate()}`])(parseD(d));
  const dayName = d => isWeek ? DOWL[+d.slice(1)] + "s" : nice(d);
  const slots = slotsOf(ev);
  const shade = n => n === 0 ? 0 : Math.max(1, Math.ceil(n / total * 4));
  const colors = ["--heat0", "--heat1", "--heat2", "--heat3", "--heat4"];

  const heat = el("div", { class: "heat", style: `grid-template-columns:auto repeat(${days.length}, ${isWeek ? 64 : 48}px)` }, el("div"));
  days.forEach(d => heat.append(el("div", { class: "hh" }, colHead(d))));
  for (const t of slots) {
    heat.append(el("div", { class: "hl" }, t % 60 === 0 ? tl(t) : ""));
    for (const d of days) {
      const n = (map[d]?.[t] || []).length, k = `${d}|${t}`;
      heat.append(el("button", { class: `hc ${S.cell === k ? "active" : ""}`, style: `background:var(${colors[shade(n)]})${isWeek ? ";width:64px" : ""}`, "aria-label": `${dayName(d)} ${tl(t)}: ${n} of ${total} free`, onclick: () => { S.cell = k; if (!isWeek) S.draft = { ev: evId, date: d, start: t, end: t + 60, details: S.draft?.details || "" }; render(); } }));
    }
  }

  const who = el("div", { class: "card" });
  if (!S.cell) who.append(el("h3", {}, "Who’s free"), el("p", { class: "hint" }, "Tap any square to see names."));
  else {
    const [d, t] = S.cell.split("|"), ids = map[d]?.[+t] || [];
    who.append(el("h3", {}, `${dayName(d)}, ${tl(+t)}–${tl(+t + SLOT)}`), el("p", { style: "margin:0;font-weight:700" }, `${ids.length} of ${total} free`),
      el("div", { class: "chips" }, people.map(([id, r]) => el("span", { class: `chip ${ids.includes(id) ? "yes" : "no"}`, title: roleText(r) }, nameOf(id), !isWeek && weekIds.has(id) ? " (weekly)" : ""))));
  }

  const runs = [];
  for (const d of days) { let i = 0; while (i < slots.length) { const n = (map[d][slots[i]] || []).length; if (!n) { i++; continue; } let j = i; while (j + 1 < slots.length && (map[d][slots[j + 1]] || []).length === n) j++; runs.push({ d, a: slots[i], b: slots[j] + SLOT, n }); i = j + 1; } }
  runs.sort((x, y) => y.n - x.n || (y.b - y.a) - (x.b - x.a));
  const best = el("div", { class: "card" }, el("h3", {}, "Best times"),
    el("div", { class: "best" }, runs.slice(0, 6).map(r => el("button", { onclick: () => { S.cell = `${r.d}|${r.a}`; if (!isWeek) S.draft = { ev: evId, date: r.d, start: r.a, end: r.b, details: S.draft?.details || "" }; render(); } }, el("span", {}, `${dayName(r.d)} · ${tl(r.a)}–${tl(r.b)}`), el("b", {}, `${r.n} of ${total}`)))));

  app.append(el("div", { class: "grid2" },
    el("div", { class: "card" }, el("div", { class: "legend" }, "Fewer", colors.map(c => el("i", { style: `background:var(${c})` })), "More people free"), el("div", { class: "heatwrap" }, heat)),
    el("div", { style: "display:grid;gap:18px;align-content:start;min-width:0" }, who, best, setMeetingCard(evId, ev, people, isFree, nameOf))));

  const noted = people.filter(([, r]) => (r.note || "").trim());
  if (noted.length) app.append(el("section", { class: "card" }, el("h3", {}, "Notes"), noted.map(([id, r]) => el("blockquote", { class: "note" }, r.note.trim(), el("cite", {}, `${nameOf(id)} · ${roleText(r)}`)))));

  app.append(el("section", { class: "card" }, el("h3", {}, isWeek ? `People who gave weekly availability (${total})` : `People counted (${total})`),
    el("div", { class: "list" }, people.sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0]))).map(([id, r]) => {
      const nd = weekIds.has(id) ? 0 : Object.values(r.avail[evId]).filter(a => a.length).length;
      return el("div", { class: "li" }, el("div", {}, nameOf(id), el("small", {}, `${roleText(r)} · ${weekIds.has(id) ? "weekly availability" : `${nd} ${nd === 1 ? "day" : "days"}`}`)), confirmBtn("Remove", "Tap again to remove", async () => { await deleteDoc(doc(db, "responses", id)); toast("Response removed"); }));
    }))));
}

function adminMeetings(app) {
  const hourOpts = def => Array.from({ length: 18 }, (_, i) => i + 6).map(h => el("option", { value: h, selected: h === def }, tl(h * 60)));
  const f = el("form", { class: "card" },
    el("h2", { style: "font-size:22px" }, "New meeting"),
    el("div", { class: "form2" },
      el("div", { class: "field full" }, el("label", { class: "lbl", for: "mTitle" }, "Meeting name"), el("input", { type: "text", id: "mTitle", required: true, maxlength: "100", placeholder: "What is it? e.g. BAPA health talk, board meeting" })),
      el("div", { class: "field full" }, el("label", { class: "lbl", for: "mTz" }, "Time zone shown"), el("input", { type: "text", id: "mTz", value: "Eastern Time", maxlength: "40" })),
      el("div", { class: "field" }, el("label", { class: "lbl", for: "mFrom" }, "Earliest time"), el("select", { id: "mFrom" }, hourOpts(9))),
      el("div", { class: "field" }, el("label", { class: "lbl", for: "mTo" }, "Latest time"), el("select", { id: "mTo" }, hourOpts(21))),
      el("div", { class: "field full" }, el("label", { class: "lbl", for: "mNote" }, "Note for participants (optional)"), el("input", { type: "text", id: "mNote", maxlength: "200", placeholder: "Zoom or in person, about 1 hour" })),
      el("div", { class: "field full" }, el("span", { class: "lbl" }, "Who can see it"), audienceToggle(S.newAud, v => { S.newAud = v; render(); }))),
    el("div", { class: "row" }, el("button", { class: "btn" }, "Create meeting"), el("span", { class: "hint" }, "New meetings open for sign-up right away.")));
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const v = id => $("#" + id).value;
    const from = +v("mFrom"), to = +v("mTo");
    if (to <= from) return toast("The latest time must be after the earliest time.");
    const id = "m" + Date.now().toString(36);
    try {
      await setDoc(doc(db, "events", id), { title: v("mTitle").trim(), tz: v("mTz").trim() || "Eastern Time", note: v("mNote").trim(), dayStart: from, dayEnd: to, open: true, audience: S.newAud, managers: [], createdAt: Date.now(), createdBy: myEmail() });
      S.aEv = id; S.aEvPicked = true; S.aTab = "results"; S.newAud = "all"; toast("Meeting created and open for sign-up"); render();
    } catch (err) { console.error(err); toast("Couldn’t create the meeting. Are you still signed in as an admin?"); }
  });
  app.append(f);

  const evs = byNewest();
  const patch = patchEv;
  app.append(el("section", { class: "card" }, el("h2", { style: "font-size:22px" }, "All meetings"),
    el("p", { class: "hint" }, "Open meetings appear on the sign-up page. Board-only meetings appear only to people who pick “BAMP board”. Closing a meeting hides it from sign-up but keeps every response."),
    evs.length ? el("div", { class: "list" }, evs.map(([id, ev]) => {
      const open = isOpen(id, ev);
      return el("div", { class: "li mrow" },
        el("div", { style: "min-width:0" }, ev.title,
          el("span", { class: `pill ${open ? "" : "off"}` }, open ? "Open" : "Closed"),
          isBoardOnly(ev) ? el("span", { class: "pill blue" }, "Board only") : null,
          isSet(ev) ? el("span", { class: "pill set" }, "Set") : null,
          el("small", {}, isSet(ev) ? `Set for ${setText(ev)}` : `${tl(ev.dayStart * 60)}–${tl(ev.dayEnd * 60)} each day${ev.createdAt ? ` · created ${new Date(ev.createdAt).toLocaleDateString()}` : ""}`),
          canManage(ev) ? managersBox(id, ev) : el("small", {}, `Managed by ${ev.createdBy || "the owner"}${(ev.managers || []).length ? " and co-managers" : ""}`)),
        el("div", { class: "row" },
          el("button", { class: "btn sm ghost", onclick: () => { S.aEv = id; S.aEvPicked = true; S.aTab = "results"; S.cell = null; window.scrollTo(0, 0); render(); } }, isSet(ev) ? "Results" : "Results & set time"),
          canManage(ev) ? [
            el("button", { class: `btn sm ${open ? "ghost" : "gold"}`, onclick: () => patch(id, { open: !open }, open ? "Closed. It’s hidden from sign-up." : "Opened for sign-up") }, open ? "Close sign-up" : "Open sign-up"),
            audienceToggle(ev.audience === "board" ? "board" : "all", v => patch(id, { audience: v }, v === "board" ? "Now visible to BAMP board only" : "Now visible to everyone")),
            confirmBtn("Delete", "Tap again to delete", async () => { await deleteDoc(doc(db, "events", id)); toast("Meeting deleted"); })] : null));
    }))
      : el("p", { class: "hint" }, "No meetings yet. Until you create one, participants see a general calendar.")));
}
function setMeetingCard(evId, ev, people, isFree, nameOf) {
  if (evId === "general" || evId === "weekly") return null;
  const card = el("div", { class: "card setcard" }, el("h3", {}, "Set the meeting"));
  if (isSet(ev) && !(S.draft?.ev === evId && S.draft.editing)) {
    card.append(el("p", { style: "margin:0;font-weight:700" }, `✓ ${setText(ev)}`),
      ev.confirmed.details ? el("p", { class: "hint" }, ev.confirmed.details) : null,
      el("p", { class: "hint" }, "Shown to participants under “Confirmed meetings”."));
    if (canManage(ev)) card.append(el("div", { class: "row" },
      el("button", { class: "btn ghost sm", onclick: () => { S.draft = { ...ev.confirmed, ev: evId, editing: true }; render(); } }, "Change"),
      confirmBtn("Cancel meeting", "Tap again to cancel", () => patchEv(evId, { confirmed: null }, "Confirmation removed"))));
    return card;
  }
  if (!canManage(ev)) { card.append(el("p", { class: "hint" }, `Only the people managing this meeting can set it. Created by ${ev.createdBy || "the owner"}.`)); return card; }
  if (S.draft?.ev !== evId) S.draft = { ev: evId, date: "", start: ev.dayStart * 60, end: Math.min(ev.dayStart * 60 + 60, 24 * 60), details: "" };
  const dr = S.draft;
  const timeOpts = (sel, min) => Array.from({ length: 37 }, (_, i) => 360 + i * 30).filter(t => t >= min).map(t => el("option", { value: t, selected: t === sel }, tl(t)));
  const dateIn = el("input", { type: "date", id: "cDate", value: dr.date, min: today(), onchange: e => { dr.date = e.target.value; render(); } });
  const startIn = el("select", { id: "cStart", onchange: e => { dr.start = +e.target.value; if (dr.end <= dr.start) dr.end = dr.start + 60; render(); } }, timeOpts(dr.start, 0));
  const endIn = el("select", { id: "cEnd", onchange: e => { dr.end = +e.target.value; render(); } }, timeOpts(dr.end, dr.start + 30));
  const detIn = el("input", { type: "text", id: "cDet", maxlength: "300", placeholder: "Where or how: address, Zoom link…", value: dr.details || "" });
  detIn.addEventListener("input", () => (dr.details = detIn.value));
  card.append(el("p", { class: "hint" }, "Tap a square or a best time to fill this in, or pick a date yourself."),
    el("div", { class: "form2" },
      el("div", { class: "field full" }, el("label", { class: "lbl", for: "cDate" }, "Date"), dateIn),
      el("div", { class: "field" }, el("label", { class: "lbl", for: "cStart" }, "Starts"), startIn),
      el("div", { class: "field" }, el("label", { class: "lbl", for: "cEnd" }, "Ends"), endIn),
      el("div", { class: "field full" }, el("label", { class: "lbl", for: "cDet" }, "Details (optional)"), detIn)));
  if (dr.date && people.length) {
    const need = []; for (let t = dr.start; t < dr.end; t += SLOT) need.push(t);
    const ok = people.filter(([id]) => need.every(t => isFree(id, dr.date, t)));
    card.append(el("p", { style: "margin:0;font-weight:700" }, `${ok.length} of ${people.length} are free for the whole time`),
      ok.length ? el("div", { class: "chips" }, ok.map(([id]) => el("span", { class: "chip yes" }, nameOf(id)))) : null);
  }
  card.append(el("div", { class: "row" },
    el("button", { class: "btn gold", disabled: !dr.date, onclick: async () => {
      const done = await patchEv(evId, { confirmed: { date: dr.date, start: dr.start, end: dr.end, details: (dr.details || "").trim(), setBy: myEmail(), setAt: Date.now() }, open: false }, "Meeting set. Participants can see it now.");
      if (done) { S.draft = null; render(); }
    } }, "Confirm this meeting"),
    dr.editing ? el("button", { class: "btn ghost sm", onclick: () => { S.draft = null; render(); } }, "Keep current time") : null),
    el("p", { class: "hint" }, "Confirming closes sign-up for this meeting. You can reopen it from the Meetings tab."));
  return card;
}

function managersBox(id, ev) {
  const mgrs = ev.managers || [];
  const creator = (ev.createdBy || "").toLowerCase();
  const pool = [...new Set([OWNER_EMAIL, ...S.admins])].filter(e => e !== creator && !mgrs.includes(e));
  const box = el("div", { class: "mgrs" }, el("span", { class: "hint" }, `Created by ${ev.createdBy || "the owner"}`));
  box.append(el("div", { class: "chips" }, el("span", { class: "hint" }, "Co-managers:"),
    mgrs.length ? mgrs.map(m => el("span", { class: "chip" }, m, el("button", { class: "x", "aria-label": `Remove ${m}`, onclick: () => patchEv(id, { managers: mgrs.filter(x => x !== m) }, "Co-manager removed") }, "×"))) : el("span", { class: "hint" }, "none")));
  if (pool.length) {
    const sel = el("select", { id: `mg-${id}`, style: "max-width:260px" }, el("option", { value: "" }, "Add an admin to help manage…"), pool.map(e => el("option", { value: e }, e)));
    sel.addEventListener("change", () => { if (sel.value) patchEv(id, { managers: [...mgrs, sel.value] }, `${sel.value} can now manage this meeting`); });
    box.append(sel);
  }
  return box;
}

function audienceToggle(val, onPick) {
  return el("div", { class: "choices", role: "radiogroup", "aria-label": "Who can see it" },
    [["all", "Everyone"], ["board", "BAMP board only"]].map(([v, l]) => el("button", { type: "button", class: "choice small", role: "radio", "aria-checked": String(val === v), onclick: () => { if (val !== v) onPick(v); } }, l)));
}

function adminAdmins(app) {
  const f = el("form", { class: "card" }, el("h2", { style: "font-size:22px" }, "Add an admin"),
    el("p", { class: "hint" }, "Enter the Google email they’ll sign in with. Admins can create meetings and see everyone’s availability. Only you can add or remove admins."),
    el("div", { class: "row" }, el("input", { type: "email", id: "aEmail", required: true, placeholder: "name@gmail.com", style: "flex:1;min-width:220px" }), el("button", { class: "btn" }, "Add admin")));
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const em = $("#aEmail").value.trim().toLowerCase(); if (!em) return;
    try { await setDoc(doc(db, "admins", em), { addedAt: Date.now() }); $("#aEmail").value = ""; toast(`${em} is now an admin`); }
    catch { toast("Couldn’t add that admin. Try again."); }
  });
  app.append(f);
  app.append(el("section", { class: "card" }, el("h2", { style: "font-size:22px" }, "Admins"),
    el("div", { class: "list" },
      el("div", { class: "li" }, el("div", {}, OWNER_EMAIL, el("small", {}, "Owner"))),
      S.admins.map(em => el("div", { class: "li" }, el("div", {}, em), confirmBtn("Remove", "Tap again to remove", async () => { await deleteDoc(doc(db, "admins", em)); toast("Admin removed"); }))))));
}

function confirmBtn(label, armedLabel, action) {
  let armed = false;
  const b = el("button", { class: "btn danger sm", type: "button" }, label);
  b.addEventListener("click", async () => {
    if (!armed) { armed = true; b.textContent = armedLabel; setTimeout(() => { armed = false; b.textContent = label; }, 4000); return; }
    try { await action(); } catch (e) { console.error(e); toast("That didn’t work. Try again."); }
  });
  return b;
}

render();
