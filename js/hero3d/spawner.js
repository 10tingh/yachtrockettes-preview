import * as THREE from 'three';
import { loadNormalized } from './loader.js';

/* Config-driven passing props. Each entry in scene.json `props` gets a pool of clones that enter at one
   side of the lane, flow past with the water, and recycle once they leave. Fields:
     model, targetSize, scale[min,max], frequency (per minute), lane left|right|both (yacht-relative),
     distance near|far|both, bobs (ride the waves), yOffset, rotation random|fixed,
     forward   which way the model's head/bow points: "+x" "-x" "+z" "-z" (default "-z")
     swim      { speed, heading: "bow"|"along"|"random"|degrees from the yacht's heading, jitter,
                 turnRate  rad/s the animal can turn at: it follows its nose through arcs of radius speed/turnRate,
                 meander   rad: slow side-to-side drift of its heading, so paths curve instead of running straight,
                 bank      roll into turns, wobble  sway of the body with the tail }
     group     swimmers sharing a group name keep clear of each other (e.g. "big" = dolphins and sharks)
     school    [min,max] spawn a group that swims together
     anim      { clip?, speed } play the model's built-in skeletal animation (e.g. dolphin Swim)
     sway      { bones[], amp[] (rad per bone), speed, lag, bend[] (rad per bone at full turn), turnNorm } add a side-to-side travelling bend through a skinned
               model's bones. The dolphin clip only flexes up and down, which hides from above; this is what reads.
     on / perHost / chance   RIDER: no timer, lives on the land of the listed prop ids (e.g. crabs on islands)
     depth     swimmers sit this far BELOW the waterline under their highest point (default world.seaDepth),
               so the yacht always draws over them
     solid     true on islands: swimmers steer around solid props
     idle      { type: bob|circle|spin } for free props, or for riders
               { type: wander, speed, radius, pause:[min,max] s, sideways (crabs), hop, tilt, gait }
     mobile:false to skip on phones, materialColors. */
const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b + 1));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/* Give the browser a turn (paint, input, the splash animation) between chunks of heavy setup work. */
const idle = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const _z = new THREE.Vector3(0, 0, 1), _q = new THREE.Quaternion();
const hostIds = (def) => (def.on == null ? [] : [].concat(def.on));

export class Spawner {
  constructor(scene, cfg, water, mobile) {
    this.scene = scene;
    this.water = water;
    this.speed = cfg.world.speed;
    this.lanes = cfg.world.lanes;
    this.seaDepth = cfg.world.seaDepth ?? 2;
    this.span = cfg.world.spawnDistance;          // half-length of the lane, along the flow
    this.flow = water.flow;
    this.bow = [-water.flow[0], -water.flow[1]];
    this.perp = [-water.flow[1], water.flow[0]];  // +1 = yacht's left-hand side
    this.freqScale = mobile ? cfg.mobile.frequencyScale : 1;
    this.defs = cfg.props.filter((p) => !(mobile && p.mobile === false));
    this.ray = new THREE.Raycaster();
    this.picks = 0;                               // ground look-ups this frame (budgeted, ray-casts are the costly part)
    this.types = [];
  }

  async init(onStep) {
    const total = this.defs.length;
    let done = 0;
    const step = () => onStep?.(++done / total);
    const mk = async (def) => {
      const g = await loadNormalized(def.model, def.targetSize, def.materialColors, def.forward, def.undulate);
      g.visible = false;
      if (def.on != null) g.userData.rider = true;
      if (def.swim) g.traverse((o) => { o.castShadow = false; });   // under water: no shadow on the surface
      // Only islands (several layers) and what stands on them receive shadows. Receiving costs a heavier shader variant per
      // material, which the GPU has to compile at load, so the yacht and the swimmers (submerged) don't.
      g.traverse((o) => { if (o.isMesh) o.receiveShadow = !!(def.solid || def.on != null); });
      this.scene.add(g);
      const item = { group: g, wiggle: g.userData.wiggle, yaw: 0, turn: 0, active: false, r: 0, x: 0, z: 0, vx: 0, vz: 0, h: [0, 0], phase: 0, host: null, mixer: null, dur: 1 };
      if (def.sway) item.sway = def.sway.bones.map((n) => g.userData.animRoot.getObjectByName(n)).filter(Boolean);
      const clips = g.userData.clips;
      if (clips?.length && def.anim !== false) {
        const clip = (def.anim?.clip && clips.find((c) => c.name === def.anim.clip)) || clips[0];
        item.mixer = new THREE.AnimationMixer(g.userData.animRoot);
        item.mixer.clipAction(clip).play();
        item.mixer.timeScale = def.anim?.speed ?? 1;
        item.dur = clip.duration;
      }
      return item;
    };

    // Free-roaming props first, then riders (their pool depends on how many hosts exist).
    const free = this.defs.filter((d) => d.on == null);
    this.types = await Promise.all(free.map(async (def) => {
      const freq = def.frequency * this.freqScale;
      const travel = (this.span * 2 + 60) / this.netSpeed(def);
      const group = def.school ? def.school[1] : 1;
      const size = Math.max(2, Math.ceil((freq / 60) * travel * 1.5) * group + 1);
      const pool = [];
      for (let i = 0; i < size; i++) { pool.push(await mk(def)); await idle(); }
      step();
      return { def, freq, pool, timer: 0 };
    }));
    const riders = await Promise.all(this.defs.filter((d) => d.on != null).map(async (def) => {
      const hosts = this.types.filter((t) => hostIds(def).includes(t.def.id)).reduce((n, t) => n + t.pool.length, 0);
      const pool = [];
      for (let i = 0; i < hosts * (def.perHost?.[1] ?? 1); i++) { pool.push(await mk(def)); await idle(); }
      step();
      return { def, freq: 0, pool, timer: Infinity };
    }));
    this.types.push(...riders);
    this.types.forEach((t) => (t.timer = this.interval(t)));
  }

  /** Typical speed a prop crosses the lane at (for sizing pools and the prewarm). */
  netSpeed(def) {
    const s = def.swim?.speed || 0;
    return Math.max(def.swim?.heading === 'bow' ? Math.abs(this.speed - s) : Math.hypot(this.speed, s) * 0.7, 0.8);
  }

  interval(t) { return t.freq > 0 ? (60 / t.freq) * (0.5 + Math.random()) : Infinity; }

  /** Fill the lane with props already underway so the first frame is never empty. */
  async prewarm() {
    for (const t of this.types) {
      if (t.def.on != null) continue;
      await idle();
      const n = Math.round((t.freq / 60) * ((this.span * 2) / this.netSpeed(t.def)));
      for (let i = 0; i < Math.min(n, t.pool.length); i++) this.spawn(t, rnd(-this.span, this.span));
    }
  }

  pos(u, v) { return [this.flow[0] * u + this.perp[0] * v, this.flow[1] * u + this.perp[1] * v]; }

  heading(swim, leader) {
    if (leader) { const a = rnd(-8, 8) * (Math.PI / 180); return rot(leader.h, a); }
    const j = rnd(-(swim.jitter || 0), swim.jitter || 0);
    // "along" = with or against the yacht, so swimmers stay in the lane and cross the view instead of wandering off
    const base = swim.heading === 'along' ? (Math.random() < 0.5 ? 0 : 180)
      : swim.heading === 'random' || swim.heading == null ? rnd(0, 360) : swim.heading === 'bow' ? 0 : swim.heading;
    return rot(this.bow, ((base + j) * Math.PI) / 180);
  }

  spawn(t, u, leader) {
    const { def } = t;
    const item = t.pool.find((p) => !p.active);
    if (!item) return false;
    const scale = def.scale ? rnd(def.scale[0], def.scale[1]) : 1;
    const r = (def.targetSize * scale) / 2;
    const swim = def.swim;
    const h = swim ? this.heading(swim, leader) : [0, 0];
    const own = swim ? [h[0] * swim.speed, h[1] * swim.speed] : [0, 0];
    const fromUpstream = this.flow[0] * (this.flow[0] * this.speed + own[0]) + this.flow[1] * (this.flow[1] * this.speed + own[1]) >= 0;
    if (u === undefined) u = fromUpstream ? -(this.span + r) : this.span + r;

    let x, z, placed = false;
    for (let attempt = 0; attempt < 5 && !placed; attempt++) {
      if (leader) {
        x = leader.x + rnd(-3, 3); z = leader.z + rnd(-3, 3);
        placed = true;
      } else {
        const left = def.lane === 'left' ? 1 : def.lane === 'right' ? -1 : Math.random() < 0.5 ? 1 : -1;
        const band = def.distance === 'near' ? this.lanes.near : def.distance === 'far' ? this.lanes.far
          : Math.random() < 0.5 ? this.lanes.near : this.lanes.far;
        [x, z] = this.pos(u, left * (band[0] + rnd(0, band[1] - band[0]) + r));
        placed = !this.overlaps(x, z, r, def.group);
      }
    }
    if (!placed) return false;

    Object.assign(item, { active: true, r, x, z, vx: own[0], vz: own[1], h, h0: h.slice(), turn: 0, phase: rnd(0, 6.28), host: null });
    const g = item.group;
    g.scale.setScalar(scale);
    item.yaw = swim ? Math.atan2(-h[0], -h[1]) : def.rotation === 'fixed' ? 0 : rnd(0, 6.28);
    g.rotation.set(0, item.yaw, 0);
    item.y0 = swim ? -g.userData.top * scale - (def.depth ?? this.seaDepth) : def.yOffset || 0;
    g.position.set(x, item.y0, z);
    g.visible = true;
    g.updateMatrixWorld(true);
    if (item.mixer) item.mixer.setTime(rnd(0, item.dur));

    if (!leader) {
      if (def.school) for (let i = irnd(def.school[0], def.school[1]) - 1; i > 0; i--) this.spawn(t, u, item);
      this.attachRiders(item, def);
    }
    return true;
  }

  /** Open ground under world point (wx, wz) on a host, or null. Cast against BOTH sides of every face: back-face culling
      hides the underside of palm fronds, which makes a canopy look like single-layer ground. A frond is a thin shell
      (a downward-facing face right under the top hit); real ground has nothing thin below it. */
  openGround(host, wx, wz) {
    this.ray.set(new THREE.Vector3(wx, 60, wz), new THREE.Vector3(0, -1, 0));
    const hits = this.castBothSides(host).filter((h) => h.point.y > 0.15);
    const hit = hits[0];
    if (!hit || hit.point.y > 4 || hit.face.normal.y < 0.6) return null;
    const under = hits.find((h, i) => i > 0 && h.face.normal.y < -0.3);
    if (under && hit.point.y - under.point.y < 0.8) return null;
    return hit;
  }

  /** Put riders (crabs, octopus) on the land of a freshly spawned host (island). */
  attachRiders(host, hostDef) {
    for (const t of this.types) {
      if (!hostIds(t.def).includes(hostDef.id) || Math.random() > (t.def.chance ?? 1)) continue;
      for (let n = irnd(...(t.def.perHost || [1, 1])); n > 0; n--) {
        const rider = t.pool.find((p) => !p.active);
        if (!rider) break;
        for (let attempt = 0; attempt < 14; attempt++) {
          const a = rnd(0, 6.28), d = Math.sqrt(Math.random()) * host.r * 0.8;
          const hit = this.openGround(host, host.x + Math.cos(a) * d, host.z + Math.sin(a) * d);
          if (!hit) continue;
          const g = rider.group;
          g.position.copy(host.group.worldToLocal(hit.point.clone()));
          g.position.y -= g.userData.bottom / host.group.scale.x;   // seat its feet on the ground, not its middle
          g.scale.setScalar(1 / host.group.scale.x);       // keep absolute size whatever the island's scale
          g.rotation.set(0, rnd(0, 6.28), 0);
          host.group.add(g);
          g.visible = true;
          Object.assign(rider, { active: true, host, phase: rnd(0, 6.28), w: { state: 'rest', timer: rnd(0.2, 1.4), flip: Math.random() < 0.5, yawT: g.rotation.y } });
          break;
        }
      }
    }
  }

  /** Ray-cast the (already positioned) this.ray against a host's own meshes, ignoring riders, double-sided. */
  castBothSides(host) {
    const meshes = [];
    const walk = (o) => { if (o.userData.rider) return; if (o.isMesh) meshes.push(o); o.children.forEach(walk); };
    walk(host.group);
    const sides = meshes.map((m) => m.material.side);
    meshes.forEach((m) => { m.material.side = THREE.DoubleSide; });
    const hits = this.ray.intersectObjects(meshes, false);
    meshes.forEach((m, i) => { m.material.side = sides[i]; });
    return hits;
  }

  release(item) {
    item.active = false;
    item.group.visible = false;
    for (const t of this.types) if (t.def.on != null) for (const p of t.pool) {
      if (p.active && p.host === item) { p.active = false; p.host = null; p.group.visible = false; p.group.removeFromParent(); }
    }
  }

  /** Heading control for swimmers. An animal has one heading that can only turn at `turnRate`, and it always moves
      along that heading, so it follows its nose through an arc (radius = speed / turnRate) instead of spinning on the
      spot. The heading it wants is its own course (original heading plus a slow meander), pushed away from islands and
      from other animals in its group; it starts turning early (`look` ahead) so avoidance is a smooth arc, not a swerve. */
  steer(p, t, dt, time) {
    const swim = t.def.swim, grp = t.def.group;
    const rate = swim.turnRate ?? 2.5;
    const look = Math.max(3, (swim.speed / rate) * 1.3);          // the distance an animal needs to begin a turn
    const base = swim.meander ? rot(p.h0, Math.sin(time * (swim.meanderSpeed ?? 0.45) + p.phase) * swim.meander) : p.h0;
    let rx = 0, rz = 0;

    const avoid = (q, limit, hard, share) => {
      const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz) || 1e-3;
      if (d > limit + look) return;
      const ox = dx / d, oz = dz / d;
      const w = Math.min(1, (limit + look - d) / look);           // 0 far .. 1 at the limit
      const side = Math.sign(-oz * p.h[0] + ox * p.h[1]) || 1;     // go round on the side the heading already leans to
      const k = w * w * 3;
      rx += (ox * 0.6 - oz * side) * k;
      rz += (oz * 0.6 + ox * side) * k;
      if (d < hard) { const push = (hard - d) * share; p.x += ox * push; p.z += oz * push; }   // backstop: never overlap
    };
    for (const o of this.types) {
      if (o.def.solid) {
        for (const q of o.pool) if (q.active) avoid(q, q.r * 0.95 + p.r + 1.2, q.r * 0.95 + p.r + 1.2, 1);
      } else if (grp && o.def.group === grp) {
        for (const q of o.pool) if (q.active && q !== p) {
          const sum = (p.r + q.r) * 0.98;                          // the full half-lengths: bodies can't overlap, even nose to tail
          avoid(q, sum + 2, sum, 0.5);                             // each of the pair gives half the room
        }
      }
    }

    const dx = base[0] + rx, dz = base[1] + rz, m = Math.hypot(dx, dz) || 1;
    const want = [dx / m, dz / m];
    const diff = Math.atan2(p.h[0] * want[1] - p.h[1] * want[0], p.h[0] * want[0] + p.h[1] * want[1]);
    p.h = rot(p.h, Math.max(-rate * dt, Math.min(rate * dt, diff)));
    p.vx = p.h[0] * swim.speed;
    p.vz = p.h[1] * swim.speed;

    const yaw = Math.atan2(-p.h[0], -p.h[1]);                      // body points exactly along the heading
    p.turn += ((wrap(yaw - p.yaw) / Math.max(dt, 1e-4)) - p.turn) * Math.min(1, dt * 6);   // smoothed turn rate, for banking
    p.yaw = yaw;
    p.group.rotation.set(0, p.yaw, swim.bank ? Math.max(-0.45, Math.min(0.45, p.turn * swim.bank)) : 0);   // bank into the turn
  }

  /** Side-to-side bend through a skinned model's spine, on top of whatever its clip does. Bone local X is the lateral
      axis (the clip pitches about it), so local Z is the body's vertical axis: turning about Z bends the body sideways.
      The wave travels tailward (`lag` per bone) and grows toward the tail; the body also curves into the turn it is making. */
  sway(p, cfg, time) {
    const turn = Math.max(-1, Math.min(1, p.turn / (cfg.turnNorm ?? 1)));     // -1..1: how hard it is turning, and which way
    p.sway.forEach((bone, i) => {
      const a = cfg.amp[i] ?? cfg.amp[cfg.amp.length - 1];
      const curve = -turn * (cfg.bend?.[i] ?? 0);                             // independent of the beat; negative so the tail trails to the INSIDE of the arc
      _q.setFromAxisAngle(_z, a * Math.sin(time * cfg.speed - i * cfg.lag + p.phase) + curve);
      bone.quaternion.multiply(_q);
    });
  }

  /** Riders wander over their island: rest a moment, pick a nearby spot of open ground, walk there, rest again. */
  wander(p, idle, dt, time) {
    const g = p.group, host = p.host, hs = host.group.scale.x, w = p.w;
    if (w.state === 'rest') {
      w.timer -= dt;
      if (w.timer <= 0 && this.picks < 1) {                        // at most one ground look-up per frame
        this.picks++;
        const spot = this.pickSpot(p, host, hs, idle);
        if (spot) {
          const dx = spot.x - g.position.x, dz = spot.z - g.position.z;
          Object.assign(w, { state: 'walk', tx: spot.x, ty: spot.y, tz: spot.z, sx: g.position.x, sy: g.position.y, sz: g.position.z, t: 0, len: Math.hypot(dx, dz) || 1e-3, flip: Math.random() < 0.5 });
          w.yawT = idle.sideways ? Math.atan2(-dz, dx) + (w.flip ? Math.PI : 0) : Math.atan2(-dx, -dz);   // crabs walk sideways
        } else w.timer = rnd(0.5, 1.2);
      }
    } else {
      w.t += ((idle.speed || 1) / hs) * dt;
      const k = Math.min(1, w.t / w.len);
      const hop = (idle.hop ?? 0) / hs * Math.abs(Math.sin(time * (idle.gait ?? 9) + p.phase));
      g.position.set(w.sx + (w.tx - w.sx) * k, w.sy + (w.ty - w.sy) * k + hop, w.sz + (w.tz - w.sz) * k);
      if (k >= 1) { w.state = 'rest'; w.timer = rnd(...(idle.pause || [0.5, 2])); }
    }
    if (w.yawT !== undefined) g.rotation.y += wrap(w.yawT - g.rotation.y) * Math.min(1, dt * 5);
    const rock = w.state === 'walk' ? Math.sin(time * (idle.gait ?? 9) * 0.5 + p.phase) * (idle.tilt ?? 0.1) : 0;
    g.rotation.z += (rock - g.rotation.z) * Math.min(1, dt * 10);
  }

  pickSpot(p, host, hs, idle) {
    const g = p.group;
    for (let attempt = 0; attempt < 6; attempt++) {
      // keep going roughly the way it was heading (within ~100 degrees), only now and then turn right round, so the
      // path wanders in curves instead of shuttling back and forth
      const a = p.w.prevDir !== undefined && Math.random() < 0.8 ? p.w.prevDir + rnd(-1.75, 1.75) : rnd(0, 6.28);
      const d = rnd(1.0, idle.radius || 3);                                // world units
      const cx = g.position.x + (Math.cos(a) * d) / hs, cz = g.position.z + (Math.sin(a) * d) / hs;   // host-local
      const wp = host.group.localToWorld(new THREE.Vector3(cx, 0, cz));
      const hit = this.openGround(host, wp.x, wp.z);
      if (!hit) continue;
      const loc = host.group.worldToLocal(hit.point.clone());
      const ty = loc.y - g.userData.bottom / hs;
      if (Math.abs(ty - g.position.y) > 0.8 * (d / hs)) continue;           // not up or down a cliff
      p.w.prevDir = a;
      return { x: loc.x, y: ty, z: loc.z };
    }
    return null;
  }

  overlaps(x, z, r, grp) {
    for (const t of this.types) {
      if (t.def.on != null) continue;
      const k = grp && t.def.group === grp ? 1.0 : 0.85;           // animals of the same group get the full room
      for (const p of t.pool) {
        if (p.active && Math.hypot(p.x - x, p.z - z) < (p.r + r) * k) return true;
      }
    }
    return false;
  }

  update(dt, time) {
    const [fx, fz] = this.flow, [px, pz] = this.perp;
    this.picks = 0;
    for (const t of this.types) {
      t.timer -= dt;
      if (t.timer <= 0) t.timer = this.spawn(t) ? this.interval(t) : 2; // blocked: retry soon

      const { def } = t, idle = def.idle;
      for (const p of t.pool) {
        if (!p.active) continue;
        const g = p.group;
        if (p.mixer) p.mixer.update(dt);
        if (p.sway) this.sway(p, def.sway, time);
        if (p.wiggle) p.wiggle.uT.value = time * (def.undulate.speed || 6) + p.phase * 3;

        if (p.host) {   // rider: wanders over its island
          if (idle?.type === 'wander') this.wander(p, idle, dt, time);
          continue;
        }

        p.x += (fx * this.speed + p.vx) * dt;
        p.z += (fz * this.speed + p.vz) * dt;
        const u = fx * p.x + fz * p.z, v = px * p.x + pz * p.z;
        if (u - p.r > this.span || u + p.r < -this.span - 30 || Math.abs(v) - p.r > 30) { this.release(p); continue; }

        if (def.swim) this.steer(p, t, dt, time);
        let x = p.x, z = p.z, y = p.y0;
        if (def.bobs) y += this.water.height(x, z, time) * 0.8;
        if (idle?.type === 'bob') y += Math.sin(time * (idle.speed || 1.5) + p.phase) * (idle.amp || 0.15);
        else if (idle?.type === 'circle') {
          const a = time * (idle.speed || 0.6) + p.phase;
          x += Math.cos(a) * (idle.radius || 4);
          z += Math.sin(a) * (idle.radius || 4);
          y += idle.height || 6;
          g.rotation.y = -a;
        } else if (idle?.type === 'spin') g.rotation.y += (idle.speed || 1) * dt;
        if (def.swim?.wobble && p.wiggle) g.rotation.y = p.yaw + Math.sin(p.wiggle.uT.value * 0.5) * def.swim.wobble;   // snake side to side with the tail
        g.position.set(x, y, z);
      }
    }
  }
}

function rot([x, z], a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - z * s, x * s + z * c];
}
