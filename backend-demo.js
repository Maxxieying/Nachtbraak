// Demo-backend: alles draait in de browser, zonder Supabase.
// Wordt automatisch gebruikt zolang config.js geen SUPABASE_URL bevat.
// Andere groepsleden zijn nep en reageren automatisch.

export const isDemo = true;

const ME = "me";
const uid = () => Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());

const OTHERS = [
  { id: "u-sam", name: "Sam" },
  { id: "u-noor", name: "Noor" },
  { id: "u-lisa", name: "Lisa" },
  { id: "u-daan", name: "Daan" },
];

const state = {
  me: null,
  groups: [],
  members: [], // {group_id, user_id}
  anytimers: [],
  votes: [],
  profiles: {},
};

function svgProof(label, color) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='360'><rect width='100%' height='100%' fill='${color}'/><text x='50%' y='50%' font-size='64' text-anchor='middle' dominant-baseline='middle'>${label}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function seed() {
  for (const o of OTHERS) state.profiles[o.id] = { ...o };
  const g = { id: "g-demo", name: "Demo-huis", code: "DEMO42", created_at: nowIso() };
  state.groups.push(g);
  state.members.push({ group_id: g.id, user_id: ME });
  for (const o of OTHERS) state.members.push({ group_id: g.id, user_id: o.id });

  const done = (giver, receiver, drink, secs, penalties, label, color) => ({
    id: uid(), group_id: g.id, giver_id: giver, receiver_id: receiver, drink, drink_custom: null,
    penalty: "Extra biertje", fire_at: nowIso(), expires_in_hours: null, postpone_hours: 24,
    status: "done", fired_at: new Date(Date.now() - 86400000).toISOString(), expires_at: null,
    done_at: new Date(Date.now() - 80000000).toISOString(), proof_path: svgProof(label, color), proof_type: "image",
    postponed_from: null, postponed_until: null, postpone_kind: null, postpone_reason: null, postpone_vote: null,
    postpone_round: 0, paused_seconds: 0, penalty_count: penalties, duration_seconds: secs,
    created_at: new Date(Date.now() - 90000000).toISOString(),
  });
  state.anytimers.push(
    done("u-sam", "u-noor", "beer", 95, 0, "🍺", "#2a2150"),
    done("u-lisa", "u-daan", "shot", 1260, 1, "🥃", "#4a1f3d"),
    done("u-daan", "u-sam", "bottle", 8040, 0, "🍾", "#1f3d4a"),
  );
}

const profileOf = (id) => state.profiles[id] || { id, name: "?" };

function dueTick() {
  const now = Date.now();
  let changed = false;
  for (const a of state.anytimers) {
    if (a.status === "scheduled" && Date.parse(a.fire_at) <= now) {
      a.status = "active";
      a.fired_at = nowIso();
      a.expires_at = a.expires_in_hours ? new Date(now + a.expires_in_hours * 3600000).toISOString() : null;
      changed = true;
      if (a.receiver_id !== ME) autoRespond(a);
    } else if (a.status === "postponed" && Date.parse(a.postponed_until) <= now) {
      if (a.postpone_kind === "approved") {
        a.paused_seconds += Math.max(0, Math.floor((Date.parse(a.postponed_until) - Date.parse(a.postponed_from)) / 1000));
      }
      Object.assign(a, { status: "active", postpone_kind: null, postponed_from: null, postponed_until: null, postpone_reason: null });
      changed = true;
    } else if ((a.status === "active" || a.status === "postponed") && a.expires_at && Date.parse(a.expires_at) <= now) {
      a.status = "expired";
      changed = true;
    }
  }
  if (changed) emit();
}

// Nep-ontvangers voeren hun anytimer na een paar seconden uit.
function autoRespond(a) {
  setTimeout(() => {
    if (a.status !== "active") return;
    const secs = Math.max(1, Math.floor((Date.now() - Date.parse(a.fired_at)) / 1000) - a.paused_seconds);
    Object.assign(a, {
      status: "done", done_at: nowIso(), duration_seconds: secs, proof_type: "image",
      proof_path: svgProof("🍺", "#2a2150"),
    });
    emit();
  }, 6000);
}

export async function init() {
  seed();
  setInterval(dueTick, 1000);
  try {
    const saved = JSON.parse(localStorage.getItem("nb_demo_me") || "null");
    if (saved) {
      state.me = saved;
      state.profiles[ME] = { id: ME, name: saved.name };
      return state.me;
    }
  } catch { /* geen opslag beschikbaar */ }
  return null;
}

export function myId() {
  return ME;
}

export async function signUp(name, lang) {
  state.me = { id: ME, name, lang, tz: "Europe/Amsterdam", alarm_windows: null };
  state.profiles[ME] = { id: ME, name };
  try { localStorage.setItem("nb_demo_me", JSON.stringify(state.me)); } catch { /* negeren */ }
  return state.me;
}

export async function getMe() {
  return state.me;
}

export async function updateMe(patch) {
  Object.assign(state.me, patch);
  if (patch.name) state.profiles[ME].name = patch.name;
  try { localStorage.setItem("nb_demo_me", JSON.stringify(state.me)); } catch { /* negeren */ }
  return state.me;
}

export async function listGroups() {
  return state.groups
    .filter((g) => state.members.some((m) => m.group_id === g.id && m.user_id === ME))
    .map((g) => ({ ...g, member_count: state.members.filter((m) => m.group_id === g.id).length }));
}

export async function createGroup(name) {
  const g = { id: "g-" + uid(), name, code: uid().slice(0, 6).toUpperCase(), created_at: nowIso() };
  state.groups.push(g);
  state.members.push({ group_id: g.id, user_id: ME });
  return g;
}

export async function joinGroup(code) {
  const g = state.groups.find((x) => x.code === code.trim().toUpperCase());
  if (!g) throw new Error("invalid_code");
  if (!state.members.some((m) => m.group_id === g.id && m.user_id === ME)) {
    state.members.push({ group_id: g.id, user_id: ME });
  }
  return g;
}

export async function leaveGroup(groupId) {
  state.members = state.members.filter((m) => !(m.group_id === groupId && m.user_id === ME));
}

export async function getGroupData(groupId) {
  const group = state.groups.find((g) => g.id === groupId);
  const members = state.members.filter((m) => m.group_id === groupId).map((m) => profileOf(m.user_id));
  const anytimers = state.anytimers.filter((a) => a.group_id === groupId).map((a) => ({ ...a }));
  const pend = new Set(anytimers.filter((a) => a.postpone_vote === "pending").map((a) => a.id));
  return { group, members, anytimers, votes: state.votes.filter((v) => pend.has(v.anytimer_id)).map((v) => ({ ...v })) };
}

export async function myOpenAnytimers() {
  return state.anytimers
    .filter((a) => a.receiver_id === ME && (a.status === "active" || a.status === "postponed"))
    .map((a) => ({ ...a, giver: profileOf(a.giver_id) }));
}

export function subscribe(groupId, onChange) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function subscribeMine(onChange) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export async function createAnytimer(p) {
  const a = {
    id: uid(), group_id: p.groupId, giver_id: ME, receiver_id: p.receiverId, drink: p.drink,
    drink_custom: p.drinkCustom || null, penalty: p.penalty, fire_at: p.fireAt,
    expires_in_hours: p.expiresHours ?? null, postpone_hours: p.postponeHours, status: "scheduled",
    fired_at: null, expires_at: null, done_at: null, proof_path: null, proof_type: null,
    postponed_from: null, postponed_until: null, postpone_kind: null, postpone_reason: null,
    postpone_vote: null, postpone_round: 0, paused_seconds: 0, penalty_count: 0, duration_seconds: null,
    created_at: nowIso(),
  };
  state.anytimers.push(a);
  emit();
  return a;
}

export async function cancelAnytimer(id) {
  state.anytimers = state.anytimers.filter((a) => !(a.id === id && a.giver_id === ME && a.status === "scheduled"));
  emit();
}

export async function uploadProof(anytimerId, file) {
  return URL.createObjectURL(file);
}

export function proofUrl(path) {
  return path || "";
}

export async function completeAnytimer(id, path, type) {
  const a = state.anytimers.find((x) => x.id === id);
  let credit = 0;
  if (a.status === "postponed" && a.postpone_kind === "approved") {
    credit = Math.max(0, Math.floor((Math.min(Date.now(), Date.parse(a.postponed_until)) - Date.parse(a.postponed_from)) / 1000));
  }
  const total = Math.max(0, Math.floor((Date.now() - Date.parse(a.fired_at)) / 1000) - a.paused_seconds - credit);
  Object.assign(a, {
    status: "done", done_at: nowIso(), proof_path: path, proof_type: type,
    paused_seconds: a.paused_seconds + credit, duration_seconds: total, postpone_vote: null,
  });
  emit();
  return a;
}

function applyPenaltyPostpone(a) {
  Object.assign(a, {
    status: "postponed", postpone_kind: "penalty", postpone_vote: null, postponed_from: nowIso(),
    postponed_until: new Date(Date.now() + a.postpone_hours * 3600000).toISOString(),
    penalty_count: a.penalty_count + 1,
  });
}

export async function requestPostpone(id, reason) {
  const a = state.anytimers.find((x) => x.id === id);
  const r = (reason || "").trim();
  if (!r) {
    applyPenaltyPostpone(a);
    a.postpone_reason = null;
  } else {
    a.postpone_vote = "pending";
    a.postpone_reason = r.slice(0, 140);
    a.postpone_round += 1;
    // Nep-groepsleden stemmen na een paar seconden.
    const voters = state.members.filter((m) => m.group_id === a.group_id && m.user_id !== ME).map((m) => m.user_id);
    voters.forEach((v, i) => setTimeout(() => castVote(a, v, i % 3 !== 2), 2500 + i * 1500));
  }
  emit();
  return a;
}

function castVote(a, voter, approve) {
  if (a.postpone_vote !== "pending") return;
  state.votes = state.votes.filter((v) => !(v.anytimer_id === a.id && v.round === a.postpone_round && v.voter_id === voter));
  state.votes.push({ anytimer_id: a.id, round: a.postpone_round, voter_id: voter, approve });
  const voters = state.members.filter((m) => m.group_id === a.group_id && m.user_id !== a.receiver_id).length;
  const mine = state.votes.filter((v) => v.anytimer_id === a.id && v.round === a.postpone_round);
  const yes = mine.filter((v) => v.approve).length;
  const no = mine.filter((v) => !v.approve).length;
  if (yes * 2 > voters) {
    Object.assign(a, {
      status: "postponed", postpone_kind: "approved", postpone_vote: null, postponed_from: nowIso(),
      postponed_until: new Date(Date.now() + a.postpone_hours * 3600000).toISOString(),
    });
  } else if (no * 2 >= voters) {
    applyPenaltyPostpone(a);
  }
  emit();
}

export async function votePostpone(id, approve) {
  const a = state.anytimers.find((x) => x.id === id);
  castVote(a, ME, approve);
  return a;
}

export async function savePush() {}

// Alleen voor de demo: laat Sam over 3 seconden een anytimer op jou inzetten.
export async function demoSendToMe() {
  return createAnytimer({
    groupId: "g-demo", receiverId: ME, drink: "beer", drinkCustom: null, penalty: "Extra biertje",
    fireAt: new Date(Date.now() + 3000).toISOString(), expiresHours: null, postponeHours: 12,
  }).then((a) => {
    a.giver_id = "u-sam";
    emit();
    return a;
  });
}
