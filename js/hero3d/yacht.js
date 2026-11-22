import * as THREE from 'three';
import { loadNormalized } from './loader.js';
import { Particles } from './particles.js';

// Rotation about Y that turns the model's bow axis toward -Z.
const BOW_ROT = { '+x': Math.PI / 2, '-x': -Math.PI / 2, '+z': Math.PI, '-z': 0 };

export async function createYacht(cfg, water, scene) {
  const yc = cfg.yacht;
  const speed = cfg.world.speed;
  const flow = water.flow;                       // world flows opposite to the bow
  const model = await loadNormalized(yc.model, yc.targetSize, yc.materialColors);

  // heading (yaw to the bow direction) > pivot (bob, pitch, roll) > orient (model's own bow axis) > model
  const orient = new THREE.Group();
  orient.rotation.y = BOW_ROT[yc.bowAxis] ?? 0;
  orient.add(model);
  const pivot = new THREE.Group();
  pivot.add(orient);
  const heading = new THREE.Group();
  const yaw = Math.atan2(flow[0], flow[1]);      // maps -Z onto the bow direction (-flow)
  heading.rotation.y = yaw;
  heading.add(pivot);
  scene.add(heading);

  const L = yc.targetSize;
  const W = Math.min(model.userData.size.x, model.userData.size.z);
  const half = L / 2;
  // World-space unit vectors: ahead (bow), and the ship's right-hand side.
  const bow = [-flow[0], -flow[1]];
  const right = [Math.cos(yaw), -Math.sin(yaw)];

  let now = 0;
  const follow = (x, z) => water.height(x, z, now) + 0.07;
  const wake = new Particles(Math.ceil(yc.wake.rate * yc.wake.life * 1.5), { follow, color: yc.wake.color });
  const spray = new Particles(160, { gravity: 9, color: yc.spray.color });
  scene.add(wake.points, spray.points);
  let wakeCarry = 0, sprayCarry = 0;
  const r = Math.random;
  const h = (t, a, b) => water.height(bow[0] * a + right[0] * b, bow[1] * a + right[1] * b, t);

  function update(dt, t) {
    now = t;
    // Sample the same waves the water uses, fore/aft and port/starboard.
    const hF = h(t, half * 0.7, 0), hB = h(t, -half * 0.7, 0), hL = h(t, 0, -W), hR = h(t, 0, W);
    pivot.position.y = ((hF + hB + hL + hR) / 4) * yc.bobGain + yc.yOffset + Math.sin(t * 1.3) * 0.03;
    pivot.rotation.x = Math.atan2(hF - hB, L * 1.4) * yc.pitchGain;
    pivot.rotation.z = Math.atan2(hR - hL, W * 2) * yc.rollGain;
    pivot.rotation.y = Math.sin(t * 0.35) * 0.02;

    // Wake: a V of foam off the stern, carried along with the water.
    const wk = yc.wake;
    wakeCarry += wk.rate * dt;
    while (wakeCarry >= 1) {
      wakeCarry--;
      const side = r() < 0.5 ? -1 : 1;
      const spread = r() < 0.3 ? 0.1 : 0.45;
      const lat = side * W * 0.3 * r();
      const out = side * (0.1 + r() * 0.5) * spread;
      const a = -half * 0.85;
      wake.emit(bow[0] * a + right[0] * lat, 0, bow[1] * a + right[1] * lat,
        flow[0] * speed * (0.9 + r() * 0.2) + right[0] * out, 0, flow[1] * speed * (0.9 + r() * 0.2) + right[1] * out,
        wk.life * (0.7 + r() * 0.5), wk.size[0] * (0.7 + r() * 0.6), wk.size[1] * (0.8 + r() * 0.5), wk.alpha * (0.6 + r() * 0.4));
    }
    wake.update(dt);

    // Bow spray: short upward flicks off both sides of the stem.
    const sp = yc.spray;
    sprayCarry += sp.rate * dt;
    while (sprayCarry >= 1) {
      sprayCarry--;
      const side = r() < 0.5 ? -1 : 1;
      const a = half * 0.8, lat = side * W * 0.3;
      const out = side * (0.3 + r() * 0.8);
      spray.emit(bow[0] * a + right[0] * lat, pivot.position.y - 0.1, bow[1] * a + right[1] * lat,
        flow[0] * speed * 0.6 + right[0] * out, 1.4 + r() * 1.6, flow[1] * speed * 0.6 + right[1] * out,
        sp.life * (0.6 + r() * 0.6), 0.12, 0.34, sp.alpha);
    }
    spray.update(dt);
  }

  return { pivot: heading, update, particles: [wake, spray] };
}
