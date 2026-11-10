// Shared machinery for "looks": whole-game animation styles (stop-motion, ink-and-paint,
// cutout, ...). A look restyles any scene built from MeshStandardMaterial meshes without the
// scene knowing about it: it swaps materials, optionally adds ink outlines, optionally runs a
// full-screen post pass, and optionally steps time so motion plays "on twos".
//
// A look module exports a descriptor:
//
//   export default {
//     id: 'cutout', name: 'Paper Cutout', era: '1970s cutout animation',
//     blurb: 'one or two plain sentences for the picker',
//     fps: 8,                       // animation step rate; 0 = smooth
//     people: { ... },              // PeopleStyle hints, see src/people.js
//     create(ctx) -> LookInstance,  // ctx = { THREE, renderer }
//   }
//
//   LookInstance = {
//     apply(root),                  // restyle a scene graph (call again for objects added later)
//     strip(root),                  // undo apply for that graph
//     setSize(w, h, pixelRatio),
//     render(scene, camera, time),  // draw one frame to the canvas
//     background?: THREE.Color,     // optional override for scene.background
//     dispose(),
//   }
//
// Scene conventions a look can rely on: meshes carry `userData.role`, one of
//   'floor' | 'wall' | 'ceiling' | 'prop' | 'bin' | 'ball' | 'person' | 'far' | 'sky' | 'fx'
// ('far' = distant scenery, 'sky' = backdrop, 'fx' = trails/particles: leave fx materials alone).
// `userData.outline === false` opts a mesh out of ink outlines.
import * as THREE from 'three';

const BASE = Symbol('baseMaterial');

/**
 * Replace every mesh material under `root` with `make(baseMaterial, mesh)`.
 * The original is remembered so `restoreMaterials` can undo it and so a second call
 * re-derives from the original, never from an already-swapped material.
 * Return null/undefined from `make` to leave a mesh untouched.
 */
export function swapMaterials(root, make) {
  const made = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.role === 'fx' || o.userData.isOutline) return;
    const base = o[BASE] || o.material;
    const next = Array.isArray(base) ? base.map((m) => make(m, o) || m) : make(base, o);
    if (!next) return;
    o[BASE] = base;
    o.material = next;
    made.push(next);
  });
  return made;
}

/** Undo swapMaterials under `root`, disposing the look's materials. */
export function restoreMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o[BASE]) return;
    const cur = o.material;
    (Array.isArray(cur) ? cur : [cur]).forEach((m) => m && m.dispose && m.dispose());
    o.material = o[BASE];
    delete o[BASE];
  });
}

/** The original (pre-look) material of a mesh. */
export const baseMaterialOf = (mesh) => mesh[BASE] || mesh.material;

/** A small canvas ramp for MeshToonMaterial.gradientMap: `steps` grey levels, nearest filtered. */
export function toonRamp(levels = [0.45, 0.8, 1.0]) {
  const data = new Uint8Array(levels.length * 4);
  levels.forEach((v, i) => {
    const b = Math.round(Math.max(0, Math.min(1, v)) * 255);
    data.set([b, b, b, 255], i * 4);
  });
  const t = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const OUTLINE_VERT = /* glsl */ `
  uniform float uThickness;   // in screen-height fractions
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    // push along the view-space normal by an amount that stays constant on screen
    float d = -mv.z * uThickness * 2.0;
    mv.xyz += n * d;
    gl_Position = projectionMatrix * mv;
  }`;
const OUTLINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
    #include <colorspace_fragment>
  }`;

/**
 * Inverted-hull ink outlines: adds a back-face shell to each smooth mesh under `root`.
 * Works best on smooth-normal geometry (flat-shaded geometry cracks at hard edges; for those
 * prefer the PostPass edge detector). Returns { setThickness(v), dispose() }.
 */
export function addOutlines(root, { thickness = 0.004, color = 0x000000, filter } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uThickness: { value: thickness }, uColor: { value: new THREE.Color(color) } },
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
  });
  const shells = [];
  const targets = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline || o.userData.outline === false) return;
    const role = o.userData.role;
    if (role === 'fx' || role === 'sky') return;
    if (filter && !filter(o)) return;
    targets.push(o);
  });
  for (const o of targets) {
    const shell = new THREE.Mesh(o.geometry, material);
    shell.userData.isOutline = true;
    shell.userData.role = 'fx';
    shell.castShadow = false;
    shell.receiveShadow = false;
    shell.frustumCulled = o.frustumCulled;
    o.add(shell);
    shells.push(shell);
  }
  return {
    setThickness(v) {
      material.uniforms.uThickness.value = v;
    },
    dispose() {
      shells.forEach((s) => s.parent && s.parent.remove(s));
      material.dispose();
    },
  };
}

/** GLSL helpers available inside every PostPass fragment. */
export const GLSL_COMMON = /* glsl */ `
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
  }
  vec3 toSRGB(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
  vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
`;

/**
 * Renders the scene to an off-screen target, then draws a full-screen quad with your
 * fragment shader. Your GLSL must define:   vec4 look(vec2 uv)
 * returning LINEAR colour. Available uniforms:
 *   sampler2D tColor;                 scene colour (linear, pre-tone-mapping)
 *   sampler2D tDepth;                 when needsDepth  (use viewZ(uv) -> positive metres)
 *   sampler2D tNormal;                when needsNormals (view-space normal packed 0..1)
 *   vec2 uResolution;                 target size in px      vec2 uTexel;  1/uResolution
 *   float uTime;                      the time passed to render()
 *   float uAspect;                    width/height
 * plus anything in `uniforms`. With `toneMap: true` (default) the renderer's tone mapping
 * and output colour space are applied after look(); with false only the colour-space
 * conversion is applied (for looks that pick exact display colours: return toLinear(srgb)).
 * `scale` < 1 renders at reduced resolution; `nearest` upscales with hard pixels.
 */
export class PostPass {
  constructor(renderer, { fragment, uniforms = {}, scale = 1, nearest = false, needsDepth = false, needsNormals = false, toneMap = true, samples = 4 } = {}) {
    this.renderer = renderer;
    this.scale = scale;
    this.needsNormals = needsNormals;
    const gl2 = renderer.capabilities.isWebGL2;
    const halfFloat = gl2 && (renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float'));
    const filter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    this.color = new THREE.WebGLRenderTarget(4, 4, {
      type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: filter,
      magFilter: filter,
      samples: nearest || !gl2 ? 0 : samples,
      depthBuffer: true,
    });
    if (needsDepth) {
      this.color.depthTexture = new THREE.DepthTexture(4, 4);
      this.color.depthTexture.type = THREE.UnsignedIntType;
    }
    if (needsNormals) {
      this.normal = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
      this.normalMaterial = new THREE.MeshNormalMaterial();
    }
    this.uniforms = {
      tColor: { value: this.color.texture },
      tDepth: { value: this.color.depthTexture || null },
      tNormal: { value: this.normal ? this.normal.texture : null },
      uResolution: { value: new THREE.Vector2(4, 4) },
      uTexel: { value: new THREE.Vector2(0.25, 0.25) },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 100 },
      ...uniforms,
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: toneMap,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <packing>
        varying vec2 vUv;
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tNormal;
        uniform vec2 uResolution; uniform vec2 uTexel; uniform float uTime; uniform float uAspect;
        uniform float cameraNear; uniform float cameraFar;
        ${GLSL_COMMON}
        float viewZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
        vec3 viewNormal(vec2 uv) { return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0); }
        ${fragment}
        void main() {
          gl_FragColor = look(vUv);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h, pixelRatio = 1) {
    const pw = Math.max(2, Math.round(w * pixelRatio * this.scale));
    const ph = Math.max(2, Math.round(h * pixelRatio * this.scale));
    this.color.setSize(pw, ph);
    if (this.normal) this.normal.setSize(pw, ph);
    this.uniforms.uResolution.value.set(pw, ph);
    this.uniforms.uTexel.value.set(1 / pw, 1 / ph);
    this.uniforms.uAspect.value = pw / ph;
  }

  render(scene, camera, time = 0) {
    const r = this.renderer;
    this.uniforms.uTime.value = time;
    this.uniforms.cameraNear.value = camera.near;
    this.uniforms.cameraFar.value = camera.far;
    r.setRenderTarget(this.color);
    r.render(scene, camera);
    if (this.normal) {
      const bg = scene.background;
      const shadows = r.shadowMap.autoUpdate;
      scene.background = null;
      r.shadowMap.autoUpdate = false;
      scene.overrideMaterial = this.normalMaterial;
      r.setRenderTarget(this.normal);
      r.setClearColor(0x8080ff, 1);
      r.clear();
      r.render(scene, camera);
      scene.overrideMaterial = null;
      scene.background = bg;
      r.shadowMap.autoUpdate = shadows;
    }
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.color.dispose();
    if (this.color.depthTexture) this.color.depthTexture.dispose();
    if (this.normal) this.normal.dispose();
    if (this.normalMaterial) this.normalMaterial.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

/** Quantise time to `fps` steps (animation "on twos"). fps <= 0 returns time unchanged. */
export function stepTime(time, fps) {
  return fps > 0 ? Math.floor(time * fps) / fps : time;
}

/** The do-nothing look: the scene as built, rendered straight to the canvas. */
export const plainLook = {
  id: 'plain',
  name: 'Clean 3D',
  era: 'modern',
  blurb: 'The scene as modelled, with physically based lighting.',
  fps: 0,
  people: {},
  create({ renderer }) {
    return {
      apply() {},
      strip() {},
      setSize() {},
      render(scene, camera) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      },
      dispose() {},
    };
  },
};
