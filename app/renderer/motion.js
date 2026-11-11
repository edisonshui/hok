// The motion engine. Every animation in the app runs on this one clock.
//
// Normally the clock follows real time, one tick per screen refresh. A recording
// switches it to manual and steps it one frame at a time, so every frame of a
// video is exact and no motion is missed or skipped.
//
// Motion is springs, not fixed curves. A spring keeps its velocity when it is
// sent somewhere new halfway through, so any motion can be interrupted, and a
// swipe can hand its speed to the motion that follows.
(function () {
  const STEP = 1 / 240;          // physics substep in seconds; fixed, so results never depend on frame rate
  const REST_DISTANCE = 0.001;   // a spring this close to its target, and this slow, has settled
  const REST_SPEED = 0.01;

  // ---------- clock ----------
  const listeners = new Set();
  let mode = "real";
  let time = 0;                  // seconds since the clock started
  let lastReal = null;
  let frame = null;

  function tick(dt) {
    time += dt;
    for (const fn of [...listeners]) fn(time, dt);
  }
  function realFrame(ms) {
    frame = null;
    if (mode !== "real") return;
    const dt = lastReal == null ? 0 : Math.min((ms - lastReal) / 1000, 0.1);  // a hidden window resumes calmly
    lastReal = ms;
    tick(dt);
    if (listeners.size) frame = requestAnimationFrame(realFrame);
  }
  function wake() {
    if (mode === "real" && frame == null) {
      lastReal = null;
      frame = requestAnimationFrame(realFrame);
    }
  }

  const clock = {
    now: () => time,
    get mode() { return mode; },
    // Recording: stop following real time. Nothing moves until step() is called.
    manual() {
      mode = "manual";
      if (frame != null) cancelAnimationFrame(frame);
      frame = null;
    },
    real() { mode = "real"; wake(); },
    step(ms) {
      if (mode !== "manual") throw new Error("clock.step() needs clock.manual() first");
      tick(ms / 1000);
    },
    on(fn) { listeners.add(fn); wake(); return () => listeners.delete(fn); },
  };

  // ---------- springs ----------
  // A named feel for each kind of motion, so every animation shares the same curves.
  const feels = {
    // Things arriving or settling: a little weight, no visible bounce.
    settle: { stiffness: 260, damping: 30, mass: 1 },
    // Small, quick responses: a press, a hover, a toggle.
    snappy: { stiffness: 520, damping: 42, mass: 1 },
    // Large moves: a panel opening, a camera move.
    glide: { stiffness: 140, damping: 24, mass: 1 },
  };

  // spring(from, { to, feel, velocity, onUpdate }) animates one number.
  // The handle's to(value, velocity?) sends it somewhere new without a jump.
  function spring(from, options) {
    const feel = typeof options.feel === "string" ? feels[options.feel] : (options.feel || feels.settle);
    let value = from;
    let velocity = options.velocity || 0;
    let target = options.to;
    let carry = 0;
    let off = null;
    let resolve;
    let done = new Promise((r) => (resolve = r));

    function advance(dt) {
      carry += dt;
      while (carry >= STEP) {
        const force = -feel.stiffness * (value - target) - feel.damping * velocity;
        velocity += (force / feel.mass) * STEP;   // semi-implicit Euler: stable at these stiffnesses
        value += velocity * STEP;
        carry -= STEP;
      }
    }
    function onTick(_, dt) {
      // Stopped earlier in this same tick (the clock walks a copy of its listeners): do nothing.
      if (!off) return;
      advance(dt);
      const resting = Math.abs(value - target) < REST_DISTANCE && Math.abs(velocity) < REST_SPEED;
      if (resting) { value = target; velocity = 0; }
      options.onUpdate(value, velocity);
      if (resting) { off(); off = null; resolve(value); }
    }
    function start() { if (!off) off = clock.on(onTick); }
    start();

    return {
      get value() { return value; },
      get velocity() { return velocity; },
      get done() { return done; },
      to(next, nextVelocity) {
        target = next;
        if (nextVelocity != null) velocity = nextVelocity;
        if (!off) done = new Promise((r) => (resolve = r));
        start();
        return this;
      },
      stop() { if (off) { off(); off = null; resolve(value); } },
    };
  }

  // curve(feel) is a spring's path from 0 to 1 as a function of seconds, worked
  // out once. Use it when many small things share one motion (each word of a
  // reply as it arrives), where a spring apiece would cost too much.
  const curves = {};
  function curve(name) {
    if (curves[name]) return curves[name];
    const feel = feels[name];
    const samples = [0];
    let value = 0, velocity = 0;
    while (samples.length < 4 * 240 && !(Math.abs(1 - value) < REST_DISTANCE && Math.abs(velocity) < REST_SPEED)) {
      const force = -feel.stiffness * (value - 1) - feel.damping * velocity;
      velocity += (force / feel.mass) * STEP;
      value += velocity * STEP;
      samples.push(value);
    }
    const duration = (samples.length - 1) * STEP;
    const fn = (t) => {
      if (t <= 0) return 0;
      if (t >= duration) return 1;
      const i = t / STEP, lo = Math.floor(i);
      return samples[lo] + (samples[lo + 1] - samples[lo]) * (i - lo);
    };
    fn.duration = duration;
    return (curves[name] = fn);
  }

  window.motion = { clock, spring, feels, curve };
})();
