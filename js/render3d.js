'use strict';
/* Faux-2D renderer ("HD-2D" / SNES 3/4 view in real 3D). Reads Game.state each frame; owns no game state.

   Projection: a top-down orthographic camera with a cabinet shear, so the floor is drawn undistorted
   (1 texel = 1 screen pixel) and every world unit of height rises 1:1 up the screen. Wall fronts and
   upright sprites therefore look exactly like a 2D tileset, while depth still comes from the Z-buffer:
   with this shear, depth = height, which sorts "behind the wall" / "in front of the crate" correctly.

   - Walls: merged slabs; a top face whose rim/shadow edges appear only on the outer boundary, plus a
     separate front-face texture. No per-tile outlines, no repeated cube faces.
   - Characters, drones, cameras, trees, barrels, pickups: pixel-art billboards with baked ink outlines.
   - Floor: pixel tiles with baked contact shadows; blob shadows under actors; x-ray silhouettes when
     something is hidden behind a wall.
   - Output: rendered at ~224 lines, then scaled to the screen by an exact integer, 15-bit colour. */
const Render3D = (() => {
  const PX = 16;                 // texels per world unit
  const WALL_PX = 20;            // wall front height in pixels
  const SHEAR = 1;               // screen rise per unit of height
  let renderer, scene, camera, rtLow, postScene, postCam, postMat, canvasEl;
  let W = 1, H = 1, pixel = 3, rtW = 2, rtH = 2;
  const shearM = new THREE.Matrix4(), baseP = new THREE.Matrix4();
  let level = null, builtS = null, builtVersion = -1;
  let exitDecals = [], coreSprites = [], fieldMeshes = [];
  const actors = new Map();      // sim object -> {mesh, xray, shadow}
  const cones = new Map();
  let dyn, pointsFx, pointsBul;
  const camT = { x: 0, z: 0, S: null };
  let floaterSprites = new Map();

  // ------------------------------------------------------------------ textures & materials
  const texMap = new WeakMap();
  function tex(c) {
    let t = texMap.get(c);
    if (!t) {
      t = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      texMap.set(c, t);
    }
    return t;
  }
  const matMap = new Map();
  function flatMat(c, o = {}) {
    const k = (c ? c.__id || (c.__id = Math.random().toString(36).slice(2)) : 'none') + JSON.stringify(o);
    let m = matMap.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ map: c ? tex(c) : null, side: THREE.DoubleSide, color: o.color != null ? o.color : 0xffffff });
      if (o.alphaTest) m.alphaTest = o.alphaTest;
      if (o.opacity) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
      if (o.additive) { m.transparent = true; m.blending = THREE.AdditiveBlending; m.depthWrite = false; }
      matMap.set(k, m);
    }
    return m;
  }
  const XRAY_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const XRAY_FS = 'uniform sampler2D map; uniform vec3 color; varying vec2 vUv; void main(){ if (texture2D(map, vUv).a < 0.5) discard; gl_FragColor = vec4(color, 1.0); }';
  function xrayMat(color) {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, color: { value: new THREE.Color(color) } },
      vertexShader: XRAY_VS, fragmentShader: XRAY_FS,
      depthFunc: THREE.GreaterDepth, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  // ------------------------------------------------------------------ setup
  function init(canvas) {
    canvasEl = canvas;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    rtLow = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 120);
    camera.up.set(0, 0, -1);
    postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: rtLow.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uPixel: { value: 1 }, uTint: { value: new THREE.Vector4(0, 0, 0, 0) }, uScreen: { value: new THREE.Vector2(1, 1) } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uRes, uScreen; uniform float uPixel; uniform vec4 uTint;
        void main(){
          // exact integer upscale, centred
          vec2 off = (uScreen - uRes*uPixel)*0.5;
          vec2 p = floor((gl_FragCoord.xy - off)/uPixel) + 0.5;
          vec3 c = texture2D(tDiffuse, p/uRes).rgb;
          c = mix(c, uTint.rgb, uTint.a);
          vec2 d = (gl_FragCoord.xy/uScreen - 0.5)*vec2(uScreen.x/uScreen.y, 1.0);
          c *= mix(0.78, 1.0, smoothstep(0.95, 0.35, length(d)));
          c = floor(clamp(c, 0.0, 1.0)*31.0 + 0.5)/31.0;   // 15-bit colour, SNES style
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    postScene = new THREE.Scene();
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));
    // cabinet shear in view space: y' = y + k*(z + camHeight)
    shearM.set(1, 0, 0, 0, 0, 1, SHEAR, 50 * SHEAR, 0, 0, 1, 0, 0, 0, 0, 1);

    dyn = new THREE.Group(); scene.add(dyn);
    const mkPoints = (n, size) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setDrawRange(0, 0);
      const p = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true }));
      p.frustumCulled = false; p.renderOrder = 5;
      scene.add(p); return p;
    };
    pointsFx = mkPoints(600, 1);
    pointsBul = mkPoints(120, 2);
    Game.setViewYaw(0); // straight-on camera: screen up = north
  }

  function resize(cssW, cssH, dpr) {
    W = Math.max(1, Math.round(cssW * dpr)); H = Math.max(1, Math.round(cssH * dpr));
    renderer.setSize(W, H, false);
    canvasEl.style.width = cssW + 'px'; canvasEl.style.height = cssH + 'px';
    pixel = Math.max(1, Math.round(Math.min(W, H) / 224)); // SNES-ish: ~224 lines on the short side
    rtW = Math.ceil(W / pixel / 2) * 2; rtH = Math.ceil(H / pixel / 2) * 2;
    rtLow.setSize(rtW, rtH);
    postMat.uniforms.uRes.value.set(rtW, rtH);
    postMat.uniforms.uPixel.value = pixel;
    postMat.uniforms.uScreen.value.set(W, H);
    camera.left = -rtW / PX / 2; camera.right = rtW / PX / 2; camera.top = rtH / PX / 2; camera.bottom = -rtH / PX / 2;
    camera.updateProjectionMatrix();
    baseP.copy(camera.projectionMatrix);
  }

  // ------------------------------------------------------------------ level
  const BG = { depot: 0x0a0e18, camp: 0x140e10, lab: 0x0c1018, hangar: 0x080a10, ship: 0x0c0616, pow: 0x100a08 };
  const PROP = { // height in px, inset in px
    X: [14, 0], L: [22, 2], G: [22, 2], k: [22, 2], B: [12, 1], O: [11, 2], C: [10, 1], I: [10, 1], i: [10, 1],
    D: [WALL_PX, 0], J: [WALL_PX, 0], A: [14, 0],
  };

  function buildLevel(S) {
    if (level) { scene.remove(level); level.traverse((o) => { if (o.geometry && o.userData.own) o.geometry.dispose(); }); }
    level = new THREE.Group(); scene.add(level);
    exitDecals = []; coreSprites = []; fieldMeshes = [];
    const th = S.theme, T3 = Art.THEMES[th];
    scene.background = new THREE.Color(BG[th] || 0x0a0e18);
    const at = (x, y) => (x < 0 || y < 0 || x >= S.w || y >= S.h) ? '#' : S.grid[y * S.w + x];
    const isWall = (c) => c === '#';
    const solid = (c) => !!Game.tileDef(c).s;
    const tall = (c) => isWall(c) || (solid(c) && c !== '=' && c !== 'C' && c !== 'I' && c !== 'i' && c !== 'Z' && c !== 'z');

    // --- floor with baked contact shadows (light from the north-west)
    const fc = document.createElement('canvas'); fc.width = S.w * PX; fc.height = S.h * PX;
    const fg = fc.getContext('2d');
    const floorOf = (ch) => (',.:;'.includes(ch) ? ch : S.def.floor);
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) fg.drawImage(Art.tile(th, floorOf(at(x, y)), (x * 7 + y * 13) % 4, false), x * PX, y * PX);
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      if (solid(at(x, y))) continue;
      if (tall(at(x, y - 1))) { const gr = fg.createLinearGradient(0, y * PX, 0, y * PX + 6); gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); fg.fillStyle = gr; fg.fillRect(x * PX, y * PX, PX, 6); }
      if (tall(at(x - 1, y))) { const gr = fg.createLinearGradient(x * PX, 0, x * PX + 5, 0); gr.addColorStop(0, 'rgba(0,0,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); fg.fillStyle = gr; fg.fillRect(x * PX, y * PX, 5, PX); }
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.h), new THREE.MeshBasicMaterial({ map: tex(fc) }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(S.w / 2, 0, S.h / 2); floor.userData.own = true;
    level.add(floor);

    // --- merged slabs: one geometry per texture
    const quads = new Map(); // canvas -> {pos:[], uv:[], opts}
    const push = (canvasTex, verts, uvs, opts = {}) => {
      let q = quads.get(canvasTex);
      if (!q) { q = { pos: [], uv: [], opts }; quads.set(canvasTex, q); }
      q.pos.push(...verts); q.uv.push(...uvs);
    };
    // top quad (north edge maps to texture top) and front quad (south face)
    const top = (c, x0, x1, z0, z1, h, o) => push(c, [x0, h, z0, x1, h, z0, x1, h, z1, x0, h, z0, x1, h, z1, x0, h, z1], [0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0], o);
    const front = (c, x0, x1, z, h, o) => push(c, [x0, 0, z, x1, 0, z, x1, h, z, x0, 0, z, x1, h, z, x0, h, z], [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], o);
    const WH = WALL_PX / PX;

    for (let ty = 0; ty < S.h; ty++) for (let tx = 0; tx < S.w; tx++) {
      const ch = at(tx, ty);
      if (ch === '#') {
        const mask = (isWall(at(tx, ty - 1)) ? 0 : 1) | (isWall(at(tx + 1, ty)) ? 0 : 2) | (isWall(at(tx, ty + 1)) ? 0 : 4) | (isWall(at(tx - 1, ty)) ? 0 : 8);
        top(Sprites.wallTop(th, mask), tx, tx + 1, ty, ty + 1, WH);
        if (!isWall(at(tx, ty + 1))) {
          const cont = (x) => isWall(at(x, ty)) && !isWall(at(x, ty + 1));
          const fm = (cont(tx + 1) ? 0 : 2) | (cont(tx - 1) ? 0 : 8);
          front(Sprites.wallFront(th, WALL_PX, fm), tx, tx + 1, ty + 1, WH);
        }
        continue;
      }
      let spec = PROP[ch];
      if (ch === 'T') spec = T3.pillar === 'server' ? [22, 1] : T3.pillar === 'shuttle' ? [24, 0] : T3.pillar === 'machine' ? [20, 1] : null;
      if (ch === 'A' && th !== 'camp') spec = [14, 1];
      if (spec) {
        const [hp, inset] = spec, h = hp / PX, e = inset / PX;
        const alpha = ch === 'J' ? { alphaTest: 0.5 } : {};
        top(Sprites.propTop(th, ch), tx + e, tx + 1 - e, ty + e, ty + 1 - e, h, alpha);
        front(Sprites.propFront(th, ch, hp), tx + e, tx + 1 - e, ty + 1 - e, h, alpha);
        continue;
      }
      // sprites & decals
      const addSprite = (c, x, z, y = 0, order = 0) => {
        const m = new THREE.Mesh(spriteGeo(c.width, c.height), flatMat(c, { alphaTest: 0.5 }));
        m.position.set(x, y, z); m.renderOrder = order; level.add(m); return m;
      };
      if (ch === 'x') addSprite(Sprites.barrel(th), tx + 0.5, ty + 0.75);
      else if (ch === 'T' && T3.pillar === 'tree') addSprite(Sprites.tree(), tx + 0.5, ty + 0.8);
      else if (ch === 'T') addSprite(Sprites.pillar(th), tx + 0.5, ty + 0.75);
      else if (ch === 'Z' || ch === 'z') { const s = addSprite(Sprites.core(ch === 'Z' ? 0 : -1), tx + 0.5, ty + 0.7); if (ch === 'Z') coreSprites.push(s); }
      else if (ch === ';') { for (let i = 0; i < 2; i++) addSprite(Sprites.tuft((tx * 3 + ty * 5 + i) % 4), tx + 0.5 + (i ? 0.19 : -0.19), ty + 0.35 + i * 0.5); }
      else if (ch === '=') {
        if (th === 'lab') {
          top(glassTex(), tx, tx + 1, ty, ty + 1, WH, { opacity: 0.22 });
          front(glassTex(), tx, tx + 1, ty + 1, WH, { opacity: 0.22 });
        } else {
          const ns = solid(at(tx - 1, ty)) || solid(at(tx + 1, ty));
          const f = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.7), new THREE.MeshBasicMaterial({ color: parseInt(T3.field.slice(1), 16), transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
          f.position.set(tx + 0.5, 0.4, ty + 0.5); if (!ns) f.rotation.y = Math.PI / 2; f.renderOrder = 4; f.userData.own = true;
          level.add(f); fieldMeshes.push(f);
        }
      } else if (ch === 'E') {
        const d = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex(Sprites.exitPad(true)), transparent: true }));
        d.rotation.x = -Math.PI / 2; d.position.set(tx + 0.5, 0.003, ty + 0.5); d.userData.own = true;
        level.add(d); exitDecals.push(d);
      }
    }
    for (const [c, q] of quads) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(q.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(q.uv, 2));
      const m = new THREE.Mesh(g, flatMat(c, q.opts));
      m.userData.own = true;
      if (q.opts.opacity) m.renderOrder = 4;
      level.add(m);
    }
    builtS = S; builtVersion = S.tileVersion;
  }
  let glassC = null;
  function glassTex() {
    if (glassC) return glassC;
    glassC = document.createElement('canvas'); glassC.width = 16; glassC.height = 20;
    const g = glassC.getContext('2d');
    g.fillStyle = '#9fdcf0'; g.fillRect(0, 0, 16, 20); g.fillStyle = '#ffffff'; g.fillRect(3, 2, 1, 10); g.fillRect(5, 2, 1, 4); g.fillRect(0, 0, 16, 1); g.fillStyle = '#5a8aa0'; g.fillRect(0, 19, 16, 1);
    return glassC;
  }

  const geoCache = new Map();
  // upright quad, bottom-centre anchored, exactly 1 texel per pixel
  function spriteGeo(w, h) {
    const k = w + 'x' + h;
    let g = geoCache.get(k);
    if (!g) { g = new THREE.PlaneGeometry(w / PX, h / PX); g.translate(0, h / PX / 2, 0); geoCache.set(k, g); }
    return g;
  }
  const snap = (v) => Math.round(v * PX) / PX;

  // ------------------------------------------------------------------ actors
  function actor(obj, kind) {
    let a = actors.get(obj);
    if (!a) {
      const mat = new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });
      const mesh = new THREE.Mesh(spriteGeo(24, 32), mat);
      mesh.renderOrder = 2;
      const xr = kind ? new THREE.Mesh(mesh.geometry, xrayMat(kind === 'player' ? 0x4fe3ff : kind === 'pow' ? 0x35e08a : 0xff4b5c)) : null;
      if (xr) { xr.renderOrder = 1; }
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex(Sprites.blobShadow(14)), transparent: true, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2; sh.renderOrder = 3;
      dyn.add(mesh, sh); if (xr) dyn.add(xr);
      a = { mesh, xr, sh };
      actors.set(obj, a);
    }
    a.seen = true;
    return a;
  }
  function place(a, c, x, z, y = 0, shadowW = 14) {
    const m = a.mesh;
    const t = tex(c);
    if (m.material.map !== t) { m.material.map = t; m.material.needsUpdate = true; }
    if (m.geometry !== spriteGeo(c.width, c.height)) { m.geometry = spriteGeo(c.width, c.height); if (a.xr) a.xr.geometry = m.geometry; }
    m.position.set(snap(x), snap(y) + 0.002, snap(z));
    if (a.xr) { a.xr.material.uniforms.map.value = t; a.xr.position.copy(m.position); a.xr.visible = m.visible; }
    a.sh.position.set(snap(x), 0.004, snap(z) - 0.02);
    a.sh.scale.set(shadowW / PX, shadowW * 0.4 / PX, 1);
    a.sh.visible = m.visible;
  }
  const dirIndex = (a) => { const c = Math.cos(a), s = Math.sin(a); return Math.abs(c) > Math.abs(s) * 1.1 ? (c > 0 ? 2 : 3) : (s > 0 ? 0 : 1); };

  // ------------------------------------------------------------------ vision cones on the floor
  const CONE_COL = { patrol: 0xffe066, return: 0xffe066, suspicious: 0xff9a3c, search: 0xff9a3c, alert: 0xff3040 };
  function updateCone(S, e) {
    let c = cones.get(e);
    if (!c) {
      const n = 18, geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 2) * 3), 3));
      const idx = []; for (let i = 1; i <= n; i++) idx.push(0, i, i + 1);
      geo.setIndex(idx);
      c = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
      c.frustumCulled = false; c.renderOrder = 3; c.userData.n = n;
      cones.set(e, c); dyn.add(c);
    }
    c.userData.seen = true;
    const alive = !e.dead && !(e.ko > 0) && e.stun <= 0;
    c.visible = alive;
    if (!alive) return;
    const range = e.range * (S.phase === 'alert' ? 1.3 : 1);
    const pos = c.geometry.attributes.position, n = c.userData.n;
    const ox = e.x, oy = e.y - 2;
    pos.setXYZ(0, ox / PX, 0.01, oy / PX);
    for (let i = 0; i <= n; i++) {
      const a = e.dir - e.fov + (2 * e.fov * i) / n, cs = Math.cos(a), sn = Math.sin(a);
      let d = 4;
      while (d < range && !Game.opaqueAt(ox + cs * d, oy + sn * d)) d += 4;
      pos.setXYZ(i + 1, (ox + cs * d) / PX, 0.01, (oy + sn * d) / PX);
    }
    pos.needsUpdate = true;
    let col = CONE_COL[e.state] || CONE_COL.patrol;
    if (e.type === 'camera') col = S.phase === 'alert' ? 0xff3040 : e.aw > 0.3 ? 0xff9a3c : 0x7ad2ff;
    c.material.color.setHex(col);
    c.material.opacity = e.sees ? 0.34 : 0.2;
  }

  // ------------------------------------------------------------------ overlay sprites (icons, text, bars)
  const spriteTex = {};
  function textCanvas(text, color) {
    const k = text + color;
    if (!spriteTex[k]) { const c = document.createElement('canvas'); c.width = text.length * 4 + 3; c.height = 8; Art.text(c.getContext('2d'), text, c.width / 2, 1, color, '#05080c'); spriteTex[k] = c; }
    return spriteTex[k];
  }
  function iconCanvas(ch) {
    const k = 'icon' + ch;
    if (!spriteTex[k]) { const c = document.createElement('canvas'); c.width = 9; c.height = 10; Art.icon(c.getContext('2d'), ch, 4.5, 8, ch === '!' ? '#ff3a3a' : '#ffd23a'); spriteTex[k] = c; }
    return spriteTex[k];
  }
  function overlay(obj, key, c) {
    const store = obj.__ov || (obj.__ov = {});
    let s = store[key];
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: c ? tex(c) : null, depthTest: false, transparent: true }));
      s.renderOrder = 10; dyn.add(s); store[key] = s;
    }
    if (c) s.scale.set(c.width / PX, c.height / PX, 1);
    s.userData.seen = true; s.visible = true;
    return s;
  }

  // ------------------------------------------------------------------ per-frame sync
  function sync(S) {
    if (builtS !== S || builtVersion !== S.tileVersion) buildLevel(S);
    for (const a of actors.values()) a.seen = false;
    for (const c of cones.values()) c.userData.seen = false;
    dyn.children.forEach((o) => { if (o.isSprite) o.userData.seen = false; });
    const t = S.t, P = S.player;

    // player
    {
      const a = actor(P, 'player');
      let pose = P.moving ? 'walk' : 'stand';
      if (P.shootT > 0 || P.fireCD > 0.12) pose = 'shoot';
      if (P.punchT > 0) pose = 'punch';
      let d = dirIndex(P.dir);
      if ((pose === 'punch' || pose === 'shoot') && d < 2) pose = pose === 'shoot' ? 'shoot' : 'stand';
      const c = P.dead ? Sprites.body('snake') : Sprites.getChar('snake', d, (P.anim | 0) % 4, pose);
      a.mesh.visible = !P.hidden && !(P.inv > 0 && ((t * 30) | 0) % 2);
      place(a, c, P.x / PX, P.y / PX + 0.1);
    }
    // enemies
    for (const e of S.enemies) {
      if (e.type === 'drone') {
        const a = actor(e, 'enemy');
        const eye = e.state === 'alert' ? '#ff3040' : (e.state === 'patrol' || e.state === 'return') ? '#ffe066' : '#ff9a3c';
        a.mesh.visible = !e.dead;
        place(a, Sprites.drone(eye, ((t * 4) | 0) % 2), e.x / PX, e.y / PX + 0.1, 0.55 + Math.round(Math.sin(t * 4 + e.ox) * 1.5) / PX, 12);
      } else if (e.type === 'camera') {
        const a = actor(e, null);
        const oct = ((Math.round(e.dir / (Math.PI / 4)) % 8) + 8) % 8;
        a.mesh.visible = !e.dead;
        place(a, Sprites.camera(oct, S.phase === 'alert' ? '#ff3040' : ((t * 2) | 0) % 2 ? '#40ff70' : '#104010'), e.x / PX, e.y / PX + 0.05, 0.85, 0);
        a.sh.visible = false;
      } else {
        const a = actor(e, 'enemy');
        const down = e.ko > 0 || e.dead;
        let c;
        if (down) c = Sprites.body(e.type);
        else {
          const pose = e.stun > 0 ? 'stun' : e.state === 'alert' && e.sees ? 'shoot' : e.walking ? 'walk' : 'stand';
          c = Sprites.getChar(e.type, dirIndex(e.dir), (e.anim | 0) % 4, pose);
        }
        a.mesh.visible = !e.dead || e.deadT < 1.4;
        a.mesh.material.color.setHex(e.dead ? 0x6bd45a : 0xffffff);
        place(a, c, e.x / PX, e.y / PX + 0.1, 0, e.type === 'heavy' ? 18 : 14);
        if (e.dead) a.mesh.scale.set(1, Math.max(0.1, 1 - e.deadT / 1.4), 1); else a.mesh.scale.set(1, 1, 1);
        if (e.ko > 0) { const s = overlay(e, 'zz', textCanvas('Z Z', '#ffe66b')); s.position.set(e.x / PX, 0.9 + Math.round(Math.sin(t * 3) * 1.5) / PX, e.y / PX); }
      }
      updateCone(S, e);
      if (e.icon && !e.dead) {
        const s = overlay(e, 'icon' + e.icon, iconCanvas(e.icon));
        const lift = e.type === 'camera' ? 1.55 : e.type === 'drone' ? 1.9 : e.type === 'heavy' ? 2.35 : 2.25;
        s.position.set(snap(e.x / PX), lift, snap(e.y / PX));
      }
      if (!e.dead && !(e.ko > 0) && e.aw > 0.05 && e.aw < 1 && S.phase !== 'alert') {
        const bg = overlay(e, 'awbg', null), fg = overlay(e, 'awfg', null);
        const y = e.type === 'camera' ? 1.45 : 2.2;
        bg.material.color.setHex(0x000000); bg.scale.set(12 / PX, 3 / PX, 1); bg.position.set(snap(e.x / PX), y, snap(e.y / PX));
        fg.material.color.setHex(e.aw > 0.6 ? 0xff6a3a : 0xffd23a); fg.center.set(0, 0.5);
        fg.scale.set(Math.max(1, Math.round(10 * e.aw)) / PX, 1 / PX, 1); fg.position.set(snap(e.x / PX) - 5 / PX, y, snap(e.y / PX));
      }
    }
    // prisoners
    for (const w of S.pows) {
      const a = actor(w, 'pow');
      const kind = w.kind === 'ai' ? 'robot' : w.kind;
      place(a, Sprites.getChar(kind, w.state === 'caged' ? 0 : dirIndex(w.dir), (w.anim | 0) % 4, w.moving ? 'walk' : 'stand'), w.x / PX, w.y / PX + 0.1);
    }
    // pickups
    for (const p of S.pickups) {
      const a = actor(p, null);
      a.mesh.visible = !p.taken;
      place(a, Sprites.pickup(p.type), p.x / PX, p.y / PX + 0.1, Math.round(2 + Math.sin(t * 3 + p.x) * 2) / PX, 10);
    }
    // hide tell
    if (P.hidden && ((t * 1.5) | 0) % 4 !== 0) { const s = overlay(P, 'hid', textCanvas('..', '#ff4b5c')); s.position.set(P.hidden.tx + 0.5, 1.0, P.hidden.ty + 1); }
    // animated level bits
    const reqOk = !S.def.requires || (S.def.requires === 'intel' ? S.intel : S.cores >= S.coresTotal);
    for (const d of exitDecals) { const tt = tex(Sprites.exitPad(reqOk)); if (d.material.map !== tt) { d.material.map = tt; d.material.needsUpdate = true; } d.material.opacity = 0.7 + Math.sin(t * 4) * 0.3; }
    for (const c of coreSprites) { const tt = tex(Sprites.core(((t * 3) | 0) % 2)); if (c.material.map !== tt) c.material = flatMat(Sprites.core(((t * 3) | 0) % 2), { alphaTest: 0.5 }); c.position.y = Math.round(Math.sin(t * 2) * 1.5) / PX; }
    for (const f of fieldMeshes) f.material.opacity = 0.3 + Math.random() * 0.25;
    // floaters
    const live = new Set();
    for (const f of S.floaters) {
      let s = floaterSprites.get(f);
      if (!s) { const c = textCanvas(f.text, f.color); s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(c), depthTest: false, transparent: true })); s.scale.set(c.width / PX, c.height / PX, 1); s.renderOrder = 12; floaterSprites.set(f, s); dyn.add(s); }
      s.position.set(snap(f.x / PX), snap(1.9 + (1.3 - f.life) * 0.6), snap(f.y / PX));
      s.material.opacity = Math.min(1, f.life * 2);
      s.userData.seen = true; live.add(f);
    }
    for (const [f, s] of floaterSprites) if (!live.has(f)) { dyn.remove(s); s.material.dispose(); floaterSprites.delete(f); }
    // cull
    for (const [o, a] of actors) if (!a.seen) { dyn.remove(a.mesh, a.sh); if (a.xr) dyn.remove(a.xr); a.mesh.material.dispose(); actors.delete(o); }
    for (const [o, c] of cones) if (!c.userData.seen) { dyn.remove(c); c.geometry.dispose(); cones.delete(o); }
    for (const o of dyn.children) if (o.isSprite && !o.userData.seen && !floaterSprites.has(o)) o.visible = false;
    // particles & bullets
    const colr = new THREE.Color();
    const fx = pointsFx.geometry, fp = fx.attributes.position, fcol = fx.attributes.color;
    let n = 0;
    for (const p of S.particles) { if (n >= 600) break; fp.setXYZ(n, p.x / PX, 0.6 + p.life * 0.8, p.y / PX); colr.set(p.color); fcol.setXYZ(n, colr.r, colr.g, colr.b); n++; }
    fx.setDrawRange(0, n); fp.needsUpdate = true; fcol.needsUpdate = true;
    const bx = pointsBul.geometry, bp = bx.attributes.position, bc = bx.attributes.color;
    n = 0;
    for (const b of S.bullets) { if (n >= 120) break; bp.setXYZ(n, b.x / PX, 0.75, b.y / PX); colr.setHex(b.owner === 'player' ? 0xfff6a0 : b.heavy ? 0xff6a6a : 0xe07bff); bc.setXYZ(n, colr.r, colr.g, colr.b); n++; }
    bx.setDrawRange(0, n); bp.needsUpdate = true; bc.needsUpdate = true;
  }

  // ------------------------------------------------------------------ frame
  function render(S, dt) {
    if (!S) { renderer.setRenderTarget(null); renderer.setClearColor(0x000000); renderer.clear(); return; }
    sync(S);
    const P = S.player;
    // follow the player; the view centres on the body (about 1 unit above the feet)
    const tx = P.x / PX, tz = P.y / PX - 0.9;
    if (camT.S !== S) { camT.x = tx; camT.z = tz; camT.S = S; }
    camT.x += (tx - camT.x) * Math.min(1, dt * 7); camT.z += (tz - camT.z) * Math.min(1, dt * 7);
    let cx = camT.x, cz = camT.z;
    // keep the view inside the map (the north wall's front rises ~1.25 units above its base)
    const hw = rtW / PX / 2, hh = rtH / PX / 2;
    cx = S.w <= hw * 2 ? S.w / 2 : Math.min(Math.max(cx, hw), S.w - hw);
    cz = S.h + 1.25 <= hh * 2 ? (S.h - 1.25) / 2 : Math.min(Math.max(cz, hh - 1.25), S.h - hh);
    if (S.shake > 0) { cx += (Math.random() - 0.5) * S.shake / PX; cz += (Math.random() - 0.5) * S.shake / PX; }
    cx = snap(cx); cz = snap(cz); // pixel-locked camera: no shimmer
    camera.position.set(cx, 50, cz); camera.lookAt(cx, 0, cz); camera.updateMatrixWorld();
    camera.projectionMatrix.copy(baseP).multiply(shearM);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    const pulse = (Math.sin(S.t * 4) + 1) / 2, tint = postMat.uniforms.uTint.value;
    if (S.flash > 0) tint.set(1, 0, 0, S.flash * 0.6);
    else if (P.dead) tint.set(0.5, 0, 0, 0.35);
    else if (S.escape != null) tint.set(1, 0.2, 0.6, 0.06 + pulse * 0.08);
    else if (S.phase === 'alert') tint.set(1, 0, 0, 0.05 + pulse * 0.06);
    else tint.set(0, 0, 0, 0);
    renderer.setRenderTarget(rtLow);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }

  function clear() {
    for (const [, a] of actors) { dyn.remove(a.mesh, a.sh); if (a.xr) dyn.remove(a.xr); }
    actors.clear();
    for (const [, c] of cones) { dyn.remove(c); c.geometry.dispose(); }
    cones.clear();
    for (const [, s] of floaterSprites) dyn.remove(s);
    floaterSprites.clear();
    for (const o of [...dyn.children]) if (o.isSprite) dyn.remove(o);
    if (level) { scene.remove(level); level = null; }
    builtS = null;
  }

  return { init, resize, render, clear, get pixel() { return pixel; }, get scene() { return scene; } };
})();
