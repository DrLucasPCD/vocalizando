import { build } from "esbuild";

await build({
  stdin: { contents: 'export { createClient } from "@supabase/supabase-js";', resolveDir: process.cwd(), sourcefile: "supabase-entry.js" },
  bundle: true, format: "esm", platform: "browser", target: "es2020",
  minify: true, outfile: "vendor/supabase.js", legalComments: "eof"
});
