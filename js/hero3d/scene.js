import * as THREE from 'three';

/* Top-down view on a transparent canvas: no sky, no fog. The page's white is the sea; a shadow-catcher
   plane grounds the yacht and islands on it. */
export function createScene(canvas, cfg, mobile) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setClearColor(0xffffff, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? cfg.mobile.pixelRatio : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const cam = cfg.camera;
  const camera = new THREE.PerspectiveCamera(mobile ? cam.fovMobile : cam.fov, 1, 1, 400);
  const basePos = new THREE.Vector3(...cam.position);
  const lookAt = new THREE.Vector3(...cam.lookAt);
  camera.position.copy(basePos);
  camera.lookAt(lookAt);

  // Soft key light from the upper left (casts the shadows toward the lower right) + white fill.
  const lc = cfg.light;
  const sun = new THREE.DirectionalLight(lc.color, lc.sun);
  sun.position.set(...lc.sunPos);
  sun.castShadow = true;
  const mapSize = mobile ? cfg.mobile.shadowMap : lc.shadowMap;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const e = lc.shadowExtent;
  Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 5, far: 180 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;   // stops self-shadow speckle now that every mesh receives shadows
  sun.shadow.radius = 4;
  scene.add(sun, new THREE.HemisphereLight('#FFFFFF', '#E6F4F4', lc.ambient));

  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ color: 0x0b1530, opacity: lc.shadowOpacity })
  );
  shadowPlane.position.y = 0.02;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  const pointer = { x: 0, y: 0 };
  const smooth = { x: 0, y: 0 };
  const shift = mobile ? cam.frameShiftMobile : cam.frameShift;

  function resize() {
    const p = canvas.parentElement;
    const w = Math.max(1, p.clientWidth), h = Math.max(1, p.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Shift the framing so the yacht sits right of centre, clear of the headline.
    camera.setViewOffset(w, h, -shift[0] * w, shift[1] * h, w, h);
    camera.updateProjectionMatrix();
  }

  function update(dt) {
    const k = 1 - Math.exp(-3 * dt);
    smooth.x += (pointer.x - smooth.x) * k;
    smooth.y += (pointer.y - smooth.y) * k;
    camera.position.set(basePos.x + smooth.x * cam.parallax[0], basePos.y, basePos.z + smooth.y * cam.parallax[1]);
    camera.lookAt(lookAt);
  }

  return {
    renderer, scene, camera, pointer, resize, update,
    pixelScale: () => renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360)),
    render: () => renderer.render(scene, camera),
  };
}
