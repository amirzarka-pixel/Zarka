import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot, increment, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, vapidKey } from "./firebase-config.js";
const MESSAGING_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

// ---------- constants ----------
const CATS = ["ירקות ופירות","מוצרי חלב וביצים","לחם ומאפים","בשר ודגים","מזווה ושימורים","קפואים","שתייה","חטיפים ומתוקים","ניקיון וטואלטיקה","תינוקות","אחר"];
const STARTERS = [["חלב","מוצרי חלב וביצים"],["ביצים","מוצרי חלב וביצים"],["לחם","לחם ומאפים"],["עגבניות","ירקות ופירות"],["מלפפונים","ירקות ופירות"],["בננות","ירקות ופירות"],["גבינה לבנה","מוצרי חלב וביצים"],["פסטה","מזווה ושימורים"],["אורז","מזווה ושימורים"],["חזה עוף","בשר ודגים"],["נייר טואלט","ניקיון וטואלטיקה"]];
const LS_NAME = "kniyot-name", LS_FAMILY = "kniyot-family", LS_DEVICE = "kniyot-device", LS_NOTIF_DISMISSED = "kniyot-notif-dismissed";

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
let firebaseApp = null;
// A stable id for this phone, so notifications skip the person who added the item.
let deviceId = ls.get(LS_DEVICE);
if (!deviceId) { deviceId = randomCode(); ls.set(LS_DEVICE, deviceId); }

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
  const app = firebaseApp = initializeApp(firebaseConfig);
  fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  const auth = getAuth(app);
  onAuthStateChanged(auth, user => { if (user) subscribe(); });
  try { await signInAnonymously(auth); }
  catch (e) { console.error(e); setStatus("לא הצלחנו להתחבר. ודאו שהכניסה האנונימית מופעלת ב-Firebase.", true); }
}

let subscribed = false;
function subscribe(){
  if (subscribed) return; subscribed = true;
  setupNotifications();
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
  if (existing) {
    const before = { qty: existing.qty || 1, note: existing.note || "" };
    const ch = { qty: Math.min(99, before.qty + qty) };
    if (note && note !== before.note) ch.note = before.note ? before.note + " · " + note : note;
    const ref = doc(itemsCol, existing.id);
    fire(updateDoc(ref, ch));
    showUndo(`עודכנה הכמות: ${name}`, () => updateDoc(ref, before));
  } else {
    const ref = doc(itemsCol); // new id, so the add can be undone right away, even offline
    fire(setDoc(ref, { name, qty, cat, note, addedBy: me, addedByDevice: deviceId, createdAt: Date.now(), done: false, doneAt: 0, doneBy: "" }));
    showUndo(`נוסף: ${name}`, () => deleteDoc(ref));
  }
  fire(setDoc(doc(histCol, histKey(name)), { name, cat, count: increment(1), lastAt: Date.now() }, { merge: true }));
}
function toggle(i){
  const ref = doc(itemsCol, i.id);
  const before = { done: !!i.done, doneAt: i.doneAt || 0, doneBy: i.doneBy || "" };
  fire(updateDoc(ref, i.done ? { done:false, doneAt:0, doneBy:"" } : { done:true, doneAt:Date.now(), doneBy:me }));
  showUndo(i.done ? `הוחזר לרשימה: ${i.name}` : `סומן כנקנה: ${i.name}`, () => updateDoc(ref, before));
}

// ---------- undo ----------
// Writes are fired without waiting: offline, Firestore only resolves once the server answers.
function fire(p){ return Promise.resolve(p).catch(onErr); }
let undoFn = null, undoTimer = 0;
function showUndo(text, fn){
  undoFn = fn;
  $("toastText").textContent = text;
  $("toast").hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, 7000);
}
function hideUndo(){ $("toast").hidden = true; undoFn = null; clearTimeout(undoTimer); }
$("toastUndo").onclick = () => { const fn = undoFn; hideUndo(); if (fn) fire(fn()); };
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
  $("editBg").hidden = false;
}
function closeEdit(){ $("editBg").hidden = true; editing = null; }
$("editCancel").onclick = closeEdit;
$("editBg").addEventListener("click", e => { if (e.target === $("editBg")) closeEdit(); });
$("editForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!editing) return;
  const ch = { name: $("editName").value.trim() || editing.name, qty: Math.max(1, Math.min(99, parseInt($("editQty").value,10) || 1)), cat: $("editCat").value, note: $("editNote").value.trim() };
  const before = { name: editing.name, qty: editing.qty || 1, cat: editing.cat || "אחר", note: editing.note || "" };
  const ref = doc(itemsCol, editing.id); closeEdit();
  fire(updateDoc(ref, ch));
  fire(setDoc(doc(histCol, histKey(ch.name)), { name: ch.name, cat: ch.cat }, { merge: true }));
  showUndo(`נשמרו השינויים: ${ch.name}`, () => updateDoc(ref, before));
});
$("editDelete").onclick = () => {
  const { id, ...data } = editing;
  const ref = doc(itemsCol, id); closeEdit();
  fire(deleteDoc(ref));
  showUndo(`נמחק: ${data.name}`, () => setDoc(ref, data));
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
  y.onclick = () => {
    restore();
    const done = items.filter(i => i.done).map(({ id, ...data }) => ({ id, data }));
    const inBatches = op => { for (let k = 0; k < done.length; k += 400) { const b = writeBatch(fs); done.slice(k, k + 400).forEach(d => op(b, d)); fire(b.commit()); } };
    inBatches((b, d) => b.delete(doc(itemsCol, d.id)));
    showUndo(`נמחקו ${done.length} פריטים מהעגלה`, () => inBatches((b, d) => b.set(doc(itemsCol, d.id), d.data)));
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

// ---------- notifications ----------
// Each phone that turns notifications on saves its push token under families/<code>/tokens/<deviceId>.
// A small Cloud Function sends a push to every other phone when an item is created.
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let messagingMod = null, messaging = null;

async function messagingReady(){
  if (messaging) return messaging;
  if (!vapidKey || !firebaseApp || !("Notification" in window) || !("serviceWorker" in navigator)) return null;
  try {
    messagingMod = await import(MESSAGING_URL);
    if (!(await messagingMod.isSupported())) return null;
    messaging = messagingMod.getMessaging(firebaseApp);
    return messaging;
  } catch (e) { console.error(e); return null; }
}
async function saveToken(){
  const msg = await messagingReady(); if (!msg) return false;
  const reg = await navigator.serviceWorker.ready;
  const token = await messagingMod.getToken(msg, { vapidKey, serviceWorkerRegistration: reg });
  if (!token) return false;
  const appUrl = location.origin + location.pathname;
  await setDoc(doc(fs, "families", family, "tokens", deviceId), { token, name: me, deviceId, appUrl, updatedAt: Date.now() });
  return true;
}
function notifState(){
  if (!vapidKey) return "off-feature";
  if (!("Notification" in window)) return isIOS && !isStandalone ? "ios-install" : "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}
function renderNotif(){
  const st = notifState();
  const txt = {
    "granted": "ההתראות פעילות בטלפון הזה. תקבלו התראה כשמישהו אחר מוסיף מוצר.",
    "default": "קבלו התראה כשמישהו מוסיף מוצר לרשימה.",
    "denied": "ההתראות חסומות. אפשר לאפשר אותן בהגדרות הדפדפן או הטלפון, תחת הרשאות האתר.",
    "ios-install": "באייפון, התראות עובדות רק אחרי התקנה: בספארי, כפתור השיתוף ואז \"הוספה למסך הבית\". פותחים מהאייקון ומפעילים כאן.",
    "unsupported": "הדפדפן הזה לא תומך בהתראות. נסו בכרום.",
    "off-feature": ""
  }[st] || "";
  $("notifText").textContent = txt;
  $("notifBox").hidden = st === "off-feature";
  $("notifOn").hidden = st !== "default";
  $("notifOff").hidden = st !== "granted";
  const showBanner = st === "default" && !ls.get(LS_NOTIF_DISMISSED);
  $("notifBanner").hidden = !showBanner;
}
async function enableNotifications(){
  try {
    const p = await Notification.requestPermission();
    if (p === "granted") {
      const ok = await saveToken();
      setStatus(ok ? "ההתראות הופעלו בטלפון הזה" : "לא הצלחנו להפעיל התראות. נסו שוב מאוחר יותר.", !ok);
    }
  } catch (e) { console.error(e); setStatus("לא הצלחנו להפעיל התראות. נסו שוב מאוחר יותר.", true); }
  renderNotif();
}
async function disableNotifications(){
  try {
    const msg = await messagingReady();
    if (msg) await messagingMod.deleteToken(msg).catch(() => {});
    await deleteDoc(doc(fs, "families", family, "tokens", deviceId));
    $("notifText").textContent = "ההתראות כובו בטלפון הזה.";
    $("notifOff").hidden = true;
  } catch (e) { onErr(e); }
}
function setupNotifications(){
  renderNotif();
  // Tokens can change; refresh quietly on every start when permission is already granted.
  if (notifState() === "granted") saveToken().catch(e => console.error(e));
}
$("notifOn").onclick = enableNotifications;
$("bannerOn").onclick = enableNotifications;
$("notifOff").onclick = disableNotifications;
$("bannerLater").onclick = () => { ls.set(LS_NOTIF_DISMISSED, "1"); $("notifBanner").hidden = true; };

// ---------- boot ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
if (me && family) { ls.set(LS_FAMILY, family); start(); } else showSetup();
