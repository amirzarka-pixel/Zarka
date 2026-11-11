// Cloud Run function: runs when a new item is created in families/{family}/items/{item}
// and sends a push notification to every other phone in that family.
const functions = require("@google-cloud/functions-framework");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();
const DEAD = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

functions.cloudEvent("notifyNewItem", async (event) => {
  // event.subject looks like "documents/families/<family>/items/<item>"
  const m = /families\/([^/]+)\/items\/([^/]+)$/.exec(event.subject || "");
  if (!m) { console.log("unexpected subject", event.subject); return; }
  const [, family, itemId] = m;

  const snap = await db.doc(`families/${family}/items/${itemId}`).get();
  if (!snap.exists) return;
  const item = snap.data();
  if (item.done) return;

  const tokens = await db.collection(`families/${family}/tokens`).get();
  const targets = tokens.docs.filter(d => d.id !== item.addedByDevice && d.get("token"));
  if (!targets.length) return;

  const qty = item.qty > 1 ? ` × ${item.qty}` : "";
  const note = item.note ? ` (${item.note})` : "";
  const who = item.addedBy ? `${item.addedBy} הוסיף/ה` : "נוסף";
  const appUrl = targets[0].get("appUrl") || "";
  const res = await getMessaging().sendEachForMulticast({
    tokens: targets.map(d => d.get("token")),
    data: {
      title: "הקניות שלנו",
      body: `${who}: ${item.name}${qty}${note}`,
      family,
      url: appUrl ? `${appUrl}?family=${family}` : "./"
    },
    webpush: { headers: { Urgency: "high", TTL: "86400" } }
  });

  // Remove tokens of phones that uninstalled the app or turned notifications off.
  await Promise.all(res.responses.map((r, i) =>
    !r.success && r.error && DEAD.has(r.error.code) ? targets[i].ref.delete() : null));
  console.log(`family ${family}: sent ${res.successCount}, failed ${res.failureCount}`);
});
