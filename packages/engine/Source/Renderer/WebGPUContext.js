import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import RuntimeError from "../Core/RuntimeError.js";

/**
 * Manages a WebGPU adapter, device, and canvas context for rendering.
 * Provides the core WebGPU infrastructure used by Cesium when WebGPU is enabled.
 *
 * WebGPU initialization is asynchronous. Use {@link WebGPUContext.create} to
 * obtain an initialized instance before using any rendering features.
 *
 * @alias WebGPUContext
 * @constructor
 *
 * @private
 */
function WebGPUContext() {
  this._adapter = undefined;
  this._device = undefined;
  this._canvasContext = undefined;
  this._canvas = undefined;
  this._presentationFormat = undefined;
  this._initialized = false;
  this._depthFormat = "depth24plus";
}

/**
 * Returns true if WebGPU is supported by the current browser environment.
 *
 * @returns {boolean} <code>true</code> if <code>navigator.gpu</code> is defined.
 */
WebGPUContext.isSupported = function () {
  return typeof navigator !== "undefined" && defined(navigator.gpu);
};

/**
 * Asynchronously creates and initializes a {@link WebGPUContext}.
 *
 * @param {HTMLCanvasElement} canvas The canvas element to associate with this context.
 * @param {object} [options] Options for initialization.
 * @param {string} [options.powerPreference="high-performance"] Power preference hint
 *   passed to <code>navigator.gpu.requestAdapter</code>.
 * @param {boolean} [options.alpha=false] Whether the swap chain surface supports
 *   alpha blending with the underlying HTML page.
 * @param {string[]} [options.requiredFeatures=[]] Optional list of WebGPU device
 *   features to enable (e.g. <code>"texture-compression-bc"</code>).
 * @returns {Promise<WebGPUContext>} A promise that resolves to the initialized context.
 *
 * @example
 * const webgpuContext = await WebGPUContext.create(canvas, {
 *   powerPreference: "high-performance",
 * });
 */
WebGPUContext.create = async function (canvas, options) {
  options = options ?? {};

  if (!WebGPUContext.isSupported()) {
    throw new RuntimeError(
      "WebGPU is not supported in this browser. Visit https://caniuse.com/webgpu for browser compatibility.",
    );
  }

  const powerPreference = options.powerPreference ?? "high-performance";

  const adapter = await navigator.gpu.requestAdapter({ powerPreference });
  if (!defined(adapter)) {
    throw new RuntimeError(
      "Failed to obtain a WebGPU adapter. The browser may not support WebGPU on this system.",
    );
  }

  const requiredFeatures = options.requiredFeatures ?? [];
  const device = await adapter.requestDevice({ requiredFeatures });

  device.lost.then(function (info) {
    if (info.reason !== "destroyed") {
      console.error(`WebGPU device lost: ${info.message}`);
    }
  });

  const gpuCanvasContext = canvas.getContext("webgpu");
  if (!defined(gpuCanvasContext)) {
    throw new RuntimeError(
      "Failed to obtain a WebGPU canvas context from the provided canvas element.",
    );
  }

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const alphaMode = options.alpha ? "premultiplied" : "opaque";
  gpuCanvasContext.configure({
    device,
    format: presentationFormat,
    alphaMode,
  });

  const context = new WebGPUContext();
  context._adapter = adapter;
  context._device = device;
  context._canvasContext = gpuCanvasContext;
  context._canvas = canvas;
  context._presentationFormat = presentationFormat;
  context._initialized = true;

  return context;
};

Object.defineProperties(WebGPUContext.prototype, {
  /**
   * The underlying <code>GPUAdapter</code>.
   * @memberof WebGPUContext.prototype
   * @type {GPUAdapter}
   * @readonly
   */
  adapter: {
    get: function () {
      return this._adapter;
    },
  },

  /**
   * The underlying <code>GPUDevice</code>.
   * @memberof WebGPUContext.prototype
   * @type {GPUDevice}
   * @readonly
   */
  device: {
    get: function () {
      return this._device;
    },
  },

  /**
   * The <code>GPUQueue</code> used to submit command buffers.
   * @memberof WebGPUContext.prototype
   * @type {GPUQueue}
   * @readonly
   */
  queue: {
    get: function () {
      return this._device.queue;
    },
  },

  /**
   * The <code>GPUCanvasContext</code> associated with the canvas element.
   * @memberof WebGPUContext.prototype
   * @type {GPUCanvasContext}
   * @readonly
   */
  canvasContext: {
    get: function () {
      return this._canvasContext;
    },
  },

  /**
   * The canvas element associated with this context.
   * @memberof WebGPUContext.prototype
   * @type {HTMLCanvasElement}
   * @readonly
   */
  canvas: {
    get: function () {
      return this._canvas;
    },
  },

  /**
   * The preferred swap chain texture format for this canvas (e.g. <code>"bgra8unorm"</code>).
   * @memberof WebGPUContext.prototype
   * @type {string}
   * @readonly
   */
  presentationFormat: {
    get: function () {
      return this._presentationFormat;
    },
  },

  /**
   * The depth texture format used by this context.
   * @memberof WebGPUContext.prototype
   * @type {string}
   * @readonly
   */
  depthFormat: {
    get: function () {
      return this._depthFormat;
    },
  },

  /**
   * <code>true</code> if the context has been successfully initialized.
   * @memberof WebGPUContext.prototype
   * @type {boolean}
   * @readonly
   */
  initialized: {
    get: function () {
      return this._initialized;
    },
  },
});

/**
 * Returns the current swap chain texture view for rendering into the canvas.
 *
 * @returns {GPUTextureView} The current frame's render target texture view.
 */
WebGPUContext.prototype.getCurrentTextureView = function () {
  return this._canvasContext.getCurrentTexture().createView();
};

/**
 * Creates a <code>GPUCommandEncoder</code> for recording GPU commands.
 *
 * @param {object} [descriptor] Optional descriptor for the command encoder.
 * @returns {GPUCommandEncoder}
 */
WebGPUContext.prototype.createCommandEncoder = function (descriptor) {
  return this._device.createCommandEncoder(descriptor);
};

/**
 * Creates a <code>GPUBuffer</code> on the device.
 *
 * @param {object} descriptor The buffer descriptor.
 * @param {number} descriptor.size Size of the buffer in bytes.
 * @param {GPUBufferUsageFlags} descriptor.usage Usage flags for the buffer.
 * @param {boolean} [descriptor.mappedAtCreation=false] Whether to map the buffer at creation.
 * @returns {GPUBuffer}
 */
WebGPUContext.prototype.createBuffer = function (descriptor) {
  return this._device.createBuffer(descriptor);
};

/**
 * Creates a <code>GPUShaderModule</code> from WGSL source code.
 *
 * @param {string} code WGSL shader source code.
 * @param {string} [label] Optional label for debugging.
 * @returns {GPUShaderModule}
 */
WebGPUContext.prototype.createShaderModule = function (code, label) {
  return this._device.createShaderModule({ code, label });
};

/**
 * Creates a <code>GPURenderPipeline</code>.
 *
 * @param {GPURenderPipelineDescriptor} descriptor The pipeline descriptor.
 * @returns {GPURenderPipeline}
 */
WebGPUContext.prototype.createRenderPipeline = function (descriptor) {
  return this._device.createRenderPipeline(descriptor);
};

/**
 * Creates a <code>GPURenderPipeline</code> asynchronously.
 *
 * @param {GPURenderPipelineDescriptor} descriptor The pipeline descriptor.
 * @returns {Promise<GPURenderPipeline>}
 */
WebGPUContext.prototype.createRenderPipelineAsync = function (descriptor) {
  return this._device.createRenderPipelineAsync(descriptor);
};

/**
 * Creates a <code>GPUComputePipeline</code>.
 *
 * @param {GPUComputePipelineDescriptor} descriptor The pipeline descriptor.
 * @returns {GPUComputePipeline}
 */
WebGPUContext.prototype.createComputePipeline = function (descriptor) {
  return this._device.createComputePipeline(descriptor);
};

/**
 * Creates a <code>GPUBindGroupLayout</code>.
 *
 * @param {GPUBindGroupLayoutDescriptor} descriptor The bind group layout descriptor.
 * @returns {GPUBindGroupLayout}
 */
WebGPUContext.prototype.createBindGroupLayout = function (descriptor) {
  return this._device.createBindGroupLayout(descriptor);
};

/**
 * Creates a <code>GPUPipelineLayout</code>.
 *
 * @param {GPUPipelineLayoutDescriptor} descriptor The pipeline layout descriptor.
 * @returns {GPUPipelineLayout}
 */
WebGPUContext.prototype.createPipelineLayout = function (descriptor) {
  return this._device.createPipelineLayout(descriptor);
};

/**
 * Creates a <code>GPUBindGroup</code>.
 *
 * @param {GPUBindGroupDescriptor} descriptor The bind group descriptor.
 * @returns {GPUBindGroup}
 */
WebGPUContext.prototype.createBindGroup = function (descriptor) {
  return this._device.createBindGroup(descriptor);
};

/**
 * Creates a <code>GPUTexture</code>.
 *
 * @param {GPUTextureDescriptor} descriptor The texture descriptor.
 * @returns {GPUTexture}
 */
WebGPUContext.prototype.createTexture = function (descriptor) {
  return this._device.createTexture(descriptor);
};

/**
 * Creates a <code>GPUSampler</code>.
 *
 * @param {GPUSamplerDescriptor} [descriptor] The sampler descriptor.
 * @returns {GPUSampler}
 */
WebGPUContext.prototype.createSampler = function (descriptor) {
  return this._device.createSampler(descriptor);
};

/**
 * Writes data into a GPU buffer using the device queue.
 *
 * @param {GPUBuffer} buffer The destination buffer.
 * @param {number} bufferOffset Byte offset into the buffer to begin writing.
 * @param {ArrayBuffer|ArrayBufferView} data The data to write.
 * @param {number} [dataOffset=0] Byte offset into <code>data</code> to begin reading.
 * @param {number} [size] Number of bytes to write. Defaults to the full data size.
 */
WebGPUContext.prototype.writeBuffer = function (
  buffer,
  bufferOffset,
  data,
  dataOffset,
  size,
) {
  this._device.queue.writeBuffer(buffer, bufferOffset, data, dataOffset, size);
};

/**
 * Copies data from a CPU-side typed array into a GPU buffer by mapping the buffer.
 * The buffer must have been created with <code>GPUBufferUsage.MAP_WRITE</code>.
 *
 * @param {GPUBuffer} buffer The buffer to write into (must be mappable).
 * @param {TypedArray} typedArray The source data.
 * @returns {Promise<void>}
 */
WebGPUContext.prototype.copyTypedArrayToBuffer = async function (
  buffer,
  typedArray,
) {
  await buffer.mapAsync(GPUMapMode.WRITE);
  const mappedRange = buffer.getMappedRange();
  new Uint8Array(mappedRange).set(new Uint8Array(typedArray.buffer));
  buffer.unmap();
};

/**
 * Submits an array of <code>GPUCommandBuffer</code> objects to the device queue.
 *
 * @param {GPUCommandBuffer[]} commandBuffers The command buffers to submit.
 */
WebGPUContext.prototype.submitCommandBuffers = function (commandBuffers) {
  this._device.queue.submit(commandBuffers);
};

/**
 * Creates a depth texture suitable for use as a depth attachment in a render pass.
 *
 * @param {number} width Width in pixels.
 * @param {number} height Height in pixels.
 * @returns {GPUTexture}
 */
WebGPUContext.prototype.createDepthTexture = function (width, height) {
  return this._device.createTexture({
    size: [width, height, 1],
    format: this._depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
};

/**
 * Returns <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
 *
 * @returns {boolean}
 */
WebGPUContext.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys this WebGPU context and releases GPU resources.
 *
 * @returns {undefined}
 */
WebGPUContext.prototype.destroy = function () {
  if (defined(this._canvasContext)) {
    this._canvasContext.unconfigure();
  }
  if (defined(this._device)) {
    this._device.destroy();
  }
  this._adapter = undefined;
  this._device = undefined;
  this._canvasContext = undefined;
  this._canvas = undefined;
  this._presentationFormat = undefined;
  this._initialized = false;
  return destroyObject(this);
};

export default WebGPUContext;
