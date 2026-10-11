(function () {
  const KEY = "vocalizing-history-v2";
  const DEVICE_KEY = "vocalizing-device-v2";
  const arrayKinds = {
    "vocalizing-functional-v1": "functional",
    "vocalizing-functional-baseline-v1": "baseline"
  };
  const documentKeys = new Set([
    "vocalizing-profile", "vocalizing-settings", "vocalizing-functional-targets-v1",
    "vocalizing-functional-references-v1", "vocalizing-listening-v1"
  ]);
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let device = localStorage.getItem(DEVICE_KEY);
  if (!device) { device = uid(); localStorage.setItem(DEVICE_KEY, device); }
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
    catch { return fallback; }
  };
  const empty = () => ({ schema: 2, events: {}, documents: {} });
  const canonical = value => JSON.stringify(value, function (key, item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]]));
  });
  const load = () => read(KEY, empty());
  const ready = () => {
    if (!load().migrated) migrate();
    return load();
  };
  const dateKey = value => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  function legacyId(kind, key, item, index) {
    const text = JSON.stringify([kind, key, item.at || "", item.exercise || "", item.prompt || "", index]);
    let hash = 2166136261;
    for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return `legacy-${kind}-${(hash >>> 0).toString(16)}`;
  }
  function stamp(store) {
    return Math.max(Date.now(), (store.clock || 0) + 1);
  }
  function remember(store, id, value, migrating) {
    const previous = store.events[id];
    const clean = { ...value, id };
    delete clean.updatedAt;
    delete clean._changes;
    const old = previous && { ...previous };
    if (old) { delete old.updatedAt; delete old._changes; }
    if (canonical(clean) === canonical(old)) return;
    const updatedAt = migrating ? new Date(value.at || 0).getTime() || 0 : stamp(store);
    const changes = { ...(previous?._changes || {}) };
    for (const field of new Set([...Object.keys(old || {}), ...Object.keys(clean)])) {
      if (!previous || canonical(clean[field]) !== canonical(old[field])) changes[field] = updatedAt;
    }
    store.events[id] = { ...clean, updatedAt, _changes: changes };
    store.clock = Math.max(store.clock || 0, updatedAt);
  }
  function capture(store, key, value, migrating = false) {
    const kind = arrayKinds[key] || (/^vocalizing-twisters-\d{4}-\d{2}-\d{2}$/.test(key) ? "twister" : null);
    if (kind) {
      const items = kind === "twister" ? value.history || [] : value;
      const present = new Set();
      items.forEach((item, index) => {
        item.id ||= migrating ? legacyId(kind, key, item, index) : uid();
        if (typeof item.at === "number") item.at = new Date(item.at).toISOString();
        present.add(item.id);
        remember(store, item.id, { ...item, kind }, migrating);
      });
      if (kind === "twister" && migrating) {
        const count = Math.max(items.length, Number(value.attempts) || 0);
        for (let index = items.length; index < count; index++) {
          const id = `legacy-twister-${key}-${index}`;
          present.add(id);
          remember(store, id, { kind, at: `${key.slice(-10)}T12:00:00`, score: null, source: "legacy" }, true);
        }
      }
      if (!migrating) for (const event of Object.values(store.events)) {
        if (event.kind === kind && !event.deleted && (kind !== "twister" || dateKey(event.at) === key.slice(-10)) && !present.has(event.id)) {
          remember(store, event.id, { ...event, deleted: true }, false);
        }
      }
    } else if (/^vocalizing-\d{4}-\d{2}-\d{2}$/.test(key)) {
      const day = key.slice(-10);
      for (const exercise of ["tara", "iii"]) {
        const events = Object.values(store.events).filter(item => item.kind === "model" && item.exercise === exercise && dateKey(item.at) === day && !item.deleted).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
        const total = Math.max(0, Math.floor(Number(value[exercise]) || 0));
        const metric = value.metrics?.[exercise];
        const confidence = metric?.accepted ? metric.confidenceSum / metric.accepted : null;
        for (let index = events.length; index < total; index++) {
          const id = migrating ? `legacy-model-${day}-${exercise}-${index}` : uid();
          const source = migrating ? index < (value.manual?.[exercise] || 0) ? "manual" : "auto" : value.lastSource || "manual";
          remember(store, id, { kind: "model", exercise, at: migrating ? `${day}T12:00:00` : new Date().toISOString(), source, confidence: source === "auto" ? value.lastConfidence ?? confidence : null }, migrating);
        }
        for (const item of events.slice(total)) remember(store, item.id, { ...item, deleted: true }, migrating);
      }
    } else if (documentKeys.has(key)) {
      const previous = read(key, {});
      for (const field of new Set([...Object.keys(previous), ...Object.keys(value)])) {
        const id = `${key}:${field}`;
        const entry = store.documents[id];
        const deleted = !Object.hasOwn(value, field);
        if (entry && canonical(entry.value) === canonical(value[field]) && !!entry.deleted === deleted) continue;
        const updatedAt = migrating ? Number(value.updatedAt) || 0 : stamp(store);
        store.documents[id] = { key, field, value: deleted ? null : value[field], deleted, updatedAt, device };
        store.clock = Math.max(store.clock || 0, updatedAt);
      }
    }
  }
  function persist(store) { localStorage.setItem(KEY, JSON.stringify(store)); }
  function write(key, value) {
    const store = ready();
    capture(store, key, value);
    const previous = localStorage.getItem(key);
    const previousHistory = localStorage.getItem(KEY);
    try {
      persist(store);
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      if (previousHistory) localStorage.setItem(KEY, previousHistory);
      else localStorage.removeItem(KEY);
      if (previous !== null) localStorage.setItem(key, previous);
      else localStorage.removeItem(key);
      throw error;
    }
    window.dispatchEvent(new CustomEvent("vocalizando-practice-saved", { detail: { key } }));
    return value;
  }
  function active(store = ready()) {
    return Object.values(store.events).filter(item => !item.deleted).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  }
  function project(store) {
    const events = active(store);
    for (const [key, kind] of Object.entries(arrayKinds)) {
      localStorage.setItem(key, JSON.stringify(events.filter(item => item.kind === kind).map(({ kind: ignored, ...item }) => item)));
    }
    const days = new Set(Object.values(store.events).filter(item => ["model", "twister"].includes(item.kind)).map(item => dateKey(item.at)));
    for (const day of days) {
      const models = events.filter(item => item.kind === "model" && dateKey(item.at) === day);
      const value = { tara: 0, iii: 0, metrics: {}, manual: {} };
      for (const key of ["tara", "iii"]) {
        const items = models.filter(item => item.exercise === key);
        const scores = items.filter(item => item.source === "auto" && Number.isFinite(item.confidence));
        value[key] = items.length;
        value.manual[key] = items.filter(item => item.source !== "auto").length;
        value.metrics[key] = { accepted: scores.length, confidenceSum: scores.reduce((sum, item) => sum + item.confidence, 0), bestConfidence: Math.max(0, ...scores.map(item => item.confidence)) };
      }
      localStorage.setItem(`vocalizing-${day}`, JSON.stringify(value));
      const history = events.filter(item => item.kind === "twister" && dateKey(item.at) === day).map(({ kind, ...item }) => item);
      let streak = 0;
      for (const item of history) streak = item.score >= 75 ? streak + 1 : 0;
      localStorage.setItem(`vocalizing-twisters-${day}`, JSON.stringify({ history, attempts: history.length, streak, best: Math.max(0, ...history.map(item => Number(item.score) || 0)) }));
    }
    const documents = new Map();
    for (const item of Object.values(store.documents)) {
      if (!documents.has(item.key)) documents.set(item.key, {});
      if (!item.deleted) documents.get(item.key)[item.field] = item.value;
    }
    for (const [key, value] of documents) localStorage.setItem(key, JSON.stringify(value));
  }
  function validate(snapshot) {
    if (snapshot?.schema !== 2 || !snapshot.events || !snapshot.documents || typeof snapshot.events !== "object" || typeof snapshot.documents !== "object" || Array.isArray(snapshot.events) || Array.isArray(snapshot.documents)) throw new Error("Histórico da nuvem inválido.");
    for (const [id, item] of Object.entries(snapshot.events)) {
      if (["__proto__", "constructor", "prototype"].includes(id) || !item || id !== item.id || !["model", "functional", "twister", "baseline"].includes(item.kind) || !Number.isFinite(new Date(item.at).getTime()) || !Number.isFinite(item.updatedAt) || item.kind === "model" && !["tara", "iii"].includes(item.exercise)) throw new Error("Tentativa da nuvem inválida.");
      if (item._changes && (typeof item._changes !== "object" || Array.isArray(item._changes) || Object.entries(item._changes).some(([field, time]) => ["__proto__", "constructor", "prototype"].includes(field) || !Number.isFinite(time)))) throw new Error("Alterações da tentativa inválidas.");
    }
    for (const [id, item] of Object.entries(snapshot.documents)) {
      if (!item || id !== `${item.key}:${item.field}` || !documentKeys.has(item.key) || typeof item.field !== "string" || ["__proto__", "constructor", "prototype"].includes(item.field) || !Number.isFinite(item.updatedAt)) throw new Error("Preferência da nuvem inválida.");
    }
  }
  function commitProjection(store) {
    const managed = key => key === KEY || arrayKinds[key] || documentKeys.has(key) || /^vocalizing-(?:twisters-)?\d{4}-\d{2}-\d{2}$/.test(key);
    const previous = Object.fromEntries(Object.keys(localStorage).filter(managed).map(key => [key, localStorage.getItem(key)]));
    try { persist(store); project(store); }
    catch (error) {
      Object.keys(localStorage).filter(managed).forEach(key => localStorage.removeItem(key));
      Object.entries(previous).forEach(([key, value]) => localStorage.setItem(key, value));
      throw error;
    }
  }
  function mergeEvent(previous, incoming) {
    const result = { ...previous, updatedAt: Math.max(previous.updatedAt, incoming.updatedAt), _changes: { ...(previous._changes || {}) } };
    const fields = new Set([...Object.keys(previous), ...Object.keys(incoming), ...Object.keys(previous._changes || {}), ...Object.keys(incoming._changes || {})]);
    for (const field of fields) {
      if (["updatedAt", "_changes"].includes(field)) continue;
      const oldTime = previous._changes?.[field] ?? (Object.hasOwn(previous, field) ? previous.updatedAt : -1);
      const newTime = incoming._changes?.[field] ?? (Object.hasOwn(incoming, field) ? incoming.updatedAt : -1);
      if (newTime > oldTime || newTime === oldTime && String(canonical(incoming[field])) > String(canonical(previous[field]))) {
        if (Object.hasOwn(incoming, field)) result[field] = incoming[field];
        else delete result[field];
        result._changes[field] = newTime;
      } else if (oldTime >= 0) result._changes[field] = oldTime;
    }
    return result;
  }
  function merge(snapshots) {
    const store = ready();
    for (const snapshot of snapshots) {
      validate(snapshot);
      for (const group of ["events", "documents"]) for (const [id, item] of Object.entries(snapshot[group])) {
        const previous = store[group][id];
        if (group === "events" && previous) store.events[id] = mergeEvent(previous, item);
        else if (!previous || item.updatedAt > previous.updatedAt || item.updatedAt === previous.updatedAt && canonical(item) > canonical(previous)) store[group][id] = item;
        store.clock = Math.max(store.clock || 0, item.updatedAt);
      }
    }
    commitProjection(store);
    window.dispatchEvent(new Event("vocalizando-history-updated"));
    return store;
  }
  function replace(snapshot) {
    validate(snapshot);
    commitProjection({ ...snapshot, migrated: true });
    window.dispatchEvent(new Event("vocalizando-history-updated"));
  }
  function migrate(force = false) {
    const store = force ? empty() : load();
    if (store.migrated && !force) return;
    for (const key of Object.keys(localStorage)) {
      const value = read(key, null);
      if (value && (arrayKinds[key] || documentKeys.has(key) || /^vocalizing-(?:twisters-)?\d{4}-\d{2}-\d{2}$/.test(key))) capture(store, key, value, true);
    }
    store.migrated = true;
    commitProjection(store);
  }
  function addRecordingAttempt(recording) {
    if (recording.attemptIds?.length) return;
    const store = ready();
    if (recording.imported) {
      const existing = active(store).filter(item => item.kind === recording.kind && (recording.kind === "twister" || item.exercise === recording.exercise) && dateKey(item.at) === dateKey(recording.at) && (!item.prompt || item.prompt === recording.prompt));
      if (existing.length) { recording.attemptIds = existing.map(item => item.id); return; }
    }
    const id = `audio-${recording.id}`;
    recording.attemptIds = [id];
    remember(store, id, { kind: recording.kind, exercise: recording.exercise || "twister", at: recording.at, prompt: recording.prompt, source: "recording", score: null }, false);
    commitProjection(store);
    window.dispatchEvent(new Event("vocalizando-history-updated"));
  }
  function recordingReview(recording) {
    if (recording.kind !== "twister") return;
    const store = ready();
    for (const id of recording.attemptIds || []) {
      const event = store.events[id];
      if (recording.imported && new Date(recording.updatedAt || recording.at).getTime() < (event?.updatedAt || 0)) continue;
      if (event && !event.deleted && event.listenerResult !== (recording.listenerResult || "")) remember(store, id, { ...event, listenerResult: recording.listenerResult || "" }, false);
    }
    commitProjection(store);
    window.dispatchEvent(new Event("vocalizando-history-updated"));
  }
  window.vocalizandoHistory = { write, snapshot: ready, merge, replace, active, deviceId: device, newId: uid, migrate, addRecordingAttempt, recordingReview, validate };
  try { migrate(); }
  catch (error) { console.warn("Histórico anterior preservado; a migração não pôde ser concluída.", error); }
})();
