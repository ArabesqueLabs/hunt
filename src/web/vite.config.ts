// hunt's web UI, built into dist/ as one script (app.js) and one stylesheet
// (app.css), at fixed names: the Rust service compiles them in and serves
// them as /app.js and /style.css, fingerprinted (?v=) so no cache keeps an
// older one. The rich text editor (TinyMCE) is a script of its own
// (editor.js), loaded the first time an editor opens, at app.js's
// fingerprint, built on its own (vite.editor.config.ts). `npm run build`
// before `cargo build`.
//
// The fonts (/fonts/…) and the design system's icon sprite are the
// service's own to serve: the stylesheet keeps their addresses as they are
// (the build's root is src/, where /fonts isn't), and the sprite the date
// picker asks for is written where the service has it, under vendor/.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src",
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      input: "src/main.tsx",
      output: {
        codeSplitting: false,
        entryFileNames: "app.js",
        assetFileNames: (asset) => (asset.names?.[0] === "icons.svg" ? "vendor/arabesque/dist/icons.svg" : "app[extname]"),
      },
    },
  },
});
