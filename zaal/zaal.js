// Raadszaal van Achrona: een PS1-stijl 3D-weergave van trace.json en verdict.json.
// Leest alleen de JSON-uitvoer van de Council (net als viewer.html) en verandert niets.
import * as THREE from "three";

// ───────────────────────── Constanten ─────────────────────────
const ROLLEN = ["archmage", "beast_master", "engineer", "guardian_keeper", "historian", "oracle"];
const NAMEN = { archmage: "Archmage", engineer: "Engineer", guardian_keeper: "Guardian Keeper", historian: "Historian",
  oracle: "Oracle", beast_master: "Beast Master", koning: "Koning", mens: "Mens" };
const KLEUR = { archmage: "#8a6bff", engineer: "#e0a030", guardian_keeper: "#2f9ee0", historian: "#b07a32",
  oracle: "#e0408a", beast_master: "#3fbf6a", koning: "#e8c45a", mens: "#d04040" };
const PREFIX = { ARC: "archmage", ENG: "engineer", GUA: "guardian_keeper", HIS: "historian", ORA: "oracle", BEA: "beast_master" };
const ID_RE = /\b(ARC|ENG|GUA|HIS|ORA|BEA)[-‐-―−](\d{3})\b/g;
const BEURTENBUDGET = 10;
const LAAG = 240;             // PS1: de scène wordt op 240 pixels hoog getekend
const STOEL_R = 4.3;          // straal waarop de stoelen staan
const TAFEL_Y = 1.25;         // hoogte van het tafelblad
const TYP_SNELHEID = 140;     // tekens per seconde bij 1×
const AFGEBROKEN = Symbol("afgebroken");
const params = new URLSearchParams(location.search);   // ?tempo=4  ·  ?zonderintro (live meekijken zonder gordijn)

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const naam = r => NAMEN[r] || r;

// ───────────────────────── Renderer + PS1-effect ─────────────────────────
const canvas = $("scherm");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07040c);
scene.fog = new THREE.Fog(0x0b0614, 10, 26);
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 60);
const rt = new THREE.WebGLRenderTarget(426, LAAG, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
const snap = { value: new THREE.Vector2(426, LAAG) };

// Na-effect: lage resolutie → sRGB → 15-bit kleur met Bayer-dithering, zoals de PS1.
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tBeeld: { value: rt.texture }, uRes: snap },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
  fragmentShader: `
    uniform sampler2D tBeeld; uniform vec2 uRes; varying vec2 vUv;
    float bayer(vec2 p){
      int x = int(mod(p.x, 4.0)); int y = int(mod(p.y, 4.0));
      int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
      return float(m[x + y * 4]) / 16.0;
    }
    void main(){
      vec3 c = texture2D(tBeeld, vUv).rgb;
      c = pow(max(c, 0.0), vec3(1.0 / 2.2));
      c += (bayer(floor(vUv * uRes)) - 0.5) / 22.0;
      c = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5) / 31.0;
      vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 1.1;
      gl_FragColor = vec4(c, 1.0);
    }`,
  depthTest: false, depthWrite: false,
})));

// Vertex-snapping: elk hoekpunt springt naar het grove pixelraster ("PS1-wiebel").
function ps1(mat) {
  mat.onBeforeCompile = s => {
    s.uniforms.uSnap = snap;
    s.vertexShader = "uniform vec2 uSnap;\n" + s.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>
      { vec2 r = uSnap * 0.25; vec4 p = gl_Position; p.xy = floor(p.xy / p.w * r + 0.5) / r * p.w; gl_Position = p; }`);
  };
  return mat;
}
const lambert = (opties) => ps1(new THREE.MeshLambertMaterial(opties));

function maat() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  const lw = Math.round(LAAG * w / h);
  rt.setSize(lw, LAAG); snap.value.set(lw, LAAG);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener("resize", maat); maat();

// ───────────────────────── Texturen (in code getekend, 8-bit stijl) ─────────────────────────
function rnd(zaad) { return () => { zaad |= 0; zaad = zaad + 0x6D2B79F5 | 0; let t = Math.imul(zaad ^ zaad >>> 15, 1 | zaad);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function textuur(w, h, teken, herhaal = [1, 1], transparant = false) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); teken(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...herhaal);
  return t;
}
const tint = (r, g, b, v) => `rgb(${Math.max(0, r + v) | 0},${Math.max(0, g + v) | 0},${Math.max(0, b + v) | 0})`;

const STEEN = textuur(64, 64, (g, w, h) => {
  const r = rnd(7); g.fillStyle = "#120c1a"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 8) for (let x = -(y / 8 % 2) * 8; x < w; x += 16) {
    g.fillStyle = tint(52, 42, 70, (r() - .5) * 26); g.fillRect(x + 1, y + 1, 14, 6);
    for (let i = 0; i < 4; i++) { g.fillStyle = tint(40, 32, 56, (r() - .5) * 20); g.fillRect(x + 1 + (r() * 13 | 0), y + 1 + (r() * 5 | 0), 1, 1); }
  }
}, [10, 3]);
const VLOER = textuur(64, 64, (g, w, h) => {
  const r = rnd(3); g.fillStyle = "#0c0812"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
    g.fillStyle = tint(36, 30, 48, (r() - .5) * 18); g.fillRect(x + 1, y + 1, 15, 15);
    if (r() < .3) { g.fillStyle = "#0c0812"; g.fillRect(x + 3 + (r() * 8 | 0), y + 4, 1, 6); }
  }
}, [8, 8]);
const HOUT = textuur(32, 32, (g, w, h) => {
  const r = rnd(11); g.fillStyle = "#3a2214"; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x++) { g.fillStyle = tint(74, 44, 26, (r() - .5) * 26); g.fillRect(x, 0, 1, h); }
  g.fillStyle = "#24140a"; for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 1, h);
}, [3, 3]);
const TAPIJT = textuur(64, 64, (g, w, h) => {
  g.fillStyle = "#2a0c26"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#7a5a1a"; g.lineWidth = 2;
  for (const s of [30, 24, 12]) { g.beginPath(); g.arc(32, 32, s, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = "#4a1440"; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; g.fillRect(32 + Math.cos(a) * 18 - 2, 32 + Math.sin(a) * 18 - 2, 4, 4); }
});
const VLAM = textuur(16, 16, (g) => {
  const pix = ["......1.........", ".....121........", ".....121........", "....12321.......", "....12321.......", "...1233321......",
    "...1234321......", "..123444321.....", "..123444321.....", "..123444321.....", "...1234321......", "....12321.......",
    ".....121........", "................", "................", "................"];
  const k = { 1: "#c0401a", 2: "#f08a28", 3: "#ffd060", 4: "#fff6c8" };
  pix.forEach((rij, y) => [...rij].forEach((c, x) => { if (k[c]) { g.fillStyle = k[c]; g.fillRect(x + 2, y + 2, 1, 1); } }));
});
const ROOK = textuur(8, 8, (g) => { g.fillStyle = "#8a809a"; g.fillRect(2, 2, 4, 4); g.fillRect(1, 3, 6, 2); g.fillRect(3, 1, 2, 6); });
const RAAM = textuur(48, 80, (g, w, h) => {
  const r = rnd(5);
  g.beginPath(); g.moveTo(2, h); g.lineTo(2, 24); g.arc(w / 2, 24, w / 2 - 2, Math.PI, 0); g.lineTo(w - 2, h); g.closePath(); g.save(); g.clip();
  const lucht = g.createLinearGradient(0, 0, 0, h); lucht.addColorStop(0, "#3d1a6e"); lucht.addColorStop(1, "#12062a");
  g.fillStyle = lucht; g.fillRect(0, 0, w, h);
  g.fillStyle = "#fff"; for (let i = 0; i < 30; i++) g.fillRect(r() * w | 0, r() * h | 0, 1, 1);
  g.fillStyle = "#b9a0ff44"; g.beginPath(); g.arc(30, 26, 12, 0, 7); g.fill();
  g.fillStyle = "#efe2ff"; g.beginPath(); g.arc(30, 26, 8, 0, 7); g.fill();
  g.fillStyle = "#c8b4f4"; g.fillRect(27, 23, 3, 2); g.fillRect(32, 28, 2, 2);
  g.restore();
  g.fillStyle = "#08040e"; g.fillRect(w / 2 - 1, 0, 3, h); g.fillRect(0, 46, w, 3);
  g.strokeStyle = "#08040e"; g.lineWidth = 3;
  g.beginPath(); g.moveTo(2, h); g.lineTo(2, 24); g.arc(w / 2, 24, w / 2 - 2, Math.PI, 0); g.lineTo(w - 2, h); g.stroke();
});
function banier(kleur) {
  return textuur(16, 32, (g, w, h) => {
    g.fillStyle = kleur; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h - 6); g.lineTo(w / 2, h); g.lineTo(0, h - 6); g.fill();
    g.fillStyle = "#e8c45a"; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 1, h - 6); g.fillRect(w - 1, 0, 1, h - 6);
    g.fillRect(6, 9, 4, 4); g.fillRect(7, 7, 2, 8); g.fillRect(5, 10, 6, 2);
  });
}

// ───────────────────────── De zaal ─────────────────────────
const zaal = new THREE.Group(); scene.add(zaal);
const MUUR_R = 13, MUUR_D = MUUR_R * Math.cos(Math.PI / 8);
{
  const muur = new THREE.Mesh(new THREE.CylinderGeometry(MUUR_R, MUUR_R, 9, 8, 1, true), lambert({ map: STEEN, side: THREE.BackSide }));
  muur.position.y = 4.5; muur.rotation.y = Math.PI / 8; zaal.add(muur);
  const vloer = new THREE.Mesh(new THREE.CircleGeometry(MUUR_R + 1, 8), lambert({ map: VLOER }));
  vloer.rotation.x = -Math.PI / 2; vloer.rotation.z = Math.PI / 8; zaal.add(vloer);
  const tapijt = new THREE.Mesh(new THREE.CircleGeometry(6.2, 16), lambert({ map: TAPIJT }));
  tapijt.rotation.x = -Math.PI / 2; tapijt.position.y = 0.01; zaal.add(tapijt);
  const plafond = new THREE.Mesh(new THREE.ConeGeometry(MUUR_R, 4, 8, 1, true), lambert({ color: 0x140c20, side: THREE.BackSide }));
  plafond.position.y = 11; plafond.rotation.y = Math.PI / 8; zaal.add(plafond);
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * Math.PI / 4;
    const zuil = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 9, 6), lambert({ map: STEEN, color: 0xb0a0c8 }));
    zuil.position.set(Math.sin(a) * (MUUR_R - 0.6), 4.5, Math.cos(a) * (MUUR_R - 0.6)); zaal.add(zuil);
  }
  const raam = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5.4), ps1(new THREE.MeshBasicMaterial({ map: RAAM, transparent: true, alphaTest: 0.5, fog: false })));
  raam.position.set(0, 4.6, -MUUR_D + 0.08); zaal.add(raam);
  const maanlicht = new THREE.DirectionalLight(0x8a7aff, 0.6); maanlicht.position.set(0, 6, -10); scene.add(maanlicht);
}
scene.add(new THREE.AmbientLight(0x5a4688, 0.55));

// Wandkandelaars
const flakkeraars = [];
function vlam(schaal = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: VLAM, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.scale.set(0.28 * schaal, 0.28 * schaal, 1); s.userData.basis = 0.28 * schaal; s.userData.fase = Math.random() * 10;
  flakkeraars.push(s); return s;
}
for (let k = 0; k < 4; k++) {
  const a = Math.PI / 4 + k * Math.PI / 2;
  const p = new THREE.Vector3(Math.sin(a) * (MUUR_R - 1.4), 3.6, Math.cos(a) * (MUUR_R - 1.4));
  const houder = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.08, 0.25, 6), lambert({ color: 0x6a5a40 }));
  houder.position.copy(p); zaal.add(houder);
  for (const dx of [-0.14, 0, 0.14]) {
    const k2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 5), lambert({ color: 0xe8dcc0 }));
    k2.position.set(p.x + dx * Math.cos(a), p.y + 0.27, p.z - dx * Math.sin(a)); zaal.add(k2);
    const v = vlam(1); v.position.set(k2.position.x, k2.position.y + 0.24, k2.position.z); zaal.add(v);
  }
  const licht = new THREE.PointLight(0xff8a3a, 9, 10, 1.4); licht.position.set(p.x * 0.97, p.y + 0.6, p.z * 0.97);
  licht.userData.basis = 9; licht.userData.fase = Math.random() * 10; flakkeraars.push(licht); scene.add(licht);
}

// Tafel
{
  const blad = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.25, 16), lambert({ map: HOUT }));
  blad.position.y = TAFEL_Y - 0.125; zaal.add(blad);
  const rand = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.07, 4, 16), lambert({ color: 0xc9a040 }));
  rand.rotation.x = Math.PI / 2; rand.position.y = TAFEL_Y - 0.05; zaal.add(rand);
  const voet = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, TAFEL_Y - 0.25, 8), lambert({ map: HOUT, color: 0x9a8070 }));
  voet.position.y = (TAFEL_Y - 0.25) / 2; zaal.add(voet);
  const sokkel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.3, 6), lambert({ map: STEEN }));
  sokkel.position.y = TAFEL_Y + 0.15; zaal.add(sokkel);
}
// Het kristal van Achrona in het midden
const kristal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), ps1(new THREE.MeshLambertMaterial({ color: 0xb48cff, emissive: 0x6a2cff, emissiveIntensity: 0.9, flatShading: true })));
kristal.position.y = TAFEL_Y + 1.05; kristal.scale.y = 1.5; zaal.add(kristal);
const kristalLicht = new THREE.PointLight(0x9a5cff, 6, 9, 1.4); kristalLicht.position.y = TAFEL_Y + 1.1; scene.add(kristalLicht);

// Zwevende runen rond het kristal: hoe verder het onderzoek, hoe meer runen fel oplichten.
const RUNEN_VORM = [
  [[3,1,3,13],[3,4,9,1],[3,8,9,5]], [[3,1,3,13],[3,1,9,7],[9,7,3,13]], [[6,1,6,13],[2,4,10,10],[10,4,2,10]], [[2,13,6,1],[6,1,10,13],[4,8,8,8]],
  [[3,1,3,13],[9,1,9,13],[3,1,9,13]], [[6,1,6,13],[6,5,10,1],[6,5,2,1]], [[2,1,10,1],[6,1,6,13],[2,13,10,13]], [[2,7,6,1],[6,1,10,7],[10,7,6,13],[6,13,2,7]],
];
const runen = RUNEN_VORM.map((lijnen, i) => {
  const tex = textuur(12, 14, g => {
    g.fillStyle = "#fff";
    for (const [x1, y1, x2, y2] of lijnen) {
      const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      for (let k = 0; k <= n; k++) g.fillRect(Math.round(x1 + (x2 - x1) * k / n), Math.round(y1 + (y2 - y1) * k / n), 1, 1);
    }
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sp.scale.set(0.36, 0.42, 1); sp.userData.fase = i / RUNEN_VORM.length * Math.PI * 2; zaal.add(sp);
  return sp;
});

// Tien kaarsen = het Beurtenbudget. Na elke Raadslid-beurt gaat er één uit.
const kaarsen = [];
for (let i = 0; i < BEURTENBUDGET; i++) {
  const a = i / BEURTENBUDGET * Math.PI * 2 + 0.31;
  const kaars = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.42, 6), lambert({ color: 0xeadfc8 }));
  kaars.position.set(Math.sin(a) * 1.75, TAFEL_Y + 0.21, Math.cos(a) * 1.75); zaal.add(kaars);
  const v = vlam(0.9); v.position.set(kaars.position.x, TAFEL_Y + 0.55, kaars.position.z); zaal.add(v);
  const rook = new THREE.Sprite(new THREE.SpriteMaterial({ map: ROOK, transparent: true, opacity: 0, depthWrite: false }));
  rook.scale.set(0.12, 0.12, 1); rook.position.copy(v.position); zaal.add(rook);
  kaarsen.push({ vlam: v, rook, aan: true, rookT: 0 });
}
const tafelLicht = new THREE.PointLight(0xffa040, 16, 14, 1.3); tafelLicht.position.y = TAFEL_Y + 1.4; scene.add(tafelLicht);

function zetKaarsen(uit, animeer = true) {
  kaarsen.forEach((k, i) => {
    const moetAan = i >= uit;
    if (k.aan && !moetAan && animeer) k.rookT = 1.6;
    k.aan = moetAan; k.vlam.visible = moetAan;
  });
  $("teller").innerHTML = `<b>${uit}</b>/${BEURTENBUDGET} beurten<br>🕯 ${BEURTENBUDGET - uit} kaarsen branden`;
}

// ───────────────────────── Stoelen en personages ─────────────────────────
const zetels = {};   // rol → { hoek, pos, groep, hoofd, voorwerp, figuur }
const ZETEL_HOEK = r => r === "koning" ? Math.PI : Math.PI + (ROLLEN.indexOf(r) + 1) * Math.PI * 2 / 7;

function stoel(koning) {
  const g = new THREE.Group();
  const hout = lambert({ map: HOUT, color: koning ? 0xd8b070 : 0xffffff });
  const zit = new THREE.Mesh(new THREE.BoxGeometry(koning ? 1.2 : 0.9, 0.14, 0.9), hout); zit.position.y = 0.75; g.add(zit);
  const onder = new THREE.Mesh(new THREE.BoxGeometry(koning ? 1.1 : 0.8, 0.68, 0.8), lambert({ map: HOUT, color: 0x806050 })); onder.position.y = 0.34; g.add(onder);
  const rug = new THREE.Mesh(new THREE.BoxGeometry(koning ? 1.4 : 0.9, koning ? 3.0 : 1.6, 0.14), hout);
  rug.position.set(0, koning ? 2.2 : 1.55, -0.45); g.add(rug);
  if (koning) {
    const goud = lambert({ color: 0xd8a830, emissive: 0x3a2000 });
    for (const x of [-0.7, 0.7]) { const p = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 4), goud); p.position.set(x, 3.9, -0.45); g.add(p); }
    const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), goud); top.position.set(0, 3.85, -0.45); g.add(top);
    const kussen = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.8), lambert({ color: 0x8a1030 })); kussen.position.y = 0.84; g.add(kussen);
  }
  return g;
}

// Tijdelijke personages uit eenvoudige vormen. Worden vervangen door Blender-modellen als zaal/modellen/raad.glb bestaat.
function maakFiguur(rol) {
  const g = new THREE.Group();
  const kleur = new THREE.Color(KLEUR[rol]);
  const kleed = lambert({ color: kleur, flatShading: true });
  const huid = lambert({ color: 0xd9a988, flatShading: true });
  const zwart = lambert({ color: 0x100810 });
  const groot = rol === "koning" ? 1.15 : 1;
  const romp = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.44, 1.05, 6), kleed); romp.position.y = 1.32; g.add(romp);
  const hoofd = new THREE.Mesh(new THREE.IcosahedronGeometry(0.23, 0), huid); hoofd.position.y = 2.03; g.add(hoofd);
  for (const x of [-0.08, 0.08]) { const oog = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.03), zwart); oog.position.set(x, 2.06, 0.2); g.add(oog); }
  const arm = new THREE.BoxGeometry(0.14, 0.14, 0.7);
  for (const x of [-0.36, 0.36]) { const a = new THREE.Mesh(arm, kleed); a.position.set(x, 1.45, 0.32); a.rotation.x = 0.35; g.add(a); }
  let voorwerp = null;
  const m = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); g.add(o); return o; };
  if (rol === "archmage") {
    m(new THREE.ConeGeometry(0.3, 0.8, 6), lambert({ color: 0x4a2aa0, flatShading: true }), 0, 2.6, 0).rotation.z = 0.12;
    m(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 4), lambert({ color: 0x6a4020 }), 0.55, 1.4, 0.1);
    voorwerp = m(new THREE.OctahedronGeometry(0.1, 0), lambert({ color: 0xc0a0ff, emissive: 0x6040ff, emissiveIntensity: 0.4 }), 0.55, 2.65, 0.1);
  } else if (rol === "engineer") {
    m(new THREE.SphereGeometry(0.25, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), lambert({ color: 0xf0c020, flatShading: true }), 0, 2.1, 0);
    m(new THREE.BoxGeometry(0.34, 0.09, 0.06), lambert({ color: 0x40d0ff, emissive: 0x104050 }), 0, 2.07, 0.2);
    voorwerp = m(new THREE.BoxGeometry(0.4, 0.04, 0.3), lambert({ color: 0x203040, emissive: 0x20a0ff, emissiveIntensity: 0.3 }), 0, TAFEL_Y + 0.02, 1.05);
  } else if (rol === "guardian_keeper") {
    m(new THREE.CylinderGeometry(0.26, 0.26, 0.3, 6), lambert({ color: 0xa0a8b8, flatShading: true }), 0, 2.12, 0);
    m(new THREE.BoxGeometry(0.06, 0.25, 0.06), lambert({ color: 0x2f9ee0 }), 0, 2.33, 0);
    voorwerp = m(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 6), lambert({ color: 0x2f70b0, emissive: 0x103060, emissiveIntensity: 0.3 }), -0.55, 1.4, 0.3);
    voorwerp.rotation.z = Math.PI / 2;
  } else if (rol === "historian") {
    m(new THREE.ConeGeometry(0.34, 0.65, 6, 1, true), lambert({ color: 0x5a3a1a, side: THREE.DoubleSide, flatShading: true }), 0, 2.2, -0.02);
    voorwerp = m(new THREE.BoxGeometry(0.5, 0.06, 0.34), lambert({ color: 0xe8dcb8, emissive: 0x403010, emissiveIntensity: 0.2 }), 0, TAFEL_Y + 0.04, 1.0);
  } else if (rol === "oracle") {
    m(new THREE.ConeGeometry(0.36, 0.9, 6, 1, true), lambert({ color: 0xf0a0d0, transparent: true, opacity: 0.6, side: THREE.DoubleSide }), 0, 2.15, 0);
    voorwerp = m(new THREE.IcosahedronGeometry(0.17, 1), lambert({ color: 0xffa0e0, emissive: 0xc02080, emissiveIntensity: 0.6, flatShading: true }), 0, TAFEL_Y + 0.2, 1.0);
  } else if (rol === "beast_master") {
    const gewei = lambert({ color: 0xd8c8a0 });
    for (const x of [-1, 1]) {
      m(new THREE.BoxGeometry(0.05, 0.45, 0.05), gewei, x * 0.17, 2.4, 0).rotation.z = -x * 0.5;
      m(new THREE.BoxGeometry(0.05, 0.2, 0.05), gewei, x * 0.27, 2.55, 0).rotation.z = x * 0.4;
    }
    m(new THREE.TorusGeometry(0.33, 0.12, 4, 6), lambert({ color: 0x5a4630, flatShading: true }), 0, 1.8, 0).rotation.x = Math.PI / 2;
    voorwerp = m(new THREE.ConeGeometry(0.12, 0.3, 4), lambert({ color: 0x80ff90, emissive: 0x208030, emissiveIntensity: 0.3 }), 0.45, TAFEL_Y + 0.15, 0.95);
  } else if (rol === "koning") {
    const goud = lambert({ color: 0xf0c040, emissive: 0x4a3000, flatShading: true });
    m(new THREE.CylinderGeometry(0.24, 0.26, 0.16, 6), goud, 0, 2.27, 0);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; m(new THREE.ConeGeometry(0.05, 0.16, 4), goud, Math.sin(a) * 0.22, 2.42, Math.cos(a) * 0.22); }
    m(new THREE.CylinderGeometry(0.5, 0.62, 0.9, 6, 1, true), lambert({ color: 0x6a1030, side: THREE.DoubleSide, flatShading: true }), 0, 1.3, -0.06);
    voorwerp = m(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 4), goud, 0.5, 1.7, 0.25);
  }
  g.scale.setScalar(groot);
  return { groep: g, voorwerp };
}

for (const rol of [...ROLLEN, "koning"]) {
  const hoek = ZETEL_HOEK(rol);
  const pos = new THREE.Vector3(Math.sin(hoek) * STOEL_R, 0, Math.cos(hoek) * STOEL_R);
  const s = stoel(rol === "koning"); s.position.copy(pos); s.lookAt(0, 0, 0); zaal.add(s);
  // Banier aan de muur achter elke zetel (achter de Koning zit het raam)
  if (rol !== "koning") {
  const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3), lambert({ map: banier(KLEUR[rol]), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
  ban.position.set(Math.sin(hoek) * (MUUR_D - 0.5), 5.4, Math.cos(hoek) * (MUUR_D - 0.5)); ban.lookAt(0, 5.4, 0); zaal.add(ban);
  }
  const plek = new THREE.Group(); plek.position.copy(pos); plek.lookAt(0, 0, 0); zaal.add(plek);
  zetels[rol] = { hoek, pos, plek, figuur: null, voorwerp: null, actief: false, gloed: 0 };
}
function zetFiguur(rol, figuur) {
  const z = zetels[rol]; if (z.figuur) z.plek.remove(z.figuur);
  z.figuur = figuur.groep; z.voorwerp = figuur.voorwerp; z.plek.add(figuur.groep);
  z.figuur.visible = z.actief;
}
for (const rol of [...ROLLEN, "koning"]) zetFiguur(rol, maakFiguur(rol));
zetels.koning.actief = true; zetels.koning.figuur.visible = true;

function hoofdPos(rol) {
  const z = zetels[rol]; const schaal = rol === "koning" ? 1.15 : 1;
  return new THREE.Vector3(z.pos.x, 2.03 * schaal, z.pos.z);
}
function zetActieveRollen(rollen) {
  for (const r of ROLLEN) { zetels[r].actief = rollen.includes(r); if (zetels[r].figuur) zetels[r].figuur.visible = zetels[r].actief; }
}

// Blender-modellen (fase 2): als zaal/modellen/raad.glb bestaat, vervangen die de tijdelijke figuren.
(async () => {
  try {
    const r = await fetch("/zaal/modellen/raad.glb"); if (!r.ok) return;
    const { GLTFLoader } = await import("/zaal/vendor/loaders/GLTFLoader.js");
    const gltf = await new GLTFLoader().parseAsync(await r.arrayBuffer(), "/zaal/modellen/");
    for (const rol of [...ROLLEN, "koning"]) {
      const knoop = gltf.scene.getObjectByName(rol); if (!knoop) continue;
      knoop.position.set(0, 0, 0); knoop.rotation.set(0, 0, 0);
      let voorwerp = null;
      knoop.traverse(o => {
        if (!o.isMesh) return;
        const oud = o.material;
        o.material = ps1(new THREE.MeshLambertMaterial({ vertexColors: !!o.geometry.attributes.color, color: oud.color || 0xffffff,
          map: oud.map || null, emissive: oud.emissive || 0x000000, emissiveIntensity: oud.emissiveIntensity ?? 1, flatShading: true }));
        if (o.name.includes("voorwerp")) voorwerp = o;
      });
      zetFiguur(rol, { groep: knoop, voorwerp });
    }
    for (const r of Object.keys(portretten)) delete portretten[r];
  } catch (e) { console.warn("Blender-modellen niet geladen, ik gebruik de tijdelijke figuren.", e); }
})();

// Spotlicht op wie spreekt
const spot = new THREE.SpotLight(0xffffff, 0, 12, 0.32, 0.6, 1);
scene.add(spot); scene.add(spot.target);
let spotDoel = 0;
let aandachtRol = null;   // iedereen kijkt naar wie spreekt
function spotOp(rol) {
  aandachtRol = rol && zetels[rol] ? rol : null;
  if (!rol || !zetels[rol]) { spotDoel = 0; return; }
  const h = hoofdPos(rol);
  spot.position.set(h.x * 0.75, 7.5, h.z * 0.75); spot.target.position.set(h.x, 1.4, h.z);
  spot.color.set(KLEUR[rol]).lerp(new THREE.Color(0xffffff), 0.55); spotDoel = 60;
}

// ───────────────────────── Portret in de tekstbox (rechtszaalstijl) ─────────────────────────
const PORTRET = 96;
const portretRT = new THREE.WebGLRenderTarget(PORTRET, PORTRET, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
const portretCam = new THREE.PerspectiveCamera(28, 1, 0.05, 12);
const portretten = {};
const GAMMA = Array.from({ length: 256 }, (_, i) => Math.round(255 * Math.pow(i / 255, 1 / 2.2)));
function portret(rol) {
  if (!zetels[rol]?.figuur) return null;
  if (portretten[rol]) return portretten[rol];
  try {
    const z = zetels[rol], h = hoofdPos(rol), naarMidden = new THREE.Vector3(-z.pos.x, 0, -z.pos.z).normalize();
    const oud = z.figuur.rotation.y; z.figuur.rotation.y = 0; z.figuur.updateMatrixWorld(true);
    const extra = rol === "koning" ? 0.12 : rol === "archmage" || rol === "beast_master" ? 0.1 : 0.02;   // kroon, punthoed, gewei
    portretCam.position.copy(h).addScaledVector(naarMidden, 1.5).add(new THREE.Vector3(0, 0.12 + extra, 0));
    portretCam.lookAt(h.x, h.y + extra, h.z);
    const spotOud = spot.intensity; spot.intensity = 0;
    renderer.setRenderTarget(portretRT); renderer.render(scene, portretCam); renderer.setRenderTarget(null);
    spot.intensity = spotOud; z.figuur.rotation.y = oud;
    const px = new Uint8Array(PORTRET * PORTRET * 4); renderer.readRenderTargetPixels(portretRT, 0, 0, PORTRET, PORTRET, px);
    const c = document.createElement("canvas"); c.width = c.height = PORTRET;
    const g = c.getContext("2d"), beeld = g.createImageData(PORTRET, PORTRET);
    for (let y = 0; y < PORTRET; y++) for (let x = 0; x < PORTRET; x++) {
      const bron = ((PORTRET - 1 - y) * PORTRET + x) * 4, doel = (y * PORTRET + x) * 4;   // WebGL leest ondersteboven
      for (let k = 0; k < 3; k++) beeld.data[doel + k] = GAMMA[px[bron + k]];
      beeld.data[doel + 3] = 255;
    }
    g.putImageData(beeld, 0, 0);
    return (portretten[rol] = c.toDataURL());
  } catch (e) { console.warn("Portret mislukt", e); return null; }
}

// ───────────────────────── Bewijs op tafel: per Rol een groeiende stapel perkamentjes ─────────────────────────
const bewijsStapels = {};   // rol → aantal kaartjes
const vliegers = [];        // kaartjes die van de spreker naar de tafel vliegen
const PERKAMENT = lambert({ color: 0xeadcb4 });
function bewijsPlek(rol, n) {
  const z = zetels[rol]; const naarMidden = z.pos.clone().setY(0).normalize().negate();
  const zij = new THREE.Vector3(naarMidden.z, 0, -naarMidden.x);
  const kolom = n % 3, laag = Math.floor(n / 3);
  const p = z.pos.clone().addScaledVector(naarMidden, 1.55).addScaledVector(zij, (kolom - 1) * 0.3);
  p.y = TAFEL_Y + 0.012 + laag * 0.026;
  return p;
}
function maakKaartje(rol) {
  const g = new THREE.Group();
  const blad = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.018, 0.32), PERKAMENT); g.add(blad);
  const streep = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.06), lambert({ color: new THREE.Color(KLEUR[rol]) }));
  streep.position.z = -0.12; g.add(streep);
  g.rotation.y = zetels[rol].hoek + (Math.random() - 0.5) * 0.5;
  g.userData.bewijs = true; zaal.add(g); return g;
}
function legBewijs(rol, aantal, animeer = true) {
  if (!zetels[rol] || !aantal) return;
  for (let i = 0; i < aantal; i++) {
    const n = bewijsStapels[rol] = (bewijsStapels[rol] || 0) + 1;
    if (n > 18) continue;                       // de stapel blijft leesbaar
    const kaart = maakKaartje(rol), doel = bewijsPlek(rol, n - 1);
    if (!animeer) { kaart.position.copy(doel); continue; }
    const start = hoofdPos(rol).add(new THREE.Vector3(0, -0.4, 0));
    kaart.position.copy(start); kaart.visible = false;
    vliegers.push({ kaart, start, doel, t: -i * 0.22 });
  }
}
function wisBewijs() {
  for (const k of [...zaal.children]) if (k.userData.bewijs) zaal.remove(k);
  vliegers.length = 0; for (const r in bewijsStapels) delete bewijsStapels[r];
}
function updateVliegers(dt) {
  for (let i = vliegers.length - 1; i >= 0; i--) {
    const v = vliegers[i]; v.t += dt * speler.tempo;
    if (v.t < 0) continue;
    const f = Math.min(1, v.t / 0.7); v.kaart.visible = true;
    v.kaart.position.lerpVectors(v.start, v.doel, f); v.kaart.position.y += Math.sin(f * Math.PI) * 0.6;
    v.kaart.rotation.x = (1 - f) * 2.5;
    if (f >= 1) vliegers.splice(i, 1);
  }
}
function aantalBewijs(b) {
  if (Array.isArray(b.bronverwijzingen)) return b.bronverwijzingen.length;
  const pre = { archmage: "ARC", engineer: "ENG", guardian_keeper: "GUA", historian: "HIS", oracle: "ORA", beast_master: "BEA" }[b.spreker];
  return new Set((String(b.tekst || "").match(ID_RE) || []).filter(i => i.startsWith(pre))).size;
}

// ───────────────────────── Kristal: voortgang van het onderzoek ─────────────────────────
const KRISTAL_PAARS = new THREE.Color(0xb48cff), KRISTAL_GLOED_PAARS = new THREE.Color(0x6a2cff);
const KRISTAL_GOUD = new THREE.Color(0xffe080), KRISTAL_GLOED_GOUD = new THREE.Color(0xc08010);
const kristalStaat = { doel: 0, nu: 0, rood: 0 };
function zetVoortgang(onderzoek) {
  if (!onderzoek || typeof onderzoek !== "object") { kristalStaat.doel = 0; return; }
  const st = Object.values(onderzoek).map(o => o?.status);
  kristalStaat.doel = st.length ? (st.filter(x => x === "onderbouwd").length + 0.5 * st.filter(x => x === "onbeslist").length) / st.length : 0;
}

// ───────────────────────── Camera ─────────────────────────
const cam = { pos: new THREE.Vector3(0, 6, 12), kijk: new THREE.Vector3(0, 1.4, 0), doelPos: new THREE.Vector3(0, 5.4, 10.5),
  doelKijk: new THREE.Vector3(0, 1.4, 0), snelheid: 2.5, modus: "overzicht", baan: 0 };
function shot(soort, rol, rol2) {
  if (cam.modus === "intro" && !intro.klaar) return;
  const zelfde = cam.modus !== "overzicht" && cam.rol === rol && cam.modus !== "duel" && soort !== "duel";
  cam.modus = soort; cam.rol = rol;
  if (soort === "overzicht") { cam.snelheid = 1.2; return; }
  const z = zetels[rol]; const h = hoofdPos(rol);
  if (soort === "dichtbij") {
    const a = z.hoek + 0.13, r = 1.45;
    cam.doelPos.set(Math.sin(a) * r, h.y + 0.25, Math.cos(a) * r); cam.doelKijk.set(h.x, h.y - 0.12, h.z); cam.snelheid = 3.2;
  } else if (soort === "half") {
    const a = z.hoek - 0.55, r = 3.0;
    cam.doelPos.set(Math.sin(a) * r, h.y + 0.9, Math.cos(a) * r); cam.doelKijk.set(h.x, h.y - 0.5, h.z); cam.snelheid = 2.6;
  } else if (soort === "duel") {
    const h2 = hoofdPos(rol2); const midden = h.clone().add(h2).multiplyScalar(0.5);
    const uit = midden.clone().setY(0).normalize();
    cam.doelPos.copy(midden).addScaledVector(uit, -3.2).setY(3.1); cam.doelKijk.copy(midden).setY(1.7); cam.snelheid = 2.2;
  }
  // Harde snede naar een andere spreker (rechtszaalstijl), met een kleine inzoom; dezelfde spreker: zacht bijsturen.
  if (!zelfde) {
    const terug = cam.doelPos.clone().sub(cam.doelKijk).normalize();
    cam.pos.copy(cam.doelPos).addScaledVector(terug, 0.45); cam.kijk.copy(cam.doelKijk);
  }
}
function updateCamera(dt, t) {
  if (cam.modus === "intro") {
    if (intro.bezig) cam.introT = (cam.introT || 0) + dt;
    const p = Math.min(1, (cam.introT || 0) / INTRO_CAMERA), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const a = -1.0 + e * 2.0, r = 11.8 - e * 4.3, y = 7.6 - e * 3.9;
    cam.pos.set(Math.sin(a) * r, y, Math.cos(a) * r); cam.kijk.set(0, 1.6 + e * 0.2, 0);
    cam.doelPos.copy(cam.pos); cam.doelKijk.copy(cam.kijk);
    camera.position.copy(cam.pos); camera.lookAt(cam.kijk); return;
  }
  if (cam.modus === "finale") {
    cam.baan += dt * 0.08; cam.snelheid = 0.9;
    cam.doelPos.set(Math.sin(cam.baan) * 6.5, 8.8, Math.cos(cam.baan) * 6.5); cam.doelKijk.set(0, 1.2, 0);
  }
  if (cam.modus === "overzicht") {
    cam.baan += dt * 0.06;
    cam.doelPos.set(Math.sin(cam.baan) * 9.5, 5.2 + Math.sin(t * 0.2) * 0.3, Math.cos(cam.baan) * 9.5); cam.doelKijk.set(0, 1.5, 0);
  }
  const f = 1 - Math.exp(-dt * cam.snelheid);
  cam.pos.lerp(cam.doelPos, f); cam.kijk.lerp(cam.doelKijk, f);
  camera.position.set(cam.pos.x + Math.sin(t * 0.7) * 0.025, cam.pos.y + Math.sin(t * 0.9) * 0.02, cam.pos.z);
  camera.lookAt(cam.kijk);
}

// ───────────────────────── Geluid (typ-piepjes, BEZWAAR) ─────────────────────────
const geluid = { ctx: null, aan: false };
const TOON = { archmage: 520, beast_master: 300, engineer: 660, guardian_keeper: 380, historian: 440, oracle: 780, koning: 240, mens: 500 };
function zetGeluid(aan) {
  geluid.aan = aan; $("k-geluid").textContent = aan ? "🔊" : "🔇"; $("k-geluid").classList.toggle("aan", aan);
  if (aan && !geluid.ctx) geluid.ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (aan) geluid.ctx.resume();
}
function piep(rol) {
  if (!geluid.aan || !geluid.ctx) return;
  const c = geluid.ctx, o = c.createOscillator(), g = c.createGain();
  o.type = "square"; o.frequency.value = (TOON[rol] || 500) * (0.97 + Math.random() * 0.06);
  g.gain.setValueAtTime(0.045, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.05);
  o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.06);
}
function bezwaarGeluid() {
  if (!geluid.aan || !geluid.ctx) return;
  const c = geluid.ctx, t = c.currentTime;
  for (const [f, d] of [[180, 0], [140, 0.02], [90, 0.04]]) {
    const o = c.createOscillator(), g = c.createGain(); o.type = "sawtooth";
    o.frequency.setValueAtTime(f * 2, t + d); o.frequency.exponentialRampToValueAtTime(f, t + d + 0.35);
    g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5);
    o.connect(g).connect(c.destination); o.start(t + d); o.stop(t + d + 0.55);
  }
}

function toon(f, start, duur, type = "triangle", v = 0.05) {
  if (!geluid.aan || !geluid.ctx) return;
  const c = geluid.ctx, t0 = c.currentTime + start, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duur); o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + duur + 0.05);
}
function slotakkoord() { for (const [f, s] of [[146.83, 0], [220, 0], [293.66, 0.05], [369.99, 0.1], [440, 0.15], [587.33, 0.6]]) toon(f, s, 3.2, s > 0.5 ? "square" : "triangle", 0.04); }
function tingeling(i) { toon(880 + i * 60, 0, 0.35, "sine", 0.03); }
function bonk() {
  toon(70, 0, 0.5, "sine", 0.25); toon(140, 0, 0.25, "square", 0.05);
}

// Intromuziek: een korte plechtige 8-bit fanfare met bas, akkoord en trommelslagen (ongeveer 5,5 seconden).
function introMuziek() {
  if (!geluid.aan || !geluid.ctx) return;
  const c = geluid.ctx, t0 = c.currentTime + 0.05;
  const noot = (f, s, d, type = "square", v = 0.05) => {
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + s); g.gain.exponentialRampToValueAtTime(v, t0 + s + 0.02);
    g.gain.setValueAtTime(v, t0 + s + d * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t0 + s + d);
    o.connect(g).connect(c.destination); o.start(t0 + s); o.stop(t0 + s + d + 0.05);
  };
  noot(73.42, 0, 5.6, "triangle", 0.09); noot(110, 0, 5.6, "triangle", 0.04);           // bourdon in D
  const melodie = [[293.66, 0, .35], [349.23, .35, .35], [440, .7, .35], [587.33, 1.05, .9], [523.25, 2.0, .3],
    [466.16, 2.3, .3], [440, 2.6, .6], [392, 3.25, .3], [440, 3.55, .3], [293.66, 3.85, 1.7]];
  for (const [f, s, d] of melodie) { noot(f, s, d, "square", 0.045); noot(f / 2, s, d, "triangle", 0.035); }
  for (const f of [349.23, 440, 587.33]) noot(f, 3.85, 1.7, "triangle", 0.03);          // slotakkoord
  for (const s of [0, 1.05, 2.0, 3.85]) {                                                  // trommelslagen
    const len = 0.3, buf = c.createBuffer(1, c.sampleRate * len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = "lowpass"; f.frequency.value = 380; g.gain.value = 0.55; src.buffer = buf;
    src.connect(f).connect(g).connect(c.destination); src.start(t0 + s);
  }
}

// ───────────────────────── Intro: gordijn open, muziek, camera rond de tafel ─────────────────────────
const INTRO_CAMERA = 6.5;   // seconden dat de camera rond de tafel vliegt
const intro = { klaar: false, bezig: false, timer: null };
function startIntro() {
  if (intro.klaar || intro.bezig) return;
  intro.bezig = true;
  if (!geluid.aan) zetGeluid(true);   // de klik is de gebruikersactie die geluid toestaat
  introMuziek();
  $("startscherm").classList.add("weg");
  setTimeout(() => $("gordijn").classList.add("open"), 250);
  cam.modus = "intro"; cam.introT = 0;
  intro.timer = setTimeout(eindigIntro, (INTRO_CAMERA + 0.4) * 1000);
}
function eindigIntro() {
  clearTimeout(intro.timer); intro.bezig = false; intro.klaar = true;
  $("startscherm").classList.add("weg"); $("gordijn").classList.add("open");
  if (cam.modus === "intro") shot("overzicht");
}
function sluitGordijn() {
  clearTimeout(intro.timer); intro.klaar = false; intro.bezig = false;
  $("gordijn").classList.remove("open"); $("startscherm").classList.remove("weg");
  cam.modus = "intro"; cam.introT = 0;
}

// ───────────────────────── Afspeler: wachten, typen, klikken, overslaan ─────────────────────────
const speler = { i: 0, fase: "debat", tempo: 1, pauze: false, gen: 0, sprong: 0, kaarsenUit: 0, live: false };
const timers = [];
function wacht(ms, klikbaar = false) {
  const gen = speler.gen, sprong = speler.sprong;
  return new Promise((res, rej) => timers.push({ rest: ms, res, rej, gen, sprong, klikbaar }));
}
function controleer(sprong) { return speler.sprong !== sprong; } // true = deze stap is overgeslagen

const dlg = { units: [], getoond: 0, totaal: 0, klaar: null, rol: null, gen: 0, laatst: -1 };
function units(tekst) {
  const uit = []; let i = 0;
  for (const m of tekst.matchAll(ID_RE)) {
    for (const ch of tekst.slice(i, m.index)) uit.push({ html: esc(ch), n: 1 });
    uit.push({ html: `<span class="id" style="--k:${KLEUR[PREFIX[m[1]]]}">${m[1]}-${m[2]}</span>`, n: 1 });
    i = m.index + m[0].length;
  }
  for (const ch of tekst.slice(i)) uit.push({ html: esc(ch), n: 1 });
  return uit;
}
function toonDialoog(rol, naambord, tekst, sub = "", pagina = "", klasse = "") {
  const d = $("dialoog"); d.classList.remove("weg");
  $("naambord").innerHTML = naambord; d.style.setProperty("--kleur", KLEUR[rol] || "#6a52a8");
  $("naambord").style.background = KLEUR[rol] || "#6a52a8";
  const beeld = portret(rol); if (beeld) $("portret").src = beeld; else $("portret").removeAttribute("src");
  $("sub").innerHTML = sub; $("sub").classList.remove("zicht"); $("verder").classList.remove("zicht");
  $("pagina").textContent = pagina;
  dlg.units = units(tekst); dlg.totaal = dlg.units.length; dlg.getoond = 0; dlg.rol = rol; dlg.laatst = -1;
  $("tekst").innerHTML = ""; $("tekst").className = klasse;
  const gen = speler.gen;
  return new Promise((res, rej) => { dlg.klaar = res; dlg.rej = rej; dlg.gen = gen; });
}
function verbergDialoog() { $("dialoog").classList.add("weg"); }
function updateDialoog(dt) {
  if (!dlg.klaar) return;
  if (dlg.gen !== speler.gen) { const r = dlg.rej; dlg.klaar = null; r(AFGEBROKEN); return; }
  if (!speler.pauze) dlg.getoond = Math.min(dlg.totaal, dlg.getoond + dt * TYP_SNELHEID * speler.tempo);
  const n = Math.floor(dlg.getoond);
  if (n !== dlg.laatst) {
    if (n > dlg.laatst && n % 2 === 0 && n < dlg.totaal && dlg.units[n]?.html.trim()) piep(dlg.rol);
    dlg.laatst = n; $("tekst").innerHTML = dlg.units.slice(0, n).map(u => u.html).join("");
  }
  if (n >= dlg.totaal) {
    $("sub").classList.add("zicht"); $("verder").classList.add("zicht");
    const r = dlg.klaar; dlg.klaar = null; r();
  }
}
function updateTimers(dt) {
  for (let i = timers.length - 1; i >= 0; i--) {
    const t = timers[i];
    if (t.gen !== speler.gen) { timers.splice(i, 1); t.rej(AFGEBROKEN); continue; }
    if (t.sprong !== speler.sprong) { timers.splice(i, 1); t.res(); continue; }
    if (!speler.pauze) t.rest -= dt * 1000 * speler.tempo;
    if (t.rest <= 0) { timers.splice(i, 1); t.res(); }
  }
}
function klik() {
  if (dlg.klaar) { dlg.getoond = dlg.totaal; return; }
  for (let i = timers.length - 1; i >= 0; i--) if (timers[i].klikbaar) { const t = timers.splice(i, 1)[0]; t.res(); }
}
function volgende() { speler.sprong++; if (dlg.klaar) dlg.getoond = dlg.totaal; }

// ───────────────────────── Labels boven hoofden ─────────────────────────
const labels = [];
function label(rol, html, ms = 1600) {
  const el = document.createElement("div"); el.className = "label pixel"; el.innerHTML = html;
  el.style.setProperty("--k", KLEUR[rol] || "#e8dcff"); document.body.appendChild(el);
  const l = { el, rol, rest: ms }; labels.push(l); return l;
}
function updateLabels(dt) {
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i]; if (!speler.pauze) l.rest -= dt * 1000 * speler.tempo;
    if (l.rest <= 0) { l.el.remove(); labels.splice(i, 1); continue; }
    const p = hoofdPos(l.rol).add(new THREE.Vector3(0, 0.75, 0)).project(camera);
    l.el.style.left = (p.x * 0.5 + 0.5) * innerWidth + "px"; l.el.style.top = (-p.y * 0.5 + 0.5) * innerHeight + "px";
    l.el.style.opacity = p.z < 1 ? Math.min(1, l.rest / 200) : 0;
  }
}

// ───────────────────────── Tekst opknippen in pagina's ─────────────────────────
function schoon(tekst) {
  return String(tekst ?? "")
    .replace(/^\s*\*\*Inbreng[^\n]*\n/i, "")          // kopregel "Inbreng van de X" laten we weg: het naambord zegt het al
    .replace(/^#{1,6}\s*/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/^\s*[-•]\s+/gm, "• ")
    .replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}
function paginas(tekst, max = 230) {
  const zinnen = tekst.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [tekst];
  const uit = []; let huidig = "";
  for (let z of zinnen) {
    while (z.length > max) {                 // heel lange zin: op een spatie knippen
      const knip = z.lastIndexOf(" ", max) > 40 ? z.lastIndexOf(" ", max) : max;
      if (huidig) { uit.push(huidig.trim()); huidig = ""; }
      uit.push(z.slice(0, knip).trim() + " …"); z = z.slice(knip);
    }
    if ((huidig + z).length > max && huidig) { uit.push(huidig.trim()); huidig = ""; }
    huidig += z;
  }
  if (huidig.trim()) uit.push(huidig.trim());
  return uit.length ? uit : [""];
}
const kleineLetter = t => /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
const leestijd = tekst => 450 + tekst.length * 7;
// Kort-modus (standaard): lange getuigenissen ingekort zodat het debat vlot loopt; de debatviewer toont alles.
let kort = !params.has("volledig");
const MAX_PAG = { bericht: 3, vraag: 1, reden: 1 };
function inkorten(pag, max) {
  if (!kort || pag.length <= max) return pag;
  const uit = pag.slice(0, max); uit[max - 1] = uit[max - 1].replace(/[\s.…]*$/, "") + " …";
  return uit;
}

// ───────────────────────── Open vragen (briefje) ─────────────────────────
let vorigeVragen = null;
function zetOpenVragen(vragen, animeer = true) {
  if (!Array.isArray(vragen)) return;
  const oud = vorigeVragen || [];
  const af = animeer ? oud.filter(v => !vragen.includes(v)) : [];
  $("vragen").innerHTML = (vragen.length || af.length)
    ? `<ul>${vragen.map(v => `<li class="${animeer && vorigeVragen && !oud.includes(v) ? "nieuw" : ""}">${esc(v)}</li>`).join("")}${af.map(v => `<li class="af">${esc(v)}</li>`).join("")}</ul>`
    : '<span class="leeg">Geen open vragen meer.</span>';
  vorigeVragen = vragen;
}

// ───────────────────────── Onderzoeksbord (doelen + status uit routering.onderzoek) ─────────────────────────
const DOELEN = { ingreep: "Ingreep", mechanisme: "Mechanisme", verloop: "Verloop", herstel: "Herstel", risicos: "Risico's" };
const STATUS_TEKEN = { open: "○", onderbouwd: "●", onbeslist: "◐" };
function zetOnderzoek(onderzoek, doel) {
  if (!onderzoek || typeof onderzoek !== "object") { $("bord").innerHTML = ""; return; }
  $("bord").innerHTML = Object.entries(onderzoek).map(([d, o]) => {
    const st = o?.status || "open";
    return `<span class="${esc(st)}${d === doel ? " nu" : ""}" title="${esc(st)}: ${esc(o?.samenvatting || "")}">${STATUS_TEKEN[st] || "○"} ${esc(DOELEN[d] || d)}</span>`;
  }).join("");
}

// ───────────────────────── Bewijskaarten (bronverwijzingen van een Raadslid) ─────────────────────────
function toonKaarten(rol, verwijzingen, controle) {
  const doos = $("kaarten"); doos.innerHTML = "";
  if (!Array.isArray(verwijzingen) || !verwijzingen.length) return;
  const kop = document.createElement("div"); kop.className = "kop";
  kop.textContent = `BEWIJS VAN ${naam(rol).toUpperCase()}${controle === "geslaagd" ? " · citaten gecontroleerd ✓" : controle ? " · controle: " + controle : ""}`;
  doos.appendChild(kop);
  verwijzingen.slice(0, 3).forEach((v, i) => {
    const k = document.createElement("div"); k.className = "kaart";
    const pre = String(v.id || "").slice(0, 3);
    k.style.setProperty("--k", KLEUR[PREFIX[pre]] || KLEUR[rol] || "#7a5428");
    k.innerHTML = `<span class="id" style="background:${KLEUR[PREFIX[pre]] || "#555"}">${esc(v.id)}</span>
      <div class="bk" title="${esc(v.bronkop)}">${esc(v.bronkop || "")}</div>«${esc(v.citaat || "")}»`;
    doos.appendChild(k); setTimeout(() => k.classList.add("in"), 120 + i * 140);
  });
  if (verwijzingen.length > 3) { const m = document.createElement("div"); m.className = "kop"; m.textContent = `+${verwijzingen.length - 3} meer bronnen in de debatviewer`; doos.appendChild(m); }
}
function verbergKaarten() { $("kaarten").innerHTML = ""; }
// Zoom-slam: snelle inzoom met een schok op wie spreekt (bij bewijs en na BEZWAAR!)
function slam() {
  if (cam.modus !== "dichtbij" && cam.modus !== "half") return;
  cam.pos.lerp(cam.kijk, 0.42);
  document.body.classList.remove("schud"); void document.body.offsetWidth; document.body.classList.add("schud");
  setTimeout(() => document.body.classList.remove("schud"), 380);
}
function stempel() {
  const s = $("stempel"); s.classList.remove("zicht"); void s.offsetWidth; s.classList.add("zicht"); slam();
  setTimeout(() => { toon(90, 0, 0.3, "sine", 0.18); toon(180, 0, 0.12, "square", 0.04); }, 200);
}

// Geschillen zijn momentopnames: elk geschil (op onderwerp) speelt maar één keer.
const gezien = new Set();
const geschilSleutel = g => String(g?.onderwerp || JSON.stringify(g?.standpunten || {})).trim().toLowerCase();
const isVerdictJson = t => { const x = String(t ?? "").trim(); if (!x.startsWith("{")) return false; try { return "oorzaak" in JSON.parse(x); } catch { return false; } };

// ───────────────────────── De scènes ─────────────────────────
function isRaadslid(b) { return b.soort === "bericht" && NAMEN[b.spreker] && !["koning", "mens"].includes(b.spreker); }

function toolTekst(b) {
  const a = b.argumenten || {};
  if (b.soort === "bestand") return `📄 leest ${esc(b.bestand)}`;
  if (b.tool === "lees_kennisbron") return "📖 raadpleegt eigen bron";
  if (b.tool === "zoek") return `🔎 zoekt “${esc(a.term ?? Object.values(a)[0] ?? "")}”`;
  if (b.tool === "toon") { const ids = a.ids || []; return `📜 bekijkt ${esc(ids.slice(0, 3).join(", "))}${ids.length > 3 ? ` +${ids.length - 3}` : ""}`; }
  return `⚙ ${esc(b.tool)}`;
}

async function speelRoutering(b) {
  const sprong = speler.sprong;
  shot("dichtbij", "koning"); spotOp("koning");
  zetOpenVragen(b.open_vragen); zetOnderzoek(b.onderzoek, b.doel); zetVoortgang(b.onderzoek); verbergKaarten();
  await wacht(450); if (controleer(sprong)) return;
  const bord = (b.aan ? `Koning <span class="pijl">→</span> ${esc(naam(b.aan))}` : "Koning") + (b.doel ? ` · ${esc(DOELEN[b.doel] || b.doel)}` : "");
  if (b.aan && zetels[b.aan]) zetels[b.aan].gloed = 1;
  const vraag = b.aan ? `${naam(b.aan)}, ${kleineLetter(b.vraag || "spreek.")}` : "Genoeg. De Raad heeft gesproken: het debat is gesloten.";
  const reden = b.aan ? `Waarom ${naam(b.aan)}? ${b.reden || ""}${b.reden === "vaste volgorde" ? " (de Koning kiest nog niet zelf)" : ""}` : `Waarom nu? ${b.reden || ""}`;
  const stukken = [...inkorten(paginas(vraag), MAX_PAG.vraag).map(t => [t, ""]), ...inkorten(paginas(reden), MAX_PAG.reden).map(t => [t, "reden"])];
  for (let k = 0; k < stukken.length; k++) {
    await toonDialoog("koning", bord, stukken[k][0], "", stukken.length > 1 ? `${k + 1}/${stukken.length}` : "", stukken[k][1]);
    if (controleer(sprong)) return;
    await wacht(leestijd(stukken[k][0]), true); if (controleer(sprong)) return;
  }
  for (const g of b.geschillen || []) {
    const sl = geschilSleutel(g); if (gezien.has(sl)) continue;
    gezien.add(sl); await speelGeschil(g, gezien.size); if (controleer(sprong)) return;
  }
}

async function speelTool(b) {
  const sprong = speler.sprong, rol = b.spreker;
  verbergDialoog();
  if (cam.modus !== "half" || speler.huidigeSpreker !== rol) { shot("half", rol); spotOp(rol); }
  speler.huidigeSpreker = rol;
  if (zetels[rol]) zetels[rol].gloed = 1;
  label(rol, toolTekst(b), 1100);
  await wacht(900); if (controleer(sprong)) return;
}

async function speelBericht(b) {
  const sprong = speler.sprong, rol = b.spreker;
  shot("dichtbij", zetels[rol] ? rol : "koning"); spotOp(zetels[rol] ? rol : "koning");
  await wacht(400); if (controleer(sprong)) return;
  let tekst = typeof b.antwoord === "string" && b.antwoord.trim() ? b.antwoord : String(b.tekst ?? "");
  if (rol === "koning" && isVerdictJson(tekst)) tekst = "De Raad heeft genoeg gehoord. Ik schrijf het Verdict neer.";
  // Bronverwijzingen worden bewijskaarten; zonder dat veld knippen we een oud blok "Broncitaten" weg.
  if (Array.isArray(b.bronverwijzingen) && b.bronverwijzingen.length) {
    toonKaarten(rol, b.bronverwijzingen, b.citaatcontrole);
    if (b.citaatcontrole === "geslaagd") setTimeout(stempel, 700 / speler.tempo);
  }
  else {
    const knip = tekst.search(/\n\s*[*#]*\s*Broncitaten\s*[*]*\s*:?/i);
    if (knip >= 0) { const n = (tekst.slice(knip).match(/^\s*[-•]\s/gm) || []).length; if (n && zetels[rol]) label(rol, `📜 ${n} broncitaten`, 2600); tekst = tekst.slice(0, knip); }
  }
  const alles = paginas(schoon(tekst)), pag = inkorten(alles, MAX_PAG.bericht);
  const extra = alles.length > pag.length ? ` · ingekort, volledig in de debatviewer` : "";
  for (let k = 0; k < pag.length; k++) {
    await toonDialoog(rol, esc(naam(rol)), pag[k], "", (pag.length > 1 ? `${k + 1}/${pag.length}` : "") + (k === pag.length - 1 ? extra : ""));
    if (controleer(sprong)) break;
    await wacht(leestijd(pag[k]), true); if (controleer(sprong)) break;
  }
  verbergDialoog(); verbergKaarten();
  if (rol !== "koning") legBewijs(rol, aantalBewijs(b));
}

async function speelGeschil(g, nr) {
  const sprong = speler.sprong;
  const rollen = Object.keys(g.standpunten || {}).filter(r => zetels[r]);
  verbergDialoog();
  if (rollen.length >= 2) shot("duel", rollen[0], rollen[1]); else shot("overzicht");
  await wacht(500); if (controleer(sprong)) return;
  verbergKaarten();
  // BEZWAAR! alleen als minstens twee Rollen in de trace botsende standpunten hebben.
  if (Object.keys(g.standpunten || {}).length >= 2) {
    const u = $("uitroep"); u.classList.add("zicht"); document.body.classList.add("schud"); bezwaarGeluid(); kristalStaat.rood = 1.8;
    await wacht(1100); u.classList.remove("zicht"); document.body.classList.remove("schud"); if (controleer(sprong)) return;
  }
  await toonDialoog("koning", `Geschil ${nr}`, g.onderwerp || ""); if (controleer(sprong)) return;
  await wacht(leestijd(g.onderwerp || ""), true); if (controleer(sprong)) return;
  let eerste = true;
  for (const [rol, standpunt] of Object.entries(g.standpunten || {})) {
    if (zetels[rol]) { shot("dichtbij", rol); spotOp(rol); }
    if (eerste && Object.keys(g.standpunten || {}).length >= 2) { eerste = false; setTimeout(slam, 120); }
    for (const p of paginas(schoon(standpunt))) {
      await toonDialoog(rol, esc(naam(rol)), p); if (controleer(sprong)) return;
      await wacht(leestijd(p), true); if (controleer(sprong)) return;
    }
  }
  shot("dichtbij", "koning"); spotOp("koning");
  const uitkomst = g.uitkomst ? `Beslist: ${g.uitkomst} ${(g.bewijs || []).join(" ")}` : "Dit geschil blijft open: het bewijs volstaat niet.";
  for (const p of paginas(schoon(uitkomst))) {
    await toonDialoog("koning", "Koning", p); if (controleer(sprong)) return;
    await wacht(leestijd(p), true); if (controleer(sprong)) return;
  }
}

function idHtml(t) {
  return esc(t).replace(ID_RE, (m, p, n) => `<span class="id" style="background:${KLEUR[PREFIX[p]]}">${p}-${n}</span>`);
}
function toonFinale() {
  if (!verdict) return;
  const o = verdict.oorzaak || {};
  const deel = (titel, s) => {
    const z = typeof s?.zekerheid === "number" ? Math.round(Math.max(0, Math.min(1, s.zekerheid)) * 100) : null;
    const k = z == null ? "#0000" : z >= 70 ? "#2f8a3a" : z >= 40 ? "#c07a10" : "#a02020";
    return `<div class="deel"><h3>${titel}</h3>${s?.bewering ? idHtml(s.bewering) + " " + (s.bewijs || []).map(idHtml).join(" ") : "<i>Onbekend: de Raad kon dit niet bewijzen.</i>"}
      ${z != null ? `<div class="meter"><i style="width:${z}%;--k:${k}"></i></div><div class="zeker">${z}% zeker</div>` : ""}</div>`;
  };
  const vs = verdict.voorspelling;
  $("rol").innerHTML = `<h2>Het Verdict van de Raad</h2><div class="onder">${idHtml(verdict.samenvatting === "TODO" ? "Nog geen samenvatting." : verdict.samenvatting)}</div>
    ${deel("De ingreep", o.ingreep)}${deel("Het mechanisme", o.mechanisme)}${deel("Het verloop", o.verloop)}
    <h3>Herstelplan</h3><ol>${(verdict.acties || []).map(a => `<li>${idHtml(a.actie)}</li>`).join("")}</ol>
    <h3>Risico's</h3><ol>${(verdict.risicos || []).map(r => `<li>${idHtml(r.risico)} — <i>${idHtml(r.mitigatie)}</i></li>`).join("")}</ol>
    ${vs ? `<h3>Voorspelling: dag ${esc(vs.dag)}</h3>${idHtml(vs.bewering)} ${(vs.bewijs || []).map(idHtml).join(" ")}` : ""}
    <button class="sluit">Sluiten</button><div class="zegel">VERDICT</div>`;
  $("rol").querySelector(".sluit").onclick = e => { e.stopPropagation(); $("finale").classList.remove("zicht"); };
  $("finale").classList.add("zicht");
  setTimeout(() => { if ($("finale").classList.contains("zicht")) bonk(); }, 1350);
}
async function speelFinale() {
  const sprong = speler.sprong, gen = speler.gen;
  shot("dichtbij", "koning"); spotOp("koning");
  try {
    await toonDialoog("koning", "Koning", "Hoor, hoor! De Raad van Achrona heeft een Verdict.");
    if (!controleer(sprong)) await wacht(1400, true);
    if (!controleer(sprong)) {
      // De kaarsen gaan één voor één weer aan, het kristal wordt goud en de camera stijgt boven de tafel.
      verbergDialoog(); spotOp(null); cam.modus = "finale"; cam.baan = Math.atan2(cam.pos.x, cam.pos.z);
      kristalStaat.doel = 1; slotakkoord();
      for (let i = kaarsen.length - 1; i >= 0; i--) {
        kaarsen[i].aan = true; kaarsen[i].vlam.visible = true; tingeling(i);
        await wacht(220); if (controleer(sprong)) break;
      }
      if (!controleer(sprong)) await wacht(1600);
    }
  } finally {
    if (speler.gen === gen) {
      verbergDialoog(); spotOp(null); kristalStaat.doel = 1;
      for (const k of kaarsen) { k.aan = true; k.vlam.visible = true; }
      $("teller").innerHTML = `<b>${speler.kaarsenUit}</b>/${BEURTENBUDGET} beurten<br>🕯 het Verdict is uitgesproken`;
      if (cam.modus !== "finale") { cam.modus = "finale"; cam.baan = Math.atan2(cam.pos.x, cam.pos.z); }
      toonFinale();
    }
  }
}

async function speelBeurt(b) {
  if (b.soort === "routering") return speelRoutering(b);
  if (b.soort === "toolcall" || b.soort === "bestand") return speelTool(b);
  if (b.soort === "bericht") {
    await speelBericht(b);
    if (isRaadslid(b)) { speler.kaarsenUit++; zetKaarsen(speler.kaarsenUit); }
  }
}

// ───────────────────────── Data ophalen en de regisseur ─────────────────────────
let trace = null, verdict = null, vorige = "";
async function haal(pad) { try { const r = await fetch(pad, { cache: "no-store" }); return r.ok ? await r.text() : null; } catch { return null; } }
async function lus() {
  const [t, v] = await Promise.all([haal("/trace.json"), haal("/verdict.json")]);
  if (t && t + (v || "") !== vorige) {
    try {
      const nieuw = JSON.parse(t); verdict = v ? JSON.parse(v) : null;
      if (!trace || nieuw.run_id !== trace.run_id) { trace = nieuw; herstart(); } else trace = nieuw;
      vorige = t + (v || "");
      zetActieveRollen(trace.raadsleden || []);
    } catch { /* half geschreven bestand: volgende keer opnieuw */ }
  }
  updateStatus();
  setTimeout(lus, 1500);
}
function updateStatus() {
  const s = $("status"), m = $("modus"), f = $("fout");
  if (!trace) { s.textContent = "wachten op trace.json… start de Council"; m.className = "pixel"; m.textContent = ""; return; }
  const n = (trace.beurten || []).length;
  const live = trace.status === "bezig" && speler.i >= n - 2;
  const fout = trace.status === "fout";
  m.className = "pixel " + (fout ? "fout" : live ? "live" : "herhaling");
  m.textContent = fout ? "⚠ RUN MISLUKT" : live ? "LIVE" : "▶ HERHALING";
  f.classList.toggle("zicht", fout);
  if (fout) f.textContent = `⚠ Deze run is afgebroken (status "fout"). ${trace.fout || "Bekijk de terminal van de Council."} Er is geen geldig Verdict.`;
  s.textContent = `${fout ? "run mislukt" : trace.status === "bezig" ? "de Raad vergadert" : "de Raad is klaar"} · ${trace.run_id || ""}`;
}
function herstart() {
  speler.gen++; speler.i = 0; speler.fase = "debat"; speler.kaarsenUit = 0; speler.huidigeSpreker = null;
  vorigeVragen = null; $("vragen").innerHTML = '<span class="leeg">Nog geen open vragen.</span>';
  gezien.clear(); zetOnderzoek(null); verbergKaarten();
  $("finale").classList.remove("zicht"); verbergDialoog(); zetKaarsen(0, false); shot("overzicht"); spotOp(null);
  wisBewijs(); kristalStaat.doel = 0; kristalStaat.rood = 0;
}
function naarLive() {
  if (!trace) return;
  const b = trace.beurten || [];
  speler.gen++; speler.i = b.length; speler.kaarsenUit = b.filter(isRaadslid).length;
  zetKaarsen(speler.kaarsenUit, false);
  const laatste = [...b].reverse().find(x => x.soort === "routering"); vorigeVragen = null;
  if (laatste) { zetOpenVragen(laatste.open_vragen, false); zetOnderzoek(laatste.onderzoek, laatste.doel); zetVoortgang(laatste.onderzoek); }
  wisBewijs(); for (const x of b) if (isRaadslid(x)) legBewijs(x.spreker, aantalBewijs(x), false);
  gezien.clear(); for (const x of b) for (const g of x.geschillen || []) gezien.add(geschilSleutel(g));
  if (trace.status === "klaar") for (const g of trace.geschillen || []) gezien.add(geschilSleutel(g));
  verbergKaarten();
  verbergDialoog(); $("finale").classList.remove("zicht");
  speler.fase = trace.status === "klaar" ? "finale" : trace.status === "fout" ? "fout" : "debat";
}

async function regisseur() {
  while (true) {
    try {
      if (!trace || !intro.klaar) { await wacht(200); continue; }
      const b = trace.beurten || [];
      if (speler.i < b.length) { const beurt = b[speler.i]; await speelBeurt(beurt); speler.i++; continue; }
      if (trace.status === "fout" && speler.fase === "debat") {
        speler.fase = "fout"; shot("dichtbij", "koning"); spotOp("koning");
        await toonDialoog("koning", "Koning", "De zitting is afgebroken. Er komt geen Verdict uit deze run.", "", "", "reden");
        await wacht(2500, true); continue;
      }
      if (trace.status === "klaar" && speler.fase === "debat") {
        speler.fase = "geschillen";
        for (const g of trace.geschillen || []) {
          const sl = geschilSleutel(g); if (gezien.has(sl)) continue;
          gezien.add(sl); await speelGeschil(g, gezien.size);
        }
        speler.fase = "finale"; continue;
      }
      if (speler.fase === "finale" && trace.status === "klaar" && verdict && verdict.run_id === trace.run_id) { await speelFinale(); speler.fase = "einde"; continue; }
      verbergDialoog(); spotOp(null); if (cam.modus !== "overzicht" && cam.modus !== "finale") shot("overzicht");
      await wacht(400);
    } catch (e) {
      if (e !== AFGEBROKEN) { console.error(e); await new Promise(r => setTimeout(r, 500)); }
    }
  }
}

// ───────────────────────── Knoppen en toetsen ─────────────────────────
canvas.addEventListener("click", klik); $("dialoog").addEventListener("click", klik);
$("k-opnieuw").onclick = () => { herstart(); if (!params.has("zonderintro")) sluitGordijn(); };
$("k-start").onclick = e => { e.stopPropagation(); startIntro(); };
$("k-pauze").onclick = () => { speler.pauze = !speler.pauze; $("k-pauze").textContent = speler.pauze ? "▶" : "⏸"; $("k-pauze").classList.toggle("aan", speler.pauze); };
$("k-volgende").onclick = () => { if (!intro.klaar) return eindigIntro(); volgende(); };
$("k-kort").textContent = kort ? "Kort" : "Volledig"; $("k-kort").classList.toggle("aan", kort);
$("k-kort").onclick = () => { kort = !kort; $("k-kort").textContent = kort ? "Kort" : "Volledig"; $("k-kort").classList.toggle("aan", kort); };
$("k-tempo").onclick = () => { speler.tempo = speler.tempo >= 4 ? 1 : speler.tempo * 2; $("k-tempo").textContent = speler.tempo + "×"; };
$("k-live").onclick = () => naarLive();
$("k-geluid").onclick = () => zetGeluid(!geluid.aan);
addEventListener("keydown", e => {
  if (!intro.klaar && (e.key === " " || e.key === "Enter")) { e.preventDefault(); return startIntro(); }
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); klik(); }
  else if (e.key === "ArrowRight") $("k-volgende").click();
  else if (e.key.toLowerCase() === "p") $("k-pauze").click();
  else if (e.key.toLowerCase() === "m") $("k-geluid").click();
});
if (params.has("tempo")) { speler.tempo = Number(params.get("tempo")) || 1; $("k-tempo").textContent = speler.tempo + "×"; }

// ───────────────────────── Animatielus ─────────────────────────
const klok = new THREE.Clock();
function frame() {
  const dt = Math.min(klok.getDelta(), 0.1), t = klok.elapsedTime;
  updateTimers(dt); updateDialoog(dt); updateLabels(dt);
  // Kaarsen en lichten flakkeren
  for (const f of flakkeraars) {
    const n = 0.82 + Math.sin(t * 11 + f.userData.fase) * 0.08 + Math.sin(t * 23.7 + f.userData.fase * 2) * 0.06 + Math.random() * 0.05;
    if (f.isSprite) f.scale.set(f.userData.basis * (0.9 + n * 0.1), f.userData.basis * n * 1.25, 1);
    else f.intensity = f.userData.basis * n;
  }
  const brandend = kaarsen.filter(k => k.aan).length;
  tafelLicht.intensity = (4 + brandend * 1.3) * (0.9 + Math.sin(t * 13) * 0.05 + Math.random() * 0.05);
  for (const k of kaarsen) {
    if (k.rookT > 0) { k.rookT -= dt; const f = 1 - k.rookT / 1.6; k.rook.material.opacity = 0.7 * (1 - f); k.rook.position.y = k.vlam.position.y + f * 0.9; k.rook.scale.setScalar(0.1 + f * 0.25); }
    else k.rook.material.opacity = 0;
  }
  kristal.rotation.y += dt * 0.6; kristal.position.y = TAFEL_Y + 1.05 + Math.sin(t * 1.3) * 0.08;
  // Kristal: paars (alles open) → goud (onderzoek rond); rood bij een geschil
  kristalStaat.nu += (kristalStaat.doel - kristalStaat.nu) * (1 - Math.exp(-dt * 1.5));
  if (kristalStaat.rood > 0) kristalStaat.rood = Math.max(0, kristalStaat.rood - dt);
  const rood = Math.min(1, kristalStaat.rood) * (0.6 + 0.4 * Math.sin(t * 20));
  kristal.material.color.copy(KRISTAL_PAARS).lerp(KRISTAL_GOUD, kristalStaat.nu).lerp(new THREE.Color(0xff3030), rood);
  kristal.material.emissive.copy(KRISTAL_GLOED_PAARS).lerp(KRISTAL_GLOED_GOUD, kristalStaat.nu).lerp(new THREE.Color(0xc00000), rood);
  kristal.material.emissiveIntensity = 0.9 + kristalStaat.nu * 0.8;
  kristal.scale.setScalar(1 + kristalStaat.nu * 0.25); kristal.scale.y *= 1.5;
  kristalLicht.color.copy(kristal.material.emissive);
  kristalLicht.intensity = (5 + kristalStaat.nu * 6) * (1 + Math.sin(t * 2) * 0.2);
  updateVliegers(dt);
  const fel = 2 + Math.round(kristalStaat.nu * (runen.length - 2));
  runen.forEach((sp, i) => {
    const a = sp.userData.fase + t * 0.45, r = 1.05 + Math.sin(t * 0.9 + i) * 0.08;
    sp.position.set(Math.sin(a) * r, TAFEL_Y + 1.25 + Math.sin(t * 1.4 + i * 1.7) * 0.22, Math.cos(a) * r);
    sp.material.color.copy(kristal.material.color).lerp(new THREE.Color(0xffffff), 0.5).multiplyScalar(i < fel ? 2.2 : 0.8);
    sp.material.opacity = (i < fel ? 1 : 0.35) * (0.8 + 0.2 * Math.sin(t * 3 + i));
  });
  // Personages ademen; wie gloeit (toolcall / gekozen) licht op
  for (const [rol, z] of Object.entries(zetels)) {
    if (!z.figuur) continue;
    z.figuur.position.y = Math.sin(t * 1.6 + z.hoek * 3) * 0.015;
    const spreekt = dlg.rol === rol && !!dlg.klaar;
    z.figuur.rotation.x = spreekt ? Math.sin(t * 14) * 0.025 : 0;
    // Kijk naar wie spreekt (alleen draaien op de stoel, maximaal ±60°)
    let gewenst = 0;
    if (aandachtRol && aandachtRol !== rol) {
      const lokaal = z.plek.worldToLocal(zetels[aandachtRol].pos.clone());
      gewenst = Math.max(-1.05, Math.min(1.05, Math.atan2(lokaal.x, lokaal.z)));
    }
    z.figuur.rotation.y += (gewenst - z.figuur.rotation.y) * (1 - Math.exp(-dt * 3));
    if (z.gloed > 0) z.gloed = Math.max(0, z.gloed - dt * 0.7);
    if (z.voorwerp?.material?.emissive) z.voorwerp.material.emissiveIntensity = 0.3 + z.gloed * 2.5 + Math.sin(t * 3) * 0.05;
  }
  spot.intensity += (spotDoel - spot.intensity) * (1 - Math.exp(-dt * 5));
  updateCamera(dt, t);
  renderer.setRenderTarget(rt); renderer.render(scene, camera);
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
  requestAnimationFrame(frame);
}

zetKaarsen(0, false);
$("laden").remove();
cam.modus = "intro"; cam.introT = 0;
if (params.has("zonderintro")) eindigIntro();
if (params.has("debug")) window.__zaal = { zetels, spotOp, shot, cam, legBewijs, zetVoortgang, kristalStaat };   // alleen voor tests
frame(); lus(); regisseur();
