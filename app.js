import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot, increment, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, vapidKey } from "./firebase-config.js";
const MESSAGING_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

// ---------- constants ----------
const CATS = ["ירקות ופירות","מוצרי חלב וביצים","לחם ומאפים","בשר ודגים","מזווה ושימורים","קפואים","שתייה","חטיפים ומתוקים","ניקיון וטואלטיקה","תחזוקת בית","אחר"];
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
let fs = null, itemsCol = null, histCol = null, boughtCol = null;
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
  boughtCol = collection(fs, "families", family, "bought");
  onSnapshot(itemsCol, snap => {
    items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render(); renderChips();
    if (!snap.metadata.fromCache) { onlineStatus(); archiveOld(); }
    if (!$("exportBg").hidden) renderExport();
  }, err => { console.error(err); setStatus("אין גישה לרשימה. בדקו את כללי האבטחה ב-Firebase.", true); });
  onSnapshot(histCol, snap => {
    history = new Map(snap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
    render(); renderChips(); fillDatalist();
  }, err => console.error(err));
  onSnapshot(boughtCol, snap => {
    bought = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!snap.metadata.fromCache) purgeOldBought();
    if (!$("boughtBg").hidden) renderBought();
  }, err => console.error(err));
}

// ---------- bought history ----------
// Items stay in "בעגלה" for a day after they were bought, then move to families/<code>/bought.
// Any family phone that opens the app does the move; doing it twice is harmless.
const ARCHIVE_AFTER = 24 * 3600 * 1000, KEEP_BOUGHT = 60 * 24 * 3600 * 1000;
let bought = [], lastArchive = 0, lastPurge = 0;
const returned = new Set(); // bought items put back on the list during this visit
function boughtRecord(data){
  // The photo stays in the product's history (it comes back when the item is re-added),
  // so the bought list stays small.
  const { photo, ...rest } = data;
  return { ...rest, doneAt: data.doneAt || Date.now(), archivedAt: Date.now() };
}
function moveToBought(list){
  const recs = list.map(({ id, ...data }) => ({ id, data, rec: boughtRecord(data) }));
  for (let k = 0; k < recs.length; k += 200) {
    const b = writeBatch(fs);
    recs.slice(k, k + 200).forEach(r => { b.set(doc(boughtCol, r.id), r.rec); b.delete(doc(itemsCol, r.id)); });
    fire(b.commit());
  }
  return recs;
}
function archiveOld(){
  if (Date.now() - lastArchive < 60000) return;
  const old = items.filter(i => i.done && i.doneAt && Date.now() - i.doneAt > ARCHIVE_AFTER);
  if (!old.length) return;
  lastArchive = Date.now();
  moveToBought(old);
}
function purgeOldBought(){
  if (Date.now() - lastPurge < 3600000) return;
  const old = bought.filter(b => (b.doneAt || b.archivedAt || 0) < Date.now() - KEEP_BOUGHT);
  if (!old.length) return;
  lastPurge = Date.now();
  for (let k = 0; k < old.length; k += 400) { const b = writeBatch(fs); old.slice(k, k + 400).forEach(o => b.delete(doc(boughtCol, o.id))); fire(b.commit()); }
}
function dayLabel(ms){
  const d = new Date(ms), now = new Date();
  const day0 = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(now) - day0(d)) / 86400000);
  const date = `${d.getDate()}.${d.getMonth() + 1}`;
  if (diff <= 0) return `היום · ${date}`;
  if (diff === 1) return `אתמול · ${date}`;
  return `${d.getDay() === 6 ? "שבת" : "יום " + DAYS[d.getDay()]} · ${date}`;
}
function renderBought(){
  const box = $("boughtList"); box.textContent = "";
  const list = [...bought].sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  $("boughtEmpty").hidden = list.length > 0;
  let curDay = "", ul = null;
  for (const it of list) {
    const label = dayLabel(it.doneAt || it.archivedAt);
    if (label !== curDay) {
      curDay = label;
      const h = document.createElement("h2"); h.textContent = label;
      ul = document.createElement("ul"); ul.className = "items";
      box.append(h, ul);
    }
    const li = document.createElement("li");
    const body = document.createElement("div"); body.className = "body";
    const n = document.createElement("span"); n.className = "name"; n.textContent = it.name + ((it.qty || 1) > 1 ? ` × ${it.qty}` : "");
    body.appendChild(n);
    if (it.note) { const t = document.createElement("span"); t.className = "note"; t.textContent = it.note; body.appendChild(t); }
    const hm = new Date(it.doneAt || it.archivedAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false });
    const m = document.createElement("span"); m.className = "meta"; m.textContent = joinMeta(it.doneBy && `נקנה ע״י ${it.doneBy}`, hm);
    body.appendChild(m);
    const back = document.createElement("button"); back.type = "button"; back.className = "btn ghost small";
    const setDone = () => { back.textContent = "נוסף ✓"; back.disabled = true; };
    back.textContent = "החזרה לרשימה";
    if (returned.has(it.id)) setDone();
    back.onclick = async () => {
      returned.add(it.id);
      const ok = await addItem(it.name, it.qty || 1, CATS.includes(it.cat) ? it.cat : "אחר", it.note || "");
      if (ok) { setDone(); if (!$("boughtBg").hidden) renderBought(); } else returned.delete(it.id);
    };
    li.append(body, back); ul.appendChild(li);
  }
}
$("boughtBtn").onclick = () => { hideUndo(); renderBought(); $("boughtBg").hidden = false; };
$("boughtClose").onclick = () => { $("boughtBg").hidden = true; };
$("boughtBg").addEventListener("click", e => { if (e.target === $("boughtBg")) $("boughtBg").hidden = true; });

// ---------- shopping list export ----------
function openGroups(){
  const open = items.filter(i => !i.done);
  return CATS.map(cat => ({ cat, list: open.filter(i => (CATS.includes(i.cat) ? i.cat : "אחר") === cat).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) }))
    .filter(g => g.list.length);
}
function todayTitle(){
  const d = new Date();
  return `${d.getDay() === 6 ? "שבת" : "יום " + DAYS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}`;
}
function exportText(){
  const groups = openGroups();
  const total = groups.reduce((s, g) => s + g.list.length, 0);
  if (!total) return "";
  const lines = [`🛒 רשימת קניות – ${todayTitle()}`, ""];
  for (const g of groups) {
    lines.push(`*${g.cat}*`);
    for (const i of g.list) lines.push(`▫️ ${i.name}${(i.qty || 1) > 1 ? ` × ${i.qty}` : ""}${i.note ? ` (${i.note})` : ""}`);
    lines.push("");
  }
  lines.push(`סה״כ ${total} פריטים`);
  return lines.join("\n");
}
function renderExport(){
  const txt = exportText();
  // Preview: WhatsApp's *bold* markers shown as real bold, one line per row.
  const box = $("exportText"); box.textContent = "";
  for (const line of (txt || "אין כרגע מוצרים לקנות.").split("\n")) {
    const row = document.createElement("div"); row.dir = "rtl";
    const m = /^\*(.+)\*$/.exec(line);
    if (m) { const b = document.createElement("strong"); b.textContent = m[1]; row.appendChild(b); }
    else row.textContent = line || "\u00a0";
    box.appendChild(row);
  }
  for (const id of ["exportWa", "exportShare", "exportCopy", "exportPdf"]) $(id).disabled = !txt;
  $("exportShare").hidden = !navigator.share;
  $("exportMsg").textContent = "";
}
$("exportBtn").onclick = () => { hideUndo(); renderExport(); $("exportBg").hidden = false; };
$("exportClose").onclick = () => { $("exportBg").hidden = true; };
$("exportBg").addEventListener("click", e => { if (e.target === $("exportBg")) $("exportBg").hidden = true; });
$("exportWa").onclick = () => {
  const url = "https://wa.me/?text=" + encodeURIComponent(exportText());
  const w = window.open(url, "_blank");
  if (!w) location.href = url;
};
$("exportShare").onclick = async () => { try { await navigator.share({ title: "רשימת קניות", text: exportText() }); } catch {} };
$("exportCopy").onclick = async () => {
  try { await navigator.clipboard.writeText(exportText()); $("exportMsg").textContent = "הרשימה הועתקה. אפשר להדביק אותה בכל מקום."; }
  catch {
    const r = document.createRange(); r.selectNodeContents($("exportText")); // fallback: select the preview
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    $("exportMsg").textContent = "סמנו והעתיקו את הטקסט.";
  }
};
// PDF: a print-styled page; the phone's print dialog offers "Save as PDF".
$("exportPdf").onclick = () => {
  const pv = $("printView"); pv.textContent = "";
  const groups = openGroups();
  const h = document.createElement("h1"); h.textContent = `רשימת קניות – ${todayTitle()}`;
  const sub = document.createElement("p"); sub.className = "print-sub"; sub.textContent = `${groups.reduce((s, g) => s + g.list.length, 0)} פריטים`;
  pv.append(h, sub);
  for (const g of groups) {
    const gh = document.createElement("h2"); gh.textContent = g.cat;
    const ul = document.createElement("ul");
    for (const i of g.list) {
      const li = document.createElement("li");
      const box = document.createElement("span"); box.className = "print-box";
      li.appendChild(box);
      if (i.photo) { const im = document.createElement("img"); im.src = i.photo; im.alt = ""; li.appendChild(im); }
      const t = document.createElement("span"); t.className = "print-name";
      t.textContent = i.name + ((i.qty || 1) > 1 ? ` × ${i.qty}` : "");
      li.appendChild(t);
      if (i.note) { const nt = document.createElement("span"); nt.className = "print-note"; nt.textContent = i.note; li.appendChild(nt); }
      ul.appendChild(li);
    }
    pv.append(gh, ul);
  }
  $("exportBg").hidden = true;
  document.body.classList.add("printing");
  const done = () => { document.body.classList.remove("printing"); removeEventListener("afterprint", done); };
  addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(done, 1000); }, 300);
};

// ---------- actions ----------
// Returns true when something was added or merged, false when the person cancelled.
async function addItem(name, qty, cat, note, photo, opts = {}){
  name = name.trim(); note = (note || "").trim();
  if (!name || !itemsCol) return false;
  // A new photo wins; otherwise reuse the photo this product had last time.
  const usePhoto = photo || history.get(histKey(name))?.photo || "";
  let existing = null;
  if (!opts.separate) {
    const match = findSimilar(name);
    if (match) {
      const choice = await askDuplicate(match, name, qty);
      if (choice === "cancel") return false;
      if (choice === "merge") {
        existing = match;
        // "חלב 3%" merged into "חלב": keep the extra detail as a note
        if (name !== match.name && !note) note = name;
      }
    }
  }
  if (existing) {
    const before = { qty: existing.qty || 1, note: existing.note || "", photo: existing.photo || "" };
    const ch = { qty: Math.min(99, before.qty + qty) };
    if (note && note !== before.note) ch.note = before.note ? before.note + " · " + note : note;
    if (photo) ch.photo = photo;
    const ref = doc(itemsCol, existing.id);
    fire(updateDoc(ref, ch));
    showUndo(`עודכנה הכמות: ${name}`, () => updateDoc(ref, before));
  } else {
    const ref = doc(itemsCol); // new id, so the add can be undone right away, even offline
    fire(setDoc(ref, { name, qty, cat, note, photo: usePhoto, addedBy: me, addedByDevice: deviceId, createdAt: Date.now(), done: false, doneAt: 0, doneBy: "" }));
    showUndo(`נוסף: ${name}`, () => deleteDoc(ref));
  }
  const h = { name, cat, count: increment(1), lastAt: Date.now() };
  if (photo) h.photo = photo;
  fire(setDoc(doc(histCol, histKey(name)), h, { merge: true }));
  return true;
}

// ---------- similar items ----------
// Normalise Hebrew names: no niqqud, final letters as regular, no punctuation,
// and a light stem so "עגבניה" / "עגבניות" and "מלפפון" / "מלפפונים" match.
const FINALS = { "ך":"כ", "ם":"מ", "ן":"נ", "ף":"פ", "ץ":"צ" };
function stem(w){
  if (w.length > 4 && /(ימ|ות)$/.test(w)) return w.slice(0, -2); // after final-letter mapping, "ים" is "ימ"
  if (w.length > 3 && /ה$/.test(w)) return w.slice(0, -1);
  return w;
}
function tokens(s){
  return s.toLowerCase()
    .replace(/[֑-ׇ]/g, "")
    .replace(/[ךםןףץ]/g, c => FINALS[c])
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim().split(/\s+/).filter(Boolean).map(stem);
}
function editDistance(a, b){
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// 3 = same name, 2 = one name contains the other, 1 = small typo, 0 = different
function similarity(a, b){
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const ja = ta.join(" "), jb = tb.join(" ");
  if (ja === jb) return 3;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.join("").length >= 2 && short.every(w => long.includes(w))) return 2;
  const len = Math.min(ja.length, jb.length), d = editDistance(ja, jb);
  if ((len >= 4 && d <= 1) || (len >= 8 && d <= 2)) return 1;
  return 0;
}
function findSimilar(name){
  let best = null, score = 0;
  for (const i of items) {
    if (i.done) continue;
    const s = similarity(name, i.name);
    if (s > score) { best = i; score = s; }
  }
  return best;
}
let dupResolve = null;
function askDuplicate(match, name, qty){
  hideUndo();
  const same = match.name.trim() === name;
  $("dupTitle").textContent = same ? `"${match.name}" כבר ברשימה` : `מוצר דומה כבר ברשימה: "${match.name}"`;
  $("dupNew").textContent = same ? "" : `ביקשת להוסיף: "${name}"`;
  $("dupNew").hidden = same;
  $("dupInfo").textContent = joinMeta((match.qty || 1) > 1 ? `× ${match.qty}` : "", match.note, match.addedBy && `נוסף ע״י ${match.addedBy}`, whenText(match.createdAt));
  $("dupMerge").textContent = `הגדלת הכמות ל־${Math.min(99, (match.qty || 1) + qty)}`;
  $("dupBg").hidden = false;
  $("dupMerge").focus();
  return new Promise(res => { dupResolve = res; });
}
function closeDup(choice){ $("dupBg").hidden = true; const r = dupResolve; dupResolve = null; if (r) r(choice); }
$("dupMerge").onclick = () => closeDup("merge");
$("dupSeparate").onclick = () => closeDup("separate");
$("dupCancel").onclick = () => closeDup("cancel");
$("dupBg").addEventListener("click", e => { if (e.target === $("dupBg")) closeDup("cancel"); });

// ---------- photos ----------
// Photos are shrunk on the phone (longest side 640px, JPEG) and stored with the item,
// so no extra storage service is needed. A product keeps its photo for next time.
function loadImage(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}
async function compressImage(file){
  const img = await loadImage(file);
  let max = 640, q = 0.72, out = "";
  for (let k = 0; k < 5; k++) {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL("image/jpeg", q);
    if (out.length < 180000) break;   // keep each photo well under Firestore's 1MB document limit
    max = Math.round(max * 0.8); q = Math.max(0.5, q - 0.08);
  }
  return out;
}
async function pickPhoto(input){
  const f = input.files && input.files[0];
  input.value = "";
  if (!f) return null;
  try { return await compressImage(f); }
  catch { setStatus("לא הצלחנו לקרוא את התמונה. נסו תמונה אחרת.", true); return null; }
}
let addPhoto = "";
function showAddPhoto(){ $("addPhotoBox").hidden = !addPhoto; if (addPhoto) $("addPhotoImg").src = addPhoto; }
for (const id of ["itemPhoto", "itemCamera"]) $(id).addEventListener("change", async () => { const p = await pickPhoto($(id)); if (p) { addPhoto = p; showAddPhoto(); } });
$("addPhotoRemove").onclick = () => { addPhoto = ""; showAddPhoto(); };
function openViewer(src, caption){ $("viewerImg").src = src; $("viewerImg").alt = caption; $("viewerCap").textContent = caption; $("viewer").hidden = false; }
$("viewer").onclick = () => { $("viewer").hidden = true; $("viewerImg").removeAttribute("src"); };
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
$("addForm").addEventListener("submit", async e => {
  e.preventDefault();
  const q = Math.max(1, Math.min(99, parseInt($("itemQty").value, 10) || 1));
  // Keep what was typed if the person cancels in the "already on the list" dialog.
  const added = await addItem($("itemName").value, q, $("itemCat").value, $("itemNote").value, addPhoto);
  if (!added) { $("itemName").focus(); return; }
  $("itemName").value = ""; $("itemQty").value = 1; $("itemNote").value = ""; addPhoto = ""; showAddPhoto(); $("itemName").focus();
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
// "היום 21:30", "אתמול 18:05", "יום ג׳ 09:12" (this week), "10.11 09:12" (older)
const DAYS = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","שבת"];
function whenText(ms){
  if (!ms) return "";
  const d = new Date(ms), now = new Date();
  const hm = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false });
  const day0 = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(now) - day0(d)) / 86400000);
  if (diff <= 0) return `היום ${hm}`;
  if (diff === 1) return `אתמול ${hm}`;
  if (diff < 7) return `${d.getDay() === 6 ? "שבת" : "יום " + DAYS[d.getDay()]} ${hm}`;
  return `${d.getDate()}.${d.getMonth() + 1}${d.getFullYear() !== now.getFullYear() ? "." + String(d.getFullYear()).slice(2) : ""} ${hm}`;
}
const joinMeta = (...parts) => parts.filter(Boolean).join(" · ");

function row(i){
  const li = document.createElement("li"); if (i.done) li.className = "done";
  const c = document.createElement("button"); c.className = "check"; c.type = "button";
  c.setAttribute("aria-label", i.done ? `החזרה לרשימה: ${i.name}` : `סימון כנקנה: ${i.name}`);
  c.onclick = () => toggle(i);
  const b = document.createElement("button"); b.type = "button"; b.className = "body"; b.onclick = () => openEdit(i);
  const n = document.createElement("span"); n.className = "name"; n.textContent = i.name; b.appendChild(n);
  if (i.note) { const t = document.createElement("span"); t.className = "note"; t.textContent = i.note; b.appendChild(t); }
  const m = document.createElement("span"); m.className = "meta";
  m.textContent = i.done
    ? joinMeta(i.doneBy && `נקנה ע״י ${i.doneBy}`, whenText(i.doneAt))
    : joinMeta(i.addedBy && `נוסף ע״י ${i.addedBy}`, whenText(i.createdAt));
  if (m.textContent) b.appendChild(m);
  li.appendChild(c);
  if (i.photo) {
    const t = document.createElement("button"); t.type = "button"; t.className = "thumb";
    t.setAttribute("aria-label", `הגדלת התמונה: ${i.name}`);
    const im = document.createElement("img"); im.src = i.photo; im.alt = ""; im.loading = "lazy";
    t.appendChild(im); t.onclick = () => openViewer(i.photo, i.name);
    li.appendChild(t);
  }
  li.appendChild(b);
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
  // Staples already on the list (same or similar name) are skipped, not asked about.
  $("addAllStaples").onclick = async () => {
    for (const h of missing) if (!findSimilar(h.name)) await addItem(h.name, 1, CATS.includes(h.cat) ? h.cat : "אחר", "", "", { separate: true });
  };
}

// ---------- edit sheet ----------
function openEdit(i){
  hideUndo();
  editing = i;
  $("editName").value = i.name; $("editQty").value = i.qty || 1; $("editCat").value = CATS.includes(i.cat) ? i.cat : "אחר"; $("editNote").value = i.note || "";
  const added = joinMeta(i.addedBy && `נוסף ע״י ${i.addedBy}`, whenText(i.createdAt));
  const bought = i.done ? joinMeta(i.doneBy && `נקנה ע״י ${i.doneBy}`, whenText(i.doneAt)) : "";
  $("editMeta").textContent = [added, bought].filter(Boolean).join("\n");
  editPhoto = undefined; showEditPhoto(i.photo || "");
  $("editBg").hidden = false;
}
let editPhoto; // undefined = unchanged, "" = removed, data URL = new photo
function showEditPhoto(src){
  $("editPhotoImg").hidden = !src; if (src) $("editPhotoImg").src = src;
  $("editPhotoRemove").hidden = !src;
}
for (const id of ["editPhoto", "editCamera"]) $(id).addEventListener("change", async () => { const p = await pickPhoto($(id)); if (p) { editPhoto = p; showEditPhoto(p); } });
$("editPhotoRemove").onclick = () => { editPhoto = ""; showEditPhoto(""); };
$("editPhotoImg").onclick = () => openViewer($("editPhotoImg").src, $("editName").value);
function closeEdit(){ $("editBg").hidden = true; editing = null; }
$("editCancel").onclick = closeEdit;
$("editBg").addEventListener("click", e => { if (e.target === $("editBg")) closeEdit(); });
$("editForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!editing) return;
  const ch = { name: $("editName").value.trim() || editing.name, qty: Math.max(1, Math.min(99, parseInt($("editQty").value,10) || 1)), cat: $("editCat").value, note: $("editNote").value.trim() };
  const before = { name: editing.name, qty: editing.qty || 1, cat: editing.cat || "אחר", note: editing.note || "", photo: editing.photo || "" };
  const h = { name: ch.name, cat: ch.cat };
  if (editPhoto !== undefined) { ch.photo = editPhoto; h.photo = editPhoto; }
  const hRef = doc(histCol, histKey(ch.name));
  const hBefore = { photo: history.get(histKey(ch.name))?.photo || "" };
  const ref = doc(itemsCol, editing.id); closeEdit();
  fire(updateDoc(ref, ch));
  fire(setDoc(hRef, h, { merge: true }));
  showUndo(`נשמרו השינויים: ${ch.name}`, () => Promise.all([
    updateDoc(ref, before),
    "photo" in h ? setDoc(hRef, hBefore, { merge: true }) : null
  ]));
});
$("editDelete").onclick = () => {
  const { id, ...data } = editing;
  const ref = doc(itemsCol, id); closeEdit();
  fire(deleteDoc(ref));
  showUndo(`נמחק: ${data.name}`, () => setDoc(ref, data));
};

// ---------- clear purchased ----------
const clearBtnEl = $("clearBtn");
// Moves everything in the cart to "נקנו לאחרונה" right away (otherwise it happens after a day).
clearBtnEl.onclick = () => {
  const recs = moveToBought(items.filter(i => i.done));
  if (!recs.length) return;
  showUndo(recs.length === 1 ? `"${recs[0].data.name}" הועבר ל"נקנו לאחרונה"` : `${recs.length} פריטים הועברו ל"נקנו לאחרונה"`, () => {
    for (let k = 0; k < recs.length; k += 200) {
      const b = writeBatch(fs);
      recs.slice(k, k + 200).forEach(r => { b.set(doc(itemsCol, r.id), r.data); b.delete(doc(boughtCol, r.id)); });
      fire(b.commit());
    }
  });
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
