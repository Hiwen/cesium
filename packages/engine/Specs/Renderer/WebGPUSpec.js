import {
  Context,
  WebGPUContext,
  WebGPUBuffer,
  WebGPUShaderProgram,
} from "../../index.js";

describe(
  "Renderer/WebGPU",
  function () {
    describe("WebGPUContext.isSupported", function () {
      it("returns a boolean", function () {
        const result = WebGPUContext.isSupported();
        expect(typeof result).toBe("boolean");
      });

      it("returns false when navigator.gpu is undefined", function () {
        const originalGpu = navigator.gpu;
        Object.defineProperty(navigator, "gpu", {
          value: undefined,
          configurable: true,
          writable: true,
        });
        expect(WebGPUContext.isSupported()).toBe(false);
        Object.defineProperty(navigator, "gpu", {
          value: originalGpu,
          configurable: true,
          writable: true,
        });
      });
    });

    describe("Context.supportsWebGPU", function () {
      it("delegates to WebGPUContext.isSupported", function () {
        expect(Context.supportsWebGPU()).toBe(WebGPUContext.isSupported());
      });
    });

    describe("Context.createWithWebGPU", function () {
      it("throws when WebGPU is not supported", async function () {
        // If WebGPU is already not supported, verify the error message.
        if (!WebGPUContext.isSupported()) {
          await expectAsync(
            Context.createWithWebGPU(document.createElement("canvas")),
          ).toBeRejectedWithError(/WebGPU is not supported/);
        } else {
          // If WebGPU is supported, the function should return a context.
          // We skip the actual device request in non-GPU test environments.
          pending("WebGPU supported - skipping mock test in GPU environment");
        }
      });
    });

    describe("WebGPUContext static API", function () {
      it("is defined", function () {
        expect(WebGPUContext).toBeDefined();
        expect(typeof WebGPUContext.isSupported).toBe("function");
        expect(typeof WebGPUContext.create).toBe("function");
      });
    });

    describe("WebGPUBuffer", function () {
      it("is defined", function () {
        expect(WebGPUBuffer).toBeDefined();
        expect(typeof WebGPUBuffer.createVertexBuffer).toBe("function");
        expect(typeof WebGPUBuffer.createIndexBuffer).toBe("function");
        expect(typeof WebGPUBuffer.createUniformBuffer).toBe("function");
      });

      it("createVertexBuffer throws without webgpuContext in debug mode", function () {
        expect(function () {
          WebGPUBuffer.createVertexBuffer({
            typedArray: new Float32Array([1, 2, 3]),
          });
        }).toThrowDeveloperError();
      });

      it("createIndexBuffer throws without webgpuContext in debug mode", function () {
        expect(function () {
          WebGPUBuffer.createIndexBuffer({
            typedArray: new Uint16Array([0, 1, 2]),
          });
        }).toThrowDeveloperError();
      });

      it("createUniformBuffer throws without webgpuContext in debug mode", function () {
        expect(function () {
          WebGPUBuffer.createUniformBuffer({
            sizeInBytes: 64,
          });
        }).toThrowDeveloperError();
      });

      it("constructor throws when both typedArray and sizeInBytes are provided", function () {
        const fakeContext = { device: {} };
        let b;
        expect(function () {
          b = new WebGPUBuffer({
            webgpuContext: fakeContext,
            typedArray: new Float32Array([1]),
            sizeInBytes: 16,
            usage: 0,
          });
        }).toThrowDeveloperError();
        expect(b).toBeUndefined();
      });

      it("constructor throws when neither typedArray nor sizeInBytes is provided", function () {
        const fakeContext = { device: {} };
        let b;
        expect(function () {
          b = new WebGPUBuffer({
            webgpuContext: fakeContext,
            usage: 0,
          });
        }).toThrowDeveloperError();
        expect(b).toBeUndefined();
      });
    });

    describe("WebGPUShaderProgram", function () {
      it("is defined", function () {
        expect(WebGPUShaderProgram).toBeDefined();
        expect(typeof WebGPUShaderProgram.createAsync).toBe("function");
      });

      it("constructor throws without webgpuContext in debug mode", function () {
        let p;
        expect(function () {
          p = new WebGPUShaderProgram({
            vertexShaderWGSL:
              "@vertex fn vertexMain() -> @builtin(position) vec4f { return vec4f(0); }",
            fragmentShaderWGSL:
              "@fragment fn fragmentMain() -> @location(0) vec4f { return vec4f(1); }",
          });
        }).toThrowDeveloperError();
        expect(p).toBeUndefined();
      });

      it("constructor throws without vertexShaderWGSL in debug mode", function () {
        const fakeContext = { device: { createShaderModule: () => ({}) } };
        let p;
        expect(function () {
          p = new WebGPUShaderProgram({
            webgpuContext: fakeContext,
            fragmentShaderWGSL:
              "@fragment fn fragmentMain() -> @location(0) vec4f { return vec4f(1); }",
          });
        }).toThrowDeveloperError();
        expect(p).toBeUndefined();
      });

      it("constructor throws without fragmentShaderWGSL in debug mode", function () {
        const fakeContext = { device: { createShaderModule: () => ({}) } };
        let p;
        expect(function () {
          p = new WebGPUShaderProgram({
            webgpuContext: fakeContext,
            vertexShaderWGSL:
              "@vertex fn vertexMain() -> @builtin(position) vec4f { return vec4f(0); }",
          });
        }).toThrowDeveloperError();
        expect(p).toBeUndefined();
      });
    });
  },
  "WebGL",
);
