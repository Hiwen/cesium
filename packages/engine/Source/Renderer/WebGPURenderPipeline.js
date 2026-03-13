import Check from "../Core/Check.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import WebGLConstants from "../Core/WebGLConstants.js";
import { glslPairToWgsl } from "./GlslToWgsl.js";

/**
 * Maps WebGL/Cesium primitive types to WebGPU topology strings.
 *
 * @type {Record<number, string>}
 * @private
 */
const PRIMITIVE_TYPE_TO_WEBGPU = {
  [WebGLConstants.POINTS]: "point-list",
  [WebGLConstants.LINES]: "line-list",
  [WebGLConstants.LINE_STRIP]: "line-strip",
  [WebGLConstants.TRIANGLES]: "triangle-list",
  [WebGLConstants.TRIANGLE_STRIP]: "triangle-strip",
};

/**
 * Maps Cesium/WebGL index data types to WebGPU index format strings.
 *
 * @type {Record<number, string>}
 * @private
 */
const INDEX_DATATYPE_TO_WEBGPU = {
  [WebGLConstants.UNSIGNED_SHORT]: "uint16",
  [WebGLConstants.UNSIGNED_INT]: "uint32",
};

/**
 * Maps Cesium/WebGL vertex attribute component types to WebGPU vertex formats.
 * The key is `<componentType>_<componentCount>`.
 *
 * @type {Record<string, string>}
 * @private
 */
const COMPONENT_FORMAT_TO_WEBGPU = {
  // float
  "5126_1": "float32",
  "5126_2": "float32x2",
  "5126_3": "float32x3",
  "5126_4": "float32x4",
  // byte (normalized)
  "5120_1": "sint8",
  "5120_2": "sint8x2",
  "5120_4": "sint8x4",
  // unsigned byte
  "5121_1": "uint8",
  "5121_2": "uint8x2",
  "5121_4": "uint8x4",
  // short
  "5122_1": "sint16",
  "5122_2": "sint16x2",
  "5122_4": "sint16x4",
  // unsigned short
  "5123_1": "uint16",
  "5123_2": "uint16x2",
  "5123_4": "uint16x4",
  // int
  "5124_1": "sint32",
  "5124_2": "sint32x2",
  "5124_3": "sint32x3",
  "5124_4": "sint32x4",
  // unsigned int
  "5125_1": "uint32",
  "5125_2": "uint32x2",
  "5125_3": "uint32x3",
  "5125_4": "uint32x4",
};

/**
 * Converts a Cesium {@link VertexArray} attribute descriptor to a
 * <code>GPUVertexAttribute</code>.
 *
 * @param {object} attribute A Cesium vertex attribute descriptor.
 * @param {number} shaderLocation The shader location (binding index).
 * @returns {GPUVertexAttribute}
 *
 * @private
 */
function cesiumAttributeToGPU(attribute, shaderLocation) {
  const componentDatatype = attribute.componentDatatype;
  const componentsPerAttribute = attribute.componentsPerAttribute;
  const key = `${componentDatatype}_${componentsPerAttribute}`;
  const format = COMPONENT_FORMAT_TO_WEBGPU[key] ?? "float32x4";
  return {
    format,
    offset: attribute.offsetInBytes ?? 0,
    shaderLocation,
  };
}

/**
 * Executes Cesium {@link DrawCommand}s using the WebGPU rendering pipeline.
 *
 * <p>
 * {@link WebGPURenderPipeline} wraps a <code>GPURenderPassEncoder</code> and
 * provides the logic needed to translate Cesium's WebGL-centric
 * {@link DrawCommand} objects into equivalent WebGPU draw calls.  It handles:
 * </p>
 * <ul>
 *   <li>GLSL-to-WGSL shader transpilation via {@link GlslToWgsl}</li>
 *   <li>Render pipeline creation and caching</li>
 *   <li>Uniform buffer management for Cesium's automatic uniforms</li>
 *   <li>Vertex buffer and index buffer binding</li>
 *   <li>Draw call submission</li>
 * </ul>
 *
 * <p>
 * Usage:
 * </p>
 * <pre>
 * const pipeline = new WebGPURenderPipeline({ webgpuContext });
 *
 * // Begin a frame
 * const encoder = webgpuContext.createCommandEncoder();
 * const passEncoder = pipeline.beginRenderPass(encoder, colorTextureView, depthTextureView);
 *
 * // Execute draw commands
 * for (const command of drawCommands) {
 *   pipeline.executeDrawCommand(passEncoder, command, uniformState);
 * }
 *
 * passEncoder.end();
 * webgpuContext.submitCommandBuffers([encoder.finish()]);
 * </pre>
 *
 * @alias WebGPURenderPipeline
 * @constructor
 *
 * @param {object} options Object with the following properties:
 * @param {WebGPUContext} options.webgpuContext An initialized {@link WebGPUContext}.
 * @param {number} [options.sampleCount=1] MSAA sample count.
 *
 * @private
 */
function WebGPURenderPipeline(options) {
  options = options ?? {};

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.webgpuContext", options.webgpuContext);
  //>>includeEnd('debug');

  const webgpuContext = options.webgpuContext;
  const device = webgpuContext.device;

  this._webgpuContext = webgpuContext;
  this._device = device;
  this._sampleCount = options.sampleCount ?? 1;

  // Pipeline cache: key = shaderProgram id → GPURenderPipeline
  this._pipelineCache = new Map();

  // Uniform buffer for Cesium automatic uniforms (one per frame, updated each draw)
  this._czmUniformBuffer = undefined;
  this._czmUniformData = undefined;
  this._czmBindGroupLayout = undefined;
  this._czmBindGroup = undefined;

  this._initCzmUniformBuffer();
}

/**
 * Calculates the byte size needed for the CzmUniforms struct in std140 layout.
 * In WebGPU uniform buffers, mat4x4f = 64 bytes, vec4f = 16 bytes, etc.
 *
 * @returns {number} Size in bytes.
 * @private
 */
WebGPURenderPipeline.CZM_UNIFORM_BUFFER_SIZE = (function () {
  // 32 mat4x4f = 32 * 64 = 2048 bytes
  // 10 mat3x3f = 10 * 48 = 480 bytes (padded to vec4 rows → 3 * 16 = 48)
  // ~15 vec4f / vec3f / vec2f / f32 uniforms
  // Round up generously to 4096 bytes
  return 4096;
})();

/**
 * @private
 */
WebGPURenderPipeline.prototype._initCzmUniformBuffer = function () {
  const device = this._device;
  const size = WebGPURenderPipeline.CZM_UNIFORM_BUFFER_SIZE;

  this._czmUniformBuffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    label: "CzmUniforms",
  });

  this._czmUniformData = new Float32Array(size / 4);

  this._czmBindGroupLayout = device.createBindGroupLayout({
    label: "CzmBindGroupLayout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });

  this._czmBindGroup = device.createBindGroup({
    label: "CzmBindGroup",
    layout: this._czmBindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: { buffer: this._czmUniformBuffer },
      },
    ],
  });
};

/**
 * Updates the Cesium automatic uniform buffer from a {@link UniformState}.
 *
 * @param {UniformState} uniformState The Cesium uniform state for the current frame.
 * @private
 */
WebGPURenderPipeline.prototype.updateCzmUniforms = function (uniformState) {
  const data = this._czmUniformData;
  let offset = 0;

  /**
   * Writes a Matrix4 (column-major) into the Float32Array at the given offset.
   * @param {Matrix4|undefined} mat
   */
  function writeMat4(mat) {
    if (defined(mat)) {
      // Cesium Matrix4 is column-major, same as WGSL mat4x4f
      for (let i = 0; i < 16; i++) {
        data[offset + i] = mat[i];
      }
    }
    offset += 16; // 16 floats = 64 bytes
  }

  /**
   * Writes a Matrix3 (padded to mat3x3f with vec4 rows) at the given offset.
   * WGSL mat3x3f uses 3 × vec4 = 48 bytes.
   * @param {Matrix3|undefined} mat
   */
  function writeMat3(mat) {
    if (defined(mat)) {
      // Column 0
      data[offset] = mat[0];
      data[offset + 1] = mat[1];
      data[offset + 2] = mat[2];
      data[offset + 3] = 0;
      // Column 1
      data[offset + 4] = mat[3];
      data[offset + 5] = mat[4];
      data[offset + 6] = mat[5];
      data[offset + 7] = 0;
      // Column 2
      data[offset + 8] = mat[6];
      data[offset + 9] = mat[7];
      data[offset + 10] = mat[8];
      data[offset + 11] = 0;
    }
    offset += 12; // 12 floats = 48 bytes (3 vec4 rows)
  }

  /** @param {Cartesian4|undefined} v */
  function writeVec4(v) {
    if (defined(v)) {
      data[offset] = v.x;
      data[offset + 1] = v.y;
      data[offset + 2] = v.z;
      data[offset + 3] = v.w;
    }
    offset += 4;
  }

  /** @param {Cartesian3|undefined} v */
  function writeVec3(v) {
    if (defined(v)) {
      data[offset] = v.x;
      data[offset + 1] = v.y;
      data[offset + 2] = v.z;
    }
    data[offset + 3] = 0; // padding
    offset += 4; // padded to vec4
  }

  /** @param {Cartesian2|undefined} v */
  function writeVec2(v) {
    if (defined(v)) {
      data[offset] = v.x;
      data[offset + 1] = v.y;
    }
    data[offset + 2] = 0;
    data[offset + 3] = 0; // padding to vec4
    offset += 4;
  }

  /** @param {number|undefined} f */
  function writeF32(f) {
    data[offset] = f ?? 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0; // padding to vec4
    offset += 4;
  }

  // Write all automatic uniforms in the same order as the WGSL struct fields.
  // This order MUST match CZM_AUTO_UNIFORMS in GlslToWgsl.js.
  writeVec4(uniformState.viewportCartesian4); // czm_viewport
  writeMat4(uniformState.viewportOrthographic); // czm_viewportOrthographic
  writeMat4(uniformState.viewportTransformation); // czm_viewportTransformation
  writeMat4(uniformState.projection); // czm_projection
  writeMat4(uniformState.infiniteProjection); // czm_infiniteProjection
  writeMat4(uniformState.inverseProjection); // czm_inverseProjection
  writeMat4(uniformState.view); // czm_view
  writeMat4(uniformState.view3D); // czm_view3D
  writeMat4(uniformState.inverseView); // czm_inverseView
  writeMat4(uniformState.inverseView3D); // czm_inverseView3D
  writeMat3(uniformState.viewRotation); // czm_viewRotation
  writeMat3(uniformState.viewRotation3D); // czm_viewRotation3D
  writeMat3(uniformState.inverseViewRotation); // czm_inverseViewRotation
  writeMat3(uniformState.inverseViewRotation3D); // czm_inverseViewRotation3D
  writeMat4(uniformState.viewProjection); // czm_viewProjection
  writeMat4(uniformState.inverseViewProjection); // czm_inverseViewProjection
  writeMat4(uniformState.model); // czm_model
  writeMat4(uniformState.inverseModel); // czm_inverseModel
  writeMat4(uniformState.modelView); // czm_modelView
  writeMat4(uniformState.modelView3D); // czm_modelView3D
  writeMat4(uniformState.modelViewRelativeToEye); // czm_modelViewRelativeToEye
  writeMat4(uniformState.inverseModelView); // czm_inverseModelView
  writeMat4(uniformState.inverseModelView3D); // czm_inverseModelView3D
  writeMat4(uniformState.modelViewProjection); // czm_modelViewProjection
  writeMat4(uniformState.modelViewProjectionRelativeToEye); // czm_modelViewProjectionRelativeToEye
  writeMat4(uniformState.modelViewInfiniteProjection); // czm_modelViewInfiniteProjection
  writeMat4(uniformState.inverseModelViewProjection); // czm_inverseModelViewProjection
  writeMat3(uniformState.normal); // czm_normal
  writeMat3(uniformState.normal3D); // czm_normal3D
  writeMat3(uniformState.inverseNormal); // czm_inverseNormal
  writeMat3(uniformState.inverseNormal3D); // czm_inverseNormal3D
  writeF32(uniformState.eyeHeight); // czm_eyeHeight
  writeVec2(uniformState.eyeHeight2D); // czm_eyeHeight2D
  writeVec3(uniformState.eyeEllipsoidNormalEC); // czm_eyeEllipsoidNormalEC
  writeVec2(uniformState.eyeEllipsoidCurvature); // czm_eyeEllipsoidCurvature
  writeF32(uniformState.orthographicIn3D ? 1 : 0); // czm_orthographicIn3D
  writeF32(uniformState.frameNumber); // czm_frameNumber
  writeF32(uniformState.morphTime); // czm_morphTime
  writeMat3(uniformState.temeToPseudoFixed); // czm_temeToPseudoFixed
  writeVec3(uniformState.sunDirectionEC); // czm_sunDirectionEC
  writeVec3(uniformState.sunDirectionWC); // czm_sunDirectionWC
  writeVec3(uniformState.moonDirectionEC); // czm_moonDirectionEC
  writeVec3(uniformState.lightColor); // czm_lightColor
  writeVec3(uniformState.lightDirectionEC); // czm_lightDirectionEC
  writeVec3(uniformState.lightDirectionWC); // czm_lightDirectionWC
  writeF32(uniformState.atmosphereScatteringIntensity); // czm_atmosphereScatteringIntensity
  writeVec3(uniformState.atmosHsbShift); // czm_atmosHsbShift
  writeF32(uniformState.atmosFogDensity); // czm_atmosFogDensity
  writeF32(uniformState.pass); // czm_pass

  // Upload to GPU
  this._device.queue.writeBuffer(
    this._czmUniformBuffer,
    0,
    this._czmUniformData.buffer,
    0,
    offset * 4,
  );
};

/**
 * Begins a WebGPU render pass.
 *
 * @param {GPUCommandEncoder} encoder A command encoder.
 * @param {GPUTextureView} colorView The swap chain or render target texture view.
 * @param {GPUTextureView} [depthView] Optional depth texture view.
 * @param {object} [clearColor] Clear color { r, g, b, a }.
 * @returns {GPURenderPassEncoder}
 */
WebGPURenderPipeline.prototype.beginRenderPass = function (
  encoder,
  colorView,
  depthView,
  clearColor,
) {
  //>>includeStart('debug', pragmas.debug);
  Check.defined("encoder", encoder);
  Check.defined("colorView", colorView);
  //>>includeEnd('debug');

  clearColor = clearColor ?? { r: 0, g: 0, b: 0, a: 1 };

  const colorAttachment = {
    view: colorView,
    clearValue: clearColor,
    loadOp: "clear",
    storeOp: "store",
  };

  const descriptor = {
    label: "CesiumMainPass",
    colorAttachments: [colorAttachment],
  };

  if (defined(depthView)) {
    descriptor.depthStencilAttachment = {
      view: depthView,
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    };
  }

  return encoder.beginRenderPass(descriptor);
};

/**
 * Returns or creates a cached {@link GPURenderPipeline} for a given
 * {@link DrawCommand}'s shader program.
 *
 * Shaders are translated from GLSL to WGSL on first use and then cached.
 * The cache key is the integer id of the Cesium {@link ShaderProgram}.
 *
 * @param {DrawCommand} drawCommand The draw command.
 * @returns {GPURenderPipeline|undefined} The compiled pipeline, or
 *   <code>undefined</code> if the command has no shader program.
 * @private
 */
WebGPURenderPipeline.prototype._getPipeline = function (drawCommand) {
  const shaderProgram = drawCommand._shaderProgram;
  if (!defined(shaderProgram)) {
    return undefined;
  }

  const cacheKey = shaderProgram.id;
  if (this._pipelineCache.has(cacheKey)) {
    return this._pipelineCache.get(cacheKey);
  }

  // Translate GLSL → WGSL
  const glslVertex = shaderProgram._vertexShaderText ?? "";
  const glslFragment = shaderProgram._fragmentShaderText ?? "";

  let vertexWgsl, fragmentWgsl;
  try {
    ({ vertexWgsl, fragmentWgsl } = glslPairToWgsl(glslVertex, glslFragment));
  } catch (e) {
    console.warn(
      `[WebGPURenderPipeline] GLSL→WGSL translation failed for shader ${cacheKey}: ${e.message}`,
    );
    return undefined;
  }

  // Build vertex buffer layouts from the draw command's vertex array
  const vertexBufferLayouts = this._buildVertexBufferLayouts(drawCommand);

  const primitiveTopology =
    PRIMITIVE_TYPE_TO_WEBGPU[drawCommand._primitiveType] ?? "triangle-list";

  const device = this._device;
  const presentationFormat = this._webgpuContext.presentationFormat;

  const vertexModule = device.createShaderModule({
    code: vertexWgsl,
    label: `VS_${cacheKey}`,
  });
  const fragmentModule = device.createShaderModule({
    code: fragmentWgsl,
    label: `FS_${cacheKey}`,
  });

  const pipelineLayout = device.createPipelineLayout({
    label: `PipelineLayout_${cacheKey}`,
    bindGroupLayouts: [this._czmBindGroupLayout],
  });

  const pipelineDescriptor = {
    label: `Pipeline_${cacheKey}`,
    layout: pipelineLayout,
    vertex: {
      module: vertexModule,
      entryPoint: "vertexMain",
      buffers: vertexBufferLayouts,
    },
    fragment: {
      module: fragmentModule,
      entryPoint: "fragmentMain",
      targets: [{ format: presentationFormat }],
    },
    primitive: {
      topology: primitiveTopology,
      cullMode: "none",
    },
    depthStencil: {
      format: this._webgpuContext.depthFormat,
      depthWriteEnabled: true,
      depthCompare: "less",
    },
    multisample: {
      count: this._sampleCount,
    },
  };

  let pipeline;
  try {
    pipeline = device.createRenderPipeline(pipelineDescriptor);
  } catch (e) {
    console.warn(
      `[WebGPURenderPipeline] Failed to create pipeline for shader ${cacheKey}: ${e.message}`,
    );
    return undefined;
  }

  this._pipelineCache.set(cacheKey, pipeline);
  return pipeline;
};

/**
 * Builds the <code>GPUVertexBufferLayout[]</code> from a draw command's vertex array.
 *
 * @param {DrawCommand} drawCommand
 * @returns {GPUVertexBufferLayout[]}
 * @private
 */
WebGPURenderPipeline.prototype._buildVertexBufferLayouts = function (
  drawCommand,
) {
  const va = drawCommand._vertexArray;
  if (!defined(va) || !defined(va._attributes)) {
    return [];
  }

  return va._attributes
    .filter((attr) => defined(attr.vertexBuffer))
    .map((attr, i) => {
      const gpuAttr = cesiumAttributeToGPU(attr, i);
      return {
        arrayStride:
          (attr.strideInBytes ?? gpuAttr.format === "float32x4") ? 16 : 12,
        stepMode: attr.instanceDivisor > 0 ? "instance" : "vertex",
        attributes: [gpuAttr],
      };
    });
};

/**
 * Executes a single Cesium {@link DrawCommand} using a
 * <code>GPURenderPassEncoder</code>.
 *
 * This method:
 * 1. Retrieves or creates the corresponding {@link GPURenderPipeline}
 * 2. Sets the pipeline and bind groups on the encoder
 * 3. Binds vertex buffers from the command's {@link VertexArray}
 * 4. Issues the draw call (indexed or non-indexed)
 *
 * @param {GPURenderPassEncoder} passEncoder An active render pass encoder.
 * @param {DrawCommand} drawCommand The Cesium draw command to execute.
 * @param {UniformState} [uniformState] The current frame's uniform state.
 *   When provided, the automatic uniform buffer is updated before drawing.
 */
WebGPURenderPipeline.prototype.executeDrawCommand = function (
  passEncoder,
  drawCommand,
  uniformState,
) {
  //>>includeStart('debug', pragmas.debug);
  Check.defined("passEncoder", passEncoder);
  Check.defined("drawCommand", drawCommand);
  //>>includeEnd('debug');

  const pipeline = this._getPipeline(drawCommand);
  if (!defined(pipeline)) {
    return;
  }

  // Update automatic uniform buffer if uniformState is provided
  if (defined(uniformState)) {
    this.updateCzmUniforms(uniformState);
  }

  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, this._czmBindGroup);

  // Bind vertex buffers
  const va = drawCommand._vertexArray;
  if (defined(va) && defined(va._attributes)) {
    let slotIndex = 0;
    for (const attr of va._attributes) {
      if (defined(attr.vertexBuffer) && defined(attr.vertexBuffer._buffer)) {
        passEncoder.setVertexBuffer(
          slotIndex,
          attr.vertexBuffer._buffer,
          attr.offsetInBytes ?? 0,
        );
        slotIndex++;
      }
    }
  }

  // Draw
  const indexBuffer = defined(va) ? va.indexBuffer : undefined;
  let count = drawCommand._count;
  const offset = drawCommand._offset ?? 0;
  const instanceCount = drawCommand.instanceCount ?? 0;
  const drawInstances = instanceCount > 0 ? instanceCount : 1;

  if (defined(indexBuffer) && defined(indexBuffer._buffer)) {
    const indexFormat =
      INDEX_DATATYPE_TO_WEBGPU[indexBuffer.indexDatatype] ?? "uint16";
    passEncoder.setIndexBuffer(indexBuffer._buffer, indexFormat, 0);

    count = count ?? indexBuffer.numberOfIndices;
    count = Math.min(count, indexBuffer.numberOfIndices);
    passEncoder.drawIndexed(count, drawInstances, offset, 0, 0);
  } else {
    count = count ?? (defined(va) ? va.numberOfVertices : 0);
    passEncoder.draw(count, drawInstances, offset, 0);
  }
};

/**
 * Returns <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
 *
 * @returns {boolean}
 */
WebGPURenderPipeline.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys this render pipeline, releasing cached GPU pipelines and
 * the automatic uniform buffer.
 *
 * @returns {undefined}
 */
WebGPURenderPipeline.prototype.destroy = function () {
  if (defined(this._czmUniformBuffer)) {
    this._czmUniformBuffer.destroy();
  }
  this._pipelineCache.clear();
  return destroyObject(this);
};

export default WebGPURenderPipeline;
