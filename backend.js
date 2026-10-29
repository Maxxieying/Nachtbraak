// Echte backend: Supabase.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const cfg = window.NACHTBRAAK_CONFIG;
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export const isDemo = false;
let userId = null;

function check({ data, error }) {
  if (error) throw new Error(error.message || "error");
  return data;
}

export async function init() {
  const { data } = await sb.auth.getSession();
  userId = data.session?.user?.id ?? null;
  if (!userId) return null;
  return getMe();
}

export function myId() {
  return userId;
}

export async function signUp(name, lang) {
  if (!userId) {
    const res = await sb.auth.signInAnonymously();
    const d = check(res);
    userId = d.user.id;
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Amsterdam";
  check(await sb.from("profiles").upsert({ id: userId, name, lang, tz }));
  return getMe();
}

export async function getMe() {
  const res = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
  return check(res);
}

export async function updateMe(patch) {
  const res = await sb.from("profiles").update(patch).eq("id", userId).select().single();
  return check(res);
}

export async function listGroups() {
  const res = await sb
    .from("group_members")
    .select("group:groups(id,name,code,created_at)")
    .eq("user_id", userId);
  const rows = check(res).map((r) => r.group).filter(Boolean);
  if (rows.length === 0) return [];
  const counts = check(
    await sb.from("group_members").select("group_id").in("group_id", rows.map((g) => g.id)),
  );
  const n = {};
  for (const c of counts) n[c.group_id] = (n[c.group_id] || 0) + 1;
  return rows
    .map((g) => ({ ...g, member_count: n[g.id] || 1 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createGroup(name) {
  return check(await sb.rpc("create_group", { p_name: name }));
}

export async function joinGroup(code) {
  const res = await sb.rpc("join_group", { p_code: code });
  if (res.error && /group_not_found/.test(res.error.message)) throw new Error("invalid_code");
  return check(res);
}

export async function leaveGroup(groupId) {
  check(await sb.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId));
}

export async function getGroupData(groupId) {
  const [g, m, a] = await Promise.all([
    sb.from("groups").select("*").eq("id", groupId).maybeSingle(),
    sb.from("group_members").select("user:profiles(id,name)").eq("group_id", groupId),
    sb.from("anytimers").select("*").eq("group_id", groupId).order("created_at", { ascending: false }).limit(500),
  ]);
  const anytimers = check(a);
  let votes = [];
  const pending = anytimers.filter((x) => x.postpone_vote === "pending").map((x) => x.id);
  if (pending.length) {
    votes = check(await sb.from("anytimer_votes").select("*").in("anytimer_id", pending));
  }
  return {
    group: check(g),
    members: check(m).map((r) => r.user).filter(Boolean),
    anytimers,
    votes,
  };
}

export async function myOpenAnytimers() {
  const res = await sb
    .from("anytimers")
    .select("*, giver:profiles!anytimers_giver_id_fkey(id,name)")
    .eq("receiver_id", userId)
    .in("status", ["active", "postponed"]);
  return check(res);
}

export function subscribe(groupId, onChange) {
  const ch = sb.channel("g-" + groupId + "-" + Math.random().toString(36).slice(2, 7));
  const fire = () => onChange();
  ch.on("postgres_changes", { event: "*", schema: "public", table: "anytimers", filter: "group_id=eq." + groupId }, fire);
  ch.on("postgres_changes", { event: "*", schema: "public", table: "anytimer_votes" }, fire);
  ch.on("postgres_changes", { event: "*", schema: "public", table: "group_members", filter: "group_id=eq." + groupId }, fire);
  ch.subscribe();
  return () => sb.removeChannel(ch);
}

export function subscribeMine(onChange) {
  const ch = sb.channel("me-" + Math.random().toString(36).slice(2, 7));
  ch.on("postgres_changes", { event: "*", schema: "public", table: "anytimers", filter: "receiver_id=eq." + userId }, () => onChange());
  ch.subscribe();
  return () => sb.removeChannel(ch);
}

export async function createAnytimer(p) {
  return check(
    await sb.rpc("create_anytimer", {
      p_group: p.groupId,
      p_receiver: p.receiverId,
      p_drink: p.drink,
      p_drink_custom: p.drinkCustom || null,
      p_penalty: p.penalty,
      p_fire_at: p.fireAt,
      p_expires_hours: p.expiresHours ?? null,
      p_postpone_hours: p.postponeHours,
    }),
  );
}

export async function cancelAnytimer(id) {
  check(await sb.rpc("cancel_anytimer", { p_id: id }));
}

export async function uploadProof(anytimerId, file) {
  const ext = (file.name.split(".").pop() || (file.type.startsWith("video") ? "mp4" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${userId}/${anytimerId}-${Date.now()}.${ext || "bin"}`;
  const res = await sb.storage.from("proofs").upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (res.error) throw new Error(res.error.message);
  return path;
}

export function proofUrl(path) {
  if (!path) return "";
  return sb.storage.from("proofs").getPublicUrl(path).data.publicUrl;
}

export async function completeAnytimer(id, path, type) {
  return check(await sb.rpc("complete_anytimer", { p_id: id, p_proof_path: path, p_proof_type: type }));
}

export async function requestPostpone(id, reason) {
  return check(await sb.rpc("request_postpone", { p_id: id, p_reason: reason || null }));
}

export async function votePostpone(id, approve) {
  return check(await sb.rpc("vote_postpone", { p_id: id, p_approve: approve }));
}

export async function savePush(sub) {
  const j = sub.toJSON();
  check(await sb.rpc("save_push", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }));
}
