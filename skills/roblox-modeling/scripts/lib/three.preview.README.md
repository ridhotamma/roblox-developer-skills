# Offline three.js bundle for `preview.html`

`preview.cjs` inlines `three.preview.js` into the generated viewer so `preview.html` works when it is opened as
a plain file, with no network and no import map. It is a minified esbuild bundle of:

- `three@0.160.0` (the classes the viewer uses)
- `examples/jsm/controls/OrbitControls.js`
- `examples/jsm/loaders/GLTFLoader.js` (and the `BufferGeometryUtils` it imports)

All are MIT licensed; see `three.LICENSE.txt`. The bundle also keeps three.js's license header at the end.
If the file is missing, `preview.cjs` falls back to the pinned jsDelivr import map, so older checkouts still build.

## Regenerate after changing `THREE_VER`

From a temporary folder with the packages installed:

```bash
npm install --no-save three@0.160.0 esbuild@0.25.0
cat > entry.js <<'EOF'
import { WebGLRenderer, Scene, HemisphereLight, DirectionalLight, PerspectiveCamera, OrthographicCamera,
  PlaneGeometry, ShadowMaterial, Box3, Vector3, GridHelper, Box3Helper, AnimationMixer, LoopRepeat,
  LoopOnce, TextureLoader, SRGBColorSpace, Mesh, MeshBasicMaterial, DoubleSide, Clock } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
window.THREE = { WebGLRenderer, Scene, HemisphereLight, DirectionalLight, PerspectiveCamera, OrthographicCamera,
  PlaneGeometry, ShadowMaterial, Box3, Vector3, GridHelper, Box3Helper, AnimationMixer, LoopRepeat,
  LoopOnce, TextureLoader, SRGBColorSpace, Mesh, MeshBasicMaterial, DoubleSide, Clock };
window.OrbitControls = OrbitControls; window.GLTFLoader = GLTFLoader;
EOF
npx esbuild entry.js --bundle --format=iife --minify --legal-comments=eof --outfile=three.preview.js
```

Copy the result next to `preview.cjs` and prepend this header:

```js
/*! three.js r160 + OrbitControls + GLTFLoader (MIT), bundled for rmodel's offline preview.
 *  See three.preview.README.md to regenerate. */
```

The viewer only reads `window.THREE` (the subset above), `window.OrbitControls` and `window.GLTFLoader`.
If the viewer starts using another three.js class, add it to both the import list and the `window.THREE` object,
then rebuild.

Update `THREE_VER` in `preview.cjs` at the same time so the CDN fallback matches.
