import Check from "../Core/Check.js";
import Frozen from "../Core/Frozen.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";

let nextShaderProgramId = 0;

/**
 * A WebGPU render pipeline compiled from WGSL vertex and fragment shader sources.
 *
 * Unlike the WebGL-based {@link ShaderProgram}, which uses GLSL, this class uses
 * WGSL (WebGPU Shading Language) and wraps a <code>GPURenderPipeline</code>.
 *
 * @alias WebGPUShaderProgram
 * @constructor
 *
 * @param {object} options Object with the following properties:
 * @param {WebGPUContext} options.webgpuContext The WebGPU context.
 * @param {string} options.vertexShaderWGSL WGSL source for the vertex stage.
 * @param {string} options.fragmentShaderWGSL WGSL source for the fragment stage.
 * @param {object} [options.vertexState] Descriptor for the vertex buffer layout(s).
 * @param {object[]} [options.colorTargets] Array of color target state descriptors.
 *   Defaults to a single target matching the presentation format.
 * @param {object} [options.depthStencil] Depth/stencil state descriptor.
 * @param {object} [options.primitive] Primitive state (topology, cull mode, etc.).
 * @param {GPUPipelineLayout|"auto"} [options.layout="auto"] Pipeline layout. Use
 *   <code>"auto"</code> to derive the layout from shader reflection.
 * @param {string} [options.vertexEntryPoint="vertexMain"] Entry point for the vertex shader.
 * @param {string} [options.fragmentEntryPoint="fragmentMain"] Entry point for the fragment shader.
 * @param {number} [options.sampleCount=1] MSAA sample count.
 * @param {string} [options.label] Optional label for debugging.
 *
 * @private
 */
function WebGPUShaderProgram(options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.webgpuContext", options.webgpuContext);
  Check.typeOf.string("options.vertexShaderWGSL", options.vertexShaderWGSL);
  Check.typeOf.string("options.fragmentShaderWGSL", options.fragmentShaderWGSL);
  //>>includeEnd('debug');

  const webgpuContext = options.webgpuContext;
  const device = webgpuContext.device;
  const label = options.label ?? `WebGPUShaderProgram_${nextShaderProgramId}`;

  const vertexModule = device.createShaderModule({
    code: options.vertexShaderWGSL,
    label: `${label}_vertex`,
  });

  const fragmentModule = device.createShaderModule({
    code: options.fragmentShaderWGSL,
    label: `${label}_fragment`,
  });

  const vertexEntryPoint = options.vertexEntryPoint ?? "vertexMain";
  const fragmentEntryPoint = options.fragmentEntryPoint ?? "fragmentMain";
  const sampleCount = options.sampleCount ?? 1;

  const colorTargets = options.colorTargets ?? [
    { format: webgpuContext.presentationFormat },
  ];

  const primitive = options.primitive ?? {
    topology: "triangle-list",
    cullMode: "none",
  };

  const pipelineDescriptor = {
    label,
    layout: options.layout ?? "auto",
    vertex: {
      module: vertexModule,
      entryPoint: vertexEntryPoint,
      buffers: options.vertexState?.buffers ?? [],
    },
    fragment: {
      module: fragmentModule,
      entryPoint: fragmentEntryPoint,
      targets: colorTargets,
    },
    primitive,
    multisample: {
      count: sampleCount,
    },
  };

  if (defined(options.depthStencil)) {
    pipelineDescriptor.depthStencil = options.depthStencil;
  }

  this._pipeline = device.createRenderPipeline(pipelineDescriptor);
  this._vertexModule = vertexModule;
  this._fragmentModule = fragmentModule;
  this._webgpuContext = webgpuContext;
  this._label = label;
  this.id = nextShaderProgramId++;
}

/**
 * Asynchronously creates a {@link WebGPUShaderProgram}.
 *
 * Prefer this method over the constructor for better browser-side shader
 * compilation scheduling.
 *
 * @param {object} options Same options as the {@link WebGPUShaderProgram} constructor.
 * @returns {Promise<WebGPUShaderProgram>}
 */
WebGPUShaderProgram.createAsync = async function (options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.webgpuContext", options.webgpuContext);
  Check.typeOf.string("options.vertexShaderWGSL", options.vertexShaderWGSL);
  Check.typeOf.string("options.fragmentShaderWGSL", options.fragmentShaderWGSL);
  //>>includeEnd('debug');

  const webgpuContext = options.webgpuContext;
  const device = webgpuContext.device;
  const label = options.label ?? `WebGPUShaderProgram_${nextShaderProgramId}`;

  const vertexModule = device.createShaderModule({
    code: options.vertexShaderWGSL,
    label: `${label}_vertex`,
  });

  const fragmentModule = device.createShaderModule({
    code: options.fragmentShaderWGSL,
    label: `${label}_fragment`,
  });

  const vertexEntryPoint = options.vertexEntryPoint ?? "vertexMain";
  const fragmentEntryPoint = options.fragmentEntryPoint ?? "fragmentMain";
  const sampleCount = options.sampleCount ?? 1;

  const colorTargets = options.colorTargets ?? [
    { format: webgpuContext.presentationFormat },
  ];

  const primitive = options.primitive ?? {
    topology: "triangle-list",
    cullMode: "none",
  };

  const pipelineDescriptor = {
    label,
    layout: options.layout ?? "auto",
    vertex: {
      module: vertexModule,
      entryPoint: vertexEntryPoint,
      buffers: options.vertexState?.buffers ?? [],
    },
    fragment: {
      module: fragmentModule,
      entryPoint: fragmentEntryPoint,
      targets: colorTargets,
    },
    primitive,
    multisample: {
      count: sampleCount,
    },
  };

  if (defined(options.depthStencil)) {
    pipelineDescriptor.depthStencil = options.depthStencil;
  }

  const pipeline = await device.createRenderPipelineAsync(pipelineDescriptor);

  const program = new WebGPUShaderProgram.__internal(
    pipeline,
    vertexModule,
    fragmentModule,
    webgpuContext,
    label,
  );
  return program;
};

/**
 * @private
 * Internal constructor for use by createAsync.
 */
WebGPUShaderProgram.__internal = function (
  pipeline,
  vertexModule,
  fragmentModule,
  webgpuContext,
  label,
) {
  this._pipeline = pipeline;
  this._vertexModule = vertexModule;
  this._fragmentModule = fragmentModule;
  this._webgpuContext = webgpuContext;
  this._label = label;
  this.id = nextShaderProgramId++;
};
WebGPUShaderProgram.__internal.prototype = WebGPUShaderProgram.prototype;

Object.defineProperties(WebGPUShaderProgram.prototype, {
  /**
   * The compiled <code>GPURenderPipeline</code>.
   * @memberof WebGPUShaderProgram.prototype
   * @type {GPURenderPipeline}
   * @readonly
   */
  pipeline: {
    get: function () {
      return this._pipeline;
    },
  },

  /**
   * The vertex shader module.
   * @memberof WebGPUShaderProgram.prototype
   * @type {GPUShaderModule}
   * @readonly
   */
  vertexModule: {
    get: function () {
      return this._vertexModule;
    },
  },

  /**
   * The fragment shader module.
   * @memberof WebGPUShaderProgram.prototype
   * @type {GPUShaderModule}
   * @readonly
   */
  fragmentModule: {
    get: function () {
      return this._fragmentModule;
    },
  },

  /**
   * The label used for this shader program in GPU debugging tools.
   * @memberof WebGPUShaderProgram.prototype
   * @type {string}
   * @readonly
   */
  label: {
    get: function () {
      return this._label;
    },
  },
});

/**
 * Checks whether shader compilation produced any errors using the
 * <code>getCompilationInfo</code> API. Resolves with a list of messages
 * (errors, warnings, info) for both shader stages.
 *
 * @returns {Promise<GPUCompilationMessage[]>} A promise that resolves to an
 *   array of compilation messages from both stages. Empty if compilation
 *   succeeded without issues.
 */
WebGPUShaderProgram.prototype.getCompilationInfo = async function () {
  if (!defined(this._vertexModule.getCompilationInfo)) {
    return [];
  }

  const [vertexInfo, fragmentInfo] = await Promise.all([
    this._vertexModule.getCompilationInfo(),
    this._fragmentModule.getCompilationInfo(),
  ]);

  return [...vertexInfo.messages, ...fragmentInfo.messages];
};

/**
 * Checks for and logs any shader compilation errors or warnings.
 *
 * @returns {Promise<boolean>} Resolves to <code>true</code> if there were no
 *   errors, <code>false</code> if any errors were found.
 */
WebGPUShaderProgram.prototype.checkCompilation = async function () {
  const messages = await this.getCompilationInfo();
  let hasErrors = false;

  for (const message of messages) {
    if (message.type === "error") {
      hasErrors = true;
      console.error(
        `[WebGPU Shader Error] ${this._label}: ${message.message} (line ${message.lineNum})`,
      );
    } else if (message.type === "warning") {
      console.warn(
        `[WebGPU Shader Warning] ${this._label}: ${message.message} (line ${message.lineNum})`,
      );
    }
  }

  return !hasErrors;
};

/**
 * Returns <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
 *
 * @returns {boolean}
 */
WebGPUShaderProgram.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys this shader program.
 * GPU pipeline objects themselves are reference-counted by the driver and
 * will be freed when no longer referenced.
 *
 * @returns {undefined}
 */
WebGPUShaderProgram.prototype.destroy = function () {
  return destroyObject(this);
};

export default WebGPUShaderProgram;
