import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'path'

// Vendored from Lightricks/LTX-Desktop. Stripped of vite-plugin-electron and
// vite-plugin-electron-renderer — this sub-app builds to a single static
// dist/index.html (inlined JS + CSS via vite-plugin-singlefile) and is loaded
// by kolbo-desktop via file:// inside a tab.
//
// Why singlefile: Chromium blocks <script type="module" crossorigin> when
// loaded from a file:// origin (the default Vite output uses external module
// chunks). Inlining everything sidesteps the CORS / MIME checks entirely and
// makes the sub-app a single self-contained file that "just works" through
// file://, custom protocols, or HTTP.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './frontend'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
