// «ОМЫРТҚА ӘЛЕМІ» · 1-серия — процедуралық 3D аниматик (Three.js)
// window.renderAt(t) — t секундтағы кадрды детерминистік түрде салады.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CAM, CAM_IN, TIREK, DISK, WORLD, SUBS, win, pulse, clamp01 } from './timeline.js';

const W = 1080, H = 1920;
const V3 = THREE.Vector3;
const C = (h) => new THREE.Color(h);

// ---------- детерминистік кездейсоқ сан ----------
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(1979);

// ---------- рендерер ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ---------- текстуралар ----------
function noiseTexture(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const r = rng(7);
  for (let i = 0; i < size * size; i++) {
    const v = fn(r, i % size, (i / size) | 0);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
const boneBump = noiseTexture(256, (r) => 150 + r() * 70 - (r() < 0.04 ? 90 : 0));
boneBump.repeat.set(2, 2);

function spriteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const SPRITE = spriteTexture();

// =====================================================================
// 1) ТІРЕК ҚАЛАСЫ — негізгі әлем
// =====================================================================
const world = new THREE.Scene();
world.fog = new THREE.FogExp2(0x1a1030, 0.03);

// аспан-фон: төменде терең күлгін, жоғарыда алтын
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { cold: { value: 0 }, time: { value: 0 } },
  vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `varying vec3 vP; uniform float cold; uniform float time;
    float h(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,45.164)))*43758.5453);}
    void main(){
      float y = vP.y*0.5+0.5;
      vec3 low = vec3(0.025,0.015,0.07), mid = vec3(0.13,0.06,0.22), top = vec3(0.7,0.4,0.18);
      vec3 c = mix(low, mid, smoothstep(0.0,0.55,y));
      c = mix(c, top, smoothstep(0.6,1.0,y)*0.7);
      float glow = pow(max(0.0, 1.0-abs(vP.x)*1.2),3.0)*smoothstep(0.3,0.9,y);
      c += vec3(1.0,0.7,0.35)*glow*0.22;
      vec3 coldC = mix(vec3(0.05,0.07,0.11), vec3(0.17,0.23,0.31), y);
      c = mix(c, coldC, cold);
      gl_FragColor = vec4(c,1.0);
    }`,
});
world.add(new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), skyMat));

// жарық
const hemi = new THREE.HemisphereLight(0xffd9a0, 0x2a1a55, 0.55);
world.add(hemi);
const key = new THREE.DirectionalLight(0xffe2b8, 2.2);
key.position.set(4, 9, 10);
world.add(key);
const rim = new THREE.DirectionalLight(0xffb347, 4.0);
rim.position.set(-2, 10, -12);
world.add(rim);
const rim2 = new THREE.DirectionalLight(0xffc870, 2.5);
rim2.position.set(6, 4, -8);
world.add(rim2);
const violetFill = new THREE.PointLight(0x7b6cf6, 18, 14, 1.6);
violetFill.position.set(0, 3, 3);
world.add(violetFill);

// ---------- материалдар ----------
const boneMat = new THREE.MeshStandardMaterial({
  color: C('#EDE3CF'), roughness: 0.5, metalness: 0.0,
  bumpMap: boneBump, bumpScale: 1.2, emissive: C('#3a2410'), emissiveIntensity: 0.18,
});
const boneDarkMat = boneMat.clone();
boneDarkMat.color = C('#d8c6a4');

function discMaterial() {
  return new THREE.MeshStandardMaterial({
    color: C('#7B6CF6'), roughness: 0.18, metalness: 0.05,
    emissive: C('#6a58ff'), emissiveIntensity: 0.55, transparent: true, opacity: 0.93,
  });
}

// ---------- омыртқа геометриясы ----------
function barrel(r, h, waist = 0.9, seg = 40) {
  const pts = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const y = -h / 2 + (h * i) / n;
    const k = Math.sin((i / n) * Math.PI);
    const rr = r * (1 - (1 - waist) * k);
    pts.push(new THREE.Vector2(rr * (i === 0 || i === n ? 0.94 : 1), y));
  }
  pts.unshift(new THREE.Vector2(0, -h / 2));
  pts.push(new THREE.Vector2(0, h / 2));
  return new THREE.LatheGeometry(pts, seg);
}
function discGeo(r, h) {
  const pts = [new THREE.Vector2(0, -h / 2)];
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 12;
    pts.push(new THREE.Vector2(r * 0.9 + Math.cos(a) * r * 0.1 + Math.cos(a) * h * 0.15, (Math.sin(a) * h) / 2));
  }
  pts.push(new THREE.Vector2(0, h / 2));
  return new THREE.LatheGeometry(pts, 40);
}

const N = 9; // сегмент саны (8 — бас)
const SEG = [];
for (let i = 0; i < N; i++) {
  const isHead = i === N - 1;
  const r = isHead ? 0.86 : 0.95 - 0.04 * i;
  const h = isHead ? 0.8 : 0.6;
  SEG.push({ r, h, isHead });
}
const DISC_H = 0.22;
// тыныштықтағы S-иілу (бел — артқа, кеуде — алға, мойын — артқа)
const REST_BEND = [-0.05, -0.06, -0.03, 0.04, 0.07, 0.06, 0.02, -0.05, -0.06];

const spine = new THREE.Group();
world.add(spine);

const segGroups = [];
const discMeshes = [];
for (let i = 0; i < N; i++) {
  const { r, h, isHead } = SEG[i];
  const g = new THREE.Group();
  if (isHead) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), boneMat);
    head.scale.set(1.05, 0.88, 0.95);
    g.add(head);
    // басқа кішкентай артқы өсінді
    const sp = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.12, r * 0.5, 6, 12), boneDarkMat);
    sp.rotation.x = Math.PI / 2 - 0.3;
    sp.position.set(0, -0.1, -r * 1.05);
    g.add(sp);
  } else {
    g.add(new THREE.Mesh(barrel(r, h), boneMat));
    // нейрал доға (канал)
    const arch = new THREE.Mesh(new THREE.TorusGeometry(r * 0.42, r * 0.12, 10, 28), boneDarkMat);
    arch.rotation.x = Math.PI / 2;
    arch.position.set(0, 0.02, -r * 1.25);
    g.add(arch);
    // артқы өсінді (processus spinosus)
    const sp = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.13, r * 0.85, 6, 12), boneDarkMat);
    sp.rotation.x = Math.PI / 2 + 0.45;
    sp.position.set(0, -0.12, -r * 2.05);
    g.add(sp);
    // көлденең өсінділер
    for (const s of [-1, 1]) {
      const tp = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.11, r * 0.6, 6, 12), boneDarkMat);
      tp.rotation.z = Math.PI / 2;
      tp.rotation.y = s * 0.35;
      tp.position.set(s * r * 0.95, 0.04, -r * 1.25);
      g.add(tp);
    }
  }
  spine.add(g);
  segGroups.push(g);
  if (i < N - 1) {
    const d = new THREE.Mesh(discGeo(r * 0.9, DISC_H), discMaterial());
    spine.add(d);
    discMeshes.push(d);
  }
}

// ---------- Тіректің беті ----------
const head = segGroups[N - 1];
const face = new THREE.Group();
head.add(face);
const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xfffaf2, roughness: 0.2, emissive: 0x332a20, emissiveIntensity: 0.2 });
const irisMat = new THREE.MeshStandardMaterial({ color: C('#E8A23A'), roughness: 0.3, emissive: C('#c27a10'), emissiveIntensity: 0.6 });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x120a05 });
const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a2216, roughness: 0.6 });

function makeEye(x, scale = 1, irisColor = irisMat, pupilR = 0.075, irisR = 0.13) {
  const root = new THREE.Group();
  root.position.x = x;
  const lid = new THREE.Group(); // scale.y — қабақ
  root.add(lid);
  const white = new THREE.Mesh(new THREE.SphereGeometry(0.2 * scale, 32, 24), eyeWhiteMat);
  white.scale.set(0.9, 1.1, 0.55);
  lid.add(white);
  const irisG = new THREE.Group();
  irisG.position.z = 0.105 * scale;
  lid.add(irisG);
  const iris = new THREE.Mesh(new THREE.CircleGeometry(irisR * scale, 32), irisColor);
  irisG.add(iris);
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(pupilR * scale, 32), pupilMat);
  pupil.position.z = 0.002;
  irisG.add(pupil);
  const g1 = new THREE.Mesh(new THREE.CircleGeometry(0.032 * scale, 16), glintMat);
  g1.position.set(0.04 * scale, 0.05 * scale, 0.004);
  irisG.add(g1);
  const g2 = new THREE.Mesh(new THREE.CircleGeometry(0.014 * scale, 12), glintMat);
  g2.position.set(-0.04 * scale, -0.035 * scale, 0.004);
  irisG.add(g2);
  return { root, lid, irisG };
}
const eyeL = makeEye(-0.31);
const eyeR = makeEye(0.31);
for (const e of [eyeL, eyeR]) {
  e.root.position.y = 0.1;
  e.root.position.z = 0.66;
  face.add(e.root);
}
function brow(x) {
  const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.2, 6, 12), boneDarkMat);
  b.rotation.z = Math.PI / 2;
  const g = new THREE.Group();
  g.add(b);
  g.position.set(x, 0.37, 0.66);
  face.add(g);
  return g;
}
const browL = brow(-0.31), browR = brow(0.31);
const mouth = new THREE.Group();
mouth.position.set(0.04, -0.27, 0.72);
face.add(mouth);
const MOUTH_ARC = Math.PI * 0.72;
const mouthLine = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 10, 32, MOUTH_ARC), darkMat);
mouthLine.rotation.z = -Math.PI / 2 - MOUTH_ARC / 2;
const mouthLineG = new THREE.Group();
mouthLineG.add(mouthLine);
mouth.add(mouthLineG);
const mouthHole = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), new THREE.MeshBasicMaterial({ color: 0x2a1208 }));
mouthHole.scale.set(1, 0.6, 0.25);
mouth.add(mouthHole);
const cheeks = [];
for (const s of [-1, 1]) {
  const ch = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), boneMat);
  ch.position.set(s * 0.33, -0.22, 0.6);
  face.add(ch);
  cheeks.push(ch);
}

// ---------- «қолдар» (6-сегменттің көлденең өсінділері) ----------
function makeArm(side) {
  const pivot = new THREE.Group();
  pivot.position.set(side * SEG[6].r * 0.95, 0.05, -0.05);
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.62, 6, 14), boneMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.x = side * 0.42;
  pivot.add(arm);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 14), boneMat);
  hand.position.x = side * 0.82;
  hand.scale.set(1, 0.85, 0.8);
  pivot.add(hand);
  segGroups[6].add(pivot);
  return pivot;
}
const armRPivot = makeArm(1), armLPivot = makeArm(-1);

// ---------- канал импульсі ----------
const pulseSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: SPRITE, color: 0xffc860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
pulseSprite.scale.set(1.6, 1.6, 1);
world.add(pulseSprite);

// ---------- нервтер (сегменттердің ұрпағы) ----------
const nerveMats = [];
for (let i = 0; i < N - 1; i++) {
  const r = SEG[i].r;
  for (const s of [-1, 1]) {
    const pts = [];
    const len = 3.2 + R() * 2.2;
    const drop = 0.6 + R() * 0.8;
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      pts.push(new V3(s * (r * 0.9 + u * len), 0.3 - u * drop - Math.sin(u * 3) * 0.15, -r * 1.1 - u * 0.8 + Math.sin(u * 5 + i) * 0.25));
    }
    const m = new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.85 });
    nerveMats.push(m);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.028, 6), m);
    segGroups[i].add(tube);
    // тармақтар
    const bpts = [pts[5].clone(), pts[5].clone().add(new V3(s * 0.6, -0.5, 0.4)), pts[5].clone().add(new V3(s * 1.2, -0.7, 0.9))];
    segGroups[i].add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bpts), 10, 0.016, 5), m));
  }
}

// ---------- бұлшықеттер (әр кадрда қайта құрылады) ----------
const muscleMat = new THREE.MeshStandardMaterial({ color: C('#D9585B'), roughness: 0.45, emissive: C('#ff3b3f'), emissiveIntensity: 0.2 });
const muscles = [];
for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), muscleMat);
  m.userData = { s, k, off: new V3(s * (0.6 + k * 0.28), 0, -1.55 - k * 0.15) };
  world.add(m);
  muscles.push(m);
}

// ---------- бөлшектер, нұр бағандары ----------
const PCOUNT = 1800;
const pGeo = new THREE.BufferGeometry();
const pBase = new Float32Array(PCOUNT * 3);
for (let i = 0; i < PCOUNT; i++) {
  pBase[i * 3] = (R() - 0.5) * 16;
  pBase[i * 3 + 1] = R() * 14 - 3;
  pBase[i * 3 + 2] = (R() - 0.5) * 14;
}
pGeo.setAttribute('position', new THREE.BufferAttribute(pBase.slice(), 3));
const pMat = new THREE.PointsMaterial({ map: SPRITE, color: 0xffcf7a, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 });
const particles = new THREE.Points(pGeo, pMat);
world.add(particles);

const bokeh = [];
for (let i = 0; i < 26; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: SPRITE, color: R() < 0.5 ? 0x9b8cff : 0xffc070, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.22, depthWrite: false }));
  const s = 0.8 + R() * 2.2;
  sp.scale.set(s, s, 1);
  sp.position.set((R() - 0.5) * 22, R() * 16 - 4, -6 - R() * 18);
  world.add(sp);
  bokeh.push(sp);
}
const rays = [];
for (let i = 0; i < 5; i++) {
  const m = new THREE.Mesh(
    new THREE.ConeGeometry(1.2 + R() * 1.5, 22, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd79a, transparent: true, opacity: 0.03, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  m.position.set((R() - 0.5) * 9, 14, -2 - R() * 6);
  m.rotation.z = (R() - 0.5) * 0.35;
  world.add(m);
  rays.push(m);
}

// ---------- Жұмсақ (Диск кейіпкері) ----------
const disk = new THREE.Group();
world.add(disk);
const diskBody = new THREE.Group();
disk.add(diskBody);
const diskShell = new THREE.Mesh(discGeo(0.46, 0.36), new THREE.MeshStandardMaterial({
  color: C('#7B6CF6'), roughness: 0.12, emissive: C('#5a4ad0'), emissiveIntensity: 0.5, transparent: true, opacity: 0.72,
}));
diskBody.add(diskShell);
for (const [y, rr] of [[-0.09, 0.45], [0, 0.468], [0.09, 0.45]]) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.012, 8, 48), new THREE.MeshBasicMaterial({ color: 0xa9c8ff, transparent: true, opacity: 0.8 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = y;
  diskBody.add(ring);
}
const diskCoreMat = new THREE.MeshBasicMaterial({ color: C('#CFC6FF') });
const diskCore = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), diskCoreMat);
diskCore.scale.set(1, 0.55, 1);
diskBody.add(diskCore);
const diskGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: SPRITE, color: 0x8f7dff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.6, depthWrite: false }));
diskGlow.scale.set(1.8, 1.4, 1);
disk.add(diskGlow);
const diskFace = new THREE.Group();
diskFace.position.set(0, 0.02, 0.42);
diskBody.add(diskFace);
const dIrisMat = new THREE.MeshBasicMaterial({ color: 0x1a1030 });
const dEyeL = makeEye(-0.13, 0.55, dIrisMat, 0.0, 0.16);
const dEyeR = makeEye(0.13, 0.55, dIrisMat, 0.0, 0.16);
for (const e of [dEyeL, dEyeR]) { e.root.position.y = 0.06; diskFace.add(e.root); }
const dMouth = new THREE.Group();
dMouth.position.set(0, -0.07, 0.03);
diskFace.add(dMouth);
const dMouthHole = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 12), new THREE.MeshBasicMaterial({ color: 0x2a0f45 }));
dMouthHole.scale.set(1.2, 0.8, 0.3);
dMouth.add(dMouthHole);
const dMouthLine = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 24, Math.PI * 0.8), new THREE.MeshBasicMaterial({ color: 0x2a0f45 }));
dMouthLine.rotation.z = -Math.PI / 2 - Math.PI * 0.4;
dMouth.add(dMouthLine);

// ---------- жүктеме толқыны, толқын-сақина ----------
const loadPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 40), new THREE.MeshStandardMaterial({ color: 0x9aa3b5, transparent: true, opacity: 0.4, roughness: 0.3, emissive: 0x30384a }));
world.add(loadPlate);
const ripple = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 64), new THREE.MeshBasicMaterial({ color: 0xd8ccff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
ripple.rotation.x = Math.PI / 2;
world.add(ripple);

// ---------- жарықшақ (күңгірт дискте) ----------
const DIM = 1; // 1 және 2 сегмент арасындағы диск
const crackPts = [];
const rc = rng(5);
for (let k = 0; k <= 14; k++) {
  const a = -0.22 + k * 0.026 + (rc() - 0.5) * 0.01;
  const rr = SEG[DIM].r * 0.9 + DISC_H * 0.15 + 0.008;
  crackPts.push(new V3(Math.sin(a) * rr, (rc() - 0.5) * 0.035 + (k - 7) * 0.003, Math.cos(a) * rr));
}
const crackMat = new THREE.MeshBasicMaterial({ color: C('#FF9A5A'), transparent: true });
const crack = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(crackPts), 60, 0.006, 5), crackMat);
discMeshes[DIM].add(crack);
const crackGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: SPRITE, color: 0xff8a40, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false }));
crackGlow.scale.set(0.7, 0.22, 1);
crackGlow.position.set(0, 0, SEG[DIM].r * 0.9 + DISC_H * 0.15 + 0.06);
discMeshes[DIM].add(crackGlow);

// =====================================================================
// 2) СЫРТҚЫ ӘЛЕМ (split-screen, 3-кадр)
// =====================================================================
const outside = new THREE.Scene();
outside.background = C('#f2b77a');
outside.fog = new THREE.Fog(0xf2b77a, 12, 40);
outside.add(new THREE.HemisphereLight(0xffe0b0, 0x806050, 1.4));
const sun = new THREE.DirectionalLight(0xffc27a, 2.6);
sun.position.set(-8, 5, 6);
outside.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 40), new THREE.MeshStandardMaterial({ color: 0x8c7b70, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
outside.add(ground);
const walk = new THREE.Mesh(new THREE.BoxGeometry(200, 0.12, 3), new THREE.MeshStandardMaterial({ color: 0xcdb8a0, roughness: 0.8 }));
walk.position.set(0, 0.06, 0);
outside.add(walk);
const ro = rng(42);
for (let i = 0; i < 40; i++) {
  const h = 4 + ro() * 9;
  const b = new THREE.Mesh(new THREE.BoxGeometry(2.5 + ro() * 3, h, 3), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.06 + ro() * 0.05, 0.35, 0.45 + ro() * 0.2), roughness: 0.8 }));
  b.position.set(-40 + i * 3.2, h / 2, -5 - ro() * 2);
  outside.add(b);
  // терезелер
  for (let k = 0; k < 3; k++) {
    const wnd = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
    wnd.position.set(b.position.x - 0.6 + k * 0.6, 1.5 + ro() * (h - 2.5), b.position.z + 1.51);
    outside.add(wnd);
  }
}
for (let i = 0; i < 12; i++) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.6), new THREE.MeshStandardMaterial({ color: 0x5a3d2a }));
  trunk.position.y = 0.8;
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshStandardMaterial({ color: 0x6f8a3a, roughness: 0.9 }));
  crown.position.y = 2.1;
  tree.add(trunk, crown);
  tree.position.set(-30 + i * 6 + ro() * 2, 0, -2.4);
  outside.add(tree);
}
// адам
const person = new THREE.Group();
outside.add(person);
const skinM = new THREE.MeshStandardMaterial({ color: 0xd9a07c, roughness: 0.6 });
const shirtM = new THREE.MeshStandardMaterial({ color: 0x3f6fb5, roughness: 0.7 });
const pantsM = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.8 });
const hips = new THREE.Group();
hips.position.y = 1.0;
person.add(hips);
const torsoPivot = new THREE.Group();
hips.add(torsoPivot);
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.6, 8, 16), shirtM);
torso.position.y = 0.45;
torsoPivot.add(torso);
const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), skinM);
pHead.position.y = 1.08;
torsoPivot.add(pHead);
const hair = new THREE.Mesh(new THREE.SphereGeometry(0.205, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1e140e }));
hair.position.y = 1.1;
torsoPivot.add(hair);
// омыртқа сызығы (жарқырайды — іштегі әлеммен байланыс)
const spineGlow = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.7, 4, 8), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
spineGlow.position.set(-0.25, 0.45, 0);
torsoPivot.add(spineGlow);
function limb(parent, mat, len, r, x, y) {
  const p = new THREE.Group();
  p.position.set(x, y, 0);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
  m.position.y = -len / 2 - r;
  p.add(m);
  parent.add(p);
  return p;
}
const legL = limb(hips, pantsM, 0.75, 0.11, 0, 0, 0.08);
legL.position.z = 0.12;
const legR = limb(hips, pantsM, 0.75, 0.11, 0, 0);
legR.position.z = -0.12;
const armOL = limb(torsoPivot, shirtM, 0.55, 0.08, 0, 0.8);
armOL.position.z = 0.33;
const armOR = limb(torsoPivot, shirtM, 0.55, 0.08, 0, 0.8);
armOR.position.z = -0.33;
const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), new THREE.MeshStandardMaterial({ color: 0xb88a52, roughness: 0.9 }));
outside.add(box);
const outCam = new THREE.PerspectiveCamera(35, W / (H / 2), 0.1, 200);

// =====================================================================
// 3) ДИСКІНІҢ ІШІ (6-кадр)
// =====================================================================
const inside = new THREE.Scene();
inside.background = C('#05030c');
inside.fog = new THREE.FogExp2(0x05030c, 0.08);
const shellMats = [];
const SHELLS = 11;
for (let i = 0; i < SHELLS; i++) {
  const rr = 0.55 + i * 0.3;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { dir: { value: i % 2 ? 1 : -1 }, rad: { value: rr }, time: { value: 0 }, tint: { value: new THREE.Color().setHSL(0.7 - i * 0.012, 0.7, 0.6) }, alpha: { value: 0.22 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform float dir; uniform float rad; uniform float time; uniform vec3 tint; uniform float alpha;
      void main(){
        float a = vUv.x*6.2831*rad*6.0 + dir*vUv.y*18.0;
        float f = smoothstep(0.55,1.0,0.5+0.5*sin(a*2.0)) ;
        float f2 = smoothstep(0.8,1.0,0.5+0.5*sin(a*7.0 + time*0.5));
        float edge = pow(1.0-abs(dot(vN,vV)),2.0);
        vec3 c = tint*(0.35+f*0.9+f2*0.4) + edge*tint*0.6;
        gl_FragColor = vec4(c, alpha*(0.5+f*0.8+edge));
      }`,
  });
  shellMats.push(mat);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, 2.6, 96, 1, true), mat);
  inside.add(m);
}
const inCore = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 24), new THREE.MeshBasicMaterial({ color: C('#d9d0ff') }));
inCore.scale.set(1, 0.7, 1);
inside.add(inCore);
const inCoreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: SPRITE, color: 0x9d8cff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
inCoreGlow.scale.set(3.2, 3.2, 1);
inside.add(inCoreGlow);
const fiberPts = [];
for (let k = 0; k <= 40; k++) {
  const a = 0.6 + k * 0.03;
  fiberPts.push(new V3(Math.cos(a) * 1.75, 1.3 - k * 0.04, Math.sin(a) * 1.75));
}
const fiberBase = fiberPts.map((p) => p.clone());
const fiberMat = new THREE.MeshBasicMaterial({ color: C('#FF9A5A'), transparent: true });
const fiber = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fiberPts), 60, 0.022, 6), fiberMat);
inside.add(fiber);
const inPts = new THREE.Points((() => {
  const g = new THREE.BufferGeometry();
  const a = new Float32Array(900 * 3);
  const r2 = rng(99);
  for (let i = 0; i < 900; i++) {
    const ang = r2() * 6.283, rr = 0.4 + r2() * 3.2;
    a[i * 3] = Math.cos(ang) * rr; a[i * 3 + 1] = r2() * 6 - 1.5; a[i * 3 + 2] = Math.sin(ang) * rr;
  }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  return g;
})(), new THREE.PointsMaterial({ map: SPRITE, color: 0xb9a8ff, size: 0.05, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
inside.add(inPts);
const inCam = new THREE.PerspectiveCamera(50, W / H, 0.01, 100);

// =====================================================================
// 4) ТЕРІ / ХУК (1-кадр 0–3.5 с) — толық экрандық шейдер
// =====================================================================
const skinScene = new THREE.Scene();
const skinCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const skinMat = new THREE.ShaderMaterial({
  uniforms: { t: { value: 0 }, res: { value: new THREE.Vector2(W, H) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }`,
  fragmentShader: `
    varying vec2 vUv; uniform float t; uniform vec2 res;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5;} return v; }
    void main(){
      vec2 uv = (vUv-0.5)*vec2(res.x/res.y,1.0);
      // 0–1 с: қара + жүрек импульсі
      float beat = exp(-pow(mod(t,0.9)-0.08,2.0)*400.0) + 0.7*exp(-pow(mod(t,0.9)-0.3,2.0)*400.0);
      float dotL = smoothstep(0.03+beat*0.02, 0.0, length(uv)) * (0.6+beat);
      vec3 col = vec3(1.0,0.8,0.5)*dotL;
      // 1.0–2.5 с: арқа, push-in
      float reveal = smoothstep(0.95, 1.35, t);
      float zoom = 0.55 + pow(clamp((t-1.0)/1.5,0.0,1.0),2.5)*5.0 + max(0.0,t-2.5)*14.0;
      vec2 p = uv/zoom + vec2(0.0, 0.05);
      float w = 0.46 + 0.12*smoothstep(-0.3,0.55,p.y) - 0.06*smoothstep(0.0,-0.45,p.y);
      float ax = abs(p.x);
      float body = smoothstep(w, w-0.025, ax) * smoothstep(0.95,0.85,p.y);
      float cyl = sqrt(max(0.0, 1.0 - pow(ax/w,2.0)));
      float groove = exp(-pow(p.x*16.0,2.0));
      float blade = smoothstep(0.2,0.0,length((vec2(ax,p.y)-vec2(0.22,0.38))*vec2(1.0,0.75)));
      float lumbar = exp(-pow(p.x*7.0,2.0)) * smoothstep(0.2,-0.4,p.y);
      vec3 skin = mix(vec3(0.3,0.16,0.1), vec3(0.68,0.42,0.29), cyl);
      skin *= 1.0 - groove*0.5 - lumbar*0.15;
      skin += vec3(0.25,0.14,0.08)*blade;
      // алтын сағат: оң жақтан қырлы жарық + rim
      float side = smoothstep(-0.2, w, p.x);
      skin += vec3(1.0,0.62,0.25)*side*0.35;
      skin += vec3(1.0,0.7,0.35)*smoothstep(w-0.12, w-0.01, ax)*body*0.6;
      float pores = smoothstep(0.78,0.95, noise(p*140.0));
      float fine = fbm(p*35.0);
      skin *= 0.9 + fine*0.16 - pores*0.08;
      float fuzz = smoothstep(0.985,1.0, hash(floor(p*900.0))) * 0.6;
      skin += vec3(1.0,0.85,0.6)*fuzz*smoothstep(1.5,4.0,zoom);
      float inner = groove * smoothstep(1.6,2.5,t) * (0.5+0.5*sin(t*7.0));
      skin += vec3(1.0,0.75,0.4)*inner*0.9;
      vec3 bg = vec3(0.12,0.06,0.03) + vec3(0.5,0.25,0.08)*exp(-pow(length(uv-vec2(0.45,0.3))*2.0,2.0));
      vec3 back = mix(bg, skin, body);
      col = mix(col, back, reveal);
      // 2.5–3.5 с: тері арқылы сүңгу
      float dive = clamp((t-2.5)/1.0, 0.0, 1.0);
      if (dive > 0.0) {
        float r = length(uv);
        float ang = atan(uv.y, uv.x);
        float tunnel = 0.2/(r+0.02) + dive*6.0;
        float layer = fract(tunnel*0.8);
        vec3 membrane = mix(vec3(1.0,0.62,0.48), vec3(0.85,0.25,0.28), smoothstep(0.2,0.6,dive));
        float fibers = 0.5+0.5*sin(ang*40.0 + tunnel*6.0);
        vec3 tun = membrane*(0.75+0.25*fibers) * (0.7+0.4*layer);
        tun = mix(tun, vec3(1.0,0.85,0.55), smoothstep(0.55,1.0,dive));
        col = mix(col, tun, smoothstep(0.0,0.35,dive));
        col += vec3(1.0,0.9,0.7)*smoothstep(0.7,1.0,dive)*1.5;
      }
      gl_FragColor = vec4(col,1.0);
    }`,
});
skinScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skinMat));

// =====================================================================
// ПОСТ-ӨҢДЕУ
// =====================================================================
const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 200);
const composer = new EffectComposer(renderer);
composer.setPixelRatio(1);
composer.setSize(W, H);
const renderPass = new RenderPass(world, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.7, 0.55, 0.78);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, cold: { value: 0 }, fade: { value: 0 }, flash: { value: 0 }, time: { value: 0 }, vig: { value: 0.35 }, warm: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float cold, fade, flash, time, vig, warm;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time*13.0)*43758.5453); }
    void main(){
      vec2 uv = vUv;
      // жиектегі хроматикалық аберрация
      vec2 d = (uv-0.5);
      float ca = dot(d,d)*0.006;
      vec3 c;
      c.r = texture2D(tDiffuse, uv + d*ca*4.0).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - d*ca*4.0).b;
      // violet–gold грейд
      float l = dot(c, vec3(0.299,0.587,0.114));
      vec3 sh = vec3(0.10,0.05,0.18), hi = vec3(1.04,0.98,0.88);
      c = mix(c + sh*(1.0-l)*0.25*warm, c*hi, l*warm*0.5);
      c = mix(c, smoothstep(0.0,1.0,c), 0.35); // контраст
      // салқын грейд
      vec3 grey = vec3(l);
      vec3 coldC = mix(grey, c, 0.55) * vec3(0.82,0.94,1.12);
      c = mix(c, coldC, cold);
      // виньетка
      float v = smoothstep(0.95, 0.25, length(d*vec2(1.0,0.75)));
      c *= mix(1.0, v, vig + cold*0.25);
      c += (hash(uv*1000.0)-0.5)*0.035;
      c = mix(c, vec3(1.0,0.96,0.88), flash);
      c *= 1.0 - fade;
      gl_FragColor = vec4(c,1.0);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

// =====================================================================
// ПОЗА: омыртқа тізбегі
// =====================================================================
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const segWorld = []; // әр сегменттің әлемдік орны (бұлшықеттер үшін)
function poseSpine(t) {
  const bendX = TIREK.bendX(t), sway = TIREK.sway(t), freq = TIREK.swayFreq(t);
  const squash = TIREK.squash(t), tall = TIREK.tall(t), turn = TIREK.headTurn(t);
  const laugh = DISK.laugh(t);
  let pos = new V3(0, 0, 0);
  let q = new THREE.Quaternion();
  segWorld.length = 0;
  for (let i = 0; i < N; i++) {
    const g = segGroups[i];
    g.position.copy(pos);
    g.quaternion.copy(q);
    if (i === N - 1) {
      _q.setFromEuler(_e.set(0, turn * 0.8, turn * 0.12));
      g.quaternion.multiply(_q);
    }
    segWorld.push({ p: pos.clone(), q: q.clone() });
    if (i === N - 1) break;
    // келесі буын
    const wave = Math.sin(t * freq - i * 0.55) * sway * 0.045 * (i / N + 0.3);
    const wave2 = Math.sin(t * freq * 0.5 - i * 0.4) * sway * 0.02;
    const bx = REST_BEND[i] + bendX + wave2 + laugh * Math.sin(t * 16 - i) * 0.015;
    const bz = wave;
    _q.setFromEuler(_e.set(bx, (i > N - 4 ? turn * 0.08 : 0), bz));
    const up = new V3(0, 1, 0).applyQuaternion(q);
    const spacing = (SEG[i].h / 2 + DISC_H + SEG[i + 1].h / 2) * squash * tall;
    // диск: екі сегменттің ортасы
    const qNext = q.clone().multiply(_q);
    const dq = q.clone().slerp(qNext, 0.5);
    const d = discMeshes[i];
    d.position.copy(pos).addScaledVector(up, SEG[i].h / 2 * squash * tall + DISC_H / 2);
    d.quaternion.copy(dq);
    d.scale.set(1 + (1 - squash) * 0.6 + Math.max(0, bendX) * 0.4, squash * (1 - Math.max(0, bendX) * 0.9), 1 + (1 - squash) * 0.6);
    q = qNext;
    const upN = new V3(0, 1, 0).applyQuaternion(q);
    pos = pos.clone().addScaledVector(up, SEG[i].h / 2 * squash * tall + DISC_H).addScaledVector(upN, SEG[i + 1].h / 2 * squash * tall);
    void spacing;
  }
}

function poseFace(t) {
  eyeL.lid.scale.y = TIREK.eyeL(t);
  eyeR.lid.scale.y = TIREK.eyeR(t);
  const lx = TIREK.lookX(t), ly = TIREK.lookY(t);
  for (const e of [eyeL, eyeR]) { e.irisG.position.x = lx * 0.05; e.irisG.position.y = ly * 0.05; }
  const bl = TIREK.browL(t), br = TIREK.browR(t), kn = TIREK.knit(t);
  browL.position.y = 0.37 + bl * 0.09 + kn * 0.02;
  browR.position.y = 0.37 + br * 0.09 + kn * 0.02;
  browL.rotation.z = -0.08 + kn * 0.42 - bl * 0.05;
  browR.rotation.z = 0.08 - kn * 0.42 + br * 0.05;
  const s = TIREK.smile(t), mo = TIREK.mouthOpen(t), puff = TIREK.puff(t);
  mouthLineG.scale.set(1 - puff * 0.6, s * 0.85 + (s >= 0 ? 0.12 : -0.12), 1);
  mouthLineG.rotation.z = 0.12 * (1 - puff);
  mouthLineG.position.y = s < 0 ? -0.06 : 0;
  mouthHole.visible = mo > 0.02;
  mouthHole.scale.set(0.9 - puff * 0.5, Math.max(0.01, mo * 0.9), 0.25);
  mouthHole.position.y = -0.1 * Math.max(0, s) - 0.02;
  for (const ch of cheeks) ch.scale.setScalar(0.8 + puff * 0.45 + Math.max(0, s - 0.8) * 0.3);
  // қолдар
  const wav = TIREK.waveArmR(t);
  armRPivot.rotation.z = TIREK.armR(t) + Math.sin(t * 11) * 0.38 * wav;
  armLPivot.rotation.z = TIREK.armL(t);
  armRPivot.rotation.y = -0.3 * wav;
  // канал импульсі
  const pv = TIREK.pulse(t);
  pulseSprite.visible = pv >= 0 && pv <= 1.15;
  if (pulseSprite.visible) {
    const idx = Math.min(N - 1, Math.floor(pv * (N - 1)));
    const f = pv * (N - 1) - idx;
    const a = segWorld[idx].p, b = segWorld[Math.min(N - 1, idx + 1)].p;
    pulseSprite.position.copy(a).lerp(b, f).add(new V3(0, 0, 0.95));
    pulseSprite.material.opacity = 1 - Math.max(0, pv - 1) * 5;
  }
}

function poseDisk(t) {
  disk.visible = DISK.visible(t);
  if (!disk.visible) return;
  const p = DISK.pos(t);
  disk.position.set(p[0], p[1] + DISK.hop(t), p[2]);
  const laugh = DISK.laugh(t);
  const breathe = 1 + Math.sin(t * 3.1) * 0.025;
  const sx = DISK.sx(t) * breathe + laugh * Math.sin(t * 22) * 0.07;
  // squash & stretch: sx>1 → жалпаяды
  diskBody.scale.set(Math.pow(sx, 0.5), 1 / sx, Math.pow(sx, 0.5));
  diskBody.rotation.z = DISK.flip(t);
  diskBody.rotation.y = -0.35;
  diskBody.rotation.x = 0.12;
  dEyeR.lid.scale.y = DISK.wink(t);
  dEyeL.lid.scale.y = laugh > 0.5 ? 0.45 : 1;
  dEyeR.lid.scale.y *= laugh > 0.5 ? 0.45 : 1;
  for (const e of [dEyeL, dEyeR]) { e.irisG.position.x = DISK.lookX(t) * 0.03; e.irisG.position.y = DISK.lookY(t) * 0.03; }
  const sm = DISK.smile(t), mo = DISK.mouthOpen(t);
  dMouthLine.scale.set(1, sm, 1);
  dMouthHole.scale.set(1.2, Math.max(0.02, mo * 0.9), 0.3);
  const core = DISK.core(t) * (1 + laugh * 0.5 * (Math.sin(t * 25) > 0 ? 1 : 0));
  diskCoreMat.color.setRGB(0.81 * core, 0.78 * core, 1.0 * core);
  diskGlow.material.opacity = 0.25 + 0.25 * core;
}

function poseWorld(t) {
  // бөлшектер ағыны
  const pa = pGeo.attributes.position.array;
  for (let i = 0; i < PCOUNT; i++) {
    pa[i * 3] = pBase[i * 3] + Math.sin(t * 0.3 + i) * 0.15;
    pa[i * 3 + 1] = ((pBase[i * 3 + 1] + t * 0.12 + 3) % 14) - 3;
    pa[i * 3 + 2] = pBase[i * 3 + 2] + Math.cos(t * 0.25 + i * 1.7) * 0.15;
  }
  pGeo.attributes.position.needsUpdate = true;

  const cold = WORLD.cold(t);
  skyMat.uniforms.cold.value = cold;
  world.fog.color.set(0x1a1030).lerp(C('#1b2533'), cold);
  world.fog.density = 0.03 + cold * 0.03;
  key.color.set(0xffe2b8).lerp(C('#a8c4e8'), cold);
  key.intensity = 2.2 - cold * 1.0;
  rim.color.set(0xffb347).lerp(C('#6f8fb8'), cold);
  rim.intensity = 4.0 - cold * 2.2;
  rim2.intensity = 2.5 - cold * 1.8;
  hemi.intensity = 0.55 - cold * 0.25;
  pMat.color.set(0xffcf7a).lerp(C('#8fb0d8'), cold);
  pMat.opacity = 0.9 - cold * 0.5;
  for (const r of rays) r.material.opacity = 0.03 * (1 - cold);

  // дискілер: домино, күңгірт диск
  const n = discMeshes.length;
  const laugh = DISK.laugh(t);
  for (let i = 0; i < n; i++) {
    const m = discMeshes[i].material;
    let e = 0.55 + WORLD.discDomino(t, i, n) * 1.1 * (1 - win(t, 23, 25) * 0.6);
    if (i === 0 && t > 21.4 && t < 22.0) e += 1.5;
    e += laugh * 0.4 * (Math.sin(t * 20 + i * 2) > 0 ? 1 : 0);
    e *= 1 - cold * 0.45;
    if (i === DIM) e *= WORLD.dimDisc(t);
    m.emissiveIntensity = e;
  }
  // бел дискі секірер алдында сығылады
  if (t > 21.4 && t < 22.1) discMeshes[0].scale.y *= 1 - win(t, 21.4, 22.0) * 0.35;

  // нервтер
  for (let i = 0; i < nerveMats.length; i++) {
    const fl = 0.55 + 0.45 * Math.max(0, Math.sin(t * 3 + i * 1.3)) + laugh * 0.5 * (Math.sin(t * 30 + i) > 0.3 ? 1 : 0);
    nerveMats[i].color.setRGB(0.5 * fl, 0.89 * fl, 1.0 * fl).lerp(C('#4a6a8a'), cold * 0.6);
  }

  // бұлшықеттер
  const mus = WORLD.muscles(t);
  muscleMat.emissiveIntensity = 0.1 + mus * 0.55 * (0.8 + 0.2 * Math.sin(t * 4));
  muscleMat.color.set('#D9585B').multiplyScalar(0.35 + mus * 0.65);
  for (const m of muscles) {
    const { off, k } = m.userData;
    const pts = [];
    for (let i = 0; i < N - 1; i++) {
      const sw = segWorld[i];
      const breath = 1 + mus * 0.12 * Math.sin(t * 4 + k);
      const o = off.clone().multiply(new V3(breath, 1, 1)).applyQuaternion(sw.q);
      pts.push(sw.p.clone().add(o));
    }
    pts.unshift(pts[0].clone().add(new V3(0, -1.2, -0.2)));
    m.geometry.dispose();
    m.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, (0.15 - k * 0.03) * (0.7 + mus * 0.3) * (1 + mus * 0.1 * Math.sin(t * 4 + k)), 10);
  }

  // жүктеме толқыны
  const lw = WORLD.loadWave(t);
  loadPlate.visible = t > 26.2 && t < 27.8;
  if (loadPlate.visible) {
    const dp = disk.position;
    loadPlate.position.set(dp.x, dp.y + 0.25 + (1 - lw) * 3.2, dp.z);
    loadPlate.material.opacity = 0.45 * (1 - win(t, 27.0, 27.8));
    loadPlate.scale.set(1 + win(t, 26.9, 27.6) * 0.6, 1, 1 + win(t, 26.9, 27.6) * 0.6);
  }
  const rp = WORLD.ripple(t);
  ripple.visible = rp > 0 && rp < 1;
  if (ripple.visible) {
    ripple.position.copy(disk.position);
    ripple.scale.setScalar(0.4 + rp * 2.6);
    ripple.material.opacity = 1 - rp;
  }

  // жарықшақ
  const ck = WORLD.crack(t);
  crack.visible = crackGlow.visible = ck > 0;
  crackMat.opacity = Math.min(1, ck * 1.3);
  crackMat.color.set('#FF9A5A').multiplyScalar(0.8 + ck * 2.4);
  crackGlow.material.opacity = ck * 0.45;

  for (const b of bokeh) b.material.opacity = 0.22 * (1 - cold * 0.5);
}

function poseOutside(t) {
  // жүру 12–13.75, еңкею + көтеру 13.75–15.2, тұру
  const walkT = Math.min(t, 13.75) - 12;
  const walking = t < 13.75 ? 1 : 0;
  const x = walkT * 1.4;
  person.position.set(x, 0, 0);
  const ph = walkT * 8.4;
  legL.rotation.z = Math.sin(ph) * 0.55 * walking;
  legR.rotation.z = -Math.sin(ph) * 0.55 * walking;
  hips.position.y = 1.0 + Math.abs(Math.cos(ph)) * 0.04 * walking;
  const bend = win(t, 13.75, 14.3) - win(t, 15.0, 15.9);
  torsoPivot.rotation.z = -bend * 1.15;
  hips.position.y -= bend * 0.18;
  legL.rotation.z += bend * 0.35; legR.rotation.z += bend * 0.35;
  const armSwing = Math.sin(ph) * 0.5 * walking;
  armOL.rotation.z = -armSwing + bend * 0.2 - (t > 14.3 ? 0.35 : 0);
  armOR.rotation.z = armSwing + bend * 0.2 - (t > 14.3 ? 0.35 : 0);
  const lifted = win(t, 14.4, 15.9);
  box.position.set(x + 0.75 - lifted * 0.25, 0.23 + 0.12 + lifted * 0.75, 0);
  outCam.position.set(x + 0.3, 1.45, 6.2);
  outCam.lookAt(x + 0.3, 1.05, 0);
}

function poseInside(t) {
  const c = CAM_IN(t);
  inCam.position.set(c[0], c[1], c[2]);
  inCam.fov = c[6];
  inCam.up.set(Math.sin(c[7]), 0, Math.cos(c[7]));
  inCam.lookAt(c[3], c[4], c[5]);
  inCam.updateProjectionMatrix();
  for (const m of shellMats) m.uniforms.time.value = t;
  const strain = win(t, 48.6, 51);
  const pts = fiberBase.map((p, k) => {
    const vib = Math.sin(t * 60 + k * 0.9) * 0.02 * strain;
    return p.clone().multiplyScalar(1 + vib + strain * 0.06 * Math.sin((k / 40) * Math.PI));
  });
  fiber.geometry.dispose();
  fiber.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.018 + strain * 0.02, 6);
  const run = (t * 0.9) % 1;
  fiberMat.color.set('#FF9A5A').multiplyScalar(0.25 + strain * 1.4 + strain * Math.exp(-Math.pow((run - 0.5) * 6, 2)) * 1.5);
  fiberMat.opacity = 0.2 + strain * 0.8;
  const shift = win(t, 48.5, 51) * 0.38;
  inCore.position.x = shift;
  inCoreGlow.position.x = shift;
  const throb = 1 + Math.sin(t * 2.2) * 0.05;
  inCore.scale.set(throb, 0.7 * throb, throb);
}

// =====================================================================
// ОВЕРЛЕЙ: субтитр, титр
// =====================================================================
const subEl = document.getElementById('sub');
const titleEl = document.getElementById('title');
const splitLine = document.getElementById('split');
function renderSubs(t) {
  const cue = SUBS.find((c) => t >= c.s && t < c.e);
  if (!cue) { subEl.innerHTML = ''; subEl.className = ''; return; }
  const lines = cue.text.split('\n');
  const total = cue.text.replace(/\n/g, ' ').split(' ').length;
  const dur = Math.min((cue.e - cue.s) * 0.65, total * 0.22);
  const shown = Math.ceil(clamp01((t - cue.s) / dur) * total + 0.001);
  let idx = 0;
  const fadeOut = 1 - win(t, cue.e - 0.12, cue.e);
  subEl.className = 'who-' + cue.who;
  subEl.style.opacity = fadeOut;
  subEl.innerHTML = lines.map((ln) => ln.split(' ').map((w) => {
    idx++;
    const vis = idx <= shown;
    const isKw = cue.kw.includes(w);
    return `<span class="w${isKw ? ' kw' : ''}" style="opacity:${vis ? 1 : 0};transform:translateY(${vis ? 0 : 12}px) scale(${vis ? 1 : 0.9})">${w}</span>`;
  }).join(' ')).join('<br>');
}
function renderTitles(t) {
  let html = '';
  if (t >= 52.0 && t < 55.5) {
    const a = win(t, 52.0, 52.5) * (1 - win(t, 55.2, 55.5));
    const dots = Math.min(3, Math.floor((t - 52.6) / 0.45) + 1);
    html = `<div class="cont" style="opacity:${a}">ЖАЛҒАСЫ БАР<span class="dots">${'.'.repeat(Math.max(0, dots))}<span style="opacity:0">${'.'.repeat(3 - Math.max(0, dots))}</span></span></div>`;
  } else if (t >= 55.5 && t < 58.5) {
    const s = 1 + win(t, 55.5, 58.5) * 0.04;
    const wig = Math.sin(t * 40) * 2 * (Math.sin(t * 3) > 0.6 ? 1 : 0.3);
    html = `<div class="ep2" style="transform:scale(${s})"><div class="ep2-n">2-СЕРИЯ</div><div class="ep2-t" style="transform:translateX(${wig}px)">ДИСКІНІҢ<br><span class="crackw">ШАРШАУЫ</span></div></div>`;
  } else if (t >= 58.5) {
    const a = win(t, 58.5, 59.0);
    html = `<div class="logo" style="opacity:${a}"><div class="logo-a">ОМЫРТҚА</div><div class="logo-b">ӘЛЕМІ</div><div class="logo-c">1-серия · Омыртқа өзін таныстырады</div></div>`;
  }
  titleEl.innerHTML = html;
}

// =====================================================================
// НЕГІЗГІ КАДР
// =====================================================================
window.renderAt = (t) => {
  grade.uniforms.time.value = t;
  grade.uniforms.flash.value = 0;
  grade.uniforms.fade.value = 0;
  grade.uniforms.cold.value = 0;
  splitLine.style.display = 'none';
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
  renderer.autoClear = true;

  if (t < 3.5) {
    // ХУК: тері
    skinMat.uniforms.t.value = t;
    renderPass.scene = skinScene;
    renderPass.camera = skinCam;
    bloom.strength = 0.45;
    grade.uniforms.vig.value = 0.5;
    grade.uniforms.warm.value = 0.6;
    composer.render();
  } else if (t < 45.0) {
    poseSpine(t);
    poseFace(t);
    poseDisk(t);
    poseWorld(t);
    const c = CAM(t);
    camera.position.set(c[0], c[1], c[2]);
    camera.fov = c[6];
    camera.up.set(Math.sin(c[7]), Math.cos(c[7]), 0);
    // жеңіл «тыныс алатын» камера
    camera.position.x += Math.sin(t * 0.9) * 0.03;
    camera.position.y += Math.sin(t * 1.3) * 0.02;
    camera.lookAt(c[3], c[4], c[5]);
    camera.updateProjectionMatrix();
    renderPass.scene = world;
    renderPass.camera = camera;
    bloom.strength = 0.75 - WORLD.cold(t) * 0.2;
    grade.uniforms.flash.value = 1 - win(t, 3.5, 3.95);
    grade.uniforms.cold.value = WORLD.cold(t);
    grade.uniforms.vig.value = 0.35;
    grade.uniforms.warm.value = 1;
    composer.render();

    // split-screen: жоғарғы бөлік — сыртқы әлем
    const frac = WORLD.split(t);
    if (frac > 0.005) {
      poseOutside(t);
      const hh = Math.round(H * frac);
      renderer.autoClear = true;
      renderer.setScissorTest(true);
      renderer.setScissor(0, H - hh, W, hh);
      renderer.setViewport(0, H - hh, W, hh);
      outCam.aspect = W / hh;
      outCam.updateProjectionMatrix();
      renderer.render(outside, outCam);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
      splitLine.style.display = 'block';
      splitLine.style.top = (hh - 3) + 'px';
    }
  } else if (t < 51.0) {
    poseInside(t);
    renderPass.scene = inside;
    renderPass.camera = inCam;
    bloom.strength = 0.9;
    grade.uniforms.cold.value = 0.35;
    grade.uniforms.vig.value = 0.55;
    grade.uniforms.flash.value = (1 - win(t, 45.0, 45.25)) * 0.5;
    composer.render();
  } else {
    // қара экран
    grade.uniforms.fade.value = 1;
    renderPass.scene = skinScene;
    renderPass.camera = skinCam;
    composer.render();
  }
  renderSubs(t);
  renderTitles(t);
  return true;
};

window.sceneReady = true;
const q = new URLSearchParams(location.search);
if (q.has('t')) window.renderAt(parseFloat(q.get('t')));
