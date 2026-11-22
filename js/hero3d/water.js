import * as THREE from 'three';

/* The yacht sails toward the bow direction; the world flows the other way. `flow` is that unit vector
   on the XZ plane (x right, z down the screen). headingDeg 0 = straight left, positive = toward the bottom. */
export function getFlow(cfg) {
  const a = (cfg.world.headingDeg * Math.PI) / 180;
  return [Math.cos(a), -Math.sin(a)];
}

/* One wave table drives the JS height query (yacht bob / roll, foam). The look of the water is the shader below. */
const WAVES = [
  { dx: 0.0, dz: 1.0, k: 0.34, a: 1.0, s: 1.1 },
  { dx: 0.6, dz: 0.8, k: 0.62, a: 0.5, s: 1.5 },
  { dx: -0.7, dz: 0.7, k: 1.05, a: 0.26, s: 1.9 },
];

/* Stylized flat water, drawn as a top-down illustration on a transparent plane (the page's white shows at the edges):
     1. a soft body in three pale aqua tones, laid out as long flowing bands (domain-warped noise, toon-stepped)
     2. thin white foam crests riding the band edges, broken into dashes
     3. a little fine ripple texture (desktop)
     4. crisp four-point sun glints, denser along the sun's glitter path
   Everything scrolls past the hull so the boat reads as moving. */
export function createWater(cfg, mobile) {
  const wc = cfg.water;
  const waves = WAVES.slice(0, mobile ? cfg.mobile.waveCount : WAVES.length);
  const speed = cfg.world.speed;
  const flow = getFlow(cfg);

  const height = (x, z, t) => {
    const px = x - flow[0] * speed * t, pz = z - flow[1] * speed * t;
    let h = 0;
    for (const w of waves) h += w.a * Math.sin(w.k * (w.dx * px + w.dz * pz) + w.s * wc.waveSpeed * t);
    return h * wc.waveHeight;
  };

  const uniforms = {
    uT: { value: 0 },
    uSpeed: { value: speed },
    uFlow: { value: new THREE.Vector2(...flow) },
    uSimple: { value: mobile && cfg.mobile.simpleWater ? 1 : 0 },
    uPale: { value: new THREE.Color(wc.pale) },
    uMid: { value: new THREE.Color(wc.mid) },
    uDeep: { value: new THREE.Color(wc.deep) },
    uFoam: { value: new THREE.Color(wc.foam) },
    uBodyAlpha: { value: wc.bodyAlpha },
    uSwell: { value: wc.swellScale },
    uFoamAmt: { value: wc.foamAmount },
    uSparkColor: { value: new THREE.Color(wc.sparkle.color) },
    uSparkAmt: { value: wc.sparkle.amount },
    uSparkSize: { value: wc.sparkle.size },
    uSunDir: { value: new THREE.Vector3(...cfg.light.sunPos).normalize() },
    uGlitterDir: { value: new THREE.Vector2(cfg.light.sunPos[0], cfg.light.sunPos[2]).normalize() },   // the glitter path runs toward the sun
    uGlitterW: { value: wc.sparkle.pathWidth },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: 'varying vec2 vXZ; void main(){ vXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform vec3 uPale, uMid, uDeep, uFoam, uSparkColor, uSunDir;
      uniform float uSimple, uT, uSpeed, uBodyAlpha, uSwell, uFoamAmt, uSparkAmt, uSparkSize, uGlitterW;
      uniform vec2 uFlow, uGlitterDir;
      varying vec2 vXZ;

      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
        return v;
      }

      vec3 col = vec3(0.0);   // premultiplied result, built up layer by layer
      float acc = 0.0;
      void over(vec3 c, float a) { col = c * a + col * (1.0 - a); acc = a + acc * (1.0 - a); }

      void main() {
        vec2 q = vXZ - uFlow * uSpeed * uT;               // everything scrolls past the hull

        // Long, flowing swell shapes: warp the lookup with slow noise, then read a smooth field.
        vec2 warp = vec2(fbm(q * 0.07 + vec2(0.0, uT * 0.04)), fbm(q * 0.07 + vec2(8.3, 2.1) - vec2(uT * 0.03, 0.0)));
        vec2 p = q + (warp - 0.44) * 10.0;
        float n = fbm(p * uSwell);                        // roughly 0.15 .. 0.75

        // 1. the body: three pale aqua tones, stepped like an illustration, with anti-aliased edges
        float aa = fwidth(n) * 1.3 + 1e-5;
        float b1 = smoothstep(0.43 - aa, 0.43 + aa, n);
        float b2 = smoothstep(0.55 - aa, 0.55 + aa, n);
        vec3 body = mix(uPale, uMid, b1);
        body = mix(body, uDeep, b2);
        over(body, uBodyAlpha);

        // 2. white foam crests along the band edges, broken into dashes so they feel drawn by hand
        float edge = min(abs(n - 0.55), abs(n - 0.43) * 1.5);
        float crest = 1.0 - smoothstep(0.0, fwidth(n) * 2.6 + 1e-5, edge);   // a steady ~2-3px line wherever it falls
        float dashes = smoothstep(0.32, 0.62, vnoise(p * 0.8 + 4.4));
        over(uFoam, clamp(crest * dashes * uFoamAmt, 0.0, 1.0));

        // 3. fine ripple texture: faint short pale strokes, desktop only
        if (uSimple < 0.5) {
          float r = fbm(p * 0.34 + 11.0);
          float ripple = 1.0 - smoothstep(0.0, fwidth(r) * 1.6 + 0.01, abs(fract(r * 7.0) - 0.5) - 0.42);
          over(uFoam, clamp(ripple * 0.22 * smoothstep(0.3, 0.6, vnoise(p * 0.5 + 2.0)), 0.0, 1.0));
        }

        // 4. sun glints. The water is a grid of tiny cells that keep re-tilting at random moments; a cell flashes only
        //    when its tilt mirrors the sun into the camera (a real specular highlight), drawn as a crisp four-point star.
        //    Denser along the sun's glitter path, a broad band through the yacht toward the sun.
        vec3 V = normalize(cameraPosition - vec3(vXZ.x, 0.0, vXZ.y));
        vec3 H = normalize(normalize(uSunDir) + V);
        float across = uGlitterDir.x * vXZ.y - uGlitterDir.y * vXZ.x;
        float path = 0.15 + 0.85 * exp(-across * across / (2.0 * uGlitterW * uGlitterW));
        vec2 g = q * 1.7;
        vec2 id = floor(g);
        vec2 uv = fract(g) - 0.5;
        float clock = uT * 1.4 + hash(id + 3.3) * 24.0;
        float flashIx = floor(clock);
        float life = fract(clock);
        vec2 tilt = (vec2(hash(id + flashIx * 7.13), hash(id + flashIx * 3.71 + 5.1)) - 0.5) * 0.9;
        float aimed = smoothstep(1.0 - uSparkSize * path, 1.0, dot(normalize(vec3(tilt.x, 1.0, tilt.y)), H));
        vec2 d = uv - (vec2(hash(id + flashIx + 1.3), hash(id + flashIx + 8.9)) - 0.5) * 0.4;
        float glint = aimed * sin(life * 3.14159) * uSparkAmt;
        float dot_ = smoothstep(0.16, 0.0, length(d));
        float star = max(exp(-abs(d.x) * 26.0) * exp(-abs(d.y) * 4.5), exp(-abs(d.y) * 26.0) * exp(-abs(d.x) * 4.5));
        over(uSparkColor, clamp(glint * smoothstep(0.5, 0.0, length(d)) * 0.35, 0.0, 1.0));       // soft warm glow
        over(vec3(1.0, 0.99, 0.93), clamp(glint * max(dot_ * 1.6, star * 1.3), 0.0, 1.0));       // bright star + core

        gl_FragColor = vec4(col / max(acc, 1e-4), acc);   // back to straight alpha for normal blending
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wc.size, wc.size).rotateX(-Math.PI / 2), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  return { mesh, height, flow, update: (t) => (uniforms.uT.value = t) };
}
