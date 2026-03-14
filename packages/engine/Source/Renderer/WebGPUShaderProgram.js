import Check from "../Core/Check.js";
import Frozen from "../Core/Frozen.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";

let nextShaderProgramId = 0;

/**
 * Builds the modules and pipeline descriptor shared by the constructor and createAsync.
 *
 * @param {object} options Validated options.
 * @param {string} label The resolved pipeline label.
 * @returns {{ vertexModule, fragmentModule, pipelineDescriptor }}
 * @private
 */
function buildPipelineDescriptor(options, label) {
  const webgpuContext = options.webgpuContext;
  const device = webgpuContext.device;

  const vertexModule = device.createShaderModule({
    code: options.vertexShaderWGSL,
    label: `${label}_vertex`,
  });

  const fragmentModule = device.createShaderModule({
    code: options.fragmentShaderWGSL,
    label: `${label}_fragment`,
  });

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
      entryPoint: options.vertexEntryPoint ?? "vertexMain",
      buffers: options.vertexState?.buffers ?? [],
    },
    fragment: {
      module: fragmentModule,
      entryPoint: options.fragmentEntryPoint ?? "fragmentMain",
      targets: colorTargets,
    },
    primitive,
    multisample: {
      count: options.sampleCount ?? 1,
    },
  };

  if (defined(options.depthStencil)) {
    pipelineDescriptor.depthStencil = options.depthStencil;
  }

  return { vertexModule, fragmentModule, pipelineDescriptor };
}

/**
 * Initializes the shared instance properties of a {@link WebGPUShaderProgram}.
 *
 * @private
 */
function initProgram(
  instance,
  pipeline,
  vertexModule,
  fragmentModule,
  webgpuContext,
  label,
) {
  instance._pipeline = pipeline;
  instance._vertexModule = vertexModule;
  instance._fragmentModule = fragmentModule;
  instance._webgpuContext = webgpuContext;
  instance._label = label;
  instance.id = nextShaderProgramId++;
}

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

  const label = options.label ?? `WebGPUShaderProgram_${nextShaderProgramId}`;
  const { vertexModule, fragmentModule, pipelineDescriptor } =
    buildPipelineDescriptor(options, label);

  const pipeline =
    options.webgpuContext.device.createRenderPipeline(pipelineDescriptor);
  initProgram(
    this,
    pipeline,
    vertexModule,
    fragmentModule,
    options.webgpuContext,
    label,
  );
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

  const label = options.label ?? `WebGPUShaderProgram_${nextShaderProgramId}`;
  const { vertexModule, fragmentModule, pipelineDescriptor } =
    buildPipelineDescriptor(options, label);

  const pipeline =
    await options.webgpuContext.device.createRenderPipelineAsync(
      pipelineDescriptor,
    );

  const program = Object.create(WebGPUShaderProgram.prototype);
  initProgram(
    program,
    pipeline,
    vertexModule,
    fragmentModule,
    options.webgpuContext,
    label,
  );
  return program;
};

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
