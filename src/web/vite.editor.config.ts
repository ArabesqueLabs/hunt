// The rich text editor (TinyMCE, src/editor.ts), built on its own into
// dist/editor.js: one module, nothing shared with app.js, which loads it
// the first time an editor opens. Runs after the app's build, adding to
// dist/ (see vite.config.ts).
import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  publicDir: false,
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    chunkSizeWarningLimit: 3000,
    lib: { entry: "editor.ts", formats: ["es"], fileName: () => "editor.js" },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
