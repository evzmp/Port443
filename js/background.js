// port 443 — animated background (WebGL)
//
// Two passes:
//   1. Fluid: domain-warped fractal noise mapped onto a cool datacenter
//      palette, rendered into a small offscreen texture.
//   2. Display: either shows the fluid directly, or (MOSAIC) blends it with a
//      grid of blinking LED dots — like a server-rack panel — where each dot
//      takes its color and brightness from the fluid underneath it.
// If WebGL is unavailable, the CSS gradient on <html> is shown instead.

(function () {
  const canvas = document.getElementById("bg");
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) {
    canvas.remove();
    return;
  }

  // true = LED mosaic, false = plain fluid
  const MOSAIC = true;
  // Mosaic: size of one LED cell in CSS pixels
  const CELL = 16;
  // Mosaic: how strongly the fluid shows through beneath the LEDs
  // (0 = LEDs on black, 1 = full-strength fluid under the LEDs)
  const FLUID_MIX = 0.6;
  // Fluid render resolution as a fraction of the CSS pixel size
  // (1 = full, crisp; lower = softer but cheaper).
  const RESOLUTION = 0.5;
  // Fluid flow speed
  const SPEED = 0.06;

  const vertexSrc = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const common = `
    precision highp float;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
  `;

  // Pass 1: fluid. Writes the color to rgb and its brightness to alpha.
  const fluidSrc = common + `
    uniform vec2 uRes;
    uniform float uTime;

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
      for (int i = 0; i < 3; i++) {
        v += a * noise(p);
        p = rot * p * 2.0 + 3.1;
        a *= 0.5;
      }
      return v;
    }

    // Cool, metallic datacenter ramp: navy -> indigo -> steel blue -> ice
    vec3 ramp(float t) {
      vec3 c0 = vec3(0.027, 0.039, 0.094); // #070a18 near-black navy
      vec3 c1 = vec3(0.071, 0.094, 0.216); // #121837 deep navy
      vec3 c2 = vec3(0.176, 0.169, 0.392); // #2d2b64 indigo
      vec3 c3 = vec3(0.216, 0.302, 0.573); // #374d92 steel blue
      vec3 c4 = vec3(0.337, 0.494, 0.749); // #567ebf cool blue
      vec3 c5 = vec3(0.627, 0.749, 0.878); // #a0bfe0 icy metallic highlight
      t = clamp(t, 0.0, 1.0);
      vec3 c = mix(c0, c1, smoothstep(0.00, 0.22, t));
      c = mix(c, c2, smoothstep(0.22, 0.42, t));
      c = mix(c, c3, smoothstep(0.42, 0.60, t));
      c = mix(c, c4, smoothstep(0.60, 0.82, t));
      c = mix(c, c5, smoothstep(0.82, 1.00, t));
      return c;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      float aspect = uRes.x / uRes.y;
      vec2 p = vec2(uv.x * aspect, uv.y) * 0.75;
      float t = uTime;

      // Two levels of domain warping give the slow, liquid folding motion
      vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.8));
      vec2 r = vec2(fbm(p + 2.0 * q + vec2(1.7, 9.2) + t * 0.6),
                    fbm(p + 2.0 * q + vec2(8.3, 2.8) - t * 0.5));
      float f = fbm(p + 1.8 * r);

      // Brightness comes only from the flowing noise (no top/bottom gradient),
      // so light and dark patches appear evenly across the whole viewport.
      // FBM_MEAN centers the noise so contrast doesn't shift overall brightness.
      const float FBM_MEAN = 0.4375; // 0.5 * (0.5 + 0.25 + 0.125)
      float v = 0.55 + (f - FBM_MEAN) * 2.0 + (r.x - FBM_MEAN) * 0.5;

      // Fine wisps carried along by the same flow, for crisper detail
      float detail = fbm(p * 6.0 + 3.0 * r + vec2(t * 1.5, -t));
      v += (detail - FBM_MEAN) * 0.45;

      vec3 col = ramp(v);

      // Violet haze drifting in patches anywhere on screen
      col = mix(col, vec3(0.24, 0.18, 0.46), smoothstep(0.42, 0.68, r.y) * 0.45);

      // Muted crimson/salmon accent drifting through (status-LED glow)
      float accent = smoothstep(0.62, 0.8, fbm(p * 1.3 + 2.5 * q + vec2(t * 0.7, -t * 0.4)));
      col = mix(col, vec3(0.62, 0.20, 0.34), accent * 0.4);

      // Metallic grade: slight desaturation and lifted blacks
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(luma), 0.15);
      col = col * 0.9 + vec3(0.03, 0.035, 0.055);

      gl_FragColor = vec4(col, clamp(v, 0.0, 1.0));
    }
  `;

  // Pass 2a: show the fluid texture as-is (plain fluid mode)
  const plainSrc = common + `
    uniform sampler2D uFluid;
    uniform vec2 uRes;

    void main() {
      vec3 col = texture2D(uFluid, gl_FragCoord.xy / uRes).rgb;
      col += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // dither against banding
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // Pass 2b: LED mosaic
  const mosaicSrc = common + `
    uniform sampler2D uFluid;
    uniform vec2 uRes;    // canvas size in pixels
    uniform float uCell;  // cell size in canvas pixels
    uniform float uClock; // real time in seconds (for blinking)

    const float FLUID_MIX = ${FLUID_MIX.toFixed(3)};

    // Soft round dot of radius R at distance d
    float dotMask(float d, float R) {
      return smoothstep(R + 1.8, R - 1.4, d);
    }

    void main() {
      vec2 px = gl_FragCoord.xy;
      vec2 cell = floor(px / uCell);
      vec2 local = (fract(px / uCell) - 0.5) * uCell; // offset from dot center

      // Fluid at this dot's center (drives the LED), and at this pixel
      // (the smooth fluid layer blended underneath)
      vec4 fl = texture2D(uFluid, (cell + 0.5) * uCell / uRes);
      vec3 fluid = texture2D(uFluid, px / uRes).rgb;

      // Which LEDs are lit: rectangular clusters that reshuffle now and then,
      // with some holes, and a share of dots flickering like activity lights
      vec2 block = floor(cell / vec2(4.0, 3.0));
      float hb = hash(block + 0.37);
      float blockOn = step(0.45, hash(block + floor(uClock * 0.12 + hb * 10.0)));
      float pattern = step(0.3, hash(cell + 0.71));
      float hc = hash(cell + 2.2);
      float phase = fract(hash(cell + 7.7) * 13.0 + uClock * mix(0.225, 1.3125, hc)); // blinks per second
      float flicker = hc < 0.35 ? smoothstep(0.0, 0.04, phase) * smoothstep(0.62, 0.56, phase) : 1.0;
      float on = blockOn * pattern * flicker;

      // Brightness follows the fluid; unlit LEDs stay faintly visible
      float level = smoothstep(0.25, 0.95, fl.a);
      float I = 0.035 + on * mix(0.2, 1.0, level);

      // LED color: mostly blue, some violet and red/pink, tinted by the fluid
      float hue = hash(cell + 5.5);
      vec3 led = hue < 0.16 ? vec3(1.0, 0.28, 0.42)
               : hue < 0.36 ? vec3(0.62, 0.38, 1.0)
               : vec3(0.35, 0.48, 1.0);
      vec3 tint = fl.rgb / max(max(fl.r, fl.g), max(fl.b, 0.001));
      led = mix(led, tint, 0.35);

      // Chromatic aberration: red and blue channels slightly offset
      float R = uCell * 0.22;
      float ca = uCell * 0.1;
      vec3 m = vec3(dotMask(length(local + vec2(ca, 0.0)), R),
                    dotMask(length(local), R),
                    dotMask(length(local - vec2(ca, 0.0)), R));

      // Soft bloom around each dot
      float halo = exp(-dot(local, local) / (R * R * 7.0));

      vec3 col = led * m * I * 1.6          // the dot
               + m * I * I * 0.6            // hot, whiter core on bright dots
               + led * halo * I * 0.5       // bloom
               + fluid * FLUID_MIX;         // the fluid itself, blended underneath

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // Setup -----------------------------------------------------------------

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };

  const link = (fragSrc) => {
    const vs = compile(gl.VERTEX_SHADER, vertexSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  };

  const fluidProg = link(fluidSrc);
  const displayProg = link(MOSAIC ? mosaicSrc : plainSrc);
  if (!fluidProg || !displayProg) {
    canvas.remove();
    return;
  }

  // Full-screen triangle, shared by both programs
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const bindQuad = (prog) => {
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  };

  const u = (prog, name) => gl.getUniformLocation(prog, name);
  const fluidU = { res: u(fluidProg, "uRes"), time: u(fluidProg, "uTime") };
  const displayU = {
    fluid: u(displayProg, "uFluid"),
    res: u(displayProg, "uRes"),
    cell: u(displayProg, "uCell"),
    clock: u(displayProg, "uClock"),
  };

  // Offscreen fluid texture + framebuffer
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();

  let fw = 1, fh = 1; // fluid texture size
  let cw = 1, ch = 1; // canvas size

  const resize = () => {
    cw = Math.max(1, Math.floor(window.innerWidth));
    ch = Math.max(1, Math.floor(window.innerHeight));
    fw = Math.max(1, Math.floor(cw * RESOLUTION));
    fh = Math.max(1, Math.floor(ch * RESOLUTION));
    canvas.width = cw;
    canvas.height = ch;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  window.addEventListener("resize", resize);
  resize();

  // Render loop -------------------------------------------------------------

  const start = performance.now();
  const frame = (now) => {
    const seconds = (now - start) / 1000;

    // Pass 1: fluid -> texture
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, fw, fh);
    gl.useProgram(fluidProg);
    bindQuad(fluidProg);
    gl.uniform2f(fluidU.res, fw, fh);
    gl.uniform1f(fluidU.time, seconds * SPEED + 10.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass 2: texture -> screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(displayProg);
    bindQuad(displayProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(displayU.fluid, 0);
    gl.uniform2f(displayU.res, cw, ch);
    gl.uniform1f(displayU.cell, CELL);
    gl.uniform1f(displayU.clock, seconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();
