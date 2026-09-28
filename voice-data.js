(function () {
  const DB_NAME = "vocalizando-voice-v1";
  let opening;

  function open() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("Este navegador não permite guardar gravações."));
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("kv");
        db.createObjectStore("recordings", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Não foi possível abrir o armazenamento."));
    }).catch(error => {
      opening = null;
      throw error;
    });
    return opening;
  }

  async function request(store, method, value, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, method === "get" || method === "getAll" ? "readonly" : "readwrite");
      const objectStore = transaction.objectStore(store);
      const action = key === undefined ? objectStore[method](value) : objectStore[method](value, key);
      let result;
      action.onsuccess = () => { result = action.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("Falha ao guardar dados neste navegador."));
      transaction.onabort = () => reject(transaction.error || new Error("Armazenamento interrompido."));
    });
  }

  window.vocalizandoData = {
    get: key => request("kv", "get", key),
    put: (key, value) => request("kv", "put", value, key),
    remove: key => request("kv", "delete", key),
    recordings: () => request("recordings", "getAll"),
    saveRecording: value => request("recordings", "put", value),
    deleteRecording: async id => {
      await request("recordings", "delete", id);
      const deleted = (await request("kv", "get", "deleted-recordings-v1")) || [];
      if (!deleted.includes(id)) await request("kv", "put", [...deleted, id], "deleted-recordings-v1");
    },
    deletedRecordings: async () => (await request("kv", "get", "deleted-recordings-v1")) || [],
    clear: async () => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(["kv", "recordings"], "readwrite");
        transaction.objectStore("kv").clear();
        transaction.objectStore("recordings").clear();
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    }
  };
})();
