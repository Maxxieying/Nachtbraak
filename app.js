import {
  t, setLang, getLang, detectLang, LANGS, DRINK_KEYS, DRINK_EMOJI,
  drinkLabel, fmtDateTime, fmtDuration, weekdayShort,
} from "./i18n.js";

const cfg = window.NACHTBRAAK_CONFIG || {};
const backend = await import(cfg.SUPABASE_URL ? "./backend.js" : "./backend-demo.js");
const isDemo = backend.isDemo;

// ---------------------------------------------------------------
// Staat
// ---------------------------------------------------------------
const S = {
  me: null,
  groups: [],
  gd: null,            // data van de geopende groep
  gdId: null,
  tab: "open",
  myOpen: [],          // open anytimers waar ik de ontvanger van ben
  byId: new Map(),
  unsubGroup: null,
  unsubMine: null,
  alarmId: null,       // anytimer waarvoor het alarmscherm open staat
  alarmRound: null,
  draftWindows: null,
  draftName: "",
  audio: null,
  alarmTimer: null,
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function store(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch { /* geen opslag */ }
  return null;
}

// ---------------------------------------------------------------
// Kleine hulpfuncties voor de interface
// ---------------------------------------------------------------
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2800);
}

function openModal(html, onMount) {
  const m = $("#modal");
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.classList.add("open");
  if (onMount) onMount(m.querySelector(".sheet"));
}

function closeModal() {
  const m = $("#modal");
  m.classList.remove("open");
  m.innerHTML = "";
}

function errText(e) {
  if (e && e.message === "invalid_code") return t("invalid_code");
  return t("error_generic");
}

function nameOf(id) {
  const m = S.gd?.members?.find((x) => x.id === id);
  const n = m?.name || "?";
  return id === backend.myId() ? `${n} (${t("you")})` : n;
}

function elapsedSeconds(a, nowMs) {
  if (a.status === "done") return a.duration_seconds ?? 0;
  if (!a.fired_at) return 0;
  const end = a.status === "expired" && a.expires_at ? Math.min(nowMs, Date.parse(a.expires_at)) : nowMs;
  let e = (end - Date.parse(a.fired_at)) / 1000 - (a.paused_seconds || 0);
  if (a.status === "postponed" && a.postpone_kind === "approved") {
    e -= Math.max(0, (Math.min(end, Date.parse(a.postponed_until)) - Date.parse(a.postponed_from)) / 1000);
  }
  return Math.max(0, Math.floor(e));
}

function rebuildIndex() {
  S.byId = new Map();
  for (const a of S.gd?.anytimers ?? []) S.byId.set(a.id, a);
  for (const a of S.myOpen) S.byId.set(a.id, { ...(S.byId.get(a.id) || {}), ...a });
}

// ---------------------------------------------------------------
// Routing
// ---------------------------------------------------------------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "g" && parts[1]) return { name: "group", id: parts[1] };
  if (parts[0] === "settings") return { name: "settings" };
  return { name: "home" };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener("hashchange", () => onRouteChange());

async function onRouteChange() {
  const r = parseRoute();
  if (r.name !== "group") {
    if (S.unsubGroup) { S.unsubGroup(); S.unsubGroup = null; }
    S.gd = null;
    S.gdId = null;
  }
  if (r.name === "settings") {
    S.draftWindows = S.me.alarm_windows ? JSON.parse(JSON.stringify(S.me.alarm_windows)) : null;
    S.draftName = S.me.name;
  }
  if (r.name === "group" && S.gdId !== r.id) {
    S.gdId = r.id;
    S.gd = null;
    S.tab = "open";
    if (S.unsubGroup) S.unsubGroup();
    S.unsubGroup = backend.subscribe(r.id, () => refreshGroup());
    render();
    await refreshGroup();
    return;
  }
  if (r.name === "home") await refreshGroups();
  render();
}

// ---------------------------------------------------------------
// Data verversen
// ---------------------------------------------------------------
async function refreshGroups() {
  try { S.groups = await backend.listGroups(); } catch { /* blijft oud */ }
}

async function refreshMine() {
  try {
    S.myOpen = await backend.myOpenAnytimers();
    rebuildIndex();
    updateAlarm();
  } catch { /* negeren */ }
}

async function refreshGroup() {
  const r = parseRoute();
  if (r.name !== "group") return;
  try {
    const data = await backend.getGroupData(r.id);
    if (parseRoute().id !== r.id) return;
    if (!data.group) { go("#/"); return; }
    S.gd = data;
    rebuildIndex();
    render();
  } catch { /* negeren */ }
}

async function refreshAll() {
  await refreshMine();
  if (parseRoute().name === "group") await refreshGroup();
}

// ---------------------------------------------------------------
// Weergave
// ---------------------------------------------------------------
function render() {
  if (!S.me) return;
  const r = parseRoute();
  const app = $("#app");
  const demoBar = isDemo
    ? `<div class="demo">${esc(t("demo_banner"))} <button class="link" data-act="demo-send">Demo: Sam → ${esc(t("you"))}</button></div>`
    : "";
  let body = "";
  if (r.name === "home") body = viewHome();
  else if (r.name === "group") body = viewGroup();
  else body = viewSettings();
  app.innerHTML = demoBar + body;
  tickStopwatches();
}

function header(title, { back, right } = {}) {
  return `<header class="bar">
    ${back ? `<button class="icon" data-act="nav" data-to="${back}" aria-label="${esc(t("back"))}">‹</button>` : `<span class="logo">🌙</span>`}
    <h1>${esc(title)}</h1>
    <span class="grow"></span>
    ${right ?? ""}
  </header>`;
}

function viewHome() {
  const gear = `<button class="icon" data-act="nav" data-to="#/settings" aria-label="${esc(t("nav_settings"))}">⚙</button>`;
  const list = S.groups.length
    ? S.groups.map((g) => `
        <button class="card group-card" data-act="nav" data-to="#/g/${esc(g.id)}">
          <strong>${esc(g.name)}</strong>
          <span class="muted">${esc(t("members_n", { n: g.member_count }))}</span>
        </button>`).join("")
    : `<p class="empty">${esc(t("home_empty"))}</p>`;
  return `${header("Nachtbraak", { right: gear })}
    <main>
      <p class="muted tagline">${esc(t("app_tagline"))}</p>
      ${list}
      <div class="row gap">
        <button class="btn" data-act="new-group">${esc(t("new_group"))}</button>
        <button class="btn ghost" data-act="join-group">${esc(t("join_group"))}</button>
      </div>
    </main>`;
}

function viewSettings() {
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const w = S.draftWindows;
  const windows = w
    ? w.map((win, i) => `
      <div class="win card">
        <div class="days">${dayOrder.map((d) => `<button type="button" class="chip ${win.days.includes(d) ? "on" : ""}" data-act="win-day" data-i="${i}" data-d="${d}">${esc(weekdayShort(d))}</button>`).join("")}</div>
        <div class="row gap">
          <label class="grow">${esc(t("from"))}<input type="time" value="${esc(win.from)}" data-act="win-from" data-i="${i}"></label>
          <label class="grow">${esc(t("to"))}<input type="time" value="${esc(win.to)}" data-act="win-to" data-i="${i}"></label>
        </div>
        <button class="link" data-act="win-remove" data-i="${i}">${esc(t("remove"))}</button>
      </div>`).join("") + `<button class="btn ghost" data-act="win-add">${esc(t("add_window"))}</button>`
    : "";
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  let notif = "";
  if (perm === "granted") notif = `<p class="ok">${esc(t("notif_on"))}</p>`;
  else if (perm === "denied") notif = `<p class="warn">${esc(t("notif_denied"))}</p>`;
  else if (perm === "unsupported") notif = `<p class="warn">${esc(t("notif_unsupported"))}</p>`;
  else notif = `<button class="btn" data-act="enable-push">${esc(t("notif_enable"))}</button>`;
  return `${header(t("settings_title"), { back: "#/" })}
    <main>
      <label class="field">${esc(t("name"))}
        <input id="set-name" type="text" maxlength="30" value="${esc(S.draftName)}">
      </label>
      <label class="field">${esc(t("language"))}
        <select id="set-lang">${LANGS.map((l) => `<option value="${l.code}" ${l.code === getLang() ? "selected" : ""}>${esc(l.label)}</option>`).join("")}</select>
      </label>
      <h2>${esc(t("alarm_window"))}</h2>
      <div class="seg">
        <button class="${w ? "" : "on"}" data-act="win-mode" data-m="always">${esc(t("alarm_always"))}</button>
        <button class="${w ? "on" : ""}" data-act="win-mode" data-m="custom">${esc(t("alarm_custom"))}</button>
      </div>
      <p class="muted small">${esc(t("alarm_hint"))}</p>
      ${windows}
      <h2>${esc(t("notifications"))}</h2>
      ${notif}
      ${/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone ? `<p class="muted small">${esc(t("install_hint"))}</p>` : ""}
      <button class="btn primary sticky" data-act="save-settings">${esc(t("save"))}</button>
    </main>`;
}

function viewGroup() {
  const g = S.gd?.group;
  const share = g ? `<button class="icon" data-act="share" aria-label="${esc(t("invite"))}">⤴</button>` : "";
  if (!S.gd) return `${header("...", { back: "#/" })}<main><p class="muted">${esc(t("loading"))}</p></main>`;
  const tabs = ["open", "scores", "members"].map((k) =>
    `<button class="${S.tab === k ? "on" : ""}" data-act="tab" data-tab="${k}">${esc(t("tab_" + k))}</button>`).join("");
  let body = "";
  if (S.tab === "open") body = tabOpen();
  else if (S.tab === "scores") body = tabScores();
  else body = tabMembers();
  return `${header(g.name, { back: "#/", right: share })}
    <div class="seg tabs">${tabs}</div>
    <main>${body}</main>
    <button class="fab" data-act="new-anytimer" aria-label="${esc(t("new_anytimer"))}">＋ ${esc(t("new_anytimer"))}</button>`;
}

function statusLine(a) {
  if (a.postpone_vote === "pending") return t("status_vote");
  switch (a.status) {
    case "scheduled": return t("status_scheduled", { when: fmtDateTime(a.fire_at) });
    case "active": return t("status_active");
    case "postponed": return t("status_postponed", { when: fmtDateTime(a.postponed_until) });
    case "done": return t("status_done");
    default: return t("status_expired");
  }
}

function cardHtml(a) {
  const me = backend.myId();
  const icon = DRINK_EMOJI[a.drink] || "✨";
  const running = a.fired_at && (a.status === "active" || a.status === "postponed");
  const votes = (S.gd?.votes ?? []).filter((v) => v.anytimer_id === a.id && v.round === a.postpone_round);
  const yes = votes.filter((v) => v.approve).length;
  const no = votes.length - yes;
  const iVoted = votes.some((v) => v.voter_id === me);
  let vote = "";
  if (a.postpone_vote === "pending") {
    vote = `<div class="vote">
      <p>${esc(t("reason_label", { reason: a.postpone_reason }))}</p>
      <p class="muted small">${esc(t("votes_count", { yes, no }))}</p>
      ${a.receiver_id !== me && !iVoted ? `<div class="row gap">
        <button class="btn small" data-act="vote" data-id="${esc(a.id)}" data-v="1">${esc(t("approve"))}</button>
        <button class="btn small ghost" data-act="vote" data-id="${esc(a.id)}" data-v="0">${esc(t("reject"))}</button>
      </div>` : (iVoted ? `<p class="muted small">${esc(t("voted"))}</p>` : "")}
    </div>`;
  }
  const actions = [];
  if (a.receiver_id === me && a.status === "active" && !a.postpone_vote) {
    actions.push(`<button class="btn small" data-act="done" data-id="${esc(a.id)}">${esc(t("btn_done"))}</button>`);
    actions.push(`<button class="btn small ghost" data-act="postpone" data-id="${esc(a.id)}">${esc(t("btn_postpone"))}</button>`);
  }
  if (a.giver_id === me && a.status === "scheduled") {
    actions.push(`<button class="btn small ghost" data-act="cancel" data-id="${esc(a.id)}">${esc(t("cancel_anytimer"))}</button>`);
  }
  return `<article class="card any ${a.status}">
    <div class="row between">
      <strong>${esc(nameOf(a.giver_id))} → ${esc(nameOf(a.receiver_id))}</strong>
      <span class="drink">${icon} ${esc(drinkLabel(a.drink, a.drink_custom))}</span>
    </div>
    <p class="status">${esc(statusLine(a))}</p>
    ${running ? `<p class="sw" data-sw="${esc(a.id)}">${esc(fmtDuration(elapsedSeconds(a, Date.now())))}</p>` : ""}
    <p class="muted small">${esc(t("penalty_label", { penalty: a.penalty }))}${a.penalty_count ? ` · ${esc(t("penalties_n", { n: a.penalty_count }))}` : ""}${a.expires_at ? ` · ${esc(t("expires_info", { when: fmtDateTime(a.expires_at) }))}` : ""}</p>
    ${vote}
    ${actions.length ? `<div class="row gap">${actions.join("")}</div>` : ""}
  </article>`;
}

function tabOpen() {
  const me = backend.myId();
  const open = (S.gd.anytimers || []).filter((a) => ["scheduled", "active", "postponed"].includes(a.status));
  const sortFn = (x, y) => Date.parse(x.fire_at) - Date.parse(y.fire_at);
  const onYou = open.filter((a) => a.receiver_id === me).sort(sortFn);
  const byYou = open.filter((a) => a.giver_id === me).sort(sortFn);
  const others = open.filter((a) => a.receiver_id !== me && a.giver_id !== me).sort(sortFn);
  const section = (title, list) => list.length ? `<h2>${esc(title)}</h2>${list.map(cardHtml).join("")}` : "";
  const html = section(t("on_you"), onYou) + section(t("given_by_you"), byYou) + section(t("others_open"), others);
  return html || `<p class="empty">${esc(t("none_open"))}</p>`;
}

function tabScores() {
  const done = (S.gd.anytimers || []).filter((a) => a.status === "done")
    .sort((x, y) => (x.duration_seconds - y.duration_seconds) || (Date.parse(x.done_at) - Date.parse(y.done_at)));
  const expired = (S.gd.anytimers || []).filter((a) => a.status === "expired");
  const medal = ["🥇", "🥈", "🥉"];
  const rows = done.map((a, i) => `
    <article class="card score">
      <span class="rank">${medal[i] || "#" + (i + 1)}</span>
      <div class="grow">
        <strong>${esc(nameOf(a.receiver_id))}</strong>
        <span class="muted small">${DRINK_EMOJI[a.drink] || ""} ${esc(drinkLabel(a.drink, a.drink_custom))} · ${esc(nameOf(a.giver_id))}${a.penalty_count ? " · " + esc(t("penalties_n", { n: a.penalty_count })) : ""}</span>
      </div>
      <div class="time">${esc(fmtDuration(a.duration_seconds))}</div>
      ${a.proof_path ? `<button class="thumb" data-act="proof" data-id="${esc(a.id)}" aria-label="${esc(t("view_proof"))}">${a.proof_type === "video" ? "▶" : `<img alt="" src="${esc(backend.proofUrl(a.proof_path))}">`}</button>` : ""}
    </article>`).join("");
  const miss = expired.length
    ? `<h2>${esc(t("not_done_title"))}</h2>` + expired.map((a) => `<article class="card score dim"><div class="grow"><strong>${esc(nameOf(a.receiver_id))}</strong><span class="muted small">${DRINK_EMOJI[a.drink] || ""} ${esc(drinkLabel(a.drink, a.drink_custom))} · ${esc(nameOf(a.giver_id))}</span></div><div class="time">${esc(t("status_expired"))}</div></article>`).join("")
    : "";
  return `<h2>${esc(t("scores_title"))}</h2>${rows || `<p class="empty">${esc(t("scores_empty"))}</p>`}${miss}`;
}

function tabMembers() {
  const g = S.gd.group;
  return `<div class="card code-card">
      <span class="muted small">${esc(t("code_label"))}</span>
      <strong class="code">${esc(g.code)}</strong>
      <button class="btn small" data-act="share">${esc(t("invite"))}</button>
    </div>
    ${S.gd.members.map((m) => `<div class="card member">${esc(nameOf(m.id))}</div>`).join("")}
    <button class="btn ghost danger" data-act="leave">${esc(t("leave_group"))}</button>`;
}

// ---------------------------------------------------------------
// Stopwatch en alarm
// ---------------------------------------------------------------
function tickStopwatches() {
  const now = Date.now();
  document.querySelectorAll("[data-sw]").forEach((el) => {
    const a = S.byId.get(el.dataset.sw);
    if (a) el.textContent = fmtDuration(elapsedSeconds(a, now));
  });
}
setInterval(tickStopwatches, 1000);

function alarmCandidate() {
  return S.myOpen.find((a) => a.status === "active" && !a.postpone_vote) || null;
}

function updateAlarm() {
  const a = alarmCandidate();
  const el = $("#alarm");
  if (!a) {
    if (S.alarmId) hideAlarm();
    return;
  }
  const key = a.id + ":" + (a.postpone_round || 0) + ":" + (a.paused_seconds || 0);
  if (S.alarmId === a.id && S.alarmRound === key) return;
  const fresh = S.alarmId !== a.id;
  S.alarmId = a.id;
  S.alarmRound = key;
  const giver = a.giver?.name || nameOf(a.giver_id);
  el.innerHTML = `<div class="alarm-box">
    <div class="bell">⏰</div>
    <h2>${esc(t("alarm_title", { giver, drink: drinkLabel(a.drink, a.drink_custom) }))}</h2>
    <p class="muted">${esc(t("time_running"))}</p>
    <p class="sw big" data-sw="${esc(a.id)}">${esc(fmtDuration(elapsedSeconds(a, Date.now())))}</p>
    <div class="col gap">
      <button class="btn primary big" data-act="done" data-id="${esc(a.id)}">${esc(t("btn_done"))}</button>
      <button class="btn ghost" data-act="postpone" data-id="${esc(a.id)}">${esc(t("btn_postpone"))}</button>
    </div>
  </div>`;
  el.classList.add("open");
  if (fresh) startAlarmSound();
}

function hideAlarm() {
  S.alarmId = null;
  S.alarmRound = null;
  $("#alarm").classList.remove("open");
  $("#alarm").innerHTML = "";
  stopAlarmSound();
}

function ensureAudio() {
  if (S.audio) return S.audio;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try { S.audio = new Ctx(); } catch { S.audio = null; }
  return S.audio;
}

document.addEventListener("pointerdown", () => {
  const a = ensureAudio();
  if (a && a.state === "suspended") a.resume();
}, { once: false, passive: true });

function beep() {
  const ctx = S.audio;
  if (!ctx || ctx.state !== "running") return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "square";
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.4);
}

function startAlarmSound() {
  stopAlarmSound();
  const pulse = () => {
    beep();
    if (navigator.vibrate) navigator.vibrate([400, 150, 400]);
  };
  pulse();
  S.alarmTimer = setInterval(pulse, 1200);
}

function stopAlarmSound() {
  clearInterval(S.alarmTimer);
  S.alarmTimer = null;
  if (navigator.vibrate) navigator.vibrate(0);
}

// ---------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------
function renderOnboarding() {
  const pre = store("nb_lang") || detectLang();
  setLang(pre);
  $("#app").innerHTML = `
    <main class="onboard">
      <div class="hero">🌙</div>
      <h1>${esc(t("welcome_title"))}</h1>
      <p class="muted">${esc(t("app_tagline"))}</p>
      <label class="field">${esc(t("ask_name"))}
        <input id="ob-name" type="text" maxlength="30" placeholder="${esc(t("name_ph"))}" autocomplete="nickname">
      </label>
      <label class="field">${esc(t("language"))}
        <select id="ob-lang">${LANGS.map((l) => `<option value="${l.code}" ${l.code === pre ? "selected" : ""}>${esc(l.label)}</option>`).join("")}</select>
      </label>
      <button class="btn primary" id="ob-go">${esc(t("start"))}</button>
      <p class="muted small" id="ob-err"></p>
      ${/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone ? `<p class="muted small">${esc(t("install_hint"))}</p>` : ""}
    </main>`;
  $("#ob-lang").addEventListener("change", (e) => { setLang(e.target.value); store("nb_lang", e.target.value); renderOnboarding(); $("#ob-name").focus(); });
  $("#ob-go").addEventListener("click", async () => {
    const name = $("#ob-name").value.trim();
    if (!name) { $("#ob-name").focus(); return; }
    const lang = $("#ob-lang").value;
    $("#ob-go").disabled = true;
    try {
      S.me = await backend.signUp(name, lang);
      setLang(lang);
      store("nb_lang", lang);
      await afterLogin();
    } catch (e) {
      $("#ob-go").disabled = false;
      $("#ob-err").textContent = errText(e);
    }
  });
}

// ---------------------------------------------------------------
// Acties
// ---------------------------------------------------------------
async function doAction(fn) {
  try { return await fn(); } catch (e) { toast(errText(e)); return null; }
}

function newGroupModal() {
  openModal(`<h2>${esc(t("new_group"))}</h2>
    <input id="m-name" type="text" maxlength="40" placeholder="${esc(t("group_name_ph"))}">
    <div class="row gap"><button class="btn ghost" data-act="close">${esc(t("cancel"))}</button><button class="btn primary" id="m-ok">${esc(t("create"))}</button></div>`,
  (sheet) => {
    sheet.querySelector("#m-name").focus();
    sheet.querySelector("#m-ok").addEventListener("click", async () => {
      const name = sheet.querySelector("#m-name").value.trim();
      if (!name) return;
      const g = await doAction(() => backend.createGroup(name));
      if (g) { closeModal(); await refreshGroups(); go("#/g/" + g.id); }
    });
  });
}

function joinGroupModal(prefill = "") {
  openModal(`<h2>${esc(t("join_group"))}</h2>
    <input id="m-code" type="text" maxlength="12" placeholder="${esc(t("code_ph"))}" value="${esc(prefill)}" autocapitalize="characters">
    <div class="row gap"><button class="btn ghost" data-act="close">${esc(t("cancel"))}</button><button class="btn primary" id="m-ok">${esc(t("join"))}</button></div>`,
  (sheet) => {
    sheet.querySelector("#m-code").focus();
    sheet.querySelector("#m-ok").addEventListener("click", async () => {
      const code = sheet.querySelector("#m-code").value.trim();
      if (!code) return;
      const g = await doAction(() => backend.joinGroup(code));
      if (g) { closeModal(); await refreshGroups(); go("#/g/" + g.id); }
    });
  });
}

function newAnytimerModal() {
  const me = backend.myId();
  const others = S.gd.members.filter((m) => m.id !== me);
  const form = { drink: "beer", expires: "", postpone: "24" };
  const expOpts = [["", "exp_never"], ["24", "exp_1d"], ["72", "exp_3d"], ["168", "exp_1w"], ["720", "exp_1m"]];
  const ppOpts = [["6", "pp_6h"], ["12", "pp_12h"], ["24", "pp_24h"], ["48", "pp_48h"]];
  openModal(`<h2>${esc(t("new_anytimer"))}</h2>
    <label class="field">${esc(t("receiver"))}
      <select id="f-recv"><option value="">${esc(t("pick_member"))}</option>${others.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select>
    </label>
    <div class="field">${esc(t("what_drink"))}
      <div class="chips" id="f-drinks">${DRINK_KEYS.map((k) => `<button type="button" class="chip ${k === "beer" ? "on" : ""}" data-k="${k}">${DRINK_EMOJI[k]} ${esc(t("d_" + k))}</button>`).join("")}</div>
      <input id="f-custom" type="text" maxlength="30" placeholder="${esc(t("custom_drink_ph"))}" hidden>
    </div>
    <div class="field">${esc(t("penalty"))}
      <input id="f-pen" type="text" maxlength="80" placeholder="${esc(t("penalty_ph"))}">
      <div class="chips" id="f-pens">${["pen_extra", "pen_shots", "pen_round"].map((k) => `<button type="button" class="chip" data-t="${esc(t(k))}">${esc(t(k))}</button>`).join("")}</div>
    </div>
    <div class="field">${esc(t("when"))}
      <input id="f-when" type="datetime-local">
      <div class="chips" id="f-quick">
        <button type="button" class="chip" data-q="1m">${esc(t("in_1_min"))}</button>
        <button type="button" class="chip" data-q="1h">${esc(t("in_1_hour"))}</button>
        <button type="button" class="chip" data-q="tom">${esc(t("tomorrow"))}</button>
      </div>
    </div>
    <label class="field">${esc(t("expires"))}
      <select id="f-exp">${expOpts.map(([v, k]) => `<option value="${v}">${esc(t(k))}</option>`).join("")}</select>
    </label>
    <label class="field">${esc(t("postpone_len"))}
      <select id="f-pp">${ppOpts.map(([v, k]) => `<option value="${v}" ${v === "24" ? "selected" : ""}>${esc(t(k))}</option>`).join("")}</select>
    </label>
    <p class="warn small" id="f-err"></p>
    <div class="row gap"><button class="btn ghost" data-act="close">${esc(t("cancel"))}</button><button class="btn primary" id="f-ok">${esc(t("create_btn"))}</button></div>`,
  (sheet) => {
    const q = (s) => sheet.querySelector(s);
    const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    q("#f-drinks").addEventListener("click", (e) => {
      const b = e.target.closest("[data-k]");
      if (!b) return;
      form.drink = b.dataset.k;
      sheet.querySelectorAll("#f-drinks .chip").forEach((c) => c.classList.toggle("on", c === b));
      q("#f-custom").hidden = form.drink !== "custom";
      if (form.drink === "custom") q("#f-custom").focus();
    });
    q("#f-pens").addEventListener("click", (e) => {
      const b = e.target.closest("[data-t]");
      if (b) q("#f-pen").value = b.dataset.t;
    });
    q("#f-quick").addEventListener("click", (e) => {
      const b = e.target.closest("[data-q]");
      if (!b) return;
      const d = new Date();
      if (b.dataset.q === "1m") d.setMinutes(d.getMinutes() + 1);
      else if (b.dataset.q === "1h") d.setHours(d.getHours() + 1);
      else { d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); }
      q("#f-when").value = toLocal(d);
    });
    q("#f-ok").addEventListener("click", async () => {
      const err = (m) => { q("#f-err").textContent = m; };
      const receiverId = q("#f-recv").value;
      const penalty = q("#f-pen").value.trim();
      const whenVal = q("#f-when").value;
      const custom = q("#f-custom").value.trim();
      if (!receiverId) return err(t("need_receiver"));
      if (form.drink === "custom" && !custom) return err(t("need_custom"));
      if (!penalty) return err(t("need_penalty"));
      if (!whenVal) return err(t("need_time"));
      const btn = q("#f-ok");
      btn.disabled = true;
      const res = await doAction(() => backend.createAnytimer({
        groupId: S.gdId,
        receiverId,
        drink: form.drink,
        drinkCustom: custom,
        penalty,
        fireAt: new Date(whenVal).toISOString(),
        expiresHours: q("#f-exp").value ? Number(q("#f-exp").value) : null,
        postponeHours: Number(q("#f-pp").value),
      }));
      btn.disabled = false;
      if (res) { closeModal(); toast(t("created_ok")); await refreshGroup(); }
    });
  });
}

function postponeModal(id) {
  const a = S.byId.get(id);
  if (!a) return;
  openModal(`<h2>${esc(t("pp_title"))}</h2>
    <p>${esc(t("pp_intro", { penalty: a.penalty }))}</p>
    <label class="field">${esc(t("pp_with_reason"))}
      <textarea id="p-reason" maxlength="140" rows="3" placeholder="${esc(t("pp_reason_ph"))}"></textarea>
    </label>
    <button class="btn primary" id="p-send" disabled>${esc(t("pp_send"))}</button>
    <button class="btn ghost" id="p-pen">${esc(t("pp_no_reason"))}</button>
    <button class="link" data-act="close">${esc(t("cancel"))}</button>`,
  (sheet) => {
    const ta = sheet.querySelector("#p-reason");
    const send = sheet.querySelector("#p-send");
    ta.addEventListener("input", () => { send.disabled = !ta.value.trim(); });
    send.addEventListener("click", async () => {
      send.disabled = true;
      const r = await doAction(() => backend.requestPostpone(id, ta.value.trim()));
      if (r) { stopAlarmSound(); closeModal(); toast(t("pp_sent")); await refreshAll(); }
      else send.disabled = false;
    });
    sheet.querySelector("#p-pen").addEventListener("click", async () => {
      const r = await doAction(() => backend.requestPostpone(id, ""));
      if (r) { stopAlarmSound(); closeModal(); toast(t("pp_penalty_taken", { penalty: a.penalty })); await refreshAll(); }
    });
  });
}

async function compressImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
    if (!blob) return file;
    return new File([blob], "proof.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function videoDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(v.src); resolve(d); };
    v.onerror = () => resolve(0);
    v.src = URL.createObjectURL(file);
  });
}

function proofModal(id) {
  openModal(`<h2>${esc(t("proof_title"))}</h2>
    <p>${esc(t("proof_intro"))}</p>
    <label class="btn ghost filebtn">${esc(t("proof_pick"))}
      <input id="pf-file" type="file" accept="image/*,video/*" hidden>
    </label>
    <div id="pf-prev" class="preview"></div>
    <p class="warn small" id="pf-err"></p>
    <button class="btn primary" id="pf-send" disabled>${esc(t("proof_send"))}</button>
    <button class="link" data-act="close">${esc(t("cancel"))}</button>`,
  (sheet) => {
    let file = null;
    const err = (m) => { sheet.querySelector("#pf-err").textContent = m; };
    sheet.querySelector("#pf-file").addEventListener("change", async (e) => {
      err("");
      sheet.querySelector("#pf-send").disabled = true;
      const f = e.target.files[0];
      if (!f) return;
      const isVideo = f.type.startsWith("video");
      if (isVideo) {
        if (f.size > 25 * 1024 * 1024) return err(t("proof_too_big"));
        const d = await videoDuration(f);
        if (d > 10.5) return err(t("proof_video_long"));
        file = f;
      } else {
        file = await compressImage(f);
        if (file.size > 25 * 1024 * 1024) return err(t("proof_too_big"));
      }
      const url = URL.createObjectURL(file);
      sheet.querySelector("#pf-prev").innerHTML = isVideo
        ? `<video src="${url}" controls playsinline muted></video>` : `<img alt="" src="${url}">`;
      sheet.querySelector("#pf-send").disabled = false;
    });
    sheet.querySelector("#pf-send").addEventListener("click", async () => {
      if (!file) return;
      const btn = sheet.querySelector("#pf-send");
      btn.disabled = true;
      btn.textContent = t("uploading");
      try {
        const type = file.type.startsWith("video") ? "video" : "image";
        const path = await backend.uploadProof(id, file);
        await backend.completeAnytimer(id, path, type);
        stopAlarmSound();
        closeModal();
        toast(t("status_done"));
        await refreshAll();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = t("proof_send");
        err(errText(e));
      }
    });
  });
}

function proofViewer(id) {
  const a = S.byId.get(id);
  if (!a?.proof_path) return;
  const url = backend.proofUrl(a.proof_path);
  openModal(`<h2>${esc(nameOf(a.receiver_id))} · ${esc(fmtDuration(a.duration_seconds))}</h2>
    <div class="preview">${a.proof_type === "video" ? `<video src="${esc(url)}" controls playsinline autoplay></video>` : `<img alt="" src="${esc(url)}">`}</div>
    <button class="btn ghost" data-act="close">${esc(t("close"))}</button>`);
}

async function shareGroup() {
  const g = S.gd.group;
  const link = `${location.origin}${location.pathname}?join=${g.code}`;
  const text = t("invite_text", { name: g.name, code: g.code });
  try {
    if (navigator.share) { await navigator.share({ title: "Nachtbraak", text, url: link }); return; }
  } catch { return; }
  try { await navigator.clipboard.writeText(text + " " + link); toast(t("copied")); } catch { toast(text); }
}

// ---------------------------------------------------------------
// Meldingen
// ---------------------------------------------------------------
function urlBase64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("./sw.js"); } catch { return null; }
}

async function ensurePush(askPermission) {
  if (!("Notification" in window)) return false;
  if (askPermission && Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission !== "granted") return false;
  if (isDemo) return true;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerSW());
  if (!reg) return false;
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY),
    });
  }
  await backend.savePush(sub);
  return true;
}

// ---------------------------------------------------------------
// Klik- en invoerafhandeling
// ---------------------------------------------------------------
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  switch (act) {
    case "nav": go(el.dataset.to); break;
    case "close": closeModal(); break;
    case "tab": S.tab = el.dataset.tab; render(); break;
    case "new-group": newGroupModal(); break;
    case "join-group": joinGroupModal(); break;
    case "new-anytimer": newAnytimerModal(); break;
    case "share": shareGroup(); break;
    case "done": proofModal(id); break;
    case "postpone": postponeModal(id); break;
    case "proof": proofViewer(id); break;
    case "cancel":
      if (confirm(t("cancel_confirm"))) { await doAction(() => backend.cancelAnytimer(id)); await refreshGroup(); }
      break;
    case "vote":
      await doAction(() => backend.votePostpone(id, el.dataset.v === "1"));
      await refreshGroup();
      break;
    case "leave":
      if (confirm(t("leave_confirm"))) {
        await doAction(() => backend.leaveGroup(S.gdId));
        go("#/");
      }
      break;
    case "demo-send":
      await backend.demoSendToMe();
      toast("Demo: Sam → " + t("you"));
      break;
    case "win-mode":
      S.draftWindows = el.dataset.m === "custom"
        ? (S.draftWindows ?? [{ days: [1, 2, 3, 4, 5, 6, 0], from: "09:00", to: "23:59" }])
        : null;
      S.draftName = $("#set-name")?.value ?? S.draftName;
      render();
      break;
    case "win-add":
      S.draftName = $("#set-name")?.value ?? S.draftName;
      S.draftWindows.push({ days: [1, 2, 3, 4, 5, 6, 0], from: "09:00", to: "23:59" });
      render();
      break;
    case "win-remove":
      S.draftName = $("#set-name")?.value ?? S.draftName;
      S.draftWindows.splice(Number(el.dataset.i), 1);
      if (S.draftWindows.length === 0) S.draftWindows = null;
      render();
      break;
    case "win-day": {
      const w = S.draftWindows[Number(el.dataset.i)];
      const d = Number(el.dataset.d);
      w.days = w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d];
      el.classList.toggle("on");
      break;
    }
    case "enable-push": {
      try {
        const ok = await ensurePush(true);
        if (!ok && Notification.permission !== "denied") toast(t("notif_failed"));
      } catch { toast(t("notif_failed")); }
      S.draftName = $("#set-name")?.value ?? S.draftName;
      render();
      break;
    }
    case "save-settings": {
      const name = $("#set-name").value.trim() || S.me.name;
      const windows = S.draftWindows
        ? S.draftWindows.filter((w) => w.days.length > 0)
        : null;
      const me = await doAction(() => backend.updateMe({
        name,
        lang: $("#set-lang").value,
        alarm_windows: windows && windows.length ? windows : null,
      }));
      if (me) { S.me = me; toast(t("saved")); go("#/"); }
      break;
    }
    default: break;
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset?.act === "win-from") S.draftWindows[Number(el.dataset.i)].from = el.value;
  if (el.dataset?.act === "win-to") S.draftWindows[Number(el.dataset.i)].to = el.value;
});

document.addEventListener("change", async (e) => {
  if (e.target.id === "set-lang") {
    const code = e.target.value;
    S.draftName = $("#set-name")?.value ?? S.draftName;
    setLang(code);
    store("nb_lang", code);
    const me = await doAction(() => backend.updateMe({ lang: code }));
    if (me) S.me = me;
    render();
  }
});

$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

// ---------------------------------------------------------------
// Opstarten
// ---------------------------------------------------------------
async function afterLogin() {
  setLang(S.me.lang || getLang());
  const sw = await registerSW();
  void sw;
  if ("Notification" in window && Notification.permission === "granted") {
    ensurePush(false).catch(() => {});
  }
  await refreshGroups();
  await refreshMine();
  if (S.unsubMine) S.unsubMine();
  S.unsubMine = backend.subscribeMine(() => refreshAll());

  const params = new URLSearchParams(location.search);
  const join = params.get("join") || store("nb_pending_join");
  if (join) {
    store("nb_pending_join", "");
    history.replaceState(null, "", location.pathname + location.hash);
    try {
      const g = await backend.joinGroup(join);
      await refreshGroups();
      location.hash = "#/g/" + g.id;
    } catch (e) { toast(errText(e)); }
  } else if (params.get("a")) {
    history.replaceState(null, "", location.pathname + location.hash);
  }
  await onRouteChange();
}

setInterval(() => { if (S.me && !document.hidden) refreshAll(); }, 20000);
document.addEventListener("visibilitychange", () => { if (S.me && !document.hidden) refreshAll(); });

(async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get("join")) store("nb_pending_join", params.get("join"));
  setLang(store("nb_lang") || detectLang());
  try {
    S.me = await backend.init();
  } catch (e) {
    $("#app").innerHTML = `<main><p class="warn">${esc(t("error_generic"))}</p></main>`;
    return;
  }
  if (!S.me) renderOnboarding();
  else await afterLogin();
})();
