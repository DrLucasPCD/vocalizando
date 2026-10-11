import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getStorage, ref, getBytes, getMetadata, uploadBytes, deleteObject, listAll } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

const app = initializeApp({
  apiKey: "AIzaSyD4HNbec_TNkd5TpJsAdwDK66ecXCCh1MY",
  authDomain: "vocalizando-b98c7.firebaseapp.com",
  databaseURL: "https://vocalizando-b98c7-default-rtdb.firebaseio.com",
  projectId: "vocalizando-b98c7",
  storageBucket: "vocalizando-b98c7.firebasestorage.app",
  messagingSenderId: "303005437694",
  appId: "1:303005437694:web:63616bb276f39c9c8c9faf"
});
const auth = getAuth(app);
const storage = getStorage(app);
const element = id => document.getElementById(id);
const status = message => { element("cloud-status").textContent = message; };
let user = null;
let busy = false;
let conflict = null;
let syncUid = null;
const accountUid = () => syncUid || user?.uid;
function checkAccount() {
  if (!user || user.uid !== syncUid) throw new Error("A conta mudou durante a sincronização. Entre novamente e tente de novo.");
}
function claimLocalData() {
  const owner = localStorage.getItem("vocalizing-cloud-owner-v2");
  if (owner && owner !== user.uid) throw new Error("Os dados deste navegador pertencem a outra conta. Exporte e apague os dados locais antes de sincronizar com esta conta.");
  localStorage.setItem("vocalizing-cloud-owner-v2", user.uid);
}

function render() {
  element("cloud-account").textContent = user?.email || "Desconectado";
  element("cloud-login").hidden = !!user;
  element("cloud-logout").hidden = !user;
  element("cloud-sync").disabled = !user || busy;
  element("cloud-delete").disabled = !user || busy;
  element("cloud-login").disabled = busy;
  element("cloud-logout").disabled = busy;
  element("cloud-conflict").hidden = !conflict;
}

function cloudRef() {
  if (!user) throw new Error("Entre na sua conta antes de sincronizar.");
  return ref(storage, `users/${accountUid()}/calibration/examples.bin`);
}

function recordingRef(id) { return ref(storage, `users/${accountUid()}/recordings/${id}`); }
function deletionRef(id) { return ref(storage, `users/${accountUid()}/deleted/${id}`); }

async function downloadHistory() {
  const folder = ref(storage, `users/${accountUid()}/history`);
  const remote = await listAll(folder);
  const snapshots = [];
  for (const file of remote.items) {
    checkAccount();
    const buffer = await getBytes(file, 10 * 1024 * 1024);
    snapshots.push(JSON.parse(new TextDecoder().decode(buffer)));
  }
  checkAccount();
  window.vocalizandoHistory.merge(snapshots);
}

async function uploadHistory() {
  const snapshot = window.vocalizandoHistory.snapshot();
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (bytes.length >= 10 * 1024 * 1024) throw new Error("O histórico ultrapassa 10 MB. Exporte um backup antes de continuar.");
  await uploadBytes(ref(storage, `users/${accountUid()}/history/${window.vocalizandoHistory.deviceId}.json`), bytes, { contentType: "application/json" });
  checkAccount();
  return `${window.vocalizandoHistory.active().filter(item => item.kind !== "baseline").length} tentativas no histórico sincronizado`;
}

async function syncRecordings() {
  const local = await window.vocalizandoData.recordings();
  const localDeleted = await window.vocalizandoData.deletedRecordings();
  const [remoteList, deletedList] = await Promise.all([
    listAll(ref(storage, `users/${accountUid()}/recordings`)),
    listAll(ref(storage, `users/${accountUid()}/deleted`))
  ]);
  const deleted = new Set([...localDeleted, ...deletedList.items.map(item => item.name)]);
  const remoteDeletes = new Set(deletedList.items.map(item => item.name));
  const remote = new Map(remoteList.items.map(item => [item.name, item]));
  for (const id of deleted) {
    checkAccount();
    if (!remoteDeletes.has(id)) await uploadBytes(deletionRef(id), new Uint8Array(0), { contentType: "application/octet-stream" });
    if (remote.has(id)) {
      await deleteObject(remote.get(id));
      remote.delete(id);
    }
    if (local.some(item => item.id === id) && !localDeleted.includes(id)) await window.vocalizandoData.deleteRecording(id);
  }
  let uploaded = 0;
  let downloaded = 0;
  const localMap = new Map(local.filter(item => !deleted.has(item.id)).map(item => [item.id, item]));
  for (const item of localMap.values()) {
    checkAccount();
    const remoteItem = remote.get(item.id);
    let shouldUpload = !remoteItem;
    if (remoteItem) {
      const metadata = await getMetadata(remoteItem);
      shouldUpload = new Date(item.updatedAt || item.at) > new Date(metadata.customMetadata?.updatedAt || metadata.updated);
    }
    if (!shouldUpload) continue;
    if (item.blob.size >= 10 * 1024 * 1024) throw new Error("Uma gravação ultrapassa o limite de 10 MB.");
    await uploadBytes(recordingRef(item.id), item.blob, {
      contentType: item.blob.type || "audio/webm",
      customMetadata: {
        kind: item.kind, at: item.at, updatedAt: item.updatedAt || item.at,
        exercise: item.exercise || "", prompt: item.prompt || "",
        version: item.version || "", listenerResult: item.listenerResult || "",
        attemptIds: JSON.stringify(item.attemptIds || [])
      }
    });
    uploaded++;
  }
  for (const [id, remoteItem] of remote) {
    checkAccount();
    if (deleted.has(id)) continue;
    const metadata = await getMetadata(remoteItem);
    const localItem = localMap.get(id);
    if (localItem && new Date(localItem.updatedAt || localItem.at) >= new Date(metadata.customMetadata?.updatedAt || metadata.updated)) continue;
    const custom = metadata.customMetadata || {};
    if (!(["functional", "twister"].includes(custom.kind))) continue;
    const bytes = await getBytes(remoteItem, 10 * 1024 * 1024);
    checkAccount();
    let attemptIds = [];
    try { attemptIds = JSON.parse(custom.attemptIds || "[]"); } catch {}
    await window.vocalizandoData.saveRecording({
      id, kind: custom.kind, at: custom.at || metadata.timeCreated,
      updatedAt: custom.updatedAt || metadata.updated, exercise: custom.exercise || "",
      prompt: custom.prompt || "", version: custom.version || "",
      listenerResult: custom.listenerResult || "",
      attemptIds: Array.isArray(attemptIds) ? attemptIds.filter(id => typeof id === "string") : [],
      imported: true,
      blob: new Blob([bytes], { type: metadata.contentType || "audio/webm" })
    });
    downloaded++;
  }
  if (downloaded || deleted.size) window.dispatchEvent(new Event("vocalizando-recordings-updated"));
  return `${uploaded} gravação(ões) enviada(s), ${downloaded} recebida(s)`;
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function remoteMetadata() {
  try { return await getMetadata(cloudRef()); }
  catch (error) {
    if (error.code === "storage/object-not-found") return null;
    throw error;
  }
}

async function upload(buffer, hash) {
  await uploadBytes(cloudRef(), new Uint8Array(buffer), {
    contentType: "application/octet-stream",
    customMetadata: { sha256: hash, schema: "1" }
  });
  localStorage.setItem(`vocalizing-cloud-hash-${user.uid}`, hash);
  status("Exemplos de voz enviados para sua conta. No outro aparelho, entre com a mesma conta e toque em Sincronizar agora.");
}

async function download() {
  const buffer = await getBytes(cloudRef(), 40 * 1024 * 1024);
  checkAccount();
  await window.vocalizandoPersonal.replaceExamples(buffer);
  localStorage.setItem(`vocalizing-cloud-hash-${user.uid}`, await sha256(buffer));
  status("Exemplos recebidos. Toque em Treinar modelo neste aparelho para ativá-lo.");
}

async function sync() {
  if (!user || busy) return;
  if (!element("cloud-consent").checked) {
    status("Marque a autorização de envio antes de sincronizar.");
    return;
  }
  busy = true;
  syncUid = user.uid;
  conflict = null;
  render();
  status("Comparando os exemplos deste aparelho com os da nuvem...");
  try {
    claimLocalData();
    await window.vocalizandoLifecycle?.pause("sync");
    let historyError = null;
    try { await downloadHistory(); }
    catch (error) {
      if (error.code !== "storage/unauthorized") throw error;
      historyError = error;
    }
    const [local, remote] = await Promise.all([window.vocalizandoPersonal.examplesBuffer(), remoteMetadata()]);
    checkAccount();
    const localHash = local ? await sha256(local) : null;
    const remoteHash = remote?.customMetadata?.sha256 || null;
    const lastHash = localStorage.getItem(`vocalizing-cloud-hash-${user.uid}`);
    if (!remote && local) await upload(local, localHash);
    else if (!remote) status("Ainda não há exemplos de voz para sincronizar.");
    else if (remoteHash && remoteHash === localHash) status("Os exemplos já estão iguais nos dois aparelhos.");
    else if (!local || localHash === lastHash) await download();
    else if (lastHash && remoteHash === lastHash) await upload(local, localHash);
    else {
      conflict = { local, localHash };
      status("Os dois aparelhos têm exemplos diferentes. Escolha qual versão manter.");
    }
    const recordingSummary = await syncRecordings();
    let historySummary = "Histórico ainda não sincronizado: publique as regras atualizadas do Storage (caminho history)";
    try { if (!historyError) historySummary = await uploadHistory(); }
    catch (error) {
      if (error.code !== "storage/unauthorized") throw error;
      historySummary = "Histórico ainda não sincronizado: publique as regras atualizadas do Storage (caminho history)";
    }
    status(`${element("cloud-status").textContent} ${recordingSummary}. ${historySummary}.`);
  } catch (error) {
    console.warn("Falha na sincronização", error);
    status(error.code === "storage/unauthorized"
      ? "Acesso negado. Confira as regras do Storage para esta conta."
      : error.code === "storage/unknown"
        ? "Falha de rede ou CORS. Confira a configuração do bucket e tente novamente."
        : `Não foi possível sincronizar: ${error.message || "falha de rede"}.`);
  } finally {
    busy = false;
    syncUid = null;
    render();
  }
}

async function resolveConflict(useLocal) {
  if (!conflict || busy || !user || !element("cloud-consent").checked) return;
  busy = true;
  syncUid = user.uid;
  render();
  try {
    claimLocalData();
    if (useLocal) await upload(conflict.local, conflict.localHash);
    else await download();
    conflict = null;
  } catch (error) {
    status(`Não foi possível concluir a escolha: ${error.message}.`);
  } finally {
    busy = false;
    syncUid = null;
    render();
  }
}

element("cloud-login").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    status("Conectado. Autorize e sincronize seu histórico e suas gravações.");
  } catch (error) {
    status(error.code === "auth/unauthorized-domain" ? "Adicione o domínio deste site aos domínios autorizados do Firebase Authentication." : `Não foi possível entrar: ${error.message}.`);
  }
});
element("cloud-logout").addEventListener("click", async () => {
  await signOut(auth);
  conflict = null;
  status("Desconectado. Seus exemplos locais continuam neste aparelho.");
});
element("cloud-sync").addEventListener("click", sync);
element("cloud-delete").addEventListener("click", async () => {
  if (!user || busy || !window.confirm("Apagar todo o histórico, exemplos e gravações da nuvem? Os dados locais serão mantidos.")) return;
  busy = true;
  syncUid = user.uid;
  render();
  try {
    const files = await Promise.all([
      listAll(ref(storage, `users/${accountUid()}/recordings`)),
      listAll(ref(storage, `users/${accountUid()}/deleted`)),
      listAll(ref(storage, `users/${accountUid()}/history`))
    ]);
    for (const file of files.flatMap(group => group.items)) { checkAccount(); await deleteObject(file); }
    try { await deleteObject(cloudRef()); }
    catch (error) { if (error.code !== "storage/object-not-found") throw error; }
    localStorage.removeItem(`vocalizing-cloud-hash-${user.uid}`);
    status("Histórico e gravações apagados da nuvem. Os dados locais podem ser reenviados numa nova sincronização.");
  } catch (error) {
    status(error.code === "storage/object-not-found" ? "Não há exemplos na nuvem." : `Não foi possível apagar: ${error.message}.`);
  } finally {
    busy = false;
    syncUid = null;
    render();
  }
});
element("cloud-use-local").addEventListener("click", () => resolveConflict(true));
element("cloud-use-remote").addEventListener("click", () => resolveConflict(false));
onAuthStateChanged(auth, current => {
  user = current;
  if (!user) conflict = null;
  render();
});
render();
