// The rich text editor (Lexical, src/editor.ts), built on its own into
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
    lib: { entry: "editor.ts", formats: ["es"], fileName: () => "editor.js" },
    // Minified: a library's build isn't, unless asked.
    rolldownOptions: { output: { codeSplitting: false, minify: true } },
  },
});
