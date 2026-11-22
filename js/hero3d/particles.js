import * as THREE from 'three';

/* Tiny ring-buffer particle system: soft white dots that grow and fade. Used for wake foam and bow spray. */
export class Particles {
  constructor(max, { gravity = 0, follow = null, color = '#ffffff' } = {}) {
    this.max = max;
    this.next = 0;
    this.gravity = gravity;
    this.follow = follow; // (x, z) => y, keeps foam riding the water surface
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1);
    this.life = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 600 }, uColor: { value: new THREE.Color(color) } },
      vertexShader: `
        attribute float aAlpha, aSize; uniform float uScale; varying float vA;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
          gl_Position.z -= 0.003 * gl_Position.w;   // bias toward camera so nearer wave crests don't slice the sprite in half
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.25, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setPixelScale(s) { this.material.uniforms.uScale.value = s; }

  emit(x, y, z, vx, vy, vz, life, s0, s1, a0) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.age[i] = 0; this.life[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
  }

  update(dt) {
    const { pos, vel, age, life, s0, s1, a0, alpha, size, gravity, follow } = this;
    for (let i = 0; i < this.max; i++) {
      if (age[i] >= life[i]) continue;
      age[i] += dt;
      if (age[i] >= life[i]) { alpha[i] = 0; size[i] = 0; continue; }
      const k = age[i] / life[i], j = i * 3;
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt;
      vel[j + 1] -= gravity * dt;
      if (follow) pos[j + 1] = follow(pos[j], pos[j + 2]);
      alpha[i] = a0[i] * Math.min(k * 10, 1) * (1 - k);
      size[i] = s0[i] + (s1[i] - s0[i]) * k;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.aAlpha.needsUpdate = g.attributes.aSize.needsUpdate = true;
  }
}
