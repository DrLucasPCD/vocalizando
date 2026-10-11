function storageError(error) {
  const message = error.message || "Falha no armazenamento da nuvem.";
  const status = Number(error.statusCode || error.status);
  const code = error.code || error.error;
  let normalized = "storage/unknown";
  if (["NoSuchKey", "object_not_found"].includes(code) || /object not found/i.test(message)) normalized = "storage/object-not-found";
  else if (status === 401 || status === 403 || /row.level security|permission denied/i.test(message)) normalized = "storage/unauthorized";
  else if (/bucket.*not found|NoSuchBucket/i.test(message) || code === "NoSuchBucket") normalized = "storage/not-configured";
  return Object.assign(new Error(message), { code: normalized });
}

function unwrap(result) {
  if (result.error) throw storageError(result.error);
  return result.data;
}

export function createSupabaseStorage(client, bucketName) {
  const bucket = client.storage.from(bucketName);
  const file = path => {
    if (typeof path !== "string" || !path || path.split("/").some(part => !part || part === "." || part === "..") || path.includes("\\")) throw new Error("Caminho de arquivo inválido.");
    return { fullPath: path, name: path.split("/").at(-1) };
  };
  async function getMetadata(reference) {
    const data = unwrap(await bucket.info(reference.fullPath));
    return {
      size: data.size, contentType: data.contentType,
      timeCreated: data.createdAt, updated: data.lastModified,
      customMetadata: data.metadata || {}
    };
  }
  return {
    file,
    getMetadata,
    async listAll(folder) {
      const items = [];
      const limit = 100;
      for (let offset = 0; ; offset += limit) {
        const page = unwrap(await bucket.list(folder.fullPath, { limit, offset, sortBy: { column: "name", order: "asc" } }));
        for (const item of page) {
          if (item.id) {
            if (item.name.includes("/")) throw new Error("Nome de arquivo inválido na nuvem.");
            items.push(file(`${folder.fullPath}/${item.name}`));
          }
        }
        if (page.length < limit) break;
      }
      return { items };
    },
    async getBytes(reference, maxBytes) {
      const metadata = await getMetadata(reference);
      if (!Number.isFinite(metadata.size) || metadata.size > maxBytes) throw new Error("O arquivo da nuvem excede o limite permitido.");
      const blob = unwrap(await bucket.download(reference.fullPath));
      if (blob.size > maxBytes) throw new Error("O arquivo da nuvem excede o limite permitido.");
      return blob.arrayBuffer();
    },
    async uploadBytes(reference, bytes, metadata) {
      unwrap(await bucket.upload(reference.fullPath, bytes, {
        upsert: true, contentType: metadata.contentType,
        metadata: metadata.customMetadata || {}, cacheControl: "0"
      }));
    },
    async deleteObject(reference) {
      unwrap(await bucket.remove([reference.fullPath]));
    }
  };
}

export async function googleLoginEnabled(config, fetcher = fetch) {
  const response = await fetcher(`${new URL(config.url).origin}/auth/v1/settings`, {
    headers: { apikey: config.publicKey }, signal: globalThis.AbortSignal?.timeout?.(10000), cache: "no-store"
  });
  if (!response.ok) throw new Error("Não foi possível verificar o login. Confira sua conexão e tente novamente.");
  const settings = await response.json();
  return settings.external?.google === true;
}

export async function createSupabaseCloud(config) {
  if (!config.url || !config.publicKey) return null;
  const url = new URL(config.url);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("Configure uma Project URL HTTPS válida do Supabase.");
  if (config.publicKey.startsWith("sb_secret_")) throw new Error("Use somente a chave pública publishable ou anon, nunca uma chave secreta.");
  if (!config.publicKey.startsWith("sb_publishable_")) {
    try {
      const payload = JSON.parse(atob(config.publicKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role !== "anon") throw new Error();
    } catch { throw new Error("Use somente uma chave pública publishable ou anon válida."); }
  }
  const { createClient } = await import("./vendor/supabase.js?v=2.117.3");
  const client = createClient(url.origin, config.publicKey, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const session = await client.auth.getSession();
  if (session.error) throw session.error;
  return {
    ...createSupabaseStorage(client, config.bucket),
    ownerKey: `vocalizing-supabase-owner-${url.host}`,
    googleAvailable: () => googleLoginEnabled(config),
    onAuthStateChanged(callback) {
      client.auth.onAuthStateChange((_event, session) => callback(session?.user ? { uid: session.user.id, email: session.user.email } : null));
    },
    async signIn() {
      if (!await googleLoginEnabled(config)) throw new Error("Ative o provedor Google no painel Supabase antes de entrar");
      const { error } = await client.auth.signInWithOAuth({
        provider: "google", options: { redirectTo: `${window.location.origin}${window.location.pathname}` }
      });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
    }
  };
}
