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
// The entry chunk itself holds no 3D code: the hero is plain HTML plus Canvas 2D effects that load
// on idle, and the heavy sections below the fold mount later. So a first visit needs only
// vendor-react and the small entry chunk to render the page.
// gsap is shared by the Projects computer and other below-the-fold pieces; naming its chunk keeps
// it cached across deploys instead of Rollup giving it a generic "index-<hash>" name.
const VENDOR_CHUNKS = [
  ['vendor-react', /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]|commonjsHelpers|vite[\\/]preload-helper/],
  [
    'vendor-3d',
    /[\\/]node_modules[\\/](three[\\/]build[\\/]three\.(core|module)(\.min)?\.js$|@react-three[\\/](fiber|drei)[\\/]|three-stdlib[\\/])/,
  ],
  ['vendor-gsap', /[\\/]node_modules[\\/](gsap|@gsap[\\/]react)[\\/]/],
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
