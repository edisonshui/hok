// The wallpaper behind the window (10 Nov 2026; main side in lib/wallpaper.js). One layer under the whole page shows
// the part of the picture the window covers, so the window reads as glass over its own wallpaper whatever sits
// behind it. It moves only where moving costs nothing you need: on Home, on wall power, while the window can be
// seen. Everywhere else, and on battery, it holds still on the frame it was showing (Edison, 10 Nov: sessions hold
// still; "hold a still frame" on battery). Sessions get a slightly thicker glass for reading (Edison, 10 Nov).
(function () {
  const F = window.flash;
  if (!F || !F.wall) { window.Wall = { route() {}, reload() {}, stone() {} }; return; }
  const MAC = F.platform === "darwin";   // pictures and Aerials come from macOS; other systems always show the stone glass
  const root = document.documentElement;
  const wall = document.createElement("div"); wall.id = "wall"; wall.setAttribute("aria-hidden", "true");
  wall.innerHTML = `<div class="wall-media"></div><div class="wall-tint"></div><div class="wall-shade"></div>`;
  document.body.prepend(wall);
  const box = wall.querySelector(".wall-media");
  let media = null, kind = "none", stoneDraw = null, waiting = null;
  let routeName = "home", battery = false, onBattery = false, z = 1, place = null;   // onBattery: Settings' "Keep moving on battery"
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const shouldPlay = () => routeName === "home" && (!battery || onBattery) && !calm() && document.visibilityState === "visible";

  // the window's spot on its display: the picture spans the display, shifted so the window shows its own part
  function fit() {
    if (!place || !media) return;
    const w = place.dw / z, h = place.dh / z;
    media.style.width = w + "px"; media.style.height = h + "px";
    media.style.transform = `translate(${-place.x / z}px,${-place.y / z}px)`;
  }
  F.wall.onPlace((p) => { place = p; fit(); });
  if (F.onZoom) F.onZoom((f) => { z = f || 1; fit(); });

  // play or hold, every time something that decides it changes
  let raf = 0;
  // The wallpaper slows to a stop and gathers speed again, instead of cutting (11 Nov, Edison: the waves stopping
  // "feels a little bit too sudden when you leave the home page"). speed runs 0 to 1: out over 900 ms, in over 700 ms,
  // on a smoothstep; a video's playback rate follows it (Chromium's floor is 1/16), the stone glass's clock too.
  // Reduce motion, and a hidden window, stop at once.
  let speed = 0, target = 0, ramp = 0, rampT = 0;
  const curve = (x) => x * x * (3 - 2 * x);
  function apply() {
    const k = curve(speed);
    if (kind === "video" && media) {
      if (k > 0) { media.playbackRate = Math.max(0.0625, k); if (media.paused) media.play().catch(() => {}); }
      else { media.pause(); media.playbackRate = 1; }
    }
    if (kind === "stone") { if (k > 0 && !raf) loop(); if (k === 0 && raf) { cancelAnimationFrame(raf); raf = 0; } }
  }
  function step(t) {
    const dt = Math.min(100, t - rampT); rampT = t;
    speed = target > speed ? Math.min(target, speed + dt / 700) : Math.max(target, speed - dt / 900);
    apply();
    ramp = speed !== target ? requestAnimationFrame(step) : 0;
  }
  function sync() {
    target = shouldPlay() ? 1 : 0;
    if (calm() || document.visibilityState !== "visible") { if (ramp) cancelAnimationFrame(ramp); ramp = 0; speed = target; apply(); return; }
    if (!ramp && speed !== target) { rampT = performance.now(); ramp = requestAnimationFrame(step); }
  }
  // the stone glass draws at 15 frames a second into a small canvas the layer stretches (energy 12.4 against 18.6 at
  // full size and 60 frames, measured 10 Nov); its clock runs at the wallpaper's speed, so it eases like the video
  let last = 0, clock = 0;
  const loop = (ms) => { raf = requestAnimationFrame(loop); ms = ms || performance.now(); if (last && ms - last < 66) return; if (last) clock += ((ms - last) / 1000) * curve(speed); last = ms; if (stoneDraw) stoneDraw(clock); };

  function set(el, k) {
    if (raf) { cancelAnimationFrame(raf); raf = 0; last = 0; }
    box.textContent = ""; media = el; kind = k; stoneDraw = null;
    root.dataset.wkind = k;   // a picture takes a lighter stone tint than the stone glass (styles.css)
    if (el) { el.classList.add("wall-pic"); box.append(el); }
    root.classList.toggle("wall-on", !!el);
    fit(); apply(); sync();
  }
  function showVideo(url) {
    const v = document.createElement("video");
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto"; v.disableRemotePlayback = true;
    v.src = url;
    v.addEventListener("loadeddata", () => { if (media === v) sync(); }, { once: true });
    set(v, "video");
    // A video that should hold still (on battery, in a session) is started until its first frame is drawn, then paused
    // there: never played, it loaded nothing and the window showed only the dark tint (11 Nov, Edison: "screen went dark").
    if (!shouldPlay()) {
      v.requestVideoFrameCallback(() => { if (media === v && !shouldPlay()) v.pause(); });
      v.play().catch(() => {});
    }
  }
  // a still is drawn once, small and blurred, and stretched: nothing to decode or redraw after that
  function showImage(url) {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas"); cv.width = 640; cv.height = 360;
      const x = cv.getContext("2d"), s = Math.max(cv.width / img.width, cv.height / img.height), w = img.width * s, h = img.height * s;
      x.filter = "blur(3px)"; x.drawImage(img, (cv.width - w) / 2 - 8, (cv.height - h) / 2 - 8, w + 16, h + 16);
      set(cv, "image");
    };
    img.onerror = () => showStone();
    img.src = url;
  }
  function stoneRGB() {
    const p = document.createElement("i"); p.style.color = "var(--stone-tone)"; document.body.append(p);
    const c = getComputedStyle(p).color; p.remove();
    const unit = c.startsWith("color(") ? 1 : 255;   // "color(srgb r g b)" is 0..1, "rgb(r, g, b)" is 0..255
    return (c.match(/[\d.]+/g) || [0.1, 0.38, 0.36]).slice(0, 3).map((v) => +v / unit);
  }
  // stone glass: soft bands of the stone's own light drifting slowly (round 5, approved 10 Nov)
  const FS = `precision mediump float; uniform vec2 R; uniform float T; uniform vec3 S;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
    float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
    void main(){vec2 uv=gl_FragCoord.xy/R; float ar=R.x/R.y; vec2 p=vec2(uv.x*ar,uv.y);
      float f=fbm(p*.9+vec2(T*.048,-T*.024)); float g=fbm(p*1.6+vec2(-T*.036,T*.028)+3.);
      float d=p.x*.85+p.y*1.25+1.9*f+.5*sin(p.x*1.3+T*.12); float band=.5+.5*sin(d*2.6-T*.2); float edge=pow(band,2.2);
      vec3 ink=vec3(.025,.03,.045); vec3 dark=mix(S,ink,.70), mid=mix(S,ink,.22), pale=mix(S,vec3(.90,.97,1.),.42);
      vec3 col=mix(dark,mid,smoothstep(.15,.85,band*.7+g*.5));
      col=mix(col,pale,edge*.72*(.45+.55*smoothstep(.2,.7,g)));
      col=mix(col,dark,smoothstep(.55,1.,uv.y)*.25);
      gl_FragColor=vec4(col/.74,1.);}`;   // /.74: the shade over every picture darkens it back
  function showStone() {
    const cv = document.createElement("canvas"); cv.width = 400; cv.height = 225;
    const gl = cv.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return stillStone(cv);   // no WebGL (a Linux without a GPU driver): the same light, drawn once and held
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}")); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(gl.getUniformLocation(pr, "R"), cv.width, cv.height);
    const uS = gl.getUniformLocation(pr, "S"), uT = gl.getUniformLocation(pr, "T");
    const draw = (t) => { gl.uniform3f(uS, ...stoneRGB()); gl.uniform1f(uT, t + 20); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
    set(cv, "stone"); stoneDraw = draw; draw(clock);
  }

  // The stone glass without WebGL (11 Nov: the first Linux run had none, and the window fell back to the flat page):
  // one still frame of the same bands, from the stone's tone, drawn with a 2D canvas.
  function stillStone(cv) {
    const x = cv.getContext("2d"); if (!x) return set(null, "none");
    const [r, g, b] = stoneRGB().map((v) => Math.round(v * 255)), ink = [6, 8, 11];
    const mix = (t, c) => `rgb(${[r, g, b].map((v, i) => Math.round(Math.min(255, (v * (1 - t) + c[i] * t) / 0.74))).join(",")})`;
    const base = x.createLinearGradient(0, 0, cv.width, cv.height);
    base.addColorStop(0, mix(0.7, ink)); base.addColorStop(0.55, mix(0.25, ink)); base.addColorStop(1, mix(0.6, ink));
    x.fillStyle = base; x.fillRect(0, 0, cv.width, cv.height);
    const glow = x.createRadialGradient(cv.width * 0.25, cv.height * 1.1, 10, cv.width * 0.25, cv.height * 1.1, cv.width * 0.8);
    glow.addColorStop(0, mix(0.4, [230, 247, 255])); glow.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = glow; x.fillRect(0, 0, cv.width, cv.height);
    set(cv, "stone");
  }
  async function reload(force) {
    const r = MAC ? await F.wall.resolve(root.dataset.theme === "night", force) : { type: "stone" };
    waiting = r.preparing ? r.preparing.key : null;
    if (r.type === "video" && r.url) showVideo(r.url);
    else if (r.type === "image" && r.url) showImage(r.url);
    else if (r.type === "none") set(null, "none");
    else if (r.stillUrl) showImage(r.stillUrl);   // the wallpaper's still, at once, while its moving copy is made
    else showStone();   // stone glass
  }
  // a copy that finishes while you wait replaces the stone glass standing in for it
  F.wall.onStatus((st) => { if (st.done && st.ok && st.key === waiting) reload(); });
  F.wall.onPower((b) => { battery = !!b; sync(); });
  F.wall.battery().then((b) => { battery = !!b; sync(); });
  document.addEventListener("visibilitychange", sync);

  window.Wall = {
    // the screen you are on: Home moves, everything else holds still; a session also thickens the glass
    route(name) { routeName = name; root.dataset.wroute = name; sync(); },
    moveOnBattery(on) { onBattery = !!on; sync(); },
    reload,
    stone() { if (kind === "stone" && stoneDraw) stoneDraw(clock); },
  };
  reload();
})();
