/**
 * Utilities for translating Cesium GLSL shader source code to WGSL
 * (WebGPU Shading Language).
 *
 * <p>
 * Full GLSL-to-WGSL transpilation is a complex problem. This module handles
 * the subset of GLSL patterns used by Cesium's built-in shaders:
 * </p>
 * <ul>
 *   <li>Type mappings (vec2/vec3/vec4, mat4, sampler2D, …)</li>
 *   <li>Built-in variable renames (gl_Position, gl_FragCoord, out_FragColor, …)</li>
 *   <li>Automatic Cesium uniforms (czm_projection, czm_modelView, …) mapped to
 *       a single WGSL uniform struct in bind group 0, binding 0</li>
 *   <li>User uniforms mapped to a WGSL uniform struct in bind group 0, binding 1</li>
 *   <li>Texture sampler patterns</li>
 *   <li>Precision qualifiers (removed – not used in WGSL)</li>
 *   <li>Fragment depth writes</li>
 * </ul>
 *
 * <p>
 * WGSL conventions used by this module:
 * </p>
 * <ul>
 *   <li>Vertex stage entry point: <code>vertexMain</code></li>
 *   <li>Fragment stage entry point: <code>fragmentMain</code></li>
 *   <li>Bind group 0, binding 0: <code>CzmUniforms</code> struct (automatic uniforms)</li>
 *   <li>Bind group 0, binding 1: <code>UserUniforms</code> struct (manual/custom uniforms)</li>
 *   <li>Textures: bind group 1</li>
 *   <li>Varyings passed via an inter-stage struct named <code>VertexOutput</code></li>
 * </ul>
 *
 * @module GlslToWgsl
 * @private
 */

/**
 * GLSL scalar / vector / matrix type → WGSL type.
 *
 * @type {Record<string, string>}
 */
const GLSL_TYPE_TO_WGSL = {
  void: "void",
  bool: "bool",
  int: "i32",
  uint: "u32",
  float: "f32",
  double: "f64",
  bvec2: "vec2<bool>",
  bvec3: "vec3<bool>",
  bvec4: "vec4<bool>",
  ivec2: "vec2<i32>",
  ivec3: "vec3<i32>",
  ivec4: "vec4<i32>",
  uvec2: "vec2<u32>",
  uvec3: "vec3<u32>",
  uvec4: "vec4<u32>",
  vec2: "vec2f",
  vec3: "vec3f",
  vec4: "vec4f",
  mat2: "mat2x2f",
  mat3: "mat3x3f",
  mat4: "mat4x4f",
  sampler2D: "texture_2d<f32>",
  samplerCube: "texture_cube<f32>",
  sampler2DArray: "texture_2d_array<f32>",
  sampler3D: "texture_3d<f32>",
  sampler2DShadow: "texture_depth_2d",
};

/**
 * Cesium automatic uniform names and their WGSL type and struct field name.
 * These map to members of the <code>CzmUniforms</code> struct.
 *
 * @type {Array<{glsl: string, wgsl: string, type: string}>}
 */
const CZM_AUTO_UNIFORMS = [
  { glsl: "czm_viewport", wgsl: "viewport", type: "vec4f" },
  {
    glsl: "czm_viewportOrthographic",
    wgsl: "viewportOrthographic",
    type: "mat4x4f",
  },
  {
    glsl: "czm_viewportTransformation",
    wgsl: "viewportTransformation",
    type: "mat4x4f",
  },
  { glsl: "czm_projection", wgsl: "projection", type: "mat4x4f" },
  {
    glsl: "czm_infiniteProjection",
    wgsl: "infiniteProjection",
    type: "mat4x4f",
  },
  { glsl: "czm_inverseProjection", wgsl: "inverseProjection", type: "mat4x4f" },
  { glsl: "czm_view", wgsl: "view", type: "mat4x4f" },
  { glsl: "czm_view3D", wgsl: "view3D", type: "mat4x4f" },
  { glsl: "czm_inverseView", wgsl: "inverseView", type: "mat4x4f" },
  { glsl: "czm_inverseView3D", wgsl: "inverseView3D", type: "mat4x4f" },
  { glsl: "czm_viewRotation", wgsl: "viewRotation", type: "mat3x3f" },
  { glsl: "czm_viewRotation3D", wgsl: "viewRotation3D", type: "mat3x3f" },
  {
    glsl: "czm_inverseViewRotation",
    wgsl: "inverseViewRotation",
    type: "mat3x3f",
  },
  {
    glsl: "czm_inverseViewRotation3D",
    wgsl: "inverseViewRotation3D",
    type: "mat3x3f",
  },
  { glsl: "czm_viewProjection", wgsl: "viewProjection", type: "mat4x4f" },
  {
    glsl: "czm_inverseViewProjection",
    wgsl: "inverseViewProjection",
    type: "mat4x4f",
  },
  { glsl: "czm_model", wgsl: "model", type: "mat4x4f" },
  { glsl: "czm_inverseModel", wgsl: "inverseModel", type: "mat4x4f" },
  { glsl: "czm_modelView", wgsl: "modelView", type: "mat4x4f" },
  { glsl: "czm_modelView3D", wgsl: "modelView3D", type: "mat4x4f" },
  {
    glsl: "czm_modelViewRelativeToEye",
    wgsl: "modelViewRelativeToEye",
    type: "mat4x4f",
  },
  { glsl: "czm_inverseModelView", wgsl: "inverseModelView", type: "mat4x4f" },
  {
    glsl: "czm_inverseModelView3D",
    wgsl: "inverseModelView3D",
    type: "mat4x4f",
  },
  {
    glsl: "czm_modelViewProjection",
    wgsl: "modelViewProjection",
    type: "mat4x4f",
  },
  {
    glsl: "czm_modelViewProjectionRelativeToEye",
    wgsl: "modelViewProjectionRelativeToEye",
    type: "mat4x4f",
  },
  {
    glsl: "czm_modelViewInfiniteProjection",
    wgsl: "modelViewInfiniteProjection",
    type: "mat4x4f",
  },
  {
    glsl: "czm_inverseModelViewProjection",
    wgsl: "inverseModelViewProjection",
    type: "mat4x4f",
  },
  { glsl: "czm_normal", wgsl: "normal", type: "mat3x3f" },
  { glsl: "czm_normal3D", wgsl: "normal3D", type: "mat3x3f" },
  { glsl: "czm_inverseNormal", wgsl: "inverseNormal", type: "mat3x3f" },
  { glsl: "czm_inverseNormal3D", wgsl: "inverseNormal3D", type: "mat3x3f" },
  { glsl: "czm_eyeHeight", wgsl: "eyeHeight", type: "f32" },
  { glsl: "czm_eyeHeight2D", wgsl: "eyeHeight2D", type: "vec2f" },
  {
    glsl: "czm_eyeEllipsoidNormalEC",
    wgsl: "eyeEllipsoidNormalEC",
    type: "vec3f",
  },
  {
    glsl: "czm_eyeEllipsoidCurvature",
    wgsl: "eyeEllipsoidCurvature",
    type: "vec2f",
  },
  { glsl: "czm_orthographicIn3D", wgsl: "orthographicIn3D", type: "f32" },
  { glsl: "czm_frameNumber", wgsl: "frameNumber", type: "f32" },
  { glsl: "czm_morphTime", wgsl: "morphTime", type: "f32" },
  { glsl: "czm_temeToPseudoFixed", wgsl: "temeToPseudoFixed", type: "mat3x3f" },
  { glsl: "czm_sunDirectionEC", wgsl: "sunDirectionEC", type: "vec3f" },
  { glsl: "czm_sunDirectionWC", wgsl: "sunDirectionWC", type: "vec3f" },
  { glsl: "czm_moonDirectionEC", wgsl: "moonDirectionEC", type: "vec3f" },
  { glsl: "czm_lightColor", wgsl: "lightColor", type: "vec3f" },
  { glsl: "czm_lightDirectionEC", wgsl: "lightDirectionEC", type: "vec3f" },
  { glsl: "czm_lightDirectionWC", wgsl: "lightDirectionWC", type: "vec3f" },
  {
    glsl: "czm_atmosphereScatteringIntensity",
    wgsl: "atmosphereScatteringIntensity",
    type: "f32",
  },
  { glsl: "czm_atmosHsbShift", wgsl: "atmosHsbShift", type: "vec3f" },
  { glsl: "czm_atmosFogDensity", wgsl: "atmosFogDensity", type: "f32" },
  { glsl: "czm_pass", wgsl: "pass", type: "f32" },
];

// Build a fast lookup map
const CZM_AUTO_UNIFORM_MAP = {};
for (const u of CZM_AUTO_UNIFORMS) {
  CZM_AUTO_UNIFORM_MAP[u.glsl] = u;
}

/**
 * The WGSL declaration for the automatic uniform block (bind group 0, binding 0).
 * All Cesium automatic uniform matrices / vectors live here.
 */
const CZM_UNIFORM_STRUCT_WGSL = (() => {
  const fields = CZM_AUTO_UNIFORMS.map((u) => `  ${u.wgsl} : ${u.type},`).join(
    "\n",
  );
  return (
    `struct CzmUniforms {\n${fields}\n};\n` +
    `@group(0) @binding(0) var<uniform> czm : CzmUniforms;\n`
  );
})();

/**
 * Removes GLSL preprocessor directives, #version, #extension, and comment lines.
 *
 * @param {string} glsl
 * @returns {string}
 */
function stripGlslPreprocessor(glsl) {
  return glsl
    .replace(/^\s*#version\s+.*$/gm, "")
    .replace(/^\s*#extension\s+.*$/gm, "")
    .replace(/^\s*#line\s+.*$/gm, "")
    .replace(/^\s*#pragma\s+.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "") // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
}

/**
 * Replaces GLSL precision qualifiers which do not exist in WGSL.
 *
 * @param {string} src
 * @returns {string}
 */
function removePrecisionQualifiers(src) {
  return src.replace(/\b(highp|mediump|lowp)\s+/g, "");
}

/**
 * Replaces GLSL type names with their WGSL equivalents throughout `src`.
 *
 * @param {string} src
 * @returns {string}
 */
function replaceTypes(src) {
  // Replace in reverse length order to avoid partial replacements
  const types = Object.keys(GLSL_TYPE_TO_WGSL).sort(
    (a, b) => b.length - a.length,
  );
  for (const glslType of types) {
    const wgslType = GLSL_TYPE_TO_WGSL[glslType];
    // Only replace whole words
    src = src.replace(new RegExp(`\\b${glslType}\\b`, "g"), wgslType);
  }
  return src;
}

/**
 * Parses `uniform TYPE NAME;` declarations from GLSL source.
 * Returns arrays of czm automatic uniforms found and user uniforms.
 *
 * @param {string} src Original GLSL source (before type replacement).
 * @returns {{ czmUniforms: string[], userUniforms: Array<{name:string,type:string}>, textureUniforms: Array<{name:string,type:string}> }}
 */
function parseUniforms(src) {
  const czmUniforms = [];
  const userUniforms = [];
  const textureUniforms = [];

  // Match: uniform <type> <name>([])?;
  const uniformRe =
    /\buniform\s+((?:sampler\w+|[a-zA-Z_]\w*))\s+([a-zA-Z_]\w*)\s*(\[\d+\])?\s*;/g;
  let m;
  while ((m = uniformRe.exec(src)) !== null) {
    const glslType = m[1];
    const name = m[2];

    if (name.startsWith("czm_")) {
      czmUniforms.push(name);
    } else if (
      glslType === "sampler2D" ||
      glslType === "samplerCube" ||
      glslType === "sampler2DArray" ||
      glslType === "sampler3D" ||
      glslType === "sampler2DShadow"
    ) {
      textureUniforms.push({ name, type: glslType });
    } else {
      userUniforms.push({ name, type: glslType });
    }
  }

  return { czmUniforms, userUniforms, textureUniforms };
}

/**
 * Parses `in TYPE NAME;` / `out TYPE NAME;` declarations (for varyings).
 *
 * @param {string} src
 * @param {string} qualifier  `"in"` or `"out"`
 * @returns {Array<{name:string,type:string}>}
 */
function parseIODeclarations(src, qualifier) {
  const result = [];
  // Match: [layout(...)] in|out TYPE NAME;
  const re = new RegExp(
    `(?:layout\\s*\\([^)]*\\)\\s*)?\\b${qualifier}\\s+(\\w+)\\s+(\\w+)\\s*;`,
    "g",
  );
  let m;
  while ((m = re.exec(src)) !== null) {
    result.push({ type: m[1], name: m[2] });
  }
  return result;
}

/**
 * Removes all `uniform`, `in`, `out` declarations from `src`
 * (they will be replaced with WGSL equivalents).
 *
 * @param {string} src
 * @returns {string}
 */
function removeDeclarations(src) {
  return src
    .replace(
      /\b(?:layout\s*\([^)]*\)\s*)?uniform\s+\S+\s+\w+\s*(?:\[\d+\])?\s*;/g,
      "",
    )
    .replace(/\b(?:layout\s*\([^)]*\)\s*)?(?:in|out)\s+\S+\s+\w+\s*;/g, "");
}

/**
 * Replaces GLSL built-in variables with their WGSL counterparts:
 * - `gl_Position`  → `output.position`
 * - `gl_FragCoord` → `input.position`
 * - `out_FragColor` / `gl_FragColor` → `output.color`
 * - `gl_FragDepth`  → `output.depth`
 *
 * @param {string} src
 * @param {boolean} isVertex
 * @returns {string}
 */
function replaceBuiltins(src, isVertex) {
  if (isVertex) {
    src = src.replace(/\bgl_Position\b/g, "output.position");
    src = src.replace(
      /\bgl_PointSize\b/g,
      "/* gl_PointSize unsupported in WebGPU */1.0",
    );
  } else {
    src = src.replace(/\bgl_FragCoord\b/g, "input.position");
    src = src.replace(/\bout_FragColor\b/g, "output.color");
    src = src.replace(/\bgl_FragColor\b/g, "output.color");
    src = src.replace(/\bgl_FragDepth\b/g, "output.depth");
    // czm_writeLogDepth / czm_vertexLogDepth are no-ops for now
    src = src.replace(
      /\bczm_writeLogDepth\s*\(\s*\)\s*;/g,
      "/* czm_writeLogDepth - not implemented */",
    );
    src = src.replace(
      /\bczm_vertexLogDepth\s*\(\s*\)\s*;/g,
      "/* czm_vertexLogDepth - not implemented */",
    );
  }
  return src;
}

/**
 * Replaces `czm_<name>` references in WGSL body with `czm.<field>`.
 *
 * @param {string} src
 * @returns {string}
 */
function replaceCzmAutoUniforms(src) {
  // Replace longest names first to avoid partial replacements
  const sorted = [...CZM_AUTO_UNIFORMS].sort(
    (a, b) => b.glsl.length - a.glsl.length,
  );
  for (const u of sorted) {
    src = src.replace(new RegExp(`\\b${u.glsl}\\b`, "g"), `czm.${u.wgsl}`);
  }
  return src;
}

/**
 * Replaces GLSL `texture(sampler, coord)` calls with WGSL
 * `textureSample(texture, sampler_name, coord)`.
 *
 * @param {string} src
 * @param {string[]} textureNames Names of texture uniforms.
 * @returns {string}
 */
function replaceTextureCalls(src, textureNames) {
  // texture(u_myTex, coord) → textureSample(u_myTex, u_myTex_sampler, coord)
  for (const name of textureNames) {
    const re = new RegExp(`\\btexture\\s*\\(\\s*${name}\\s*,\\s*`, "g");
    src = src.replace(re, `textureSample(${name}, ${name}_sampler, `);
    // texture2D (GLSL 1) variant
    const re2 = new RegExp(`\\btexture2D\\s*\\(\\s*${name}\\s*,\\s*`, "g");
    src = src.replace(re2, `textureSample(${name}, ${name}_sampler, `);
  }
  // Generic fallback for remaining texture()/texture2D() calls
  src = src.replace(/\btexture2D\s*\(/g, "textureSample(");
  return src;
}

/**
 * Replaces GLSL `discard` with WGSL `discard;` inside a fragment function
 * (same syntax, but needs to be inside a function that returns void or uses
 * out struct; this is fine as-is).
 *
 * @param {string} src
 * @returns {string}
 */
function fixDiscard(src) {
  // In WGSL, `discard` is the same keyword; no change needed
  return src;
}

/**
 * Replaces GLSL `mix(a, b, t)` calls. WGSL uses `mix` too, so no change.
 * Handles `mod(a, b)` → `(a % b)` for float types.
 *
 * @param {string} src
 * @returns {string}
 */
function fixBuiltinFunctions(src) {
  // `fract`, `abs`, `min`, `max`, `clamp`, `sign` — same names in WGSL, no change needed.
  // `atan(y, x)` → `atan2(y, x)` in WGSL
  src = src.replace(/\batan\s*\(([^,)]+),\s*([^)]+)\)/g, "atan2($1, $2)");
  // `mod(a, b)` → `(a - b * floor(a/b))` or use WGSL's `a % b`
  src = src.replace(/\bmod\s*\(([^,)]+),\s*([^)]+)\)/g, "($1 % $2)");
  // `dFdx` → `dpdx`, `dFdy` → `dpdy`, `fwidth` stays
  src = src.replace(/\bdFdx\b/g, "dpdx");
  src = src.replace(/\bdFdy\b/g, "dpdy");
  // `inversesqrt` → WGSL `inverseSqrt`
  src = src.replace(/\binversesqrt\b/g, "inverseSqrt");
  // `matrixCompMult` → `hadamard` product; approximate with per-component
  // WGSL doesn't have matrixCompMult, but it's rarely used in Cesium
  return src;
}

/**
 * Wraps the GLSL `void main()` body into a proper WGSL entry-point function.
 *
 * For vertex shaders:
 * ```wgsl
 * @vertex
 * fn vertexMain(input: VertexInput) -> VertexOutput {
 *   var output: VertexOutput;
 *   // ... translated body ...
 *   return output;
 * }
 * ```
 *
 * For fragment shaders:
 * ```wgsl
 * @fragment
 * fn fragmentMain(input: VertexOutput) -> FragmentOutput {
 *   var output: FragmentOutput;
 *   // ... translated body ...
 *   return output;
 * }
 * ```
 *
 * @param {string} src Source with the `void main() { ... }` block.
 * @param {boolean} isVertex
 * @returns {string}
 */
function wrapMainFunction(src, isVertex) {
  // Extract the body of void main() { ... }
  const mainRe = /\bvoid\s+main\s*\(\s*\)\s*\{/;
  const mainMatch = mainRe.exec(src);
  if (!mainMatch) {
    // No main found, return as-is (helper function mode)
    return src;
  }

  const bodyStart = mainMatch.index + mainMatch[0].length;
  let depth = 1;
  let i = bodyStart;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") {
      depth++;
    } else if (src[i] === "}") {
      depth--;
    }
    i++;
  }
  const body = src.slice(bodyStart, i - 1).trim();
  const before = src.slice(0, mainMatch.index).trim();
  const after = src.slice(i).trim();

  const stageAttr = isVertex ? "@vertex" : "@fragment";
  const fnName = isVertex ? "vertexMain" : "fragmentMain";
  const inputType = isVertex ? "VertexInput" : "VertexOutput";
  const outputType = isVertex ? "VertexOutput" : "FragmentOutput";

  const fn =
    `${stageAttr}\n` +
    `fn ${fnName}(input: ${inputType}) -> ${outputType} {\n` +
    `  var output: ${outputType};\n` +
    `${body
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n")}\n` +
    `  return output;\n` +
    `}`;

  return [before, after, fn].filter(Boolean).join("\n\n");
}

/**
 * Builds the WGSL struct declarations for inter-stage varyings.
 *
 * @param {Array<{name:string,type:string}>} varyings  Parsed varying declarations.
 * @param {boolean} isVertex
 * @returns {string}
 */
function buildVaryingStructs(varyings, isVertex) {
  const wgslVaryings = varyings
    .filter((v) => v.type !== "void")
    .map((v, idx) => {
      const wgslType = GLSL_TYPE_TO_WGSL[v.type] ?? v.type;
      return `  @location(${idx}) ${v.name} : ${wgslType},`;
    })
    .join("\n");

  if (isVertex) {
    // VertexOutput always has position
    const varyingSection = wgslVaryings ? `${wgslVaryings}\n` : "";
    return `struct VertexOutput {\n  @builtin(position) position : vec4f,\n${varyingSection}};\n`;
  }

  const varyingSection = wgslVaryings ? `${wgslVaryings}\n` : "";
  return [
    `struct VertexOutput {\n  @builtin(position) position : vec4f,\n${varyingSection}};`,
    `struct FragmentOutput {\n  @location(0) color : vec4f,\n};`,
  ].join("\n");
}

/**
 * Builds the WGSL <code>UserUniforms</code> uniform buffer struct
 * and its bind group declaration.
 *
 * @param {Array<{name:string,type:string}>} uniforms
 * @returns {string}
 */
function buildUserUniformStruct(uniforms) {
  if (uniforms.length === 0) {
    return "";
  }
  const fields = uniforms
    .map((u) => {
      const wgslType = GLSL_TYPE_TO_WGSL[u.type] ?? u.type;
      return `  ${u.name} : ${wgslType},`;
    })
    .join("\n");
  return `struct UserUniforms {\n${fields}\n};\n@group(0) @binding(1) var<uniform> user : UserUniforms;\n`;
}

/**
 * Builds WGSL texture + sampler declarations for a list of texture uniforms.
 *
 * @param {Array<{name:string,type:string}>} textureUniforms
 * @param {number} [bindingStart=0] Starting binding index within group 1.
 * @returns {string}
 */
function buildTextureDeclarations(textureUniforms, bindingStart) {
  if (textureUniforms.length === 0) {
    return "";
  }
  const start = bindingStart ?? 0;
  return textureUniforms
    .map((t, i) => {
      const wgslType = GLSL_TYPE_TO_WGSL[t.type] ?? "texture_2d<f32>";
      const texBinding = start + i * 2;
      const samplerBinding = texBinding + 1;
      return (
        `@group(1) @binding(${texBinding}) var ${t.name} : ${wgslType};\n` +
        `@group(1) @binding(${samplerBinding}) var ${t.name}_sampler : sampler;`
      );
    })
    .join("\n");
}

/**
 * Replaces user uniform accesses `u_myUniform` with `user.u_myUniform`
 * so they reference the UserUniforms struct.
 *
 * @param {string} src
 * @param {Array<{name:string}>} userUniforms
 * @returns {string}
 */
function prefixUserUniforms(src, userUniforms) {
  for (const u of userUniforms) {
    src = src.replace(new RegExp(`\\b${u.name}\\b`, "g"), `user.${u.name}`);
  }
  return src;
}

/**
 * Translates a GLSL vertex shader source string to WGSL.
 *
 * <p>
 * The translation is best-effort. Cesium-specific built-in functions
 * (<code>czm_</code> prefix) must be provided as WGSL helper functions
 * separately; this function only translates the main shader body and
 * handles declarations, types, built-ins, and uniforms.
 * </p>
 *
 * @param {string} glslSource The GLSL vertex shader source.
 * @param {object} [options] Options.
 * @param {string[]} [options.attributeNames] Ordered list of vertex attribute names.
 *   Used to build the WGSL <code>VertexInput</code> struct. If not provided,
 *   attributes are inferred from <code>in</code> declarations.
 * @param {Array<{name:string,type:string}>} [options.attributes] Explicit attribute
 *   descriptors with name and GLSL type.
 * @returns {string} WGSL vertex shader source.
 */
function glslVertexToWgsl(glslSource, options) {
  options = options ?? {};

  // 1. Strip preprocessor directives
  let src = stripGlslPreprocessor(glslSource);

  // 2. Parse declarations before type replacement
  const { userUniforms, textureUniforms } = parseUniforms(src);
  const varyings = parseIODeclarations(src, "out");
  const attributes =
    options.attributes ??
    parseIODeclarations(src, "in").map((a) => ({
      name: a.name,
      type: a.type,
    }));

  // 3. Remove GLSL declarations
  src = removeDeclarations(src);
  src = removePrecisionQualifiers(src);

  // 4. Replace types
  src = replaceTypes(src);

  // 5. Replace built-ins
  src = replaceBuiltins(src, true);

  // 6. Replace czm_ uniform references
  src = replaceCzmAutoUniforms(src);

  // 7. Replace texture calls
  const textureNames = textureUniforms.map((t) => t.name);
  src = replaceTextureCalls(src, textureNames);
  src = fixBuiltinFunctions(src);

  // 8. Prefix user uniform accesses
  src = prefixUserUniforms(src, userUniforms);

  // 9. Wrap main()
  src = wrapMainFunction(src, true);

  // 10. Build VertexInput struct from attributes
  const attrFields = attributes
    .map((a, i) => {
      const wgslType = GLSL_TYPE_TO_WGSL[a.type] ?? a.type;
      return `  @location(${i}) ${a.name} : ${wgslType},`;
    })
    .join("\n");
  const vertexInputStruct = attrFields
    ? `struct VertexInput {\n${attrFields}\n};\n`
    : `struct VertexInput {\n  @builtin(vertex_index) vertexIndex : u32,\n};\n`;

  // 11. Assemble header
  const header = [
    CZM_UNIFORM_STRUCT_WGSL,
    buildUserUniformStruct(userUniforms),
    buildTextureDeclarations(textureUniforms),
    vertexInputStruct,
    buildVaryingStructs(varyings, true),
  ]
    .filter(Boolean)
    .join("\n");

  return `${header}\n${src}`;
}

/**
 * Translates a GLSL fragment shader source string to WGSL.
 *
 * @param {string} glslSource The GLSL fragment shader source.
 * @param {Array<{name:string,type:string}>} [varyingDefs] Varying definitions
 *   (should match those from the corresponding vertex shader's <code>out</code>
 *   declarations). If omitted, parsed from <code>in</code> declarations.
 * @returns {string} WGSL fragment shader source.
 */
function glslFragmentToWgsl(glslSource, varyingDefs) {
  // 1. Strip preprocessor directives
  let src = stripGlslPreprocessor(glslSource);

  // 2. Parse declarations
  const { userUniforms, textureUniforms } = parseUniforms(src);
  const varyings = varyingDefs ?? parseIODeclarations(src, "in");

  // 3. Remove GLSL declarations
  src = removeDeclarations(src);
  src = removePrecisionQualifiers(src);

  // 4. Replace types
  src = replaceTypes(src);

  // 5. Replace built-ins
  src = replaceBuiltins(src, false);

  // 6. Replace czm_ uniform references
  src = replaceCzmAutoUniforms(src);

  // 7. Replace texture calls
  const textureNames = textureUniforms.map((t) => t.name);
  src = replaceTextureCalls(src, textureNames);
  src = fixDiscard(src);
  src = fixBuiltinFunctions(src);

  // 8. Prefix user uniform accesses
  src = prefixUserUniforms(src, userUniforms);

  // 9. Wrap main()
  src = wrapMainFunction(src, false);

  // 10. Assemble header
  const header = [
    CZM_UNIFORM_STRUCT_WGSL,
    buildUserUniformStruct(userUniforms),
    buildTextureDeclarations(textureUniforms),
    buildVaryingStructs(varyings, false),
  ]
    .filter(Boolean)
    .join("\n");

  return `${header}\n${src}`;
}

/**
 * Translates a pair of GLSL vertex + fragment shaders to WGSL.
 *
 * The varyings declared as <code>out</code> in the vertex shader are
 * automatically used as the <code>in</code> declarations for the fragment shader,
 * ensuring the inter-stage struct is consistent.
 *
 * @param {string} vertexGlsl GLSL vertex shader source.
 * @param {string} fragmentGlsl GLSL fragment shader source.
 * @param {object} [options] Options forwarded to {@link glslVertexToWgsl}.
 * @returns {{ vertexWgsl: string, fragmentWgsl: string }}
 */
function glslPairToWgsl(vertexGlsl, fragmentGlsl, options) {
  // Parse vertex shader varyings to share with fragment shader
  const vertexSrc = stripGlslPreprocessor(vertexGlsl);
  const varyings = parseIODeclarations(vertexSrc, "out");

  const vertexWgsl = glslVertexToWgsl(vertexGlsl, options);
  const fragmentWgsl = glslFragmentToWgsl(fragmentGlsl, varyings);

  return { vertexWgsl, fragmentWgsl };
}

/**
 * Returns the WGSL source for the standard Cesium uniform struct declaration
 * (bind group 0, binding 0). This is the same header prepended to every
 * translated shader; it can be used when writing custom WGSL shaders that
 * need access to Cesium's automatic uniforms.
 *
 * @returns {string}
 */
function getCzmUniformStructWgsl() {
  return CZM_UNIFORM_STRUCT_WGSL;
}

/**
 * Returns the list of all Cesium automatic uniform descriptors.
 *
 * @returns {Array<{glsl:string, wgsl:string, type:string}>}
 */
function getCzmAutoUniforms() {
  return CZM_AUTO_UNIFORMS.slice();
}

/**
 * @type {object}
 * @property {Function} glslVertexToWgsl
 * @property {Function} glslFragmentToWgsl
 * @property {Function} glslPairToWgsl
 * @property {Function} getCzmUniformStructWgsl
 * @property {Function} getCzmAutoUniforms
 * @property {Record<string,string>} GLSL_TYPE_TO_WGSL
 * @property {Record<string,object>} CZM_AUTO_UNIFORM_MAP
 */
const GlslToWgsl = {
  glslVertexToWgsl,
  glslFragmentToWgsl,
  glslPairToWgsl,
  getCzmUniformStructWgsl,
  getCzmAutoUniforms,
  GLSL_TYPE_TO_WGSL,
  CZM_AUTO_UNIFORM_MAP,
};

export {
  glslVertexToWgsl,
  glslFragmentToWgsl,
  glslPairToWgsl,
  getCzmUniformStructWgsl,
  getCzmAutoUniforms,
  GLSL_TYPE_TO_WGSL,
  CZM_AUTO_UNIFORM_MAP,
};

export default GlslToWgsl;
