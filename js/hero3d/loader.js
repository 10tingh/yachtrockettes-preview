import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const gltf = new GLTFLoader();
const cache = new Map();

function loadGltf(url) {
  if (!cache.has(url)) cache.set(url, gltf.loadAsync(url));
  return cache.get(url);
}

// Rotation about Y that turns a model's own forward axis (the way its head/bow points) toward -Z.
export const FORWARD_ROT = { '+x': Math.PI / 2, '-x': -Math.PI / 2, '+z': Math.PI, '-z': 0 };

/**
 * Load a .glb and normalise it: scaled so its longest horizontal side equals `targetSize`,
 * centred on X/Z, Y left as authored (model origin = waterline), and turned so its `forward` axis
 * (default "-z") points down -Z. Cloned per call (skeleton-safe), geometry/materials shared.
 * `colors` optionally overrides base colour by material name, e.g. { Yacht: "#FFFFFF" }.
 * Returns a Group; userData.size is the final bounding-box size, userData.clips any animation clips.
 */
export async function loadNormalized(url, targetSize, colors, forward = '-z', undulate = null) {
  const src = await loadGltf(url);
  const root = cloneSkinned(src.scene);
  // Skinned meshes must be measured with their skeleton posed, or the bind-pose box is wrong.
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.boundingBox = null; o.computeBoundingBox(); } });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const s = targetSize / Math.max(size.x, size.z);

  // Procedural body motion for rigid meshes: bend the vertices in the shader (per-instance uniforms).
  const wiggle = undulate ? { uT: { value: 0 }, uAmp: { value: undulate.amp ?? 0.08 }, uFreq: { value: undulate.freq ?? 1 } } : null;
  const glsl = wiggle && undulateGLSL(box, forward, undulate.mode);

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    if (o.isSkinnedMesh) o.frustumCulled = false;   // bind-pose bounds are wrong once animated
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    // glTF defaults to fully metallic; with no environment map that renders black, so tame it.
    mats.forEach((m) => { if (m.isMeshStandardMaterial && m.metalness > 0.5) m.metalness = 0.1; });
    if (!colors && !wiggle) return;
    const out = mats.map((m) => {
      const hex = colors?.[m.name];
      if (!hex && !wiggle) return m;
      const n = m.clone();                       // own material so this instance owns its uniforms
      if (hex) n.color.set(hex);
      if (wiggle) patchUndulate(n, wiggle, glsl);
      return n;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });

  root.position.set(-c.x, 0, -c.z);
  const inner = new THREE.Group();
  inner.add(root);
  inner.scale.setScalar(s);
  const orient = new THREE.Group();
  orient.rotation.y = FORWARD_ROT[forward] ?? 0;
  orient.add(inner);
  const outer = new THREE.Group();
  outer.add(orient);
  outer.userData.bottom = box.min.y * s;         // lowest point below the model origin (feet, for riders)
  outer.userData.top = box.max.y * s;            // height of the highest point above the model origin (waterline)
  outer.userData.size = size.multiplyScalar(s);
  outer.userData.clips = src.animations;
  outer.userData.animRoot = root;
  outer.userData.wiggle = wiggle;
  return outer;
}

/* GLSL snippet that bends a mesh. Linear mode: a travelling wave across the body, zero at the head and
   growing toward the tail (fish, sharks). Radial mode: a ripple travelling out along the arms (octopus). */
function undulateGLSL(box, forward, mode) {
  const f = (n) => n.toFixed(4);
  if (mode === 'radial') {
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const R = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
    return `vec2 d_ = position.xz - vec2(${f(cx)}, ${f(cz)}); float r_ = clamp(length(d_) / ${f(R)}, 0.0, 1.0);
      transformed.xz += normalize(d_ + 1e-5) * sin(r_ * uFreq * 6.2832 - uT) * uAmp * ${f(R)} * r_;`;
  }
  const axis = forward.endsWith('x') ? 'x' : 'z', lat = axis === 'x' ? 'z' : 'x';
  const lo = box.min[axis], len = box.max[axis] - box.min[axis];
  const headAtMax = forward.startsWith('+');
  return `float k_ = clamp((position.${axis} - ${f(lo)}) / ${f(len)}, 0.0, 1.0); ${headAtMax ? 'k_ = 1.0 - k_;' : ''}
      transformed.${lat} += sin(k_ * uFreq * 6.2832 - uT) * uAmp * ${f(len)} * (0.08 + 0.92 * k_ * k_);`;
}

function patchUndulate(mat, u, glsl) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uT: u.uT, uAmp: u.uAmp, uFreq: u.uFreq });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uT, uAmp, uFreq;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + glsl);
  };
  mat.customProgramCacheKey = () => glsl;
}
