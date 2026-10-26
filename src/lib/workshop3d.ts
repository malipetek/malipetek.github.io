/* The workshop: one continuous Three.js diorama behind the homepage.
 *
 * Stations sit side by side along +X. Each homepage room names its station
 * with data-station; scroll position picks the room, and the camera lerps
 * between station poses, so each section reads as walking into the next room.
 * DOM content stays on top; the canvas is decoration: pointer-events none,
 * aria-hidden.
 *
 * The hero station is the service drawn as a machine, seen near-isometric:
 * request → approval gate (a person) → agent at a terminal → review (a person)
 * → shipped to a cloud. Tickets ride the belt through all four. The step
 * order and names mirror STEPS in src/lib/offer.js.
 *
 * Drawn as line art: flat facet-shaded fills, crisp screen-space outlines
 * (fat-line edges for creases, an inverted hull for curved silhouettes), on a
 * dot-matrix floor shader. The dots under each ticket light up orange as it
 * travels, so the floor tracks the work moving through.
 *
 * Everything is primitives + CanvasTexture labels — no model files. Theme
 * palettes come from the page's data-theme attribute; every material is
 * shared per role, so a theme switch is a handful of uniform writes.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

const GAP = 26; // distance between stations — wide enough that the isometric hero sees no neighbours
const ORANGE = 0xff5a1f;
const SHOPIFY = 0x95bf47;
const GREY = 0x8a857b;
const LINE_PX = 1.15; // outline width in CSS pixels

type Role = 'fill' | 'fill2' | 'ink' | 'orange';

interface Palette {
  fill: number;
  fill2: number;
  ink: number;
  dot: number;
  paperInk: string;
}

const LIGHT: Palette = {
  fill: 0xffffff,
  fill2: 0xf1eee9,
  ink: 0x16140f,
  dot: 0xc9c2b6,
  paperInk: '#b9b2a6',
};

const DARK: Palette = {
  fill: 0x1b1915,
  fill2: 0x25221d,
  ink: 0xe6dfd2,
  dot: 0x3d3831,
  paperInk: '#5d574d',
};

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/* ————— materials ————— */

// Facet shading without lights: brightness from the world normal against one
// fixed direction. Top faces read as the pure fill, the two faces the
// isometric camera sees step down a few percent — the look of a technical
// illustration, not a render.
const FACET_VERT = /* glsl */ `
  varying vec3 vN;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FACET_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vN;
  void main() {
    float l = clamp(dot(normalize(vN), normalize(vec3(-0.45, 1.0, 0.6))) / 0.82, 0.0, 1.0);
    gl_FragColor = vec4(uColor * (0.88 + 0.12 * l), 1.0);
    #include <colorspace_fragment>
  }
`;

// Inverted hull: back faces pushed out along the normal in screen space, so a
// sphere or cylinder gets a constant-width silhouette line at any distance.
const HULL_VERT = /* glsl */ `
  uniform vec2 uRes;
  uniform float uWidth;
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec2 n = (projectionMatrix * vec4(normalMatrix * normal, 0.0)).xy;
    clip.xy += normalize(n) / uRes * uWidth * 2.0 * clip.w;
    gl_Position = clip;
  }
`;
const HULL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
    #include <colorspace_fragment>
  }
`;

// The floor: a dot matrix in world space. Dots fade with distance from the
// camera's focus (and before they get small enough to alias), breathe on a
// slow diagonal wave, and turn orange under the tickets on the hero belt.
const FLOOR_VERT = /* glsl */ `
  varying vec2 vP;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const FLOOR_FRAG = /* glsl */ `
  uniform vec3 uDot;
  uniform vec3 uAccent;
  uniform vec2 uFocus;
  uniform float uTime;
  uniform vec3 uGlow[6];
  varying vec2 vP;
  void main() {
    const float S = 0.42;
    vec2 cell = (fract(vP / S) - 0.5) * S;
    float d = length(cell);
    float aa = fwidth(d) * 1.2;

    float glow = 0.0;
    for (int i = 0; i < 6; i++) {
      // Elongated behind the ticket (it travels +x), so each one leaves a trail.
      vec2 q = vP - uGlow[i].xy;
      float kx = q.x < 0.0 ? 0.3 : 1.6;
      glow += uGlow[i].z * exp(-(q.x * q.x * kx + q.y * q.y * 1.6));
    }
    glow = clamp(glow, 0.0, 1.0);

    float r = mix(0.028, 0.05, glow);
    float dotMask = 1.0 - smoothstep(r - aa, r + aa, d);
    // Drop dots before they shrink under a pixel, or the far floor moirés.
    // The larger axis catches grazing angles, where dots smear into streaks.
    vec2 fw = fwidth(vP);
    dotMask *= 1.0 - smoothstep(r * 0.6, r * 1.2, max(fw.x, fw.y));

    float far = 1.0 - smoothstep(7.0, 24.0, length(vP - uFocus));
    float wave = 0.72 + 0.28 * sin(dot(vP, vec2(0.55, 0.35)) - uTime * 0.7);

    // The floor is see-through: only the dots and the faint orange wash under
    // the tickets have alpha, so the page (and its rails) shows between them.
    vec3 dotCol = mix(uDot, uAccent, glow);
    float a = dotMask * max(far * wave, glow);
    float tint = glow * 0.07 * far;
    float outA = a + tint * (1.0 - a);
    vec3 col = (dotCol * a + uAccent * tint * (1.0 - a)) / max(outA, 1e-4);
    gl_FragColor = vec4(col, outA);
    #include <colorspace_fragment>
  }
`;

interface Kit {
  role: (r: Role | number) => THREE.ShaderMaterial;
  line: LineMaterial;
  hull: THREE.ShaderMaterial;
  floor: THREE.ShaderMaterial;
  glow: THREE.Vector3[];
  setPalette: (p: Palette) => void;
  setSize: (w: number, h: number) => void;
}

function makeKit(): Kit {
  const facet = (color: number) =>
    new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: FACET_VERT,
      fragmentShader: FACET_FRAG,
      // Fills sit a hair behind their own edges so outlines never z-fight.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

  const roles: Record<Role, THREE.ShaderMaterial> = {
    fill: facet(LIGHT.fill),
    fill2: facet(LIGHT.fill2),
    ink: facet(LIGHT.ink),
    orange: facet(ORANGE),
  };
  const fixed = new Map<number, THREE.ShaderMaterial>();
  const role = (r: Role | number) => {
    if (typeof r === 'string') return roles[r];
    if (!fixed.has(r)) fixed.set(r, facet(r));
    return fixed.get(r)!;
  };

  const line = new LineMaterial({ color: LIGHT.ink, linewidth: LINE_PX, worldUnits: false });

  const hull = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(LIGHT.ink) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uWidth: { value: LINE_PX },
    },
    vertexShader: HULL_VERT,
    fragmentShader: HULL_FRAG,
    side: THREE.BackSide,
  });

  const glow = Array.from({ length: 6 }, () => new THREE.Vector3(0, 0, 0));
  const floor = new THREE.ShaderMaterial({
    uniforms: {
      uDot: { value: new THREE.Color(LIGHT.dot) },
      uAccent: { value: new THREE.Color(ORANGE) },
      uFocus: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uGlow: { value: glow },
    },
    vertexShader: FLOOR_VERT,
    fragmentShader: FLOOR_FRAG,
    transparent: true,
  });

  return {
    role,
    line,
    hull,
    floor,
    glow,
    setPalette: (p) => {
      roles.fill.uniforms.uColor.value.setHex(p.fill);
      roles.fill2.uniforms.uColor.value.setHex(p.fill2);
      roles.ink.uniforms.uColor.value.setHex(p.ink);
      line.color.setHex(p.ink);
      hull.uniforms.uColor.value.setHex(p.ink);
      floor.uniforms.uDot.value.setHex(p.dot);
    },
    setSize: (w, h) => {
      line.resolution.set(w, h);
      hull.uniforms.uRes.value.set(w, h);
    },
  };
}

/* ————— canvas textures ————— */

function drawCode(c: HTMLCanvasElement, dark: boolean, accent = '#ff8a5c') {
  const g = c.getContext('2d')!;
  g.fillStyle = dark ? '#141311' : '#ffffff';
  g.fillRect(0, 0, 256, 160);
  // title bar dots
  const dot = dark ? '#8a857b' : '#cfc9bf';
  ['#ff5a1f', dot, dot].forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(18 + i * 16, 14, 4, 0, 7);
    g.fill();
  });
  // fake code lines — darker, lower-key hues on the light card
  const ink = dark ? '#e9e4da' : '#2a2723';
  const blue = dark ? '#9ec5e0' : '#4a7ba6';
  const green = dark ? '#c7d98f' : '#7a9440';
  const lines = [
    [0.12, 0.5, accent], [0.28, 0.55, blue], [0.28, 0.4, green],
    [0.44, 0.3, ink], [0.28, 0.45, accent], [0.12, 0.35, ink],
    [0.12, 0.6, dot], [0.28, 0.3, blue],
  ];
  lines.forEach(([indent, len, col], i) => {
    g.fillStyle = col as string;
    g.fillRect(16 + (indent as number) * 100, 34 + i * 15, (len as number) * 140, 5);
  });
}

function canvasTexture(w: number, h: number, draw: (c: HTMLCanvasElement) => void, repaint: (() => void)[]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const paint = () => {
    draw(c);
    tex.needsUpdate = true;
  };
  paint();
  repaint.push(paint);
  return tex;
}

/* ————— builders ————— */

interface Ctx {
  kit: Kit;
  pal: () => Palette;
  repaint: (() => void)[];
}

/** A mesh in line-art: facet fill, crease edges, and optionally a hull for curved silhouettes. */
function part(
  ctx: Ctx,
  geo: THREE.BufferGeometry,
  role: Role | number,
  { edges = true, hull = false } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geo, ctx.kit.role(role));
  // Ink on ink needs no outline.
  if (role === 'ink') return m;
  if (edges) {
    const e = new LineSegments2(
      new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo, 28)),
      ctx.kit.line,
    );
    m.add(e);
  }
  if (hull) m.add(new THREE.Mesh(geo, ctx.kit.hull));
  return m;
}

const box = (
  ctx: Ctx, w: number, h: number, d: number, role: Role | number,
  x = 0, y = 0, z = 0,
): THREE.Mesh => {
  const m = part(ctx, new THREE.BoxGeometry(w, h, d), role);
  m.position.set(x, y, z);
  return m;
};

function cyl(ctx: Ctx, r: number, h: number, role: Role | number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = part(ctx, new THREE.CylinderGeometry(r, r, h, 32), role, { hull: true });
  m.position.set(x, y, z);
  return m;
}

function codePanel(ctx: Ctx, w = 3.2, h = 2): THREE.Group {
  const g = new THREE.Group();
  g.add(box(ctx, w, h, 0.12, 'ink'));
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 0.16, h - 0.16),
    new THREE.MeshBasicMaterial({
      map: canvasTexture(256, 160, (c) => drawCode(c, ctx.pal() === DARK), ctx.repaint),
    }),
  );
  face.position.z = 0.065;
  g.add(face);
  return g;
}

function paper(ctx: Ctx): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1.1, 1.4, 0.03);
  const fill = ctx.kit.role('fill');
  const face = new THREE.MeshBasicMaterial({
    map: canvasTexture(160, 200, (c) => {
      const g = c.getContext('2d')!;
      g.fillStyle = hex(ctx.pal().fill);
      g.fillRect(0, 0, 160, 200);
      g.fillStyle = ctx.pal().paperInk;
      for (let i = 0; i < 9; i++) g.fillRect(16, 26 + i * 18, 60 + ((i * 37) % 70), 4);
    }, ctx.repaint),
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const m = new THREE.Mesh(geo, [fill, fill, fill, fill, face, fill]);
  m.add(new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo)), ctx.kit.line));
  return m;
}

/* ————— pipeline props (hero) ————— */

/** A person, as few shapes as will read as one: body, head. The human steps. */
function person(ctx: Ctx): THREE.Group {
  const g = new THREE.Group();
  const body = part(ctx, new THREE.CylinderGeometry(0.2, 0.34, 0.95, 24), 'ink');
  body.position.y = 0.475;
  const head = part(ctx, new THREE.SphereGeometry(0.25, 24, 16), 'ink');
  head.position.y = 1.22;
  g.add(body, head);
  return g;
}

/** The agent: a boxy head with two lit eyes on a block. Deliberately not a person. */
function agentBot(ctx: Ctx): THREE.Group {
  const g = new THREE.Group();
  g.add(box(ctx, 0.7, 0.55, 0.6, 'fill2', 0, 0.275, 0));
  g.add(box(ctx, 0.12, 0.14, 0.12, 'ink', 0, 0.62, 0));
  g.add(box(ctx, 0.86, 0.62, 0.66, 'fill', 0, 1.0, 0));
  for (const x of [-0.2, 0.2]) g.add(box(ctx, 0.14, 0.14, 0.04, 'orange', x, 1.03, 0.34));
  return g;
}

/** Serverless, drawn: a cloud with identical little instances under it. */
function cloud(ctx: Ctx): THREE.Group {
  const g = new THREE.Group();
  const puffs: [number, number, number, number][] = [
    [0, 0, 0, 0.62], [-0.62, -0.1, 0.05, 0.46], [0.66, -0.08, 0, 0.5], [0.2, 0.3, -0.1, 0.48], [-0.25, 0.22, 0.1, 0.4],
  ];
  for (const [x, y, z, r] of puffs) {
    const p = part(ctx, new THREE.SphereGeometry(r, 32, 24), 'fill', { edges: false, hull: true });
    p.position.set(x, y, z);
    g.add(p);
  }
  return g;
}

/** Mono caption lying on the floor beside a step. Repainted on theme change. */
function floorLabel(ctx: Ctx, no: string, text: string): THREE.Mesh {
  const tex = canvasTexture(512, 128, (c) => {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 512, 128);
    g.textBaseline = 'middle';
    g.font = "500 40px 'JetBrains Mono', ui-monospace, Menlo, monospace";
    g.fillStyle = '#ff5a1f';
    g.fillText(no, 8, 66);
    g.fillStyle = hex(ctx.pal().ink);
    g.font = "600 52px 'Bricolage Grotesque', system-ui, sans-serif";
    g.fillText(text, 90, 66);
  }, ctx.repaint);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 0.8),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

/* ————— stations ————— */

interface Station {
  /** Matches a room's data-station attribute. */
  name: string;
  cam: [number, number, number];
  look: [number, number, number];
  animated: THREE.Object3D[];
  /** Vertical field of view; narrow + far reads as isometric. Default 38. */
  fov?: number;
  /** Per-frame motion beyond the idle float (the hero belt). */
  tick?: (t: number) => void;
}

const DEFAULT_FOV = 38;

function buildStations(scene: THREE.Scene, ctx: Ctx): Station[] {
  const stations: Station[] = [];
  const at = (i: number) => i * GAP;

  // 0 — hero: the service as a machine. Request → approve → build → ship,
  // left to right along +X, viewed from the front-left so it climbs the screen.
  {
    const g = new THREE.Group();
    g.position.x = at(0);
    const STEP_X = [-4.8, -1.6, 1.6, 4.8];
    const BELT_Z = 0.7;
    const PAD_Z = -1.35;
    const FACE = -Math.PI / 4; // turn a +Z face toward the camera

    // belt + rails
    g.add(box(ctx, 12.2, 0.3, 1.1, 'fill2', 0.2, 0.15, BELT_Z));
    for (const z of [BELT_Z - 0.6, BELT_Z + 0.6]) g.add(box(ctx, 12.2, 0.12, 0.1, 'ink', 0.2, 0.36, z));

    // a pad per step, with its caption on the floor in front of the belt
    const captions: [string, string][] = [['01', 'REQUEST'], ['02', 'APPROVE'], ['03', 'BUILD'], ['04', 'SHIP']];
    STEP_X.forEach((x, i) => {
      g.add(box(ctx, 2.3, 0.4, 2.0, 'fill', x, 0.2, PAD_Z));
      const label = floorLabel(ctx, captions[i][0], captions[i][1]);
      label.position.set(x + 0.15, 0.02, BELT_Z + 1.35);
      g.add(label);
    });

    // 01 request — a letter and a chat bubble arriving
    const letter = box(ctx, 1.15, 0.78, 0.08, 'fill', STEP_X[0] - 0.35, 0.85, PAD_Z);
    letter.rotation.set(-0.25, FACE, 0);
    const seal = cyl(ctx, 0.13, 0.05, 'orange', 0, 0, 0.06);
    seal.rotation.x = Math.PI / 2;
    letter.add(seal);
    const bubble = new THREE.Group();
    bubble.add(box(ctx, 1.05, 0.7, 0.3, 'fill'));
    bubble.add(box(ctx, 0.22, 0.22, 0.3, 'fill', -0.3, -0.38, 0).rotateZ(Math.PI / 4));
    for (const dx of [-0.26, 0, 0.26]) bubble.add(box(ctx, 0.12, 0.12, 0.05, 'ink', dx, 0, 0.17));
    bubble.position.set(STEP_X[0] + 0.5, 2.0, PAD_Z - 0.2);
    bubble.rotation.y = FACE;
    g.add(letter, bubble);

    // 02 approve — a person at a gate; the orange stamp only drops when a ticket is under it
    const gateX = STEP_X[1];
    g.add(box(ctx, 0.2, 2.1, 0.2, 'ink', gateX, 1.05, BELT_Z - 0.75));
    g.add(box(ctx, 0.2, 2.1, 0.2, 'ink', gateX, 1.05, BELT_Z + 0.75));
    g.add(box(ctx, 0.2, 0.2, 1.7, 'ink', gateX, 2.1, BELT_Z));
    const stamp = cyl(ctx, 0.3, 0.5, 'orange', gateX, 1.5, BELT_Z);
    g.add(stamp);
    const approver = person(ctx);
    approver.position.set(gateX, 0.4, PAD_Z);
    g.add(approver);

    // 03 build — the agent at a terminal
    const term = codePanel(ctx, 2.1, 1.35);
    term.position.set(STEP_X[2] + 0.55, 1.35, PAD_Z - 0.45);
    term.rotation.y = FACE;
    g.add(box(ctx, 0.16, 0.7, 0.16, 'ink', STEP_X[2] + 0.55, 0.55, PAD_Z - 0.45));
    const bot = agentBot(ctx);
    bot.position.set(STEP_X[2] - 0.55, 0.4, PAD_Z + 0.35);
    bot.rotation.y = FACE;
    g.add(term, bot);

    // 04 ship — a second person checks it, then it lifts into the cloud
    const reviewer = person(ctx);
    reviewer.position.set(STEP_X[3] - 0.2, 0.4, PAD_Z);
    g.add(reviewer);
    const sky = cloud(ctx);
    sky.position.set(7.4, 3.5, BELT_Z - 0.2);
    sky.scale.setScalar(1.25);
    g.add(sky);
    // identical instances under the cloud: scaling is more of the same box
    const instances: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const inst = box(ctx, 0.3, 0.3, 0.3, i === 1 ? 'orange' : 'ink', 6.75 + i * 0.44, 2.45, BELT_Z - 0.2);
      instances.push(inst);
      g.add(inst);
    }

    // tickets riding the belt; what they look like says which step they passed
    const START = -6.1;
    const LIFT = 5.9; // where the belt ends and the ticket rises
    const END = 7.4;
    const ticketGeo = new THREE.BoxGeometry(0.66, 0.12, 0.46);
    const tickets = Array.from({ length: 6 }, () => {
      const stage = (['fill', 'ink', 'orange'] as const).map((r) => part(ctx, ticketGeo, r));
      const t = new THREE.Group();
      t.add(...stage);
      const mark = cyl(ctx, 0.11, 0.03, 'orange', 0.16, 0.07, 0.08);
      t.add(mark);
      g.add(t);
      return { group: t, stage, mark };
    });
    const tick = (time: number) => {
      let nearestGate = Infinity;
      tickets.forEach(({ group, stage, mark }, i) => {
        const u = (time * 0.045 + i / tickets.length) % 1;
        const x = START + u * (END - START);
        const lift = Math.max(0, (x - LIFT) / (END - LIFT));
        group.position.set(x, 0.43 + lift * lift * 2.7, BELT_Z - lift * 0.2);
        group.scale.setScalar(1 - lift * 0.55);
        const s = x > STEP_X[3] ? 2 : x > STEP_X[2] ? 1 : 0;
        stage.forEach((m, k) => (m.visible = k === s));
        mark.visible = x > gateX && x <= STEP_X[2];
        nearestGate = Math.min(nearestGate, Math.abs(x - gateX));
        // The floor glow follows the ticket; it brightens once approved and
        // fades as the ticket lifts off into the cloud.
        const approved = THREE.MathUtils.smoothstep(x, gateX - 0.3, gateX + 0.6);
        const enter = THREE.MathUtils.smoothstep(x, START, START + 0.8);
        // Centred just in front of the belt: the belt itself hides the floor.
        ctx.kit.glow[i].set(x, BELT_Z + 0.95, (0.35 + 0.65 * approved) * enter * (1 - lift));
      });
      stamp.position.y = 1.5 - 0.72 * Math.max(0, 1 - nearestGate / 0.45);
      instances.forEach((inst, i) => {
        inst.position.y = 2.45 + Math.sin(time * 1.3 + i * 1.1) * 0.07;
      });
    };
    tick(8); // a settled frame for reduced motion and first paint

    scene.add(g);
    // Classic isometric direction (1 : 0.82 : 1), from the front-left.
    const LOOK: [number, number, number] = [at(0) - 0.4, 0.9, 0];
    const D = 21;
    stations.push({
      name: 'hero',
      cam: [LOOK[0] - D, LOOK[1] + D * 0.82, LOOK[2] + D],
      look: LOOK,
      animated: [bubble, sky],
      fov: 26,
      tick,
    });
  }

  // 1 — how it works: the queue itself, tickets in a stack with one approved
  {
    const g = new THREE.Group();
    g.position.x = at(1);
    g.add(box(ctx, 3.4, 0.5, 2.6, 'fill2', 5.4, 0.25, -3.2));
    for (let i = 0; i < 7; i++) {
      const slab = box(ctx, 2.5, 0.2, 1.7, i === 4 ? 'orange' : 'fill', 5.4, 0.62 + i * 0.24, -3.2);
      slab.rotation.y = ((i * 37) % 9 - 4) * 0.035;
      g.add(slab);
    }
    scene.add(g);
    stations.push({ name: 'how', cam: [at(1), 3.2, 12], look: [at(1), 1.5, -1], animated: [] });
  }

  // 2 — shelf room: kind-colored project boxes on a long plank
  {
    const g = new THREE.Group();
    g.position.x = at(2);
    g.add(box(ctx, 11, 0.5, 3, 'fill2', 2.5, 0.25, -3.5));
    const specs: [Role | number, number, number, number][] = [
      [SHOPIFY, 1.5, 2.4, 1.5], ['orange', 1.2, 1.7, 1.2], ['ink', 1.3, 2.0, 1.3], [GREY, 1.1, 1.4, 1.1],
    ];
    specs.forEach(([col, w, h, d], i) => {
      const x = -0.5 + i * 2.1;
      g.add(box(ctx, w, h, d, col, x, 0.5 + h / 2, -3.5));
      g.add(box(ctx, w + 0.02, 0.24, d + 0.02, 'fill', x, 0.5 + h - 0.12, -3.5));
    });
    scene.add(g);
    stations.push({ name: 'shelf', cam: [at(2) + 1, 2.6, 11], look: [at(2) + 1.5, 1.2, -1], animated: [] });
  }

  // 3 — writing room: papers lifting off a low plinth
  {
    const g = new THREE.Group();
    g.position.x = at(3);
    g.add(box(ctx, 4.2, 0.6, 3, 'fill2', 4.6, 0.3, -2.6));
    const sheets: THREE.Object3D[] = [];
    for (let i = 0; i < 5; i++) {
      const s = paper(ctx);
      s.position.set(2.6 + i * 0.85, 2.3 + i * 0.5, -2.9 + (i % 2) * 0.5);
      s.rotation.set(-0.25 + i * 0.08, 0.3 - i * 0.15, 0.12 - i * 0.05);
      sheets.push(s);
      g.add(s);
    }
    scene.add(g);
    stations.push({ name: 'writing', cam: [at(3) + 1, 2.8, 10.6], look: [at(3) + 1.4, 1.7, 0], animated: sheets });
  }

  // 4 — work room: pillars like a bar-chart timeline
  {
    const g = new THREE.Group();
    g.position.x = at(4);
    [1.4, 2.3, 3.1, 1.9].forEach((h, i) => {
      g.add(box(ctx, 1.4, h, 1.7, i === 2 ? 'orange' : 'fill', -2.6 + i * 1.9, h / 2, -4.5));
    });
    scene.add(g);
    stations.push({ name: 'work', cam: [at(4), 3.4, 12], look: [at(4), 1.1, -2], animated: [] });
  }

  // 5 — library (knowledgebase + plugins): index cards filed in a tray
  {
    const g = new THREE.Group();
    g.position.x = at(5);
    g.add(box(ctx, 5.2, 0.5, 1.8, 'fill2', 4.4, 0.25, -3));
    for (let i = 0; i < 11; i++) {
      const h = 1.1 + ((i * 7) % 4) * 0.14;
      const card = box(ctx, 0.1, h, 1.3, i === 6 ? 'orange' : 'fill', 2.3 + i * 0.42, 0.5 + h / 2, -3);
      card.rotation.z = -0.08;
      g.add(card);
    }
    scene.add(g);
    stations.push({ name: 'library', cam: [at(5) + 1, 2.8, 11], look: [at(5) + 1.4, 1.5, -1], animated: [] });
  }

  // 6 — intercom room: the orange beacon
  {
    const g = new THREE.Group();
    g.position.x = at(6);
    const beacon = box(ctx, 1.6, 4.4, 1.6, 'orange', 0, 2.2, -4.5);
    g.add(beacon);
    g.add(box(ctx, 3, 0.7, 3, 'fill', 0, 0.35, -4.5));
    scene.add(g);
    stations.push({ name: 'talk', cam: [at(6), 3, 12.5], look: [at(6), 1.9, -2], animated: [beacon] });
  }

  return stations;
}

/* ————— driver ————— */

export function initWorkshop(canvas: HTMLCanvasElement): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Transparent canvas: the page background and rails sit behind it, and
  // only the props and floor dots paint over them.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 400);

  let pal = LIGHT;
  const kit = makeKit();
  const repaint: (() => void)[] = [];
  const ctx: Ctx = { kit, pal: () => pal, repaint };

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 240), // deep enough that the isometric hero never sees an edge
    kit.floor,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(32, 0, -6);
  // First among the transparent pass, so the floor captions draw over it.
  floor.renderOrder = -1;
  scene.add(floor);

  const stations = buildStations(scene, ctx);
  // Web fonts may land after first paint; redraw the captions once they have.
  document.fonts?.ready.then(() => repaint.forEach((draw) => draw()));

  // Theme sync — read the page attribute, repaint on change.
  const applyTheme = () => {
    pal = document.documentElement.dataset.theme === 'dark' ? DARK : LIGHT;
    kit.setPalette(pal);
    repaint.forEach((draw) => draw());
    if (reduced) renderer.render(scene, camera);
  };
  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  // Scroll driver: which room is in the viewport → its station. Rooms name
  // their station with data-station, so adding a room to the page never
  // shifts every backdrop after it; an unnamed room keeps the previous one.
  // Mapped by offsetTop, not scrollY/innerHeight, so the pose lands on the
  // room you're in even when a section overshoots the viewport.
  const last = stations.length - 1;
  let rooms: { top: number; station: number }[] = [];
  const measure = () => {
    let previous = 0;
    rooms = Array.from(document.querySelectorAll<HTMLElement>('.room, .intercom'))
      .sort((a, b) => a.offsetTop - b.offsetTop)
      .map((el) => {
        const named = stations.findIndex((st) => st.name === (el.dataset.station ?? (el.classList.contains('intercom') ? 'talk' : '')));
        previous = named === -1 ? previous : named;
        return { top: el.offsetTop, station: previous };
      });
  };
  measure();
  const targetFor = () => {
    const y = window.scrollY + window.innerHeight * 0.45;
    let i = 0;
    while (i < rooms.length - 1 && rooms[i + 1].top <= y) i += 1;
    return rooms[i]?.station ?? 0;
  };

  let current = targetFor();
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const mouse = { x: 0, y: 0 };
  // Narrow viewports see less horizontally — pull the camera back so the
  // stations read at a similar size and don't crowd the DOM text.
  let zoom = 1;
  const computeZoom = () => {
    zoom = THREE.MathUtils.clamp(0.95 / camera.aspect, 1, 2.2);
  };

  const pose = (t: number) => {
    const i = Math.min(Math.floor(t), last - 1);
    const f = THREE.MathUtils.smoothstep(t - i, 0, 1);
    const a = stations[i];
    const b = stations[Math.min(i + 1, last)];
    const mix = (x: number, y: number) => THREE.MathUtils.lerp(x, y, f);
    look.set(mix(a.look[0], b.look[0]), mix(a.look[1], b.look[1]), mix(a.look[2], b.look[2]));
    // Zoom scales the whole look→camera offset, so an angled (isometric)
    // pose pulls straight back instead of sliding sideways.
    pos.set(mix(a.cam[0], b.cam[0]), mix(a.cam[1], b.cam[1]), mix(a.cam[2], b.cam[2]))
      .sub(look)
      .multiplyScalar(zoom)
      .add(look);
    const fov = mix(a.fov ?? DEFAULT_FOV, b.fov ?? DEFAULT_FOV);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    kit.floor.uniforms.uFocus.value.set(look.x, look.z);
  };

  // Lens shift, not a camera move: wide screens slide the diorama right so
  // the left-aligned DOM text reads on clear floor; tall screens lift it into
  // the empty band under the header. Perspective stays identical.
  const frame = (w: number, h: number) => {
    const aspect = w / h;
    const dx = aspect >= 1.25 ? -w * THREE.MathUtils.clamp((aspect - 1.25) * 0.6, 0, 0.22) : 0;
    const dy = aspect < 0.9 ? h * 0.12 : 0;
    if (dx || dy) camera.setViewOffset(w, h, dx, dy, w, h);
    else camera.clearViewOffset();
  };

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    kit.setSize(w, h);
    camera.aspect = w / h;
    frame(w, h);
    camera.updateProjectionMatrix();
    computeZoom();
    if (reduced) {
      pose(current);
      camera.position.copy(pos);
      camera.lookAt(look);
      renderer.render(scene, camera);
    }
    measure();
  };
  resize();
  window.addEventListener('resize', resize);

  if (reduced) {
    // No animation loop — snap straight to the room being viewed.
    const render = () => {
      current = targetFor();
      pose(current);
      camera.position.copy(pos);
      camera.lookAt(look);
      renderer.render(scene, camera);
    };
    render();
    window.addEventListener('scroll', render, { passive: true });
    return;
  }

  window.addEventListener('pointermove', (e) => {
    mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  const timer = new THREE.Timer();
  const tick = () => {
    timer.update();
    const t = timer.getElapsed();
    current += (targetFor() - current) * 0.075;
    pose(current);
    kit.floor.uniforms.uTime.value = t;
    // Gentle idle float on registered props + pointer parallax.
    stations.forEach((s, si) => {
      s.tick?.(t);
      s.animated.forEach((o, oi) => {
        o.position.y += Math.sin(t * 0.9 + si * 2 + oi) * 0.0016;
        o.rotation.z += Math.sin(t * 0.5 + oi) * 0.0004;
      });
    });
    camera.position.set(pos.x + mouse.x * 0.7, pos.y - mouse.y * 0.4, pos.z);
    camera.lookAt(look);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  tick();
}
