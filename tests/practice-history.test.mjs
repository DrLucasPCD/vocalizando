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

const cloudSource = readFileSync(new URL("../firebase-cloud.js", import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
function connect(current, files, { denyHistory = false } = {}) {
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
    initializeApp() {}, getAuth() {}, getStorage() {}, GoogleAuthProvider: class {},
    onAuthStateChanged(auth, callback) { authChanged = callback; callback({ uid: "test-account", email: "test@example.com" }); },
    signInWithPopup: async () => { throw Object.assign(new Error("Domain"), { code: "auth/unauthorized-domain" }); },
    signOut: async () => authChanged(null),
    ref(storage, path) { return reference(path); },
    listAll: async folder => {
      if (denyHistory && folder.fullPath.endsWith("/history")) throw Object.assign(new Error("Denied"), { code: "storage/unauthorized" });
      return { items: [...files.keys()].filter(path => path.startsWith(`${folder.fullPath}/`) && !path.slice(folder.fullPath.length + 1).includes("/")).map(reference) };
    },
    getMetadata: async file => { if (!files.has(file.fullPath)) throw notFound(); return files.get(file.fullPath).metadata; },
    getBytes: async file => { if (!files.has(file.fullPath)) throw notFound(); return files.get(file.fullPath).bytes; },
    uploadBytes: async (file, bytes, metadata) => { files.set(file.fullPath, { bytes, metadata: { ...metadata, updated: new Date().toISOString() } }); },
    deleteObject: async file => { if (!files.delete(file.fullPath)) throw notFound(); }
  });
  current.window.vocalizandoPersonal = { examplesBuffer: async () => null };
  current.window.vocalizandoData = { recordings: async () => [], deletedRecordings: async () => [] };
  vm.runInContext(cloudSource, current.context);
  return { sync: () => vm.runInContext("sync()", current.context), element };
}

test("Firebase sync joins full histories using separate device snapshots", async () => {
  const files = new Map();
  const left = device();
  const right = device();
  left.history.write(countKey, { tara: 1, iii: 0, lastSource: "manual" });
  right.history.write("vocalizing-functional-v1", [{ at, exercise: "voz", prompt: "Frase", score: 71 }]);
  right.history.write("vocalizing-functional-targets-v1", { words: ["neurologia"], phrases: ["Eu quero falar."] });
  const cloudLeft = connect(left, files);
  const cloudRight = connect(right, files);
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
  const cloud = connect(current, new Map(), { denyHistory: true });
  await cloud.sync();
  assert.match(cloud.element("cloud-status").textContent, /Histórico ainda não sincronizado/);
  await cloud.element("cloud-login").click();
  assert.match(cloud.element("cloud-status").textContent, /domínios autorizados/);
});

test("another account cannot receive locally owned practice data", async () => {
  const current = device();
  current.localStorage.setItem("vocalizing-cloud-owner-v2", "another-account");
  const files = new Map();
  const cloud = connect(current, files);
  await cloud.sync();
  assert.match(cloud.element("cloud-status").textContent, /outra conta/);
  assert.equal(files.size, 0);
});
