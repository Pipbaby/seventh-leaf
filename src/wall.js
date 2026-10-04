// The wall: COLS × ROWS split-flap cells. Each cell is two fixed halves and one falling leaf.
// A leaf's front carries the top half of the image it is leaving, its back the bottom half of the
// image it is going to — exactly like a physical split-flap module.
import * as THREE from '../vendor/three/three.module.min.js';

export const COLS = 12;
export const ROWS = 7;
const CW = 1; // cell pitch (square cells, as in the exhibition)
const CH = 1;
const GAP = 0.045; // black frame between cells
const SPLIT = 0.0035; // hairline between the two halves
const LW = CW - GAP;
const HH = (CH - GAP) / 2 - SPLIT;
export const WALL_W = COLS * CW;
export const WALL_H = ROWS * CH;
export const WALL_ASPECT = WALL_W / WALL_H;

const vert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const frag = /* glsl */ `
  uniform sampler2D map;
  uniform sampler2D bg;
  uniform vec4 xform;   // image uv = wall uv * xy + zw
  uniform vec4 rect;    // this plane's rectangle in wall uv
  uniform float shade;  // shadow cast by a passing leaf
  uniform float mode;   // 0 printed leaves, 1 projected onto dark leaves
  uniform vec3 lightDir;
  uniform sampler2D projA;
  uniform sampler2D projB;
  uniform sampler2D projBgA;
  uniform sampler2D projBgB;
  uniform vec4 projXA;
  uniform vec4 projXB;
  uniform float projMix;
  uniform vec3 projPos;
  uniform vec2 wallSize;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vW;

  // Satin-printed leaves reflect the gallery: a long light panel above and in front of the wall,
  // a dim ceiling, the dark room. Flat leaves facing the viewer reflect the room and stay matt;
  // a leaf tipped up by a few degrees catches the panel and flashes.
  vec3 room(vec3 R) {
    float panel = smoothstep(0.1, 0.24, R.y) * (1.0 - smoothstep(0.5, 0.65, R.y)) * smoothstep(-0.1, 0.35, R.z)
      * (1.0 - smoothstep(0.55, 0.9, abs(R.x)));
    float ceiling = smoothstep(0.04, 0.5, R.y) * 0.35;
    return vec3(1.0, 0.97, 0.92) * (panel * 1.8 + ceiling + 0.02);
  }

  vec3 sampleSource(sampler2D m, sampler2D b, vec4 x, vec2 wuv) {
    vec2 iuv = wuv * x.xy + x.zw;
    if (iuv.x < 0.0 || iuv.y < 0.0 || iuv.x > 1.0 || iuv.y > 1.0) return texture2D(b, wuv).rgb;
    return texture2D(m, iuv).rgb;
  }

  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    float lambert = max(dot(n, normalize(lightDir)), 0.0);
    // the viewing direction of the wall as a whole: a leaf at rest reflects the same thing wherever
    // it is on the wall, so only leaves that tip (wobbling, flipping) catch the light panel
    vec3 V = normalize(cameraPosition);
    float nv = max(dot(n, V), 0.0);
    float fres = 0.05 + 0.95 * pow(1.0 - nv, 5.0);
    vec3 refl = room(reflect(-V, n)) * mix(0.16, 0.9, fres);
    vec3 col;
    if (mode < 0.5) {
      vec2 wuv = mix(rect.xy, rect.zw, vUv);
      vec3 art = sampleSource(map, bg, xform, wuv);
      // satin print under gallery light; leaves facing down go dark, facing up catch the light
      float light = 0.56 + 0.6 * lambert;
      col = art * light * (1.0 - shade) + refl * (1.0 - 0.7 * shade);
    } else {
      // a projector in front of the wall: each point takes the pixel on the ray from the lens
      vec3 toP = projPos - vW;
      float s = projPos.z / max(toP.z, 0.001);
      vec2 hit = projPos.xy + (vW.xy - projPos.xy) * s;
      vec2 puv = hit / wallSize + 0.5;
      vec3 a = sampleSource(projA, projBgA, projXA, puv);
      vec3 b = sampleSource(projB, projBgB, projXB, puv);
      vec3 p = mix(a, b, projMix);
      float facing = max(dot(n, normalize(toP)), 0.0);
      vec3 leaf = vec3(0.035, 0.035, 0.04);
      col = leaf * (0.5 + lambert) + p * facing * 0.95 * (1.0 - 0.6 * shade) + refl * 0.8;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLANK.needsUpdate = true;

export class Wall {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c0c0e);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    this.view = { yaw: 0, pitch: 0, dist: 1, targetYaw: 0, targetPitch: 0, targetDist: 1 };

    this.global = {
      mode: { value: 0 },
      lightDir: { value: new THREE.Vector3(0.15, 0.75, 0.65) },
      projA: { value: BLANK },
      projB: { value: BLANK },
      projBgA: { value: BLANK },
      projBgB: { value: BLANK },
      projXA: { value: new THREE.Vector4(1, 1, 0, 0) },
      projXB: { value: new THREE.Vector4(1, 1, 0, 0) },
      projMix: { value: 0 },
      projPos: { value: new THREE.Vector3(0, 0.6, 16) },
      wallSize: { value: new THREE.Vector2(WALL_W, WALL_H) },
    };

    this.#build();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  #material(rect) {
    return new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        ...this.global,
        map: { value: BLANK },
        bg: { value: BLANK },
        xform: { value: new THREE.Vector4(1, 1, 0, 0) },
        rect: { value: rect },
        shade: { value: 0 },
      },
    });
  }

  #build() {
    // backing board and outer frame
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(WALL_W + 0.5, WALL_H + 0.5),
      new THREE.MeshBasicMaterial({ color: 0x050505 }),
    );
    board.position.z = -0.12;
    this.scene.add(board);
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x111113 });
    for (const [w, h, x, y] of [
      [WALL_W + 0.5, 0.25, 0, WALL_H / 2 + 0.125],
      [WALL_W + 0.5, 0.25, 0, -WALL_H / 2 - 0.125],
      [0.25, WALL_H + 0.5, -WALL_W / 2 - 0.125, 0],
      [0.25, WALL_H + 0.5, WALL_W / 2 + 0.125, 0],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), frameMat);
      m.position.set(x, y, -0.04);
      this.scene.add(m);
    }

    const topG = new THREE.PlaneGeometry(LW, HH).translate(0, HH / 2 + SPLIT, 0);
    const botG = new THREE.PlaneGeometry(LW, HH).translate(0, -HH / 2 - SPLIT, 0);
    // the leaf's back, stored where it sits before falling: it lands as an upright bottom half
    const backG = botG.clone().rotateX(Math.PI);

    this.cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = (c - (COLS - 1) / 2) * CW;
        const y = ((ROWS - 1) / 2 - r) * CH;
        // wall uv of this cell's halves
        const u0 = (x - LW / 2 + WALL_W / 2) / WALL_W;
        const u1 = (x + LW / 2 + WALL_W / 2) / WALL_W;
        const vMid = (y + WALL_H / 2) / WALL_H;
        const topRect = new THREE.Vector4(u0, vMid + SPLIT / WALL_H, u1, vMid + (SPLIT + HH) / WALL_H);
        const botRect = new THREE.Vector4(u0, vMid - (SPLIT + HH) / WALL_H, u1, vMid - SPLIT / WALL_H);

        const g = new THREE.Group();
        g.position.set(x, y, 0);
        // fixed halves lean very slightly, as real leaves do
        const top = new THREE.Mesh(topG, this.#material(topRect));
        const bot = new THREE.Mesh(botG, this.#material(botRect));
        top.rotation.x = -0.015 - Math.random() * 0.02;
        bot.rotation.x = 0.01 + Math.random() * 0.02;
        const topRest = top.rotation.x;
        const botRest = bot.rotation.x;
        const pivot = new THREE.Group();
        pivot.position.z = 0.006;
        const front = new THREE.Mesh(topG, this.#material(topRect));
        const back = new THREE.Mesh(backG, this.#material(botRect));
        pivot.add(front, back);
        pivot.visible = false;
        g.add(top, bot, pivot);
        this.scene.add(g);
        this.cells.push({ c, r, x, y, top, bot, pivot, front, back, topRest, botRest });
      }
    }

    // hub pins at both ends of each axle
    const pinG = new THREE.CylinderGeometry(0.03, 0.03, 0.09, 12).rotateX(Math.PI / 2);
    const pins = new THREE.InstancedMesh(pinG, new THREE.MeshLambertMaterial({ color: 0x9a9a9e }), (COLS + 1) * ROWS);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        m.makeTranslation((c - COLS / 2) * CW, ((ROWS - 1) / 2 - r) * CH, 0.02);
        pins.setMatrixAt(i++, m);
      }
    }
    this.scene.add(pins);
    this.pins = pins;

    // mechanism details, as on the real wall: the axle with rings at both ends of each leaf, and
    // two small stops along each cell's upper edge that hold the top leaf until it is released
    const metal = new THREE.MeshPhongMaterial({ color: 0x8c8c92, specular: 0x666666, shininess: 70 });
    const dark = new THREE.MeshPhongMaterial({ color: 0x3a3a3e, specular: 0x444444, shininess: 40 });
    this.details = new THREE.Group();
    const rod = new THREE.CylinderGeometry(0.011, 0.011, WALL_W, 10).rotateZ(Math.PI / 2);
    for (let r = 0; r < ROWS; r++) {
      const m = new THREE.Mesh(rod, dark);
      m.position.set(0, ((ROWS - 1) / 2 - r) * CH, 0.006);
      this.details.add(m);
    }
    const ringG = new THREE.TorusGeometry(0.036, 0.0085, 8, 20).rotateY(Math.PI / 2);
    const stopG = new THREE.BoxGeometry(0.022, 0.065, 0.026);
    const rings = new THREE.InstancedMesh(ringG, metal, COLS * ROWS * 4);
    const stops = new THREE.InstancedMesh(stopG, metal, COLS * ROWS * 2);
    let ri = 0;
    let si = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = (c - (COLS - 1) / 2) * CW;
        const y = ((ROWS - 1) / 2 - r) * CH;
        for (const side of [-1, 1]) {
          for (const k of [0, 1]) {
            m.makeTranslation(x + side * (LW / 2 - 0.02 - k * 0.022), y, 0.006);
            rings.setMatrixAt(ri++, m);
          }
        }
        for (const fx of [-0.25, 0.25]) {
          // a tab hooked over the top edge of the upper leaf
          m.makeTranslation(x + fx * LW, y + SPLIT + HH - 0.012, 0.024);
          stops.setMatrixAt(si++, m);
        }
      }
    }
    // the loop clipped round the axle at the middle of every cell (seen edge-on from the front,
    // a short silver bar crossing the rod; it hangs a little lower than it rises)
    const clipG = new THREE.TorusGeometry(0.042, 0.0055, 8, 28).rotateY(Math.PI / 2).scale(2.2, 1, 1);
    const clips = new THREE.InstancedMesh(clipG, new THREE.MeshPhongMaterial({ color: 0xb4b4ba, specular: 0x999999, shininess: 90 }), COLS * ROWS);
    const tilt = new THREE.Matrix4();
    let ci = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = (c - (COLS - 1) / 2) * CW + (Math.random() - 0.5) * 0.06;
        const y = ((ROWS - 1) / 2 - r) * CH - 0.01;
        m.makeTranslation(x, y, 0.006).multiply(tilt.makeRotationZ((Math.random() - 0.5) * 0.25));
        clips.setMatrixAt(ci++, m);
      }
    }
    this.details.add(rings, stops, clips);
    this.scene.add(this.details);
    this.setDetails(true);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const d = new THREE.DirectionalLight(0xffffff, 2);
    d.position.set(2, 8, 6);
    this.scene.add(d);
  }

  static assign(mat, src) {
    const u = mat.uniforms;
    u.map.value = src?.texture || BLANK;
    u.bg.value = src?.bg || BLANK;
    if (src) u.xform.value.copy(src.xform);
  }

  setProjection(a, b, mix) {
    const g = this.global;
    g.projA.value = a?.texture || BLANK;
    g.projBgA.value = a?.bg || BLANK;
    if (a) g.projXA.value.copy(a.xform);
    g.projB.value = b?.texture || BLANK;
    g.projBgB.value = b?.bg || BLANK;
    if (b) g.projXB.value.copy(b.xform);
    g.projMix.value = mix;
  }

  setDetails(on) {
    this.details.visible = on;
    this.pins.visible = !on;
  }

  setMode(m) {
    this.global.mode.value = m === 'projected' ? 1 : 0;
  }

  // which cell is under a screen point
  pick(clientX, clientY) {
    const ins = this.inset || { right: 0, bottom: 0 };
    const w = innerWidth - ins.right;
    const h = innerHeight - ins.bottom;
    const ndc = new THREE.Vector2((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)) return null;
    const c = Math.floor(p.x / CW + COLS / 2);
    const r = Math.floor(ROWS / 2 - p.y / CH);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
    return { c, r };
  }

  setView(preset) {
    const v = this.view;
    if (preset === 'angled') {
      v.targetYaw = -0.42;
      v.targetPitch = 0.04;
      v.targetDist = 1.02;
    } else {
      v.targetYaw = 0;
      v.targetPitch = 0;
      v.targetDist = 1;
    }
  }

  orbit(dx, dy) {
    const v = this.view;
    v.targetYaw = Math.max(-1.1, Math.min(1.1, v.targetYaw - dx * 0.004));
    v.targetPitch = Math.max(-0.5, Math.min(0.5, v.targetPitch + dy * 0.003));
  }

  zoom(f) {
    const v = this.view;
    v.targetDist = Math.max(0.35, Math.min(1.6, v.targetDist * f));
  }

  // screen space taken by the controls: the wall is framed in what is left
  setInset(right, bottom) {
    this.inset = { right, bottom };
    this.resize();
  }

  resize() {
    const W = innerWidth;
    const H = innerHeight;
    this.renderer.setSize(W, H, false);
    const ins = this.inset || { right: 0, bottom: 0 };
    const w = Math.max(200, W - ins.right);
    const h = Math.max(150, H - ins.bottom);
    this.renderer.setViewport(0, H - h, w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // distance that fits the wall plus a margin
    const vfov = (this.camera.fov * Math.PI) / 180;
    const fitH = (WALL_H + 1.4) / 2 / Math.tan(vfov / 2);
    const fitW = (WALL_W + 1.4) / 2 / Math.tan(vfov / 2) / this.camera.aspect;
    this.baseDist = Math.max(fitH, fitW);
  }

  render(dt) {
    const v = this.view;
    const k = 1 - Math.exp(-dt * 6);
    v.yaw += (v.targetYaw - v.yaw) * k;
    v.pitch += (v.targetPitch - v.pitch) * k;
    v.dist += (v.targetDist - v.dist) * k;
    const d = this.baseDist * v.dist;
    const o = this.camOverride; // { yaw, pitch, dist, tx, ty } when a script drives the camera
    if (o) {
      const D = this.baseDist * o.dist;
      this.camera.position.set(o.tx + Math.sin(o.yaw) * Math.cos(o.pitch) * D, o.ty + Math.sin(o.pitch) * D, Math.cos(o.yaw) * Math.cos(o.pitch) * D);
      this.camera.lookAt(o.tx, o.ty, 0);
    } else {
      this.camera.position.set(Math.sin(v.yaw) * Math.cos(v.pitch) * d, Math.sin(v.pitch) * d, Math.cos(v.yaw) * Math.cos(v.pitch) * d);
      this.camera.lookAt(0, 0, 0);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
