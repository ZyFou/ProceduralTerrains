/** Browser-only smoke test of the actual camera GLSL (no Three.js mock). */
export function runCameraShaderSmoke(source, spatialGLSL) {
  const match = source.match(/const CAMERA_FRAGMENT = \/\* glsl \*\/ `([\s\S]*?)`;/);
  if (!match) throw new Error('Camera shader source not found');
  const fragment = match[1].replace('${SPATIAL_UPSCALE_GLSL}', spatialGLSL);
  let compiled = 0, rendered = 0;
  const contexts = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  for (const backend of ['webgl', 'webgl2']) {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
    const gl = canvas.getContext(backend, { alpha: false, antialias: false });
    check(gl, `${backend} unavailable`); contexts.push(backend);
    const vertex = backend === 'webgl2'
      ? '#version 300 es\nin vec2 position; out vec2 vUv; void main(){vUv=position*0.5+0.5;gl_Position=vec4(position,0.,1.);}'
      : 'attribute vec2 position; varying vec2 vUv; void main(){vUv=position*0.5+0.5;gl_Position=vec4(position,0.,1.);}';
    const shader = (type, text) => {
      const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s);
      check(gl.getShaderParameter(s, gl.COMPILE_STATUS), gl.getShaderInfoLog(s)); return s;
    };
    const vs = shader(gl.VERTEX_SHADER, vertex);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const constant = new Uint8Array(8 * 6 * 4), pattern = new Uint8Array(constant.length);
    for (let i = 0; i < 48; i++) {
      constant.set([80, 120, 160, 255], i * 4);
      const v = 64 + ((i * 31 + Math.floor(i / 8) * 17) % 129);
      pattern.set([v, v, v, 255], i * 4);
    }
    let linear, zero, sharpened;
    for (const mode of [0, 1, 2, 3]) {
      for (let effects = 0; effects < 8; effects++) {
        const defs = {
          USE_PIXELATED: +(mode === 2), USE_CLEAN_RECONSTRUCTION: +(mode === 1),
          USE_SPATIAL_RECONSTRUCTION: +(mode === 3),
          USE_DITHERING: +(!!(effects & 1)), USE_CRT: +(!!(effects & 2)), USE_CHROMATIC: +(!!(effects & 4)),
        };
        const prefix = backend === 'webgl2'
          ? '#version 300 es\nprecision highp float;\n#define varying in\n#define texture2D texture\nout vec4 outColor;\n#define gl_FragColor outColor\n' : '';
        const fs = shader(gl.FRAGMENT_SHADER, prefix + Object.entries(defs).map(([k,v]) => `#define ${k} ${v}\n`).join('') + fragment);
        const program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
        check(gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program)); compiled++;
        gl.useProgram(program);
        const pos = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1i(gl.getUniformLocation(program, 'tDiffuse'), 0);
        gl.uniform2f(gl.getUniformLocation(program, 'uSourceSize'), 8, 6);
        gl.uniform2f(gl.getUniformLocation(program, 'uOutputSize'), 32, 24);
        const set = (name, value) => gl.uniform1f(gl.getUniformLocation(program, name), value);
        set('uReconstructionMode', mode); set('uDitherLevels', 8); set('uDitherScale', 2); set('uCrtLineWidth', 2);
        const draw = (pixels, sharpness) => {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 8, 6, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          set('uSpatialSharpness', sharpness); gl.viewport(0, 0, 32, 24); gl.drawArrays(gl.TRIANGLES, 0, 3);
          const out = new Uint8Array(32 * 24 * 4); gl.readPixels(0, 0, 32, 24, gl.RGBA, gl.UNSIGNED_BYTE, out);
          check(gl.getError() === gl.NO_ERROR, `${backend}: GL error`); rendered++; return out;
        };
        const out = draw(constant, 1);
        // Effects are structurally compiled but zero-strength for this invariant.
        for (let i = 0; i < out.length; i++) check(Math.abs(out[i] - [80,120,160,255][i % 4]) <= 1, `${backend}: constant colour changed (mode ${mode})`);
        if (effects === 0 && (mode === 0 || mode === 3)) {
          const image = draw(pattern, 0);
          if (mode === 0) linear = image; else {
            zero = image; sharpened = draw(pattern, 1);
            for (let i = 0; i < sharpened.length; i++) {
              check(i % 4 === 3 ? sharpened[i] === 255 : sharpened[i] >= 63 && sharpened[i] <= 193, 'Spatial result exceeds source colour range');
            }
          }
        }
        gl.deleteProgram(program); gl.deleteShader(fs);
      }
    }
    check(linear.every((value, i) => Math.abs(value - zero[i]) <= 1), 'Zero sharpness must match bilinear');
    check(sharpened.some((value, i) => Math.abs(value - linear[i]) > 1), 'Sharpness has no visible effect');
    gl.deleteShader(vs); gl.deleteBuffer(buffer); gl.deleteTexture(texture);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return { contexts, compiledPrograms: compiled, renderedFrames: rendered, status: 'passed' };
}
