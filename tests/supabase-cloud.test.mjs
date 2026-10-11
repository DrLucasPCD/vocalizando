import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseStorage, createSupabaseCloud, googleLoginEnabled } from "../supabase-cloud.js";

function adapter(methods) {
  return createSupabaseStorage({ storage: { from(name) { assert.equal(name, "private"); return methods; } } }, "private");
}

test("Supabase listing retrieves every page, not only the first 100 files", async () => {
  const offsets = [];
  const storage = adapter({ list: async (path, options) => {
    assert.equal(path, "users/a/recordings");
    offsets.push(options.offset);
    return { data: Array.from({ length: options.offset === 0 ? 100 : 3 }, (_, i) => ({ id: `id-${options.offset + i}`, name: `clip-${options.offset + i}` })), error: null };
  } });
  const result = await storage.listAll(storage.file("users/a/recordings"));
  assert.equal(result.items.length, 103);
  assert.deepEqual(offsets, [0, 100]);
});

test("Supabase upload and info preserve audio review metadata", async () => {
  const custom = { kind: "twister", listenerResult: "all", attemptIds: '["a"]', updatedAt: "2026-10-11T12:00:00Z" };
  let uploaded;
  const storage = adapter({
    upload: async (path, body, options) => { uploaded = { path, body, options }; return { data: {}, error: null }; },
    info: async () => ({ data: { size: 4, contentType: "audio/mp4", lastModified: "later", createdAt: "before", metadata: custom }, error: null })
  });
  const file = storage.file("users/a/recordings/clip");
  await storage.uploadBytes(file, new Uint8Array(4), { contentType: "audio/mp4", customMetadata: custom });
  assert.equal(uploaded.options.upsert, true);
  assert.deepEqual(uploaded.options.metadata, custom);
  const info = await storage.getMetadata(file);
  assert.deepEqual(info.customMetadata, custom);
  assert.equal(info.contentType, "audio/mp4");
  assert.equal(info.updated, "later");
});

test("missing objects are distinguished from missing buckets and policy errors", async () => {
  for (const [error, code] of [
    [{ code: "NoSuchKey", message: "Object not found", statusCode: "404" }, "storage/object-not-found"],
    [{ code: "NoSuchBucket", message: "Bucket not found", statusCode: "404" }, "storage/not-configured"],
    [{ message: "new row violates row-level security policy", statusCode: "400" }, "storage/unauthorized"]
  ]) {
    const storage = adapter({ info: async () => ({ data: null, error }) });
    await assert.rejects(storage.getMetadata(storage.file("users/a/file")), value => value.code === code);
  }
});

test("oversized remote audio is rejected before download", async () => {
  const storage = adapter({
    info: async () => ({ data: { size: 11 }, error: null }),
    download: () => assert.fail("must not download")
  });
  await assert.rejects(storage.getBytes(storage.file("users/a/file"), 10), /limite/);
});

test("valid private download returns original bytes", async () => {
  const storage = adapter({
    info: async () => ({ data: { size: 3 }, error: null }),
    download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null })
  });
  assert.deepEqual(new Uint8Array(await storage.getBytes(storage.file("users/a/file"), 10)), new Uint8Array([1, 2, 3]));
});

test("unsafe paths and secret keys are rejected", async () => {
  const storage = adapter({});
  for (const path of ["users/../file", "/users/file", "users//file", "users/a\\file"]) assert.throws(() => storage.file(path), /inválido/);
  assert.equal(await createSupabaseCloud({ url: "", publicKey: "" }), null);
  await assert.rejects(createSupabaseCloud({ url: "https://test.supabase.co", publicKey: "sb_secret_private" }), /chave secreta/);
  const secret = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  await assert.rejects(createSupabaseCloud({ url: "https://test.supabase.co", publicKey: secret }), /chave pública/);
});

test("Google login checks the live provider before redirecting", async () => {
  const config = { url: "https://test.supabase.co", publicKey: "sb_publishable_test" };
  for (const enabled of [true, false]) {
    assert.equal(await googleLoginEnabled(config, async (url, options) => {
      assert.equal(url, "https://test.supabase.co/auth/v1/settings");
      assert.equal(options.headers.apikey, config.publicKey);
      return { ok: true, json: async () => ({ external: { google: enabled } }) };
    }), enabled);
  }
  await assert.rejects(googleLoginEnabled(config, async () => ({ ok: false })), /verificar o login/);
});
