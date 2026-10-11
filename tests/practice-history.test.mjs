import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, webcrypto } from "node:crypto";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../practice-history.js", import.meta.url), "utf8");
class Storage {
  getItem(key) { return this[key] ?? null; }
  setItem(key, value) { this[key] = String(value); }
  removeItem(key) { delete this[key]; }
}
function device(initial = {}) {
  const localStorage = new Storage();
  for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, JSON.stringify(value));
  const window = { dispatchEvent() {} };
  const context = vm.createContext({ localStorage, window, crypto: { randomUUID, subtle: webcrypto.subtle }, Event: class {}, CustomEvent: class {} });
  vm.runInContext(source, context);
  const history = window.vocalizandoHistory;
  return { history, localStorage, context, window, read: key => JSON.parse(localStorage.getItem(key)) };
}
const day = new Date().toLocaleDateString("sv-SE");
const countKey = `vocalizing-${day}`;
const at = new Date().toISOString();

test("migration preserves historical counts and uses stable identities", () => {
  const data = {
    [countKey]: { tara: 3, iii: 2, manual: { tara: 1, iii: 0 }, metrics: { tara: { accepted: 2, confidenceSum: 1.8 }, iii: { accepted: 2, confidenceSum: 1.7 } } },
    "vocalizing-functional-v1": [{ at, exercise: "voz", prompt: "Hoje eu tenho aula.", score: 73 }],
    [`vocalizing-twisters-${day}`]: { attempts: 1, history: [{ at: Date.now(), score: 80 }] }
  };
  const first = device(data);
  const second = device(data);
  first.history.merge([second.history.snapshot()]);
  assert.equal(first.read(countKey).tara, 3);
  assert.equal(first.read(countKey).metrics.tara.accepted, 2);
  assert.equal(first.read("vocalizing-functional-v1").length, 1);
  assert.equal(first.history.active().length, 7);
});

test("independent new repetitions merge without duplication", () => {
  const left = device();
  const right = device();
  left.history.write(countKey, { tara: 1, iii: 0, lastSource: "manual" });
  right.history.write(countKey, { tara: 1, iii: 0, lastSource: "auto", lastConfidence: 0.9 });
  left.history.merge([right.history.snapshot()]);
  right.history.merge([left.history.snapshot()]);
  left.history.merge([right.history.snapshot()]);
  assert.equal(left.read(countKey).tara, 2);
  assert.equal(right.read(countKey).tara, 2);
  assert.equal(left.read(countKey).manual.tara, 1);
  assert.equal(left.read(countKey).metrics.tara.confidenceSum, 0.9);
});

test("undo survives stale remote snapshots", () => {
  const left = device();
  const right = device();
  left.history.write("vocalizing-functional-v1", [{ at, exercise: "voz", prompt: "Frase", score: null }]);
  right.history.merge([left.history.snapshot()]);
  const stale = right.history.snapshot();
  left.history.write("vocalizing-functional-v1", []);
  left.history.merge([stale]);
  right.history.merge([left.history.snapshot()]);
  assert.equal(left.read("vocalizing-functional-v1").length, 0);
  assert.equal(right.read("vocalizing-functional-v1").length, 0);
});

test("listener ratings and references from both devices are retained", () => {
  const left = device();
  const right = device();
  left.history.write("vocalizing-functional-v1", [{ at, exercise: "voz", prompt: "Frase", score: 80 }]);
  right.history.merge([left.history.snapshot()]);
  const items = right.read("vocalizing-functional-v1");
  items[0].listenerResult = "all";
  right.history.write("vocalizing-functional-v1", items);
  left.history.write("vocalizing-functional-references-v1", { "voz\nFrase": { id: "a", basedOn: at } });
  right.history.write("vocalizing-functional-references-v1", { "vogais\ni-a-u": { id: "b", basedOn: at } });
  left.history.merge([right.history.snapshot()]);
  assert.equal(left.read("vocalizing-functional-v1")[0].listenerResult, "all");
  assert.equal(Object.keys(left.read("vocalizing-functional-references-v1")).length, 2);
  const refs = left.read("vocalizing-functional-references-v1");
  delete refs["voz\nFrase"];
  left.history.write("vocalizing-functional-references-v1", refs);
  right.history.merge([left.history.snapshot()]);
  assert.deepEqual(Object.keys(right.read("vocalizing-functional-references-v1")), ["vogais\ni-a-u"]);
});

test("a saved recording is one attempt and updates its listener result", () => {
  const current = device();
  const clip = { id: "clip-a", kind: "twister", at, prompt: "Frase" };
  current.history.addRecordingAttempt(clip);
  current.history.addRecordingAttempt(clip);
  clip.listenerResult = "all";
  current.history.recordingReview(clip);
  assert.equal(current.history.active().length, 1);
  assert.equal(current.read(`vocalizing-twisters-${day}`).attempts, 1);
  assert.equal(current.history.active()[0].listenerResult, "all");
});

test("independent reviews of the same attempt combine field by field", () => {
  const left = device();
  const right = device();
  left.history.write("vocalizing-functional-v1", [{ at, exercise: "voz", prompt: "Frase", effort: null, listenerResult: "" }]);
  right.history.merge([left.history.snapshot()]);
  const local = left.read("vocalizing-functional-v1");
  local[0].effort = 3;
  left.history.write("vocalizing-functional-v1", local);
  const remote = right.read("vocalizing-functional-v1");
  remote[0].listenerResult = "all";
  right.history.write("vocalizing-functional-v1", remote);
  left.history.merge([right.history.snapshot()]);
  right.history.merge([left.history.snapshot()]);
  assert.equal(left.read("vocalizing-functional-v1")[0].effort, 3);
  assert.equal(left.read("vocalizing-functional-v1")[0].listenerResult, "all");
  assert.equal(right.read("vocalizing-functional-v1")[0].effort, 3);
});

test("invalid cloud data is rejected before changing local history", () => {
  const current = device();
  const before = JSON.stringify(current.history.snapshot());
  assert.throws(() => current.history.merge([{ schema: 2, events: { x: { id: "x", kind: "model", exercise: "unknown", at, updatedAt: 1 } }, documents: {} }]), /inválida/);
  assert.equal(JSON.stringify(current.history.snapshot()), before);
});

test("storage exhaustion restores the previous attempt and snapshot", () => {
  const current = device();
  const before = current.localStorage.getItem("vocalizing-history-v2");
  const original = current.localStorage.setItem;
  current.localStorage.setItem = function (key, value) {
    if (key === "vocalizing-functional-v1" && value.includes("voz")) throw new Error("QuotaExceededError");
    original.call(this, key, value);
  };
  assert.throws(() => current.history.write("vocalizing-functional-v1", [{ at, exercise: "voz", prompt: "Frase" }]), /QuotaExceeded/);
  assert.equal(current.localStorage.getItem("vocalizing-history-v2"), before);
  assert.equal(current.history.active().length, 0);
});

const cloudSource = readFileSync(new URL("../cloud-sync.js", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
async function connect(current, files, { denyHistory = false, configured = true, recordings = new Map(), deletions = new Set() } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: "", checked: true, addEventListener(name, callback) { this[name] = callback; } });
    return elements.get(id);
  };
  const reference = path => ({ fullPath: path, name: path.split("/").at(-1) });
  const notFound = () => Object.assign(new Error("Not found"), { code: "storage/object-not-found" });
  let authChanged;
  Object.assign(current.context, {
    console: { ...console, warn() {} }, TextEncoder, TextDecoder, Blob, Uint8Array,
    document: { getElementById: element },
    supabaseConfig: {},
    createSupabaseCloud: async () => configured ? ({
    ownerKey: "vocalizing-supabase-owner-test",
    onAuthStateChanged(callback) { authChanged = callback; callback({ uid: "test-account", email: "test@example.com" }); },
    signIn: async () => { throw new Error("Google desativado"); },
    signOut: async () => authChanged(null),
    file: reference,
    listAll: async folder => {
      if (denyHistory && folder.fullPath.endsWith("/history")) throw Object.assign(new Error("Denied"), { code: "storage/unauthorized" });
      return { items: [...files.keys()].filter(path => path.startsWith(`${folder.fullPath}/`) && !path.slice(folder.fullPath.length + 1).includes("/")).map(reference) };
    },
    getMetadata: async file => { if (!files.has(file.fullPath)) throw notFound(); return files.get(file.fullPath).metadata; },
    getBytes: async file => { if (!files.has(file.fullPath)) throw notFound(); const bytes = files.get(file.fullPath).bytes; return bytes instanceof Blob ? bytes.arrayBuffer() : bytes; },
    uploadBytes: async (file, bytes, metadata) => { files.set(file.fullPath, { bytes, metadata: { ...metadata, updated: new Date().toISOString() } }); },
    deleteObject: async file => { if (!files.delete(file.fullPath)) throw notFound(); }
    }) : null
  });
  current.window.vocalizandoPersonal = { examplesBuffer: async () => null };
  current.window.vocalizandoData = {
    recordings: async () => [...recordings.values()], deletedRecordings: async () => [...deletions],
    async saveRecording(item) {
      recordings.set(item.id, item);
      current.history.addRecordingAttempt(item);
      current.history.recordingReview(item);
    },
    async deleteRecording(id) { recordings.delete(id); deletions.add(id); }
  };
  current.window.confirm ||= () => true;
  vm.runInContext(cloudSource, current.context);
  await vm.runInContext("cloudReady", current.context);
  return { sync: () => vm.runInContext("sync()", current.context), element, changeAccount: authChanged };
}

test("Supabase sync joins full histories using separate device snapshots", async () => {
  const files = new Map();
  const left = device();
  const right = device();
  left.history.write(countKey, { tara: 1, iii: 0, lastSource: "manual" });
  right.history.write("vocalizing-functional-v1", [{ at, exercise: "voz", prompt: "Frase", score: 71 }]);
  right.history.write("vocalizing-functional-targets-v1", { words: ["neurologia"], phrases: ["Eu quero falar."] });
  const cloudLeft = await connect(left, files);
  const cloudRight = await connect(right, files);
  await cloudLeft.sync();
  await cloudRight.sync();
  await cloudLeft.sync();
  assert.equal(left.read("vocalizing-functional-v1")[0].score, 71);
  assert.equal(right.read(countKey).tara, 1);
  assert.deepEqual(left.read("vocalizing-functional-targets-v1").words, ["neurologia"]);
  assert.equal(files.size, 2);
  assert.match(cloudLeft.element("cloud-status").textContent, /2 tentativas no histórico sincronizado/);
  assert.equal(cloudLeft.element("cloud-sync").disabled, false);
});

test("missing history rules produce an actionable message without claiming success", async () => {
  const current = device();
  const cloud = await connect(current, new Map(), { denyHistory: true });
  await cloud.sync();
  assert.match(cloud.element("cloud-status").textContent, /Histórico ainda não sincronizado/);
  await cloud.element("cloud-login").click();
  assert.match(cloud.element("cloud-status").textContent, /URLs autorizadas no Supabase/);
});

test("another account cannot receive locally owned practice data", async () => {
  const current = device();
  current.localStorage.setItem("vocalizing-supabase-owner-test", "another-account");
  const files = new Map();
  const cloud = await connect(current, files);
  await cloud.sync();
  assert.match(cloud.element("cloud-status").textContent, /outra conta/);
  assert.equal(files.size, 0);
});

test("missing configuration keeps local data and disables cloud actions", async () => {
  const current = device();
  current.history.write(countKey, { tara: 1, iii: 0 });
  const before = JSON.stringify(current.history.snapshot());
  const cloud = await connect(current, new Map(), { configured: false });
  assert.equal(cloud.element("cloud-login").disabled, true);
  assert.equal(cloud.element("cloud-sync").disabled, true);
  assert.match(cloud.element("cloud-status").textContent, /ainda não foi configurado/);
  await cloud.sync();
  assert.equal(JSON.stringify(current.history.snapshot()), before);
});

test("without consent no practice data is transferred", async () => {
  const files = new Map();
  const cloud = await connect(device(), files);
  cloud.element("cloud-consent").checked = false;
  await cloud.sync();
  assert.equal(files.size, 0);
  assert.match(cloud.element("cloud-status").textContent, /autorização/);
});

test("Firebase ownership requires explicit confirmation before migration", async () => {
  const current = device();
  current.localStorage.setItem("vocalizing-cloud-owner-v2", "firebase-account");
  current.window.confirm = () => false;
  const files = new Map();
  const cloud = await connect(current, files);
  await cloud.sync();
  assert.equal(files.size, 0);
  assert.equal(current.localStorage.getItem("vocalizing-supabase-owner-test"), null);
  assert.match(cloud.element("cloud-status").textContent, /Transferência cancelada/);
  current.window.confirm = () => true;
  await cloud.sync();
  assert.equal(files.size, 1);
  assert.equal(current.localStorage.getItem("vocalizing-cloud-owner-v2"), "firebase-account");
});

test("recordings and reviews sync both ways and deletion prevents resurrection", async () => {
  const left = device();
  const right = device();
  const files = new Map();
  const leftRecordings = new Map();
  const rightRecordings = new Map();
  const cloudLeft = await connect(left, files, { recordings: leftRecordings });
  const cloudRight = await connect(right, files, { recordings: rightRecordings });
  await left.window.vocalizandoData.saveRecording({ id: "audio-a", kind: "twister", at, updatedAt: at, prompt: "Frase", blob: new Blob(["audio"], { type: "audio/mp4" }) });
  await cloudLeft.sync();
  await cloudRight.sync();
  assert.equal(rightRecordings.size, 1);
  assert.equal(await rightRecordings.get("audio-a").blob.text(), "audio");
  assert.equal(right.history.active().length, 1);
  const reviewed = rightRecordings.get("audio-a");
  reviewed.listenerResult = "all";
  reviewed.updatedAt = new Date(Date.now() + 5000).toISOString();
  await right.window.vocalizandoData.saveRecording(reviewed);
  await cloudRight.sync();
  await cloudLeft.sync();
  assert.equal(leftRecordings.get("audio-a").listenerResult, "all");
  assert.equal(left.history.active().length, 1);
  assert.equal(left.history.active()[0].listenerResult, "all");
  await right.window.vocalizandoData.deleteRecording("audio-a");
  await cloudRight.sync();
  await cloudLeft.sync();
  await cloudRight.sync();
  assert.equal(leftRecordings.size, 0);
  assert.equal(rightRecordings.size, 0);
  assert.equal(files.has("users/test-account/recordings/audio-a"), false);
  assert.equal(left.history.active().length, 1);
});

test("an account change during sync cancels it without uploading", async () => {
  const current = device();
  const files = new Map();
  const cloud = await connect(current, files);
  current.window.vocalizandoLifecycle = { pause: async () => cloud.changeAccount({ uid: "other", email: "other@example.com" }) };
  await cloud.sync();
  assert.equal(files.size, 0);
  assert.match(cloud.element("cloud-status").textContent, /conta mudou/);
});
