'use strict';
/* Isometric 3D renderer. Reads Game.state every frame and owns no game state.
   Look: turn-tactics "classic" anime style (cel/toon shading, ink outlines, pastel palette,
   hemi + key + rim + fill lights, saturated grade, vignette), rendered at a low internal
   resolution and upscaled with nearest filtering + 15-bit Bayer dither for a retro/pixel feel
   (the dr-mow retro.js idea, done as a post pass). 1 tile = 1 world unit; sim px / 16 = units. */
const Render3D = (() => {
  const U = 1 / 16;
  const AZ = Math.PI / 4, EL = Math.atan(1 / Math.sqrt(2)); // true isometric
  const WALL_H = 1.15;
  const INK = 0x0a0c16;
  let renderer, scene, camera, rtLow, postScene, postCam, postMat, canvasEl;
  let W = 1, H = 1, pixel = 3;
  let levelGroup = null, builtS = null, builtVersion = -1;
  const models = new Map();          // sim object -> THREE.Group
  const cones = new Map();           // enemy -> cone mesh
  let dyn, pointsFx, pointsBul, stars = [];
  let camT = new THREE.Vector3(), shakeT = 0;
  let viewHalf = 5.6;
  let exitMeshes = [], coreMeshes = [], fieldMeshes = [];

  // ------------------------------------------------------------------ materials
  const toonGrad = (() => {
    const d = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
    const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
  })();
  const matCache = {};
  function toon(color, o = {}) {
    const key = color + '|' + (o.emissive || 0) + '|' + (o.ei || 0) + '|' + (o.map ? o.map.uuid : '') + '|' + (o.opacity || 1);
    if (matCache[key]) return matCache[key];
    const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGrad, map: o.map || null });
    if (o.emissive) { m.emissive.setHex(o.emissive); m.emissiveIntensity = o.ei || 0.6; }
    if (o.opacity) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
    return (matCache[key] = m);
  }
  const glowCache = {};
  const glow = (c, op) => glowCache[c + '|' + (op || 1)] || (glowCache[c + '|' + (op || 1)] = new THREE.MeshBasicMaterial({ color: c, transparent: !!op, opacity: op || 1, depthWrite: !op }));
  const outlineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  const xrayMats = {
    player: new THREE.MeshBasicMaterial({ color: 0x4fe3ff, depthFunc: THREE.GreaterDepth, depthWrite: false }),
    enemy: new THREE.MeshBasicMaterial({ color: 0xff4b5c, depthFunc: THREE.GreaterDepth, depthWrite: false }),
    pow: new THREE.MeshBasicMaterial({ color: 0x35e08a, depthFunc: THREE.GreaterDepth, depthWrite: false }),
  };
  const texCache = {};
  function tileTex(theme, ch, v = 0) {
    const k = theme + ch + v;
    if (texCache[k]) return texCache[k];
    const t = new THREE.CanvasTexture(Art.tile(theme, ch, v, false));
    t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return (texCache[k] = t);
  }

  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
    cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
    cone4: new THREE.ConeGeometry(1, 1, 4),
    cone: new THREE.ConeGeometry(1, 1, 7),
    sph: new THREE.SphereGeometry(1, 10, 8),
    ico: new THREE.IcosahedronGeometry(1, 0),
    oct: new THREE.OctahedronGeometry(1),
    tor: new THREE.TorusGeometry(1, 0.12, 5, 16),
    disc: new THREE.CircleGeometry(1, 14),
    prism: (() => { // tent ridge: triangle cross-section, 1 unit long along z
      const sh = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -0.5); return g;
    })(),
  };

  // one mesh (+ ink outline) as a child of parent
  function part(parent, geo, mat, p, s, o = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(p[0], p[1], p[2]);
    m.scale.set(s[0], s[1], s[2]);
    if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2]);
    parent.add(m);
    if (o.ol !== false && !o.glow) {
      const ol = new THREE.Mesh(geo, outlineMat);
      const k = o.ow || 1.12;
      ol.scale.setScalar(k);
      m.add(ol);
    }
    return m;
  }

  // ------------------------------------------------------------------ setup
  function init(canvas) {
    canvasEl = canvas;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.autoClear = true;
    rtLow = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
    postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: rtLow.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uTint: { value: new THREE.Vector4(0, 0, 0, 0) }, uAspect: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform vec4 uTint; uniform float uAspect; varying vec2 vUv;
        float bayer(vec2 p){ int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)); int i = x + y*4;
          float m[16]; m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
          for (int k = 0; k < 16; k++) if (k == i) return m[k]/16.0; return 0.0; }
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, 1.16);                       // anime saturation
          c = c/(1.0 + c*0.12)*1.08;                        // gentle filmic curve
          c = mix(c, uTint.rgb, uTint.a);                   // alert / damage tint
          vec2 d = (vUv - 0.5)*vec2(uAspect, 1.0); c *= mix(0.62, 1.0, smoothstep(0.95, 0.3, length(d)));
          vec2 px = floor(vUv*uRes);
          c += (bayer(px) - 0.5)/31.0;                      // 15-bit colour with ordered dither
          c = floor(clamp(c, 0.0, 1.0)*31.0 + 0.5)/31.0;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    postScene = new THREE.Scene();
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

    // lights (turn-tactics classic rig)
    scene.userData.hemi = new THREE.HemisphereLight(0xc4d6ff, 0x2a1840, 0.62); scene.add(scene.userData.hemi);
    scene.userData.key = new THREE.DirectionalLight(0xfff0dc, 1.15); scene.userData.key.position.set(-6, 14, 9); scene.add(scene.userData.key);
    scene.userData.rim = new THREE.DirectionalLight(0x6fa8ff, 0.45); scene.userData.rim.position.set(8, 6, -10); scene.add(scene.userData.rim);
    scene.userData.fill = new THREE.DirectionalLight(0xb06cff, 0.35); scene.userData.fill.position.set(4, -6, 6); scene.add(scene.userData.fill);

    dyn = new THREE.Group(); scene.add(dyn);
    // particle + bullet point clouds
    const mkPoints = (n, size) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setDrawRange(0, 0);
      const p = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true }));
      p.frustumCulled = false; p.renderOrder = 5;
      scene.add(p); return p;
    };
    pointsFx = mkPoints(600, 1.5);
    pointsBul = mkPoints(120, 3);
    Game.setViewYaw(AZ);
  }

  function resize(cssW, cssH, dpr) {
    W = Math.max(1, Math.round(cssW * dpr)); H = Math.max(1, Math.round(cssH * dpr));
    renderer.setSize(W, H, false);
    canvasEl.style.width = cssW + 'px'; canvasEl.style.height = cssH + 'px';
    // ~230 internal lines on the short side: chunky but readable
    pixel = Math.max(1, Math.round(Math.min(W, H) / 230));
    rtLow.setSize(Math.ceil(W / pixel), Math.ceil(H / pixel));
    postMat.uniforms.uRes.value.set(rtLow.width, rtLow.height);
    postMat.uniforms.uAspect.value = W / H;
    // show about 11-12 tiles across the short side
    const aspect = W / H;
    viewHalf = (aspect >= 1 ? 3.6 : 3.6 / aspect * 0.8) / (Number(new URLSearchParams(location.search).get('zoom')) || 1);
    camera.left = -viewHalf * aspect; camera.right = viewHalf * aspect; camera.top = viewHalf; camera.bottom = -viewHalf;
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ level build
  const LIGHTS = {
    depot: { bg: 0x0a1020, sky: 0xb8c8ff, gnd: 0x241838, key: 0xffe6c8, ki: 1.0, rim: 0x6fa8ff },
    camp: { bg: 0x1a1020, sky: 0xffd8b0, gnd: 0x3a2040, key: 0xffc890, ki: 1.15, rim: 0xb06cff },
    lab: { bg: 0x0c1220, sky: 0xe4f0ff, gnd: 0x303a58, key: 0xffffff, ki: 1.2, rim: 0x6fd8ff },
    hangar: { bg: 0x080a12, sky: 0xc4d6ff, gnd: 0x2a1c30, key: 0xffe0c0, ki: 1.1, rim: 0xff8a5a },
    ship: { bg: 0x0c0618, sky: 0xd8b8ff, gnd: 0x1a3a30, key: 0xf0e0ff, ki: 1.0, rim: 0x6dffb0 },
    pow: { bg: 0x100a08, sky: 0xffd0a8, gnd: 0x2a1a20, key: 0xffb070, ki: 1.1, rim: 0x6fa8ff },
  };

  function buildLevel(S) {
    if (levelGroup) { scene.remove(levelGroup); levelGroup.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.userData.ownGeo) o.geometry.dispose(); }); }
    levelGroup = new THREE.Group();
    scene.add(levelGroup);
    exitMeshes = []; coreMeshes = []; fieldMeshes = [];
    const th = S.theme, L = LIGHTS[th] || LIGHTS.depot;
    scene.background = new THREE.Color(L.bg);
    scene.userData.hemi.color.setHex(L.sky); scene.userData.hemi.groundColor.setHex(L.gnd);
    scene.userData.key.color.setHex(L.key); scene.userData.key.intensity = L.ki * 0.75;
    scene.userData.rim.color.setHex(L.rim);

    // floor: one plane textured with the pixel tiles
    const fc = document.createElement('canvas');
    fc.width = S.w * 16; fc.height = S.h * 16;
    const fg = fc.getContext('2d');
    const floorOf = (ch) => (',.:;'.includes(ch) ? ch : S.def.floor);
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      const ch = S.grid[y * S.w + x];
      fg.drawImage(Art.tile(th, ch === ';' ? ';' : floorOf(ch), (x * 7 + y * 13) % 4, false), x * 16, y * 16);
    }
    const ft = new THREE.CanvasTexture(fc);
    ft.magFilter = ft.minFilter = THREE.NearestFilter; ft.generateMipmaps = false;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.h), new THREE.MeshToonMaterial({ color: 0xffffff, map: ft, gradientMap: toonGrad }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(S.w / 2, 0, S.h / 2);
    floor.userData.ownGeo = true;
    levelGroup.add(floor);

    // instanced parts: key -> {geo, mat, outline, list:[Matrix4]}
    const batches = new Map();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    function add(key, geo, mat, x, y, z, sx, sy, sz, ry = 0, outline = true) {
      let b = batches.get(key);
      if (!b) { b = { geo, mat, outline, list: [] }; batches.set(key, b); }
      e.set(0, ry, 0); q.setFromEuler(e); v.set(x, y, z); sc.set(sx, sy, sz);
      b.list.push(new THREE.Matrix4().compose(v.clone(), q.clone(), sc.clone()));
    }
    const at = (x, y) => (x < 0 || y < 0 || x >= S.w || y >= S.h) ? '#' : S.grid[y * S.w + x];
    const solid = (c) => !!Game.tileDef(c).s;
    const T3 = Art.THEMES[th];
    const col = (hex) => parseInt(hex.slice(1), 16);

    for (let ty = 0; ty < S.h; ty++) for (let tx = 0; tx < S.w; tx++) {
      const ch = at(tx, ty), cx = tx + 0.5, cz = ty + 0.5;
      const along = solid(at(tx - 1, ty)) && solid(at(tx + 1, ty)) ? 0 : Math.PI / 2; // door / field orientation
      switch (ch) {
        case '#': {
          // skip walls completely surrounded by walls (never visible) to save instances
          if (solid(at(tx - 1, ty)) && at(tx - 1, ty) === '#' && at(tx + 1, ty) === '#' && at(tx, ty - 1) === '#' && at(tx, ty + 1) === '#' &&
              at(tx - 1, ty - 1) === '#' && at(tx + 1, ty + 1) === '#' && at(tx + 1, ty - 1) === '#' && at(tx - 1, ty + 1) === '#') {
            add('wallcap', G.box, toon(col(Art.shade(T3.wall, -0.35))), cx, WALL_H / 2, cz, 1, WALL_H, 1, 0, false);
          } else add('wall' + ((tx + ty) % 2), G.box, toon(0xffffff, { map: tileTex(th, '#', (tx + ty) % 2) }), cx, WALL_H / 2, cz, 1, WALL_H, 1);
          break;
        }
        case 'X': add('crate', G.box, toon(0xffffff, { map: tileTex(th, 'X', 0) }), cx, 0.4, cz, 0.92, 0.8, 0.92); break;
        case 'x':
          add('barrel', G.cyl, toon(th === 'ship' ? 0x8a5ab0 : th === 'camp' ? 0x7a8a4a : 0x4f8fb8), cx, 0.4, cz, 0.34, 0.8, 0.34);
          add('barrelband', G.cyl, toon(col(T3.line)), cx, 0.55, cz, 0.36, 0.08, 0.36, 0, false);
          break;
        case 'T':
          if (T3.pillar === 'tree') {
            add('trunk', G.cyl6, toon(0x6a4a2a), cx, 0.35, cz, 0.12, 0.7, 0.12);
            add('leaf', G.ico, toon(0x4fa84a), cx, 1.05, cz, 0.5, 0.55, 0.5);
            add('leaf2', G.ico, toon(0x6fcf5a), cx + 0.08, 1.35, cz - 0.05, 0.32, 0.35, 0.32);
          } else if (T3.pillar === 'server') {
            add('server', G.box, toon(0xffffff, { map: tileTex(th, 'T', (tx + ty) % 3) }), cx, 0.7, cz, 0.8, 1.4, 0.8);
          } else if (T3.pillar === 'shuttle') {
            add('hull', G.box, toon(0xe8eef6, { map: tileTex(th, 'T', (tx * 3 + ty) % 4) }), cx, 0.8, cz, 1.0, 1.6, 1.0, 0, false);
          } else if (T3.pillar === 'organic') {
            add('opil', G.cyl6, toon(0x6a3a8a), cx, 0.7, cz, 0.36, 1.4, 0.36);
            add('ocore', G.sph, glow(0x6dffb0), cx, 0.8, cz + 0.3, 0.12, 0.2, 0.08, 0, false);
          } else {
            add('mach', G.box, toon(0x8a93a0), cx, 0.65, cz, 0.85, 1.3, 0.85);
            add('machl', G.box, glow(0x40ff70), cx, 0.95, cz + 0.43, 0.3, 0.08, 0.02, 0, false);
          }
          break;
        case 'A':
          if (th === 'camp') {
            const ridgeX = at(tx - 1, ty) === 'A' || at(tx + 1, ty) === 'A';
            add('tent', G.box, toon(0x8a2434), cx, 0.18, cz, 1, 0.36, 1, 0, false);
            add('tentroof', G.prism, toon(0xd8465a), cx, 0.36, cz, 1.02, 0.72, 1, ridgeX ? Math.PI / 2 : 0);
          }
          else add('gen', G.box, toon(0x6a7282), cx, 0.4, cz, 0.9, 0.8, 0.9);
          break;
        case 'L': case 'G': case 'k':
          add('locker', G.box, toon(th === 'ship' ? 0x7a6aa8 : 0x6f8fb0), cx, 0.62, cz, 0.78, 1.24, 0.6);
          add('lockerv', G.box, toon(0x2a3448), cx, 0.95, cz + 0.305, 0.5, 0.04, 0.01, 0, false);
          if (ch === 'G') add('gearled', G.box, glow(0xffd23a), cx, 1.1, cz + 0.31, 0.12, 0.08, 0.02, 0, false);
          break;
        case 'B':
          add('bin', G.box, toon(th === 'ship' ? 0x4a8a6a : 0x4f8a48), cx, 0.35, cz, 0.9, 0.7, 0.78);
          add('binlid', G.box, toon(0x6fb060), cx, 0.72, cz, 0.94, 0.06, 0.82, 0, false);
          break;
        case 'O': add('cbox', G.box, toon(0xd8aa68), cx, 0.32, cz, 0.8, 0.64, 0.8); add('tape', G.box, toon(0xf0d8a0), cx, 0.645, cz, 0.12, 0.01, 0.82, 0, false); break;
        case 'C': case 'I': case 'i': {
          add('console', G.box, toon(0x3a4252), cx, 0.3, cz, 0.9, 0.6, 0.7);
          const scr = ch === 'C' ? col(T3.accent) : ch === 'I' ? 0x35e08a : 0x1a3020;
          add('screen' + ch, G.box, glow(scr), cx, 0.62, cz + 0.05, 0.7, 0.04, 0.45, 0, false);
          break;
        }
        case '=':
          if (th === 'lab') add('glass', G.box, toon(0xbfefff, { opacity: 0.35 }), cx, 0.55, cz, 1, 1.1, 1, 0, false);
          else { add('fieldpost', G.box, toon(0x555a66), cx, 0.45, cz, along ? 0.14 : 1, 0.9, along ? 1 : 0.14, 0, false); }
          break;
        case 'D': add('door', G.box, toon(0xffffff, { map: tileTex(th, 'D', 0) }), cx, 0.55, cz, 1, 1.1, 0.3, along); break;
        case 'd': add('doorframe', G.box, toon(0x4a505c), cx, 1.08, cz, 1, 0.12, 0.34, along); break;
        case 'J':
          for (let i = -2; i <= 2; i++) add('bar', G.cyl6, toon(0xaab0bc), cx + (along === 0 ? i * 0.2 : 0), 0.55, cz + (along === 0 ? 0 : i * 0.2), 0.035, 1.1, 0.035, 0, false);
          add('barh', G.box, toon(0x7a808c), cx, 1.08, cz, along === 0 ? 1 : 0.1, 0.08, along === 0 ? 0.1 : 1, 0, false);
          break;
        case 'j': add('barh', G.box, toon(0x7a808c), cx, 1.08, cz, along === 0 ? 1 : 0.1, 0.08, along === 0 ? 0.1 : 1, 0, false); break;
        case 'Z': case 'z': add('corebase', G.cyl6, toon(0x3a2a58), cx, 0.2, cz, 0.42, 0.4, 0.42); break;
        case ';':
          for (let i = 0; i < 3; i++) {
            const ox = ((tx * 13 + ty * 7 + i * 5) % 10) / 10 - 0.45, oz = ((tx * 5 + ty * 11 + i * 3) % 10) / 10 - 0.45;
            add('grass' + (i % 2), G.cone4, toon(i % 2 ? 0x5fbf4a : 0x3f9a3a), cx + ox * 0.8, 0.28, cz + oz * 0.8, 0.16, 0.56, 0.16, i, false);
          }
          break;
      }
      // dynamic, animated tiles
      if (ch === 'E') {
        const pad = new THREE.Mesh(G.cyl, glow(0x35e08a, 0.8)); pad.scale.set(0.46, 0.04, 0.46); pad.position.set(cx, 0.03, cz);
        const ring = new THREE.Mesh(G.tor, glow(0x9dffb8)); ring.scale.setScalar(0.36); ring.rotation.x = Math.PI / 2; ring.position.set(cx, 0.5, cz);
        levelGroup.add(pad, ring); exitMeshes.push({ pad, ring });
      }
      if (ch === 'Z') {
        const c = new THREE.Mesh(G.oct, toon(0xd35bff, { emissive: 0xb45cff, ei: 0.9 })); c.scale.set(0.24, 0.42, 0.24); c.position.set(cx, 0.95, cz);
        const ol = new THREE.Mesh(G.oct, outlineMat); ol.scale.setScalar(1.12); c.add(ol);
        levelGroup.add(c); coreMeshes.push(c);
      }
      if (ch === '=' && th !== 'lab') {
        const f = new THREE.Mesh(G.box, glow(col(T3.field), 0.45)); f.scale.set(along === 0 ? 1 : 0.06, 0.7, along === 0 ? 0.06 : 1); f.position.set(cx, 0.5, cz);
        levelGroup.add(f); fieldMeshes.push(f);
      }
    }
    for (const [, b] of batches) {
      const im = new THREE.InstancedMesh(b.geo, b.mat, b.list.length);
      im.frustumCulled = false; // r128 instanced meshes have no per-instance bounds
      b.list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.renderOrder = 0;
      levelGroup.add(im);
      if (b.outline) {
        const ol = new THREE.InstancedMesh(b.geo, outlineMat, b.list.length);
        ol.frustumCulled = false;
        const tmp = new THREE.Matrix4(), s = new THREE.Matrix4().makeScale(1.05, 1.03, 1.05);
        b.list.forEach((mm, i) => { tmp.copy(mm).multiply(s); ol.setMatrixAt(i, tmp); });
        levelGroup.add(ol);
      }
    }
    builtS = S; builtVersion = S.tileVersion;
  }

  // ------------------------------------------------------------------ characters
  const PAL3 = {
    snake: { suit: 0x34507a, suitD: 0x243858, skin: 0xf5c9a4, hair: 0x3a2a24, accent: 0xff4b5c, arm: 0xd0dae6, glowc: 0x4fe3ff, eye: 0x1a1a2a },
    grunt: { suit: 0xc8384a, suitD: 0x7a1e2c, skin: 0x6fd05a, hair: 0x3f9a3a, accent: 0x1a1a22, arm: 0x6fd05a, glowc: 0xffd23a, eye: 0xffd23a },
    heavy: { suit: 0x6a58a0, suitD: 0x40346a, skin: 0x5fb04a, hair: 0xa8a0c8, accent: 0x2a2a33, arm: 0x8a7cc0, glowc: 0xff4b5c, eye: 0xff4b5c },
    human: { suit: 0xff9a3c, suitD: 0xc86a1e, skin: 0xf0c4a0, hair: 0x5a3a2a, accent: 0xff9a3c, arm: 0xff9a3c, glowc: 0xffffff, eye: 0x1a1a2a },
    hybrid: { suit: 0xff9a3c, suitD: 0xc86a1e, skin: 0xe8d0c0, hair: 0xd8e0ea, accent: 0xff9a3c, arm: 0xc0ccd8, glowc: 0x4fe3ff, eye: 0x4fe3ff },
  };

  function addXray(group, kind) {
    const add = [];
    group.traverse((o) => { if (o.isMesh && o.material !== outlineMat && !o.userData.noXray) add.push(o); });
    for (const o of add) {
      const x = new THREE.Mesh(o.geometry, xrayMats[kind]);
      x.renderOrder = 1; x.userData.noXray = true;
      o.add(x);
    }
    group.traverse((o) => { if (o.isMesh && !o.userData.noXray) o.renderOrder = 2; });
  }

  function shadowDisc(group, r = 0.3) {
    const s = new THREE.Mesh(G.disc, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    s.rotation.x = -Math.PI / 2; s.position.y = 0.012; s.scale.setScalar(r); s.userData.noXray = true;
    group.add(s); return s;
  }

  // anime-proportioned humanoid (big head), facing +z
  function makeHuman(kind) {
    const P = PAL3[kind] || PAL3.grunt;
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    const big = kind === 'heavy' ? 1.22 : 1;
    body.scale.setScalar(big);
    shadowDisc(g, 0.3 * big);
    const mk = (c, o) => toon(c, o);
    const legs = [], arms = [];
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group(); leg.position.set(sx * 0.09, 0.36, 0); body.add(leg);
      part(leg, G.box, mk(P.suitD), [0, -0.17, 0], [0.13, 0.34, 0.15]);
      part(leg, G.box, mk(0x1a1a22), [0, -0.33, 0.03], [0.14, 0.06, 0.2], { ol: false });
      legs.push(leg);
      const arm = new THREE.Group(); arm.position.set(sx * 0.23, 0.66, 0); body.add(arm);
      const cyber = kind === 'snake' && sx > 0;
      part(arm, G.box, mk(cyber ? P.arm : P.suit), [0, -0.15, 0], [0.1, 0.3, 0.11]);
      part(arm, G.box, cyber ? glow(P.glowc) : mk(P.skin), [0, -0.32, 0], [0.09, 0.07, 0.1], { ol: false });
      arms.push(arm);
    }
    part(body, G.box, mk(P.suit), [0, 0.52, 0], [0.36, 0.34, 0.22]);
    part(body, G.box, mk(P.suitD), [0, 0.38, 0], [0.37, 0.05, 0.23], { ol: false });
    const head = new THREE.Group(); head.position.set(0, 0.88, 0); body.add(head);
    if (kind === 'snake') {
      part(head, G.box, mk(P.skin), [0, 0, 0], [0.32, 0.3, 0.3]);
      part(head, G.box, mk(P.hair), [0, 0.12, -0.03], [0.34, 0.1, 0.32], { ol: false });
      part(head, G.box, mk(P.hair), [0, 0.02, -0.14], [0.34, 0.24, 0.06], { ol: false });
      part(head, G.box, mk(P.accent), [0, 0.07, 0], [0.35, 0.06, 0.33], { ol: false });   // bandana
      const t1 = part(head, G.box, mk(P.accent), [0.05, 0.04, -0.24], [0.05, 0.04, 0.18], { ol: false, r: [0.3, 0.2, 0] });
      const t2 = part(head, G.box, mk(P.accent), [-0.05, 0.02, -0.23], [0.05, 0.04, 0.16], { ol: false, r: [0.5, -0.2, 0] });
      g.userData.tails = [t1, t2];
      part(head, G.box, glow(0xff2a2a), [0.07, -0.01, 0.152], [0.06, 0.04, 0.01], { glow: true });   // cyber-eye
      part(head, G.box, mk(P.eye), [-0.07, -0.01, 0.152], [0.05, 0.05, 0.01], { ol: false });
      part(head, G.box, mk(0xb9c6d2), [0.1, 0.0, 0.14], [0.1, 0.1, 0.03], { ol: false });           // plate
    } else if (kind === 'grunt' || kind === 'heavy') {
      part(head, G.box, mk(P.skin), [0, 0, 0], [0.3, 0.28, 0.3]);
      part(head, G.box, mk(P.skin), [0, -0.05, 0.18], [0.2, 0.12, 0.14]);                         // snout
      for (const [x, h] of [[0, 0.16], [-0.09, 0.11], [0.09, 0.11]]) part(head, G.cone4, mk(P.hair), [x, 0.17 + h / 2, -0.02], [0.05, h, 0.05], { ol: false });
      part(head, G.box, mk(0x111118), [0, 0.03, 0.152], [0.3, 0.06, 0.01], { ol: false });
      part(head, G.box, glow(P.eye), [-0.08, 0.03, 0.158], [0.05, 0.035, 0.01], { glow: true });
      part(head, G.box, glow(P.eye), [0.08, 0.03, 0.158], [0.05, 0.035, 0.01], { glow: true });
      if (kind === 'heavy') {
        part(head, G.sph, mk(0x9aa0b4), [0, 0.1, -0.02], [0.2, 0.14, 0.2]);
        for (const sx of [-1, 1]) part(body, G.box, mk(P.arm), [sx * 0.3, 0.72, 0], [0.18, 0.12, 0.26]);
      } else for (const sx of [-1, 1]) part(body, G.box, mk(0x1a1a22), [sx * 0.23, 0.7, 0], [0.13, 0.07, 0.2], { ol: false });
      const gun = new THREE.Group(); gun.position.set(0.23, 0.4, 0.12); body.add(gun);
      part(gun, G.box, mk(kind === 'heavy' ? 0x2a2a33 : 0x22222a), [0, 0, 0.1], kind === 'heavy' ? [0.14, 0.14, 0.4] : [0.07, 0.08, 0.3]);
      part(gun, G.box, glow(kind === 'heavy' ? 0xff4b5c : 0xb45cff), [0, 0.02, 0.26], [0.04, 0.03, 0.04], { glow: true });
      g.userData.gun = gun;
    } else { // prisoners: human / hybrid
      part(head, G.box, mk(P.skin), [0, 0, 0], [0.3, 0.28, 0.28]);
      part(head, G.box, mk(P.hair), [0, 0.13, -0.02], [0.32, 0.08, 0.3], { ol: false });
      part(head, G.box, mk(P.eye), [-0.07, 0, 0.142], [0.05, 0.05, 0.01], { ol: false });
      part(head, G.box, kind === 'hybrid' ? glow(P.eye) : mk(P.eye), [0.07, 0, 0.142], [0.05, 0.05, 0.01], { ol: false });
      if (kind === 'hybrid') { part(head, G.box, glow(0x4fe3ff), [-0.155, 0.02, 0], [0.01, 0.14, 0.14], { glow: true }); part(head, G.box, mk(0xc0ccd8), [0.1, 0.1, 0.1], [0.12, 0.06, 0.1], { ol: false }); }
    }
    g.userData.legs = legs; g.userData.arms = arms; g.userData.body = body; g.userData.head = head;
    return g;
  }

  function makeRobotPow() { // an AI in a salvaged drone frame on little legs
    const g = new THREE.Group(); shadowDisc(g, 0.24);
    const body = new THREE.Group(); g.add(body);
    part(body, G.box, toon(0xd8dde6), [0, 0.46, 0], [0.34, 0.3, 0.28]);
    part(body, G.box, toon(0xff9a3c), [0, 0.46, 0.15], [0.26, 0.2, 0.02], { ol: false });
    part(body, G.sph, glow(0x35e08a), [0, 0.5, 0.17], [0.05, 0.05, 0.03], { glow: true });
    part(body, G.cyl6, toon(0x8a93a0), [0, 0.7, 0], [0.02, 0.16, 0.02], { ol: false });
    part(body, G.sph, glow(0xff4b5c), [0, 0.8, 0], [0.035, 0.035, 0.035], { glow: true });
    const legs = [];
    for (const sx of [-1, 1]) { const leg = new THREE.Group(); leg.position.set(sx * 0.1, 0.31, 0); body.add(leg); part(leg, G.box, toon(0x6a7282), [0, -0.15, 0], [0.07, 0.3, 0.07]); legs.push(leg); }
    g.userData.legs = legs; g.userData.arms = []; g.userData.body = body;
    return g;
  }

  function makeDrone() {
    const g = new THREE.Group(); const sh = shadowDisc(g, 0.26);
    const body = new THREE.Group(); body.position.y = 0.95; g.add(body);
    part(body, G.sph, toon(0xb0a6d8), [0, 0, 0], [0.24, 0.2, 0.24]);
    part(body, G.tor, toon(0x6a5f96), [0, 0, 0], [0.32, 0.32, 0.32], { r: [Math.PI / 2, 0, 0], ol: false });
    const eye = part(body, G.sph, glow(0xffe066), [0, -0.02, 0.2], [0.08, 0.08, 0.05], { glow: true });
    part(body, G.cyl6, toon(0x888888), [0, 0.26, 0], [0.015, 0.14, 0.015], { ol: false });
    g.userData.body = body; g.userData.eye = eye; g.userData.shadow = sh;
    return g;
  }

  function makeCamera() {
    const g = new THREE.Group();
    const head = new THREE.Group(); head.position.y = 1.0; g.add(head);
    part(head, G.box, toon(0xe0e6ec), [0, 0, 0.06], [0.18, 0.14, 0.3]);
    part(head, G.cyl, toon(0x1a1a22), [0, 0, 0.23], [0.06, 0.06, 0.06], { r: [Math.PI / 2, 0, 0], ol: false });
    const led = part(head, G.box, glow(0x40ff70), [0.06, 0.08, 0.1], [0.04, 0.03, 0.04], { glow: true });
    g.userData.head = head; g.userData.led = led;
    return g;
  }

  function makePickup(type) {
    const g = new THREE.Group(); shadowDisc(g, 0.18);
    const b = new THREE.Group(); b.position.y = 0.3; g.add(b);
    if (type === 'r') { part(b, G.box, toon(0xf4f6fa), [0, 0, 0], [0.3, 0.2, 0.22]); part(b, G.box, glow(0xff4b5c), [0, 0.101, 0], [0.18, 0.01, 0.05], { glow: true }); part(b, G.box, glow(0xff4b5c), [0, 0.101, 0], [0.05, 0.01, 0.16], { glow: true }); }
    else if (type === 'a') { part(b, G.box, toon(0x6a7f3f), [0, 0, 0], [0.3, 0.18, 0.2]); for (let i = -1; i <= 1; i++) part(b, G.cyl6, toon(0xffc94a), [i * 0.08, 0.14, 0], [0.025, 0.12, 0.025], { ol: false }); }
    else { part(b, G.box, toon(0x3d8bff, { emissive: 0x3d8bff, ei: 0.5 }), [0, 0, 0], [0.3, 0.02, 0.2]); part(b, G.box, glow(0xffc94a), [0, 0.012, -0.04], [0.3, 0.01, 0.03], { glow: true }); }
    g.userData.spin = b;
    return g;
  }

  // ------------------------------------------------------------------ '90s Marathon-style characters
  // Flat-shaded, metallic and grimy (pre-rendered-sprite era look) instead of chibi toon: lanky
  // digitigrade aliens with elongated crested skulls and multiple glowing eyes, an armoured brute
  // with an arm cannon, a floating sentinel eye, and a cyborg operative in segmented armour.
  const grime = (() => {   // panel seams, rivets, soot and rust streaks at 90s texel density
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 260; i++) { const v = 150 + Math.random() * 100 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 32 | 0, Math.random() * 32 | 0, 1, 1); }
    g.fillStyle = 'rgba(40,40,40,.6)'; for (const y of [0, 11, 22]) g.fillRect(0, y, 32, 1); for (const x of [0, 9, 20]) g.fillRect(x, 0, 1, 32);
    g.fillStyle = 'rgba(255,255,255,.3)'; for (const y of [1, 12, 23]) g.fillRect(0, y, 32, 1);
    g.fillStyle = 'rgba(30,30,30,.7)'; for (const y of [3, 14, 25]) for (let x = 3; x < 32; x += 6) g.fillRect(x, y, 1, 1);
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(70,45,30,.35)'; g.fillRect(Math.random() * 32 | 0, Math.random() * 24 | 0, 1, 4 + Math.random() * 8 | 0); }
    const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t;
  })();
  const scales = (() => {  // mottled reptile hide
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, 32, 32);
    for (let y = 0; y < 32; y += 3) for (let x = (y % 6 ? 0 : 2); x < 32; x += 4) { const v = 150 + Math.random() * 90 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 3, 2); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + 2, 3, 1); }
    for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(60,20,70,.35)'; g.fillRect(Math.random() * 28 | 0, Math.random() * 28 | 0, 4, 3); }
    const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t;
  })();
  const stdCache = {};
  function metal(c, o = {}) {
    const k = 'm' + c + (o.rough || '') + (o.ei || '');
    return stdCache[k] || (stdCache[k] = new THREE.MeshStandardMaterial({ color: c, map: grime, metalness: o.metal != null ? o.metal : 0.45, roughness: o.rough || 0.45, flatShading: true, emissive: c, emissiveIntensity: o.ei || 0.3 }));
  }
  function hide(c) {
    const k = 'h' + c;
    return stdCache[k] || (stdCache[k] = new THREE.MeshStandardMaterial({ color: c, map: scales, metalness: 0.05, roughness: 0.7, flatShading: true, emissive: c, emissiveIntensity: 0.32 }));
  }
  function cloth(c) {
    const k = 'c' + c;
    return stdCache[k] || (stdCache[k] = new THREE.MeshStandardMaterial({ color: c, metalness: 0, roughness: 0.85, flatShading: true, emissive: c, emissiveIntensity: 0.3 }));
  }
  const tapers = {};
  function taper(bot, top, h) { // square frustum
    const k = bot + ':' + top + ':' + h;
    if (!tapers[k]) { const g = new THREE.CylinderGeometry(top * 0.7071, bot * 0.7071, h, 4, 1); g.rotateY(Math.PI / 4); tapers[k] = g; }
    return tapers[k];
  }
  // mesh with an optional thin ink edge (only big silhouette parts get one)
  function seg(parent, geo, mat, p, sc = [1, 1, 1], o = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(p[0], p[1], p[2]); m.scale.set(sc[0], sc[1], sc[2]);
    if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2]);
    parent.add(m);
    if (o.ol) { const ol = new THREE.Mesh(geo, outlineMat); ol.scale.setScalar(1.07); m.add(ol); }
    return m;
  }
  const grp = (parent, p, r) => { const g = new THREE.Group(); g.position.set(p[0], p[1], p[2]); if (r) g.rotation.set(r[0], r[1], r[2]); parent.add(g); return g; };

  // limb: hip -> thigh -> knee -> shin (-> foot); returns joints for animation
  function limb(parent, at, dims, mats, digi) {
    const hip = grp(parent, at);
    const [tw, tl, sw2, sl] = dims;
    seg(hip, taper(tw * 0.8, tw, tl), mats.thigh, [0, -tl / 2, 0], [1, 1, 1.1], { ol: true });
    const knee = grp(hip, [0, -tl, 0]);
    seg(knee, G.sph, mats.joint, [0, 0, 0.01], [tw * 0.55, tw * 0.55, tw * 0.6]);
    seg(knee, taper(sw2 * 0.8, sw2, sl), mats.shin, [0, -sl / 2, 0], [1, 1, 1.15], { ol: true });
    const ankle = grp(knee, [0, -sl, 0]);
    if (digi) { // clawed hoof
      seg(ankle, G.box, mats.foot, [0, -0.02, 0.05], [0.07, 0.05, 0.16]);
      for (const x of [-0.025, 0.025]) seg(ankle, G.cone4, mats.claw, [x, -0.03, 0.15], [0.015, 0.06, 0.015], { r: [Math.PI / 2, 0, 0] });
    } else seg(ankle, G.box, mats.foot, [0, -0.03, 0.04], [sw2 * 1.15, 0.07, 0.2], { ol: true });
    return { hip, knee, ankle, digi };
  }
  function armRig(parent, at, dims, mats) {
    const sh = grp(parent, at);
    const [uw, ul, fw, fl] = dims;
    seg(sh, taper(uw * 0.8, uw, ul), mats.upper, [0, -ul / 2, 0], [1, 1, 1], { ol: true });
    const el = grp(sh, [0, -ul, 0]);
    seg(el, taper(fw * 0.75, fw, fl), mats.fore, [0, -fl / 2, 0]);
    const hand = grp(el, [0, -fl, 0]);
    return { sh, el, hand };
  }

  // --- the operative (player, and prisoners in jumpsuits)
  function makeOperative(kind) {
    const pr = kind !== 'snake';
    const C = pr ? { armor: 0xd8742a, suit: 0xe07a2a, dark: 0x4a4440 } : { armor: 0x7f9458, suit: 0x3a4250, dark: 0x2a2e36 };
    const g = new THREE.Group(); shadowDisc(g, 0.3);
    const body = grp(g, [0, 0, 0]);
    const arm = (c) => metal(c, { metal: 0.2, rough: 0.6 });
    const mats = { thigh: pr ? cloth(C.suit) : arm(C.armor), shin: pr ? cloth(C.suit) : arm(C.armor), joint: metal(0x40444c), foot: metal(C.dark, { rough: 0.8 }) };
    const legs = [limb(body, [-0.09, 0.62, 0], [0.13, 0.3, 0.11, 0.3], mats), limb(body, [0.09, 0.62, 0], [0.13, 0.3, 0.11, 0.3], mats)];
    seg(body, taper(0.24, 0.28, 0.12), pr ? cloth(C.dark) : metal(0x3a3a34), [0, 0.66, 0], [1, 1, 0.75]);                   // belt / pelvis
    const torso = grp(body, [0, 0.7, 0]);
    seg(torso, taper(0.28, 0.38, 0.34), pr ? cloth(C.suit) : arm(C.armor), [0, 0.17, 0], [1, 1, 0.62], { ol: true });   // chest
    if (!pr) {
      for (let i = 0; i < 3; i++) seg(torso, G.box, metal(0x565e48), [0, 0.08 + i * 0.08, 0.12], [0.2 - i * 0.02, 0.03, 0.02]);   // ribbed plate
      const pack = grp(torso, [0, 0.2, -0.16]);
      seg(pack, G.box, metal(0x2a2e34), [0, 0, 0], [0.26, 0.3, 0.12], { ol: true });
      seg(pack, G.cyl, glow(0x4fe3ff), [0, 0.02, -0.065], [0.05, 0.16, 0.02], { r: [0, 0, 0] });                       // power cell
      for (const x of [-0.09, 0.09]) seg(pack, G.cyl6, metal(0x585e66), [x, 0.17, 0], [0.025, 0.08, 0.025]);
      seg(torso, taper(0.16, 0.12, 0.1), arm(C.armor), [-0.22, 0.32, 0], [1, 1, 1.1], { ol: true });                   // left pauldron
    } else seg(torso, G.box, cloth(0xffffff), [-0.08, 0.24, 0.115], [0.08, 0.05, 0.01]);                                // prisoner number
    const arms = [
      armRig(torso, [-0.22, 0.3, 0], [0.09, 0.26, 0.08, 0.24], { upper: pr ? cloth(C.suit) : arm(C.armor), fore: pr ? cloth(C.suit) : arm(0x5e6a4a) }),
      armRig(torso, [0.22, 0.3, 0], [0.09, 0.26, 0.08, 0.24], pr ? { upper: cloth(C.suit), fore: cloth(C.suit) } : { upper: metal(0xc3ccd6, { metal: 0.8, rough: 0.3 }), fore: metal(0xc3ccd6, { metal: 0.8, rough: 0.3 }) }),
    ];
    for (const a of arms) seg(a.hand, G.box, pr ? hide(kind === 'hybrid' ? 0xe8d8cc : 0xe8b898) : metal(0x2a2e34), [0, -0.03, 0], [0.07, 0.07, 0.08]);
    if (!pr) { // cybernetic right arm: glowing joints
      seg(arms[1].sh, G.sph, glow(0x4fe3ff), [0, -0.01, 0], [0.05, 0.05, 0.05]);
      seg(arms[1].el, G.sph, glow(0x4fe3ff), [0, 0, 0], [0.04, 0.04, 0.04]);
      seg(arms[1].el, G.box, glow(0x4fe3ff), [0.045, -0.12, 0], [0.005, 0.16, 0.02]);
    }
    // head
    const head = grp(torso, [0, 0.45, 0.01]);
    const skin = hide(kind === 'hybrid' ? 0xe8d8cc : 0xe8b898);
    seg(head, G.box, skin, [0, 0.08, 0], [0.17, 0.19, 0.18], { ol: true });
    seg(head, G.box, skin, [0, 0.02, 0.07], [0.12, 0.08, 0.06]);                                                          // jaw
    const hairC = kind === 'hybrid' ? 0xd4dce8 : kind === 'human' ? 0x5a3a28 : 0x2a1e1a;
    seg(head, G.box, cloth(hairC), [0, 0.17, -0.01], [0.18, 0.05, 0.19]);
    seg(head, G.box, cloth(hairC), [0, 0.1, -0.085], [0.18, 0.14, 0.03]);
    let tails = null;
    if (!pr) {
      seg(head, G.box, cloth(0xd02a3a), [0, 0.14, 0], [0.185, 0.035, 0.19]);                                             // bandana
      tails = [seg(head, G.box, cloth(0xd02a3a), [0.04, 0.13, -0.16], [0.04, 0.025, 0.16], { r: [0.3, 0.2, 0] }),
               seg(head, G.box, cloth(0xb01e2e), [-0.03, 0.12, -0.15], [0.035, 0.025, 0.14], { r: [0.5, -0.2, 0] })];
      seg(head, G.box, metal(0xb9c6d2, { metal: 0.8, rough: 0.3 }), [0.05, 0.09, 0.092], [0.08, 0.06, 0.01]);             // optic plate
      seg(head, G.box, glow(0xff2a2a), [0.055, 0.09, 0.098], [0.04, 0.025, 0.005]);                                        // red optic
      seg(head, G.box, cloth(0x1a1a22), [-0.045, 0.09, 0.092], [0.03, 0.02, 0.005]);
    } else {
      for (const x of [-0.045, 0.045]) seg(head, G.box, kind === 'hybrid' && x > 0 ? glow(0x4fe3ff) : cloth(0x1a1a22), [x, 0.09, 0.092], [0.03, 0.02, 0.005]);
      if (kind === 'hybrid') seg(head, G.box, glow(0x4fe3ff), [-0.09, 0.08, 0.02], [0.005, 0.08, 0.1]);
    }
    // pistol (drawn when firing) and holster
    const gun = grp(arms[1].hand, [0, -0.05, 0.05]);
    if (!pr) {
      seg(gun, G.box, metal(0x22262c), [0, 0, 0.06], [0.05, 0.07, 0.16]);
      seg(gun, G.cyl, metal(0x34383e), [0, 0.01, 0.2], [0.022, 0.14, 0.022], { r: [Math.PI / 2, 0, 0] });                  // suppressor
    }
    body.scale.setScalar(1.12);
    g.userData.rig = { kind: pr ? 'pow' : 'snake', legs, arms, torso, head, gun, tails, body };
    g.userData.body = body; g.userData.tails = tails;
    return g;
  }

  // --- Vyrr trooper: tall, hunched, digitigrade, elongated crested skull, four eyes, shock lance
  function makeTrooper() {
    const g = new THREE.Group(); shadowDisc(g, 0.28);
    const body = grp(g, [0, 0, 0]);
    const skin = hide(0x93b87c), armor = metal(0x5a6072), sash = cloth(0xa02a3c);
    const mats = { thigh: skin, shin: skin, joint: armor, foot: metal(0x2a2c34), claw: metal(0xd8d0c0, { metal: 0.2 }) };
    const legs = [limb(body, [-0.1, 0.64, 0], [0.1, 0.34, 0.075, 0.36], mats, true), limb(body, [0.1, 0.64, 0], [0.1, 0.34, 0.075, 0.36], mats, true)];
    for (const L of legs) { L.hip.rotation.x = -0.5; L.knee.rotation.x = 1.0; L.ankle.rotation.x = -0.5; }
    seg(body, taper(0.2, 0.24, 0.1), armor, [0, 0.66, 0], [1, 1, 0.7]);
    const torso = grp(body, [0, 0.7, 0], [0.38, 0, 0]);    // hunched forward
    seg(torso, taper(0.2, 0.34, 0.4), skin, [0, 0.2, 0], [1, 1, 0.62], { ol: true });
    for (let i = 0; i < 3; i++) seg(torso, G.box, armor, [0, 0.12 + i * 0.1, 0.07], [0.26 + i * 0.03, 0.045, 0.1]);   // rib armour
    seg(torso, G.box, sash, [0, 0.14, 0.118], [0.11, 0.3, 0.012]);                                                     // rank tabard
    for (let i = 0; i < 4; i++) seg(torso, G.oct, glow(0xc34bff), [0, 0.1 + i * 0.09, -0.075], [0.025, 0.03, 0.025]);  // spine nodes
    seg(torso, G.box, metal(0xc8a44a, { metal: 0.9 }), [0, 0.3, 0.126], [0.05, 0.05, 0.01]);                          // insignia
    for (const sx of [-1, 1]) seg(torso, G.cone4, armor, [sx * 0.2, 0.44, -0.04], [0.05, 0.2, 0.05], { r: [-0.5, 0, sx * 0.4], ol: true });   // shoulder fins
    // neck + elongated skull
    seg(torso, G.cyl6, skin, [0, 0.47, 0.05], [0.035, 0.16, 0.035], { r: [0.5, 0, 0] });
    const head = grp(torso, [0, 0.56, 0.11], [-0.38, 0, 0]);
    seg(head, G.sph, skin, [0, 0.04, -0.06], [0.11, 0.1, 0.24], { r: [-0.55, 0, 0], ol: true });                    // swept-back skull
    seg(head, G.box, skin, [0, -0.02, 0.11], [0.1, 0.07, 0.14]);                                                      // snout
    seg(head, G.box, hide(0x5a7248), [0, -0.06, 0.1], [0.08, 0.03, 0.12]);                                            // jaw
    for (const [x, y, r] of [[-0.042, 0.035, 0.028], [0.042, 0.035, 0.028], [-0.06, 0.0, 0.02], [0.06, 0.0, 0.02]]) seg(head, G.sph, glow(0xffd23a), [x, y, 0.135], [r, r * 0.7, 0.012]);
    for (const x of [-0.04, 0.04]) seg(head, G.cone4, metal(0xe8e0d0, { metal: 0.1, ei: 0.4 }), [x, -0.08, 0.15], [0.014, 0.07, 0.014], { r: [2.6, 0, x > 0 ? 0.3 : -0.3] });   // tusks
    for (let i = 0; i < 3; i++) seg(head, G.cone4, metal(0x9a5ac8, { ei: 0.45 }), [0, 0.13 - i * 0.02, -0.07 - i * 0.1], [0.035, 0.16 - i * 0.03, 0.035], { r: [-1.1, 0, 0] }, );   // crest
    const skinArm = { upper: skin, fore: skin };
    const arms = [armRig(torso, [-0.2, 0.38, 0.02], [0.06, 0.3, 0.05, 0.3], skinArm), armRig(torso, [0.2, 0.38, 0.02], [0.06, 0.3, 0.05, 0.3], skinArm)];
    for (const a of arms) for (const x of [-0.02, 0.02]) seg(a.hand, G.cone4, mats.claw, [x, -0.04, 0.01], [0.012, 0.07, 0.012], { r: [Math.PI, 0, 0] });
    // shock lance held in the right hand
    const gun = grp(arms[1].hand, [0, -0.03, 0.02]);
    seg(gun, G.cyl6, metal(0x2a2c34), [0, 0.1, 0], [0.018, 0.9, 0.018]);
    seg(gun, G.box, metal(0x5a4a78), [0, 0.5, 0], [0.05, 0.08, 0.05]);
    const tip = seg(gun, G.oct, glow(0xc34bff), [0, 0.6, 0], [0.04, 0.07, 0.04]);
    seg(gun, G.tor, glow(0xe8a0ff), [0, 0.52, 0], [0.05, 0.05, 0.05], { r: [Math.PI / 2, 0, 0] });
    g.userData.rig = { kind: 'trooper', legs, arms, torso, head, gun, tip, body, hunch: 0.38 };
    g.userData.body = body; g.userData.gun = gun;
    return g;
  }

  // --- Vyrr enforcer: armoured brute, carapace hump, acid vents, arm cannon
  function makeEnforcer() {
    const g = new THREE.Group(); shadowDisc(g, 0.4);
    const body = grp(g, [0, 0, 0]);
    const armor = metal(0x7a64b0, { metal: 0.35, rough: 0.5 }), dark = metal(0x3c3450, { metal: 0.3 }), acid = glow(0x7dff4a);
    const mats = { thigh: armor, shin: armor, joint: dark, foot: dark };
    const legs = [limb(body, [-0.15, 0.56, 0], [0.18, 0.26, 0.17, 0.28], mats), limb(body, [0.15, 0.56, 0], [0.18, 0.26, 0.17, 0.28], mats)];
    const torso = grp(body, [0, 0.6, 0], [0.18, 0, 0]);
    seg(torso, taper(0.4, 0.62, 0.5), armor, [0, 0.25, 0], [1, 1, 0.66], { ol: true });
    seg(torso, G.sph, dark, [0, 0.46, -0.12], [0.28, 0.2, 0.2], { ol: true });                                        // carapace hump
    for (let i = 0; i < 3; i++) seg(torso, G.cone4, metal(0xd8d0c0, { metal: 0.2 }), [(i - 1) * 0.12, 0.6, -0.16], [0.035, 0.16, 0.035], { r: [-0.5, 0, (i - 1) * -0.3] });   // back spikes
    for (let i = 0; i < 2; i++) seg(torso, G.box, acid, [0, 0.3 + i * 0.08, -0.215], [0.24, 0.02, 0.01]);            // rear vents
    for (let i = 0; i < 3; i++) seg(torso, G.box, acid, [0, 0.14 + i * 0.07, 0.19], [0.2, 0.018, 0.01]);           // vents
    for (const sx of [-1, 1]) { seg(torso, G.sph, armor, [sx * 0.36, 0.44, 0], [0.16, 0.12, 0.16], { ol: true }); seg(torso, G.tor, acid, [sx * 0.36, 0.4, 0], [0.13, 0.13, 0.13], { r: [Math.PI / 2, 0, 0] }); }     // pauldrons
    const head = grp(torso, [0, 0.52, 0.08]);
    seg(head, G.box, dark, [0, 0.03, 0], [0.18, 0.14, 0.16], { ol: true });
    seg(head, G.box, glow(0xff4b5c), [0, 0.04, 0.083], [0.13, 0.025, 0.005]);                                        // visor slit
    seg(head, G.cone4, dark, [0, 0.13, -0.03], [0.05, 0.12, 0.05], { r: [-0.6, 0, 0] });
    const arms = [
      armRig(torso, [-0.4, 0.38, 0], [0.12, 0.26, 0.1, 0.22], { upper: armor, fore: dark }),
      armRig(torso, [0.4, 0.38, 0], [0.12, 0.26, 0.12, 0.2], { upper: armor, fore: dark }),
    ];
    for (let i = 0; i < 3; i++) seg(arms[0].hand, G.cone4, metal(0xd8d0c0, { metal: 0.3 }), [-0.04 + i * 0.04, -0.05, 0.02], [0.02, 0.1, 0.02], { r: [Math.PI, 0, 0] });
    const gun = grp(arms[1].hand, [0, -0.02, 0.04]);
    seg(gun, G.cyl, dark, [0, 0, 0.14], [0.08, 0.4, 0.08], { r: [Math.PI / 2, 0, 0], ol: true });
    seg(gun, G.tor, acid, [0, 0, 0.2], [0.085, 0.085, 0.085]);
    const tip = seg(gun, G.cyl, acid, [0, 0, 0.345], [0.05, 0.02, 0.05], { r: [Math.PI / 2, 0, 0] });
    g.userData.rig = { kind: 'enforcer', legs, arms, torso, head, gun, tip, body, hunch: 0.18 };
    g.userData.body = body; g.userData.gun = gun;
    return g;
  }

  // --- sentinel drone: floating chrome eye, spinning blades, trailing tendrils
  function makeSentinel() {
    const g = new THREE.Group(); const sh = shadowDisc(g, 0.26);
    const body = grp(g, [0, 0.95, 0]);
    seg(body, G.sph, metal(0xc0c6d4, { metal: 0.6, rough: 0.3, ei: 0.35 }), [0, 0, 0], [0.18, 0.18, 0.18], { ol: true });
    const band = seg(body, G.tor, glow(0xffe066), [0, 0, 0], [0.19, 0.19, 0.19], { r: [Math.PI / 2, 0, 0] });
    seg(body, G.sph, metal(0x2a2c34), [0, 0, 0.08], [0.13, 0.13, 0.12]);
    const eye = seg(body, G.sph, glow(0xffe066), [0, 0, 0.17], [0.07, 0.07, 0.04]);
    seg(body, G.tor, metal(0xb0b6c4, { metal: 0.9, rough: 0.2 }), [0, 0, 0.16], [0.1, 0.1, 0.1]);
    const fins = grp(body, [0, 0, 0]);
    for (let i = 0; i < 3; i++) {
      const f = grp(fins, [0, 0, 0], [0, 0, i * Math.PI * 2 / 3]);
      seg(f, taper(0.02, 0.07, 0.34), metal(0x8a70c8, { ei: 0.4 }), [0, 0.28, -0.04], [1, 1, 0.3], { ol: true });
      seg(f, G.box, glow(0xc34bff), [0, 0.4, -0.02], [0.02, 0.06, 0.01]);
    }
    seg(body, G.cone4, metal(0x6a6e7c), [0, 0.24, -0.05], [0.03, 0.14, 0.03]);
    const tendrils = [];
    for (let i = 0; i < 3; i++) { const t = grp(body, [(i - 1) * 0.07, -0.14, -0.04]); seg(t, G.cyl6, metal(0x3a3c48), [0, -0.14, 0], [0.012, 0.28, 0.012]); seg(t, G.sph, glow(0xc34bff), [0, -0.29, 0], [0.02, 0.02, 0.02]); tendrils.push(t); }
    g.userData.rig = { kind: 'sentinel', fins, tendrils, body };
    g.userData.body = body; g.userData.eye = eye; g.userData.band = band; g.userData.shadow = sh;
    return g;
  }

  // per-frame pose + animation for the rigs above
  function animateRig(m, st) {
    const R = m.userData.rig;
    if (!R) return;
    const { t, moving, anim } = st;
    if (R.kind === 'sentinel') {
      R.fins.rotation.z = t * 1.6;
      R.tendrils.forEach((tn, i) => { tn.rotation.x = Math.sin(t * 3 + i) * 0.35 + (st.moving ? 0.5 : 0.15); tn.rotation.z = Math.cos(t * 2.3 + i) * 0.2; });
      return;
    }
    const ph = moving ? anim : 0, sw = moving ? Math.sin(ph) : 0;
    const digi = R.kind === 'trooper';
    R.legs.forEach((L, i) => {
      const s = i ? -sw : sw, lift = moving ? Math.max(0, i ? Math.cos(ph) : -Math.cos(ph)) : 0;
      if (digi) { L.hip.rotation.x = -0.5 + s * 0.45; L.knee.rotation.x = 1.0 + lift * 0.5; L.ankle.rotation.x = -0.5 - lift * 0.3; }
      else { L.hip.rotation.x = s * 0.55; L.knee.rotation.x = lift * 0.8; L.ankle.rotation.x = -lift * 0.2; }
    });
    R.body.position.y = moving ? Math.abs(Math.cos(ph)) * 0.035 : Math.sin(t * 2) * 0.006;
    const breathe = Math.sin(t * 2.2) * 0.03;
    R.torso.rotation.x = (R.hunch || 0) + breathe + (moving ? 0.06 : 0);
    R.torso.rotation.z = st.stun ? Math.sin(t * 14) * 0.15 : 0;
    const [aL, aR] = R.arms;
    aL.sh.rotation.set(-sw * 0.6 - (R.hunch || 0), 0, digi ? 0.15 : 0.08); aL.el.rotation.x = -0.3;
    aR.sh.rotation.set(sw * 0.6 - (R.hunch || 0), 0, digi ? -0.15 : -0.08); aR.el.rotation.x = -0.3;
    if (R.head) R.head.rotation.y = moving ? 0 : Math.sin(t * 0.7) * 0.25;
    if (digi && R.gun) R.gun.rotation.x = 0.1;   // lance carried upright
    if (st.aim) {
      aR.sh.rotation.set(-1.45 - (R.hunch || 0), 0, 0); aR.el.rotation.x = 0;
      if (digi && R.gun) R.gun.rotation.x = 1.55;  // lance levelled like a rifle
    }
    if (st.punch) { aR.sh.rotation.set(-1.6 - (R.hunch || 0), 0, 0); aR.el.rotation.x = 0; }
    if (st.plant) { const j = Math.sin(t * 20) * 0.2; aL.sh.rotation.x = -1.1 + j; aR.sh.rotation.x = -1.1 - j; aL.el.rotation.x = aR.el.rotation.x = -0.6; }
    if (R.gun && R.kind === 'snake') R.gun.visible = !!(st.aim || st.punch);
    if (R.tip) { const k = st.aim ? 1.4 + Math.sin(t * 30) * 0.3 : 1; if (!R.tipBase) R.tipBase = R.tip.scale.clone(); R.tip.scale.copy(R.tipBase).multiplyScalar(k); }
    if (R.tails) R.tails.forEach((tl, i) => { tl.rotation.x = 0.3 + Math.sin(t * 10 + i) * 0.25 + (moving ? 0.4 : 0); });
  }

  // ------------------------------------------------------------------ sprites (icons, floaters, bars)
  const spriteTex = {};
  function textSprite(text, color, scale = 1) {
    const k = text + color;
    let t = spriteTex[k];
    if (!t) {
      const c = document.createElement('canvas');
      c.width = text.length * 4 + 3; c.height = 8;
      Art.text(c.getContext('2d'), text, c.width / 2, 1, color, '#05080c');
      t = spriteTex[k] = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      t.userData = { w: c.width, h: c.height };
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    const px = 1 / 18 * scale; // about one texel per screen pixel at the default zoom
    s.scale.set(t.userData.w * px, t.userData.h * px, 1);
    s.renderOrder = 10;
    return s;
  }
  function iconSprite(ch) {
    const k = 'icon' + ch;
    let t = spriteTex[k];
    if (!t) {
      const c = document.createElement('canvas'); c.width = 9; c.height = 10;
      Art.icon(c.getContext('2d'), ch, 4.5, 8, ch === '!' ? '#ff3a3a' : '#ffd23a');
      t = spriteTex[k] = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(9 / 16, 10 / 16, 1); s.renderOrder = 11;
    return s;
  }

  // ------------------------------------------------------------------ per-frame sync
  function modelFor(obj, make) {
    let m = models.get(obj);
    if (!m) { m = make(); models.set(obj, m); dyn.add(m); }
    m.userData.seen = true;
    return m;
  }
  const rotYFromDir = (a) => Math.atan2(Math.cos(a), Math.sin(a));

  function animWalk(m, moving, anim) {
    const sw = moving ? Math.sin(anim) * 0.7 : 0;
    const L = m.userData.legs || [], A = m.userData.arms || [];
    if (L[0]) { L[0].rotation.x = sw; L[1].rotation.x = -sw; }
    if (A[0]) { A[0].rotation.x = -sw * 0.8; A[1].rotation.x = sw * 0.8; }
    if (m.userData.body) m.userData.body.position.y = moving ? Math.abs(Math.cos(anim)) * 0.04 : 0;
  }

  function lieDown(m, down) {
    const b = m.userData.body;
    if (!b) return;
    if (down) { b.rotation.x = -Math.PI / 2; b.position.y = 0.16; b.position.z = 0.1; }
    else { b.rotation.x = 0; b.position.z = 0; }
  }

  function coneFor(e) {
    let c = cones.get(e);
    if (!c) {
      const n = 18, geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 2) * 3), 3));
      const idx = []; for (let i = 1; i <= n; i++) idx.push(0, i + 1, i);
      geo.setIndex(idx);
      c = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.2, depthWrite: false }));
      c.frustumCulled = false; c.renderOrder = 3; c.userData.n = n;
      cones.set(e, c); dyn.add(c);
    }
    c.userData.seen = true;
    return c;
  }
  const CONE_COL = { patrol: 0xffe066, return: 0xffe066, suspicious: 0xff9a3c, search: 0xff9a3c, alert: 0xff3040 };

  function updateCone(S, e) {
    const c = coneFor(e);
    const alive = !e.dead && !(e.ko > 0) && e.stun <= 0;
    c.visible = alive;
    if (!alive) return;
    const range = e.range * (S.phase === 'alert' ? 1.3 : 1);
    const pos = c.geometry.attributes.position, n = c.userData.n;
    const ox = e.x, oy = e.y - 2;
    pos.setXYZ(0, ox * U, 0.03, oy * U);
    for (let i = 0; i <= n; i++) {
      const a = e.dir - e.fov + (2 * e.fov * i) / n, cs = Math.cos(a), sn = Math.sin(a);
      let d = 4;
      while (d < range && !Game.opaqueAt(ox + cs * d, oy + sn * d)) d += 4;
      pos.setXYZ(i + 1, (ox + cs * d) * U, 0.03, (oy + sn * d) * U);
    }
    pos.needsUpdate = true;
    c.geometry.computeBoundingSphere();
    let col = CONE_COL[e.state] || CONE_COL.patrol;
    if (e.type === 'camera') col = S.phase === 'alert' ? 0xff3040 : e.aw > 0.3 ? 0xff9a3c : 0x7ad2ff;
    c.material.color.setHex(col);
    c.material.opacity = e.sees ? 0.34 : 0.2;
  }

  function overlayFor(obj, key, make) {
    const store = obj.__ov || (obj.__ov = {});
    let s = store[key];
    if (!s) { s = store[key] = make(); dyn.add(s); }
    s.userData.seen = true;
    s.visible = true;
    return s;
  }

  let floaterSprites = new Map();

  function sync(S, dt) {
    if (builtS !== S || builtVersion !== S.tileVersion) buildLevel(S);
    for (const m of models.values()) m.userData.seen = false;
    for (const c of cones.values()) c.userData.seen = false;
    dyn.children.forEach((o) => { if (o.isSprite) o.userData.seen = false; });
    const t = S.t;
    const P = S.player;

    // player
    const pm = modelFor(P, () => { const m = makeOperative('snake'); addXray(m, 'player'); return m; });
    pm.visible = !P.hidden;
    pm.position.set(P.x * U, 0, P.y * U);
    pm.rotation.y = rotYFromDir(P.dir);
    animateRig(pm, { t, moving: P.moving, anim: P.anim * 0.8, aim: P.shootT > 0 || P.fireCD > 0.1, punch: P.punchT > 0, plant: !!P.planting });
    lieDown(pm, P.dead);
    const blink = P.inv > 0 && ((t * 30) | 0) % 2;
    if (!P.hidden) pm.visible = !blink;

    // enemies
    for (const e of S.enemies) {
      let m;
      if (e.type === 'drone') {
        m = modelFor(e, () => { const d = makeSentinel(); addXray(d, 'enemy'); return d; });
        m.position.set(e.x * U, 0, e.y * U);
        m.userData.body.position.y = 0.95 + Math.sin(t * 4 + e.ox) * 0.06;
        animateRig(m, { t, moving: e.walking });
        m.rotation.y = rotYFromDir(e.dir);
        m.userData.eye.material = m.userData.band.material = glow(e.state === 'alert' ? 0xff3040 : (e.state === 'patrol' || e.state === 'return') ? 0xffe066 : 0xff9a3c);
        m.visible = !e.dead || e.deadT < 0.1;
      } else if (e.type === 'camera') {
        m = modelFor(e, makeCamera);
        m.position.set(e.x * U, 0, e.y * U);
        m.userData.head.rotation.y = rotYFromDir(e.dir);
        m.userData.led.material = glow(S.phase === 'alert' ? 0xff3040 : 0x40ff70);
        m.userData.led.visible = ((t * 2) | 0) % 2 === 0;
        m.visible = !e.dead;
      } else {
        m = modelFor(e, () => { const h = e.type === 'heavy' ? makeEnforcer() : makeTrooper(); addXray(h, 'enemy'); return h; });
        m.position.set(e.x * U, 0, e.y * U);
        m.rotation.y = rotYFromDir(e.dir);
        const down = e.ko > 0;
        animateRig(m, { t: t + e.ox, moving: e.walking && !down, anim: e.anim * 0.9, aim: e.state === 'alert' && e.sees && !down, stun: e.stun > 0 });
        lieDown(m, down);
        if (m.userData.gun) m.userData.gun.visible = !down;
        if (e.dead) { const k = Math.min(1, e.deadT / 1.2); m.scale.set(1 + k * 0.3, Math.max(0.02, 1 - k), 1 + k * 0.3); }
        else m.scale.set(1, 1, 1);
        // KO stars
        if (down) {
          const s = overlayFor(e, 'zz', () => textSprite('Z Z', '#ffe66b'));
          s.position.set(e.x * U, 0.6 + Math.sin(t * 3) * 0.05, e.y * U);
        }
      }
      updateCone(S, e);
      // icons and awareness meter
      if (e.icon && !e.dead) {
        const s = overlayFor(e, 'icon' + e.icon, () => iconSprite(e.icon));
        s.position.set(e.x * U, e.type === 'camera' ? 1.45 : e.type === 'drone' ? 1.55 : (e.type === 'heavy' ? 1.65 : 1.4), e.y * U);
      }
      if (!e.dead && !(e.ko > 0) && e.aw > 0.05 && e.aw < 1 && S.phase !== 'alert') {
        const bg = overlayFor(e, 'awbg', () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, depthTest: false })); s.renderOrder = 10; return s; });
        const fg = overlayFor(e, 'awfg', () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd23a, depthTest: false })); s.renderOrder = 11; return s; });
        const y = e.type === 'camera' ? 1.3 : 1.25;
        bg.position.set(e.x * U, y, e.y * U); bg.scale.set(0.7, 0.1, 1);
        fg.material.color.setHex(e.aw > 0.6 ? 0xff6a3a : 0xffd23a);
        fg.scale.set(0.62 * e.aw, 0.05, 1);
        fg.center.set(0, 0.5); // grow from the left edge, along the camera's right vector
        fg.position.set(e.x * U - Math.cos(AZ) * 0.31, y, e.y * U + Math.sin(AZ) * 0.31);
      }
    }
    // prisoners
    for (const w of S.pows) {
      const m = modelFor(w, () => { const r = w.kind === 'ai' ? makeRobotPow() : makeOperative(w.kind); addXray(r, 'pow'); return r; });
      m.position.set(w.x * U, 0, w.y * U);
      m.rotation.y = rotYFromDir(w.dir);
      if (m.userData.rig) animateRig(m, { t: t + w.x, moving: w.moving, anim: w.anim * 0.8 }); else animWalk(m, w.moving, w.anim);
    }
    // pickups
    for (const p of S.pickups) {
      const m = modelFor(p, () => makePickup(p.type));
      m.visible = !p.taken;
      m.position.set(p.x * U, 0, p.y * U);
      m.userData.spin.rotation.y = t * 2;
      m.userData.spin.position.y = 0.3 + Math.sin(t * 3 + p.x) * 0.05;
    }
    // hiding tell: a faint eye glint on the hide spot
    if (P.hidden) {
      const s = overlayFor(P, 'hid', () => textSprite('..', '#ff4b5c'));
      s.position.set(P.hidden.tx + 0.5, 0.9, P.hidden.ty + 0.5);
      s.visible = ((t * 1.5) | 0) % 4 !== 0;
    }
    // animated tiles
    const reqOk = !S.def.requires || (S.def.requires === 'intel' ? S.intel : S.cores >= S.coresTotal);
    for (const { pad, ring } of exitMeshes) {
      pad.material = glow(reqOk ? 0x35e08a : 0xff4b5c, 0.7);
      ring.position.y = 0.45 + Math.sin(t * 2) * 0.12; ring.rotation.z = t;
      ring.material = glow(reqOk ? 0x9dffb8 : 0xff8a8a);
    }
    for (const c of coreMeshes) { c.rotation.y = t * 1.5; c.position.y = 0.95 + Math.sin(t * 2) * 0.06; }
    for (const f of fieldMeshes) f.material.opacity = 0.3 + Math.random() * 0.25;

    // floaters
    const live = new Set();
    for (const f of S.floaters) {
      let s = floaterSprites.get(f);
      if (!s) { s = textSprite(f.text, f.color); floaterSprites.set(f, s); dyn.add(s); }
      s.position.set(f.x * U, 1.4 + (1.3 - f.life) * 0.5, f.y * U);
      s.material.opacity = Math.min(1, f.life * 2);
      s.userData.seen = true;
      live.add(f);
    }
    for (const [f, s] of floaterSprites) if (!live.has(f)) { dyn.remove(s); s.material.dispose(); floaterSprites.delete(f); }

    // cull what vanished
    for (const [o, m] of models) if (!m.userData.seen) { dyn.remove(m); models.delete(o); }
    for (const [o, c] of cones) if (!c.userData.seen) { dyn.remove(c); c.geometry.dispose(); cones.delete(o); }
    for (const o of [...dyn.children]) if (o.isSprite && !o.userData.seen && ![...floaterSprites.values()].includes(o)) o.visible = false;
    for (const e of S.enemies) if (e.__ov) for (const k in e.__ov) e.__ov[k].visible = e.__ov[k].userData.seen;
    if (P.__ov) for (const k in P.__ov) P.__ov[k].visible = P.__ov[k].userData.seen && P.__ov[k].visible;

    // particles & bullets
    const fx = pointsFx.geometry, fp = fx.attributes.position, fc = fx.attributes.color, colr = new THREE.Color();
    let n = 0;
    for (const p of S.particles) {
      if (n >= 600) break;
      fp.setXYZ(n, p.x * U, 0.45 + p.life * 0.6, p.y * U);
      colr.set(p.color); fc.setXYZ(n, colr.r, colr.g, colr.b); n++;
    }
    fx.setDrawRange(0, n); fp.needsUpdate = true; fc.needsUpdate = true;
    const bx = pointsBul.geometry, bp = bx.attributes.position, bc = bx.attributes.color;
    n = 0;
    for (const b of S.bullets) {
      if (n >= 120) break;
      bp.setXYZ(n, b.x * U, 0.55, b.y * U);
      colr.setHex(b.owner === 'player' ? 0xfff6a0 : b.heavy ? 0xff6a6a : 0xe07bff); bc.setXYZ(n, colr.r, colr.g, colr.b); n++;
    }
    bx.setDrawRange(0, n); bp.needsUpdate = true; bc.needsUpdate = true;
  }

  // ------------------------------------------------------------------ frame
  function render(S, dt) {
    if (!S) { renderer.setRenderTarget(null); renderer.setClearColor(0x000000); renderer.clear(); return; }
    sync(S, dt);
    const P = S.player;
    const tgt = new THREE.Vector3(P.x * U, 0.4, P.y * U);
    if (camT.lengthSq() === 0 || camT.userData !== S) { camT.copy(tgt); camT.userData = S; }
    camT.lerp(tgt, Math.min(1, dt * 6));
    const D = 60, ce = Math.cos(EL);
    const sx = S.shake > 0 ? (Math.random() - 0.5) * S.shake * 0.04 : 0, sy = S.shake > 0 ? (Math.random() - 0.5) * S.shake * 0.04 : 0;
    camera.position.set(camT.x + Math.sin(AZ) * ce * D + sx, camT.y + Math.sin(EL) * D + sy, camT.z + Math.cos(AZ) * ce * D);
    camera.lookAt(camT.x + sx, camT.y + sy, camT.z);
    // tint: damage flash > alert pulse > escape pulse
    const pulse = (Math.sin(S.t * 4) + 1) / 2;
    const tint = postMat.uniforms.uTint.value;
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
    for (const [, m] of models) dyn.remove(m);
    models.clear();
    for (const [, c] of cones) { dyn.remove(c); c.geometry.dispose(); }
    cones.clear();
    for (const [, s] of floaterSprites) dyn.remove(s);
    floaterSprites.clear();
    for (const o of [...dyn.children]) if (o.isSprite) dyn.remove(o);
    if (levelGroup) { scene.remove(levelGroup); levelGroup = null; }
    builtS = null;
  }

  return { init, resize, render, clear, get pixel() { return pixel; }, get scene() { return scene; } };
})();
