import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot, increment, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ---------- constants ----------
const CATS = ["ירקות ופירות","מוצרי חלב וביצים","לחם ומאפים","בשר ודגים","מזווה ושימורים","קפואים","שתייה","חטיפים ומתוקים","ניקיון וטואלטיקה","תינוקות","אחר"];
const STARTERS = [["חלב","מוצרי חלב וביצים"],["ביצים","מוצרי חלב וביצים"],["לחם","לחם ומאפים"],["עגבניות","ירקות ופירות"],["מלפפונים","ירקות ופירות"],["בננות","ירקות ופירות"],["גבינה לבנה","מוצרי חלב וביצים"],["פסטה","מזווה ושימורים"],["אורז","מזווה ושימורים"],["חזה עוף","בשר ודגים"],["נייר טואלט","ניקיון וטואלטיקה"]];
const LS_NAME = "kniyot-name", LS_FAMILY = "kniyot-family";

const $ = id => document.getElementById(id);
const ls = {
  get(k){ try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch {} },
  del(k){ try { localStorage.removeItem(k); } catch {} }
};
const histKey = n => n.trim().replace(/\//g,"∕").slice(0,100) || "_";
const randomCode = () => { const a="abcdefghijkmnpqrstuvwxyz23456789"; const b=new Uint8Array(24); crypto.getRandomValues(b); return [...b].map(x=>a[x%a.length]).join(""); };
const validCode = c => /^[a-z0-9]{20,40}$/.test(c);

// ---------- state ----------
let me = ls.get(LS_NAME);
let family = "";
let items = [], history = new Map();
let fs = null, itemsCol = null, histCol = null;
let editing = null;

// family from URL wins (it survives "add to home screen"), then local storage
const urlFamily = new URLSearchParams(location.search).get("family") || "";
family = validCode(urlFamily) ? urlFamily : ls.get(LS_FAMILY);
if (!validCode(family)) family = "";

function keepFamilyInUrl(){
  if (!family) return;
  const u = new URL(location.href);
  u.search = "?family=" + family;
  history_replace(u);
}
function history_replace(u){ try { window.history.replaceState(null, "", u.toString()); } catch {} }
function shareUrl(){ const u = new URL(location.href); u.search = "?family=" + family; u.hash = ""; return u.toString(); }

// ---------- selects ----------
for (const sel of [$("itemCat"), $("editCat")]) CATS.forEach(c => { const o=document.createElement("option"); o.value=c; o.textContent=c; sel.appendChild(o); });

// ---------- status ----------
function setStatus(t, warn){ const s=$("status"); s.textContent=t; s.className="status"+(warn?" warn":""); }
function onErr(e){ console.error(e); setStatus("השינוי לא נשמר. נסו שוב.", true); }
function onlineStatus(){ if (!navigator.onLine) setStatus("אין חיבור. השינויים יישמרו ויסונכרנו כשהחיבור יחזור.", true); else setStatus("מסונכרן עם כל המשפחה"); }
addEventListener("online", onlineStatus); addEventListener("offline", onlineStatus);

// ---------- views ----------
function showSetup(){
  $("mainView").hidden = true; $("setupView").hidden = false;
  $("setupName").value = me;
  const joining = !!family;
  $("joinBox").hidden = !joining;
  $("setupSubmit").textContent = joining ? "הצטרפות לרשימה" : "יצירת רשימה משפחתית";
}
$("haveCode").onclick = () => { $("codeForm").hidden = false; $("codeInput").focus(); };
$("codeForm").addEventListener("submit", e => {
  e.preventDefault();
  let v = $("codeInput").value.trim();
  const m = v.match(/family=([a-z0-9]+)/); if (m) v = m[1];
  v = v.toLowerCase();
  if (!validCode(v)) { $("codeInput").setCustomValidity("הקוד לא תקין"); $("codeInput").reportValidity(); return; }
  family = v; showSetup();
});
$("codeInput").addEventListener("input", () => $("codeInput").setCustomValidity(""));
$("setupForm").addEventListener("submit", e => {
  e.preventDefault();
  me = $("setupName").value.trim().slice(0,20); if (!me) return;
  ls.set(LS_NAME, me);
  if (!family) family = randomCode();
  ls.set(LS_FAMILY, family);
  start();
});

// ---------- Firebase ----------
function configMissing(){ return !firebaseConfig || !firebaseConfig.apiKey || String(firebaseConfig.apiKey).startsWith("REPLACE"); }

let started = false;
async function start(){
  keepFamilyInUrl();
  $("setupView").hidden = true; $("mainView").hidden = false;
  render(); renderChips();
  if (configMissing()) { setStatus("חסרות הגדרות Firebase בקובץ firebase-config.js. ראו את מדריך ההתקנה.", true); return; }
  if (started) return; started = true;
  setStatus("מתחבר…");
  const app = initializeApp(firebaseConfig);
  fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  const auth = getAuth(app);
  onAuthStateChanged(auth, user => { if (user) subscribe(); });
  try { await signInAnonymously(auth); }
  catch (e) { console.error(e); setStatus("לא הצלחנו להתחבר. ודאו שהכניסה האנונימית מופעלת ב-Firebase.", true); }
}

let subscribed = false;
function subscribe(){
  if (subscribed) return; subscribed = true;
  itemsCol = collection(fs, "families", family, "items");
  histCol = collection(fs, "families", family, "history");
  onSnapshot(itemsCol, snap => {
    items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render(); renderChips();
    if (!snap.metadata.fromCache) onlineStatus();
  }, err => { console.error(err); setStatus("אין גישה לרשימה. בדקו את כללי האבטחה ב-Firebase.", true); });
  onSnapshot(histCol, snap => {
    history = new Map(snap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    render(); renderChips(); fillDatalist();
  }, err => console.error(err));
}

// ---------- actions ----------
async function addItem(name, qty, cat, note){
  name = name.trim(); note = (note || "").trim();
  if (!name || !itemsCol) return;
  const existing = items.find(i => !i.done && i.name === name);
  try {
    if (existing) {
      const ch = { qty: Math.min(99, (existing.qty || 1) + qty) };
      if (note && note !== existing.note) ch.note = existing.note ? existing.note + " · " + note : note;
      await updateDoc(doc(itemsCol, existing.id), ch);
    } else {
      await addDoc(itemsCol, { name, qty, cat, note, addedBy: me, createdAt: Date.now(), done: false, doneAt: 0, doneBy: "" });
    }
    await setDoc(doc(histCol, histKey(name)), { name, cat, count: increment(1), lastAt: Date.now() }, { merge: true });
  } catch (e) { onErr(e); }
}
async function toggle(i){
  try { await updateDoc(doc(itemsCol, i.id), i.done ? { done:false, doneAt:0, doneBy:"" } : { done:true, doneAt:Date.now(), doneBy:me }); }
  catch (e) { onErr(e); }
}
async function togglePin(name, cat){
  const h = history.get(histKey(name));
  try { await setDoc(doc(histCol, histKey(name)), { name, cat: h?.cat || cat, pinned: !(h && h.pinned) }, { merge: true }); }
  catch (e) { onErr(e); }
}

// ---------- add form ----------
$("addForm").addEventListener("submit", e => {
  e.preventDefault();
  const q = Math.max(1, Math.min(99, parseInt($("itemQty").value, 10) || 1));
  addItem($("itemName").value, q, $("itemCat").value, $("itemNote").value);
  $("itemName").value = ""; $("itemQty").value = 1; $("itemNote").value = ""; $("itemName").focus();
});
$("itemName").addEventListener("input", () => {
  const h = history.get(histKey($("itemName").value));
  if (h && CATS.includes(h.cat)) $("itemCat").value = h.cat;
});
function fillDatalist(){
  const dl = $("historyList"); dl.textContent = "";
  [...history.values()].sort((a,b)=>(b.count||0)-(a.count||0)).slice(0,200).forEach(h => { const o=document.createElement("option"); o.value=h.name; dl.appendChild(o); });
}

// ---------- render ----------
function render(){
  const open = items.filter(i => !i.done), done = items.filter(i => i.done);
  $("count").textContent = items.length ? `${open.length} פריטים לקנות${done.length ? ` · ${done.length} בעגלה` : ""}` : "הרשימה ריקה";
  const lists = $("lists"); lists.textContent = "";
  if (!open.length) {
    const e = document.createElement("div"); e.className = "empty";
    const s = document.createElement("strong");
    s.textContent = items.length ? "הכול בעגלה" : "עדיין אין פריטים";
    e.append(s, document.createTextNode(items.length ? "אין מה לקנות עוד." : "הקלידו מוצר למעלה או לחצו על מוצר קבוע."));
    lists.appendChild(e);
  }
  CATS.forEach(cat => {
    const group = open.filter(i => (CATS.includes(i.cat) ? i.cat : "אחר") === cat).sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
    if (!group.length) return;
    const sec = document.createElement("div"); sec.className = "group";
    const h = document.createElement("h2"); h.textContent = `${cat} (${group.length})`;
    const ul = document.createElement("ul"); ul.className = "items";
    group.forEach(i => ul.appendChild(row(i)));
    sec.append(h, ul); lists.appendChild(sec);
  });
  $("cartSec").hidden = !done.length;
  $("cartTitle").textContent = `בעגלה (${done.length})`;
  const cl = $("cartList"); cl.textContent = "";
  done.sort((a,b) => (b.doneAt||0) - (a.doneAt||0)).forEach(i => cl.appendChild(row(i)));
}
function row(i){
  const li = document.createElement("li"); if (i.done) li.className = "done";
  const c = document.createElement("button"); c.className = "check"; c.type = "button";
  c.setAttribute("aria-label", i.done ? `החזרה לרשימה: ${i.name}` : `סימון כנקנה: ${i.name}`);
  c.onclick = () => toggle(i);
  const b = document.createElement("button"); b.type = "button"; b.className = "body"; b.onclick = () => openEdit(i);
  const n = document.createElement("span"); n.className = "name"; n.textContent = i.name; b.appendChild(n);
  if (i.note) { const t = document.createElement("span"); t.className = "note"; t.textContent = i.note; b.appendChild(t); }
  const m = document.createElement("span"); m.className = "meta";
  m.textContent = i.done && i.doneBy ? `נקנה ע״י ${i.doneBy}` : (i.addedBy ? `נוסף ע״י ${i.addedBy}` : "");
  if (m.textContent) b.appendChild(m);
  li.append(c, b);
  if ((i.qty || 1) > 1) { const q = document.createElement("span"); q.className = "qty"; q.textContent = "× " + i.qty; li.appendChild(q); }
  const pinned = history.get(histKey(i.name))?.pinned;
  const s = document.createElement("button"); s.type = "button"; s.className = "star" + (pinned ? " on" : "");
  s.textContent = "★"; s.setAttribute("aria-label", pinned ? `הסרה מהקבועים: ${i.name}` : `הוספה לקבועים: ${i.name}`);
  s.onclick = () => togglePin(i.name, i.cat);
  li.appendChild(s);
  return li;
}
function renderChips(){
  const box = $("chips"); box.textContent = "";
  const openNames = new Set(items.filter(i => !i.done).map(i => i.name));
  const all = [...history.values()];
  const pinned = all.filter(h => h.pinned).sort((a,b) => a.name.localeCompare(b.name, "he"));
  const frequent = all.filter(h => !h.pinned && (h.count||0) > 0).sort((a,b) => (b.count||0) - (a.count||0)).slice(0, 12);
  let list = [...pinned, ...frequent].filter(h => !openNames.has(h.name));
  if (!all.length) list = STARTERS.map(([name,cat]) => ({ name, cat })).filter(h => !openNames.has(h.name));
  list.forEach(h => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip" + (h.pinned ? " pinned" : "");
    b.textContent = h.name; b.onclick = () => addItem(h.name, 1, CATS.includes(h.cat) ? h.cat : "אחר", "");
    box.appendChild(b);
  });
  $("staplesBox").hidden = !list.length;
  const missing = pinned.filter(h => !openNames.has(h.name));
  $("addAllStaples").hidden = missing.length < 2;
  $("addAllStaples").onclick = async () => { for (const h of missing) await addItem(h.name, 1, CATS.includes(h.cat) ? h.cat : "אחר", ""); };
}

// ---------- edit sheet ----------
function openEdit(i){
  editing = i;
  $("editName").value = i.name; $("editQty").value = i.qty || 1; $("editCat").value = CATS.includes(i.cat) ? i.cat : "אחר"; $("editNote").value = i.note || "";
  const when = i.createdAt ? new Date(i.createdAt).toLocaleDateString("he-IL", { day:"numeric", month:"numeric" }) : "";
  $("editMeta").textContent = i.addedBy ? `נוסף ע״י ${i.addedBy}${when ? " ב-" + when : ""}` : "";
  $("editDelete").textContent = "מחיקה";
  $("editBg").hidden = false;
}
function closeEdit(){ $("editBg").hidden = true; editing = null; }
$("editCancel").onclick = closeEdit;
$("editBg").addEventListener("click", e => { if (e.target === $("editBg")) closeEdit(); });
$("editForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!editing) return;
  const ch = { name: $("editName").value.trim() || editing.name, qty: Math.max(1, Math.min(99, parseInt($("editQty").value,10) || 1)), cat: $("editCat").value, note: $("editNote").value.trim() };
  const id = editing.id; closeEdit();
  try { await updateDoc(doc(itemsCol, id), ch); await setDoc(doc(histCol, histKey(ch.name)), { name: ch.name, cat: ch.cat }, { merge: true }); } catch (err) { onErr(err); }
});
$("editDelete").onclick = async () => {
  const b = $("editDelete");
  if (b.textContent !== "בטוח?") { b.textContent = "בטוח?"; return; }
  const id = editing.id; closeEdit();
  try { await deleteDoc(doc(itemsCol, id)); } catch (err) { onErr(err); }
};

// ---------- clear purchased ----------
const clearBtnEl = $("clearBtn");
clearBtnEl.onclick = () => {
  const a = $("clearArea"); a.textContent = "";
  const w = document.createElement("div"); w.className = "confirm";
  const t = document.createElement("span"); t.textContent = "למחוק את מה שבעגלה?";
  const y = document.createElement("button"); y.className = "btn danger small"; y.type = "button"; y.textContent = "מחיקה";
  const n = document.createElement("button"); n.className = "btn ghost small"; n.type = "button"; n.textContent = "ביטול";
  const restore = () => { a.textContent = ""; a.appendChild(clearBtnEl); };
  y.onclick = async () => {
    restore();
    const done = items.filter(i => i.done);
    try {
      for (let k = 0; k < done.length; k += 400) {
        const batch = writeBatch(fs);
        done.slice(k, k + 400).forEach(i => batch.delete(doc(itemsCol, i.id)));
        await batch.commit();
      }
    } catch (err) { onErr(err); }
  };
  n.onclick = restore;
  w.append(t, y, n); a.appendChild(w);
};

// ---------- settings ----------
$("settingsBtn").onclick = () => { $("shareLink").value = shareUrl(); $("myName").value = me; $("setMsg").textContent = ""; $("leaveFamily").textContent = "יציאה מהרשימה"; $("setBg").hidden = false; };
$("setClose").onclick = () => { $("setBg").hidden = true; };
$("setBg").addEventListener("click", e => { if (e.target === $("setBg")) $("setBg").hidden = true; });
$("copyLink").onclick = async () => {
  const url = shareUrl();
  if (navigator.share) { try { await navigator.share({ title: "הקניות שלנו", text: "הצטרפו לרשימת הקניות של המשפחה:", url }); return; } catch (e) { if (e.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(url); $("setMsg").textContent = "הקישור הועתק. שלחו אותו לבני המשפחה."; }
  catch { $("shareLink").select(); $("setMsg").textContent = "סמנו והעתיקו את הקישור."; }
};
$("saveName").onclick = () => { const v = $("myName").value.trim().slice(0,20); if (!v) return; me = v; ls.set(LS_NAME, me); $("setMsg").textContent = "השם נשמר."; };
$("leaveFamily").onclick = () => {
  const b = $("leaveFamily");
  if (b.textContent !== "לחצו שוב לאישור") { b.textContent = "לחצו שוב לאישור"; return; }
  ls.del(LS_FAMILY); const u = new URL(location.href); u.search = ""; location.replace(u.toString());
};

// ---------- boot ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
if (me && family) { ls.set(LS_FAMILY, family); start(); } else showSetup();
