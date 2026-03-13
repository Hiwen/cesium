import Check from "../Core/Check.js";
import createGuid from "../Core/createGuid.js";
import Frozen from "../Core/Frozen.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import DeveloperError from "../Core/DeveloperError.js";

/**
 * A GPU buffer backed by a WebGPU <code>GPUBuffer</code>.
 *
 * Use {@link WebGPUBuffer.createVertexBuffer} or {@link WebGPUBuffer.createIndexBuffer}
 * for the most common buffer types.
 *
 * @alias WebGPUBuffer
 * @constructor
 *
 * @private
 */
function WebGPUBuffer(options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.webgpuContext", options.webgpuContext);

  if (!defined(options.typedArray) && !defined(options.sizeInBytes)) {
    throw new DeveloperError(
      "Either options.sizeInBytes or options.typedArray is required.",
    );
  }

  if (defined(options.typedArray) && defined(options.sizeInBytes)) {
    throw new DeveloperError(
      "Cannot pass in both options.sizeInBytes and options.typedArray.",
    );
  }

  if (defined(options.typedArray)) {
    Check.typeOf.object("options.typedArray", options.typedArray);
    Check.typeOf.number(
      "options.typedArray.byteLength",
      options.typedArray.byteLength,
    );
  }

  if (!defined(options.usage)) {
    throw new DeveloperError("options.usage is required.");
  }
  //>>includeEnd('debug');

  const webgpuContext = options.webgpuContext;
  const device = webgpuContext.device;
  const typedArray = options.typedArray;
  let sizeInBytes = options.sizeInBytes;
  const usage = options.usage;
  const hasArray = defined(typedArray);

  if (hasArray) {
    sizeInBytes = typedArray.byteLength;
  }

  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.number.greaterThan("sizeInBytes", sizeInBytes, 0);
  //>>includeEnd('debug');

  // WebGPU requires buffer sizes to be multiples of 4 bytes.
  const alignedSize = Math.ceil(sizeInBytes / 4) * 4;

  const gpuBuffer = device.createBuffer({
    size: alignedSize,
    usage: usage,
    mappedAtCreation: hasArray,
    label: options.label,
  });

  if (hasArray) {
    const src = new Uint8Array(
      typedArray.buffer,
      typedArray.byteOffset,
      typedArray.byteLength,
    );
    new Uint8Array(gpuBuffer.getMappedRange()).set(src);
    gpuBuffer.unmap();
  }

  this._id = createGuid();
  this._webgpuContext = webgpuContext;
  this._device = device;
  this._buffer = gpuBuffer;
  this._sizeInBytes = sizeInBytes;
  this._alignedSize = alignedSize;
  this._usage = usage;
  this.vertexArrayDestroyable = true;
}

/**
 * Creates a vertex buffer.
 *
 * @param {object} options Object with the following properties:
 * @param {WebGPUContext} options.webgpuContext The WebGPU context.
 * @param {TypedArray} [options.typedArray] Initial vertex data. Mutually exclusive with <code>sizeInBytes</code>.
 * @param {number} [options.sizeInBytes] Size of the buffer in bytes. Mutually exclusive with <code>typedArray</code>.
 * @param {boolean} [options.allowWrite=false] Whether the buffer can be updated after creation.
 * @returns {WebGPUBuffer}
 */
WebGPUBuffer.createVertexBuffer = function (options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.webgpuContext", options.webgpuContext);
  //>>includeEnd('debug');

  let usage = GPUBufferUsage.VERTEX;
  if (options.allowWrite) {
    usage |= GPUBufferUsage.COPY_DST;
  }

  return new WebGPUBuffer({
    webgpuContext: options.webgpuContext,
    typedArray: options.typedArray,
    sizeInBytes: options.sizeInBytes,
    usage,
    label: options.label ?? "vertex",
  });
};

/**
 * Creates an index buffer.
 *
 * @param {object} options Object with the following properties:
 * @param {WebGPUContext} options.webgpuContext The WebGPU context.
 * @param {TypedArray} [options.typedArray] Initial index data. Mutually exclusive with <code>sizeInBytes</code>.
 * @param {number} [options.sizeInBytes] Size of the buffer in bytes. Mutually exclusive with <code>typedArray</code>.
 * @param {boolean} [options.allowWrite=false] Whether the buffer can be updated after creation.
 * @returns {WebGPUBuffer}
 */
WebGPUBuffer.createIndexBuffer = function (options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.webgpuContext", options.webgpuContext);
  //>>includeEnd('debug');

  let usage = GPUBufferUsage.INDEX;
  if (options.allowWrite) {
    usage |= GPUBufferUsage.COPY_DST;
  }

  return new WebGPUBuffer({
    webgpuContext: options.webgpuContext,
    typedArray: options.typedArray,
    sizeInBytes: options.sizeInBytes,
    usage,
    label: options.label ?? "index",
  });
};

/**
 * Creates a uniform buffer.
 *
 * @param {object} options Object with the following properties:
 * @param {WebGPUContext} options.webgpuContext The WebGPU context.
 * @param {TypedArray} [options.typedArray] Initial uniform data. Mutually exclusive with <code>sizeInBytes</code>.
 * @param {number} [options.sizeInBytes] Size of the buffer in bytes. Mutually exclusive with <code>typedArray</code>.
 * @returns {WebGPUBuffer}
 */
WebGPUBuffer.createUniformBuffer = function (options) {
  options = options ?? Frozen.EMPTY_OBJECT;

  //>>includeStart('debug', pragmas.debug);
  Check.defined("options.webgpuContext", options.webgpuContext);
  //>>includeEnd('debug');

  const usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;

  return new WebGPUBuffer({
    webgpuContext: options.webgpuContext,
    typedArray: options.typedArray,
    sizeInBytes: options.sizeInBytes,
    usage,
    label: options.label ?? "uniform",
  });
};

Object.defineProperties(WebGPUBuffer.prototype, {
  /**
   * The unique identifier for this buffer.
   * @memberof WebGPUBuffer.prototype
   * @type {string}
   * @readonly
   */
  id: {
    get: function () {
      return this._id;
    },
  },

  /**
   * The underlying <code>GPUBuffer</code>.
   * @memberof WebGPUBuffer.prototype
   * @type {GPUBuffer}
   * @readonly
   */
  buffer: {
    get: function () {
      return this._buffer;
    },
  },

  /**
   * The size of this buffer in bytes, as requested.
   * @memberof WebGPUBuffer.prototype
   * @type {number}
   * @readonly
   */
  sizeInBytes: {
    get: function () {
      return this._sizeInBytes;
    },
  },

  /**
   * The actual allocated size of this buffer in bytes, aligned to 4-byte boundaries.
   * @memberof WebGPUBuffer.prototype
   * @type {number}
   * @readonly
   */
  alignedSizeInBytes: {
    get: function () {
      return this._alignedSize;
    },
  },

  /**
   * The WebGPU usage flags for this buffer.
   * @memberof WebGPUBuffer.prototype
   * @type {GPUBufferUsageFlags}
   * @readonly
   */
  usage: {
    get: function () {
      return this._usage;
    },
  },
});

/**
 * Copies data from a typed array into this buffer using the device queue.
 * The buffer must have been created with a usage that includes <code>GPUBufferUsage.COPY_DST</code>.
 *
 * @param {TypedArray} typedArray The source data.
 * @param {number} [offsetInBytes=0] Byte offset into the GPU buffer to write at.
 */
WebGPUBuffer.prototype.copyFromTypedArray = function (
  typedArray,
  offsetInBytes,
) {
  //>>includeStart('debug', pragmas.debug);
  Check.typeOf.object("typedArray", typedArray);
  //>>includeEnd('debug');

  offsetInBytes = offsetInBytes ?? 0;
  this._webgpuContext.writeBuffer(
    this._buffer,
    offsetInBytes,
    typedArray.buffer,
    typedArray.byteOffset,
    typedArray.byteLength,
  );
};

/**
 * Returns <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
 *
 * @returns {boolean}
 */
WebGPUBuffer.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys this buffer and frees the associated GPU memory.
 *
 * @returns {undefined}
 */
WebGPUBuffer.prototype.destroy = function () {
  this._buffer.destroy();
  return destroyObject(this);
};

export default WebGPUBuffer;
