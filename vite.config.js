import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Long-lived vendor code goes into its own hashed chunks so a content or copy change only
// invalidates the small app chunk (netlify.toml caches /assets/*.js as immutable).
// three is matched on its WebGL core only (three.core.js / three.module.js). The lazily loaded
// globe also pulls three/webgpu, three/tsl and some three/examples modules; those must stay in the
// globe chunk instead of being dragged into the eager 3D chunk.
// Rollup's shared helpers (CommonJS interop, Vite's preload helper) go in vendor-react, the chunk
// with no dependencies. Left to Rollup they can land in vendor-3d, and then vendor-react and
// vendor-3d import each other and React is undefined when R3F initializes.
const VENDOR_CHUNKS = [
  ['vendor-react', /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]|commonjsHelpers|vite[\\/]preload-helper/],
  [
    'vendor-3d',
    /[\\/]node_modules[\\/](three[\\/]build[\\/]three\.(core|module)(\.min)?\.js$|@react-three[\\/](fiber|drei)[\\/]|three-stdlib[\\/])/,
  ],
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          for (const [name, pattern] of VENDOR_CHUNKS) {
            if (pattern.test(id)) return name
          }
          return undefined
        },
      },
    },
  },
})
