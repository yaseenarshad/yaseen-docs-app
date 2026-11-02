/**
 * YAZ-4074 6A item 8: the font subset worker's limits. Its first job includes the
 * worker start and two wasm compiles, so it gets 30 s, not the pool's 1 s. A job
 * that fails or is slow falls back to the main thread once; only a worker that
 * cannot start turns the workers off.
 */
const pool = vi.hoisted(() => ({ postMessage: vi.fn() }));
const create = vi.hoisted(() => vi.fn(() => pool));

vi.mock("../workers", () => ({ WorkerPool: { create } }));
vi.mock("../subset/subset-worker?worker-source", () => ({ default: "" }));
const loads = vi.hoisted(() => ({ shared: 0 }));
vi.mock("../subset/subset-shared.chunk", () => {
  loads.shared++;
  return { subsetToBase64: vi.fn(async () => "main thread") };
});
vi.mock("../subset/subset-utils", () => ({
  Commands: { Subset: "SUBSET" },
  toBase64: vi.fn(async () => "worker"),
}));

const subset = async () => {
  const { subsetWoff2GlyphsByCodepoints } = await import(
    "../subset/subset-main"
  );
  return () => subsetWoff2GlyphsByCodepoints(new ArrayBuffer(8), [65]);
};

describe("YAZ-4074 6A item 8: the font subset worker", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("Worker", class {});
    URL.createObjectURL = () => "blob:subset";
    create.mockClear();
    loads.shared = 0;
    pool.postMessage.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("gives the worker 30 s", async () => {
    pool.postMessage.mockResolvedValue(new ArrayBuffer(4));
    const run = await subset();
    expect(await run()).toBe("worker");
    expect(create).toHaveBeenCalledWith(expect.any(URL), { ttl: 30_000 });
  });

  it("a job on the worker never loads the wasm chunk on the UI thread; the fallback does (6A item 30)", async () => {
    const run = await subset();
    pool.postMessage.mockResolvedValueOnce(new ArrayBuffer(4));
    expect(await run()).toBe("worker");
    expect(loads.shared).toBe(0);
    pool.postMessage.mockResolvedValueOnce({ error: "bad font" });
    expect(await run()).toBe("main thread");
    expect(loads.shared).toBe(1);
  });

  it("a job that fails or is slow runs on the main thread once; the next one uses the worker", async () => {
    const run = await subset();
    pool.postMessage.mockResolvedValueOnce({ error: "bad font" });
    expect(await run()).toBe("main thread");
    pool.postMessage.mockRejectedValueOnce(
      new Error("Active worker did not respond for 30000ms!"),
    );
    expect(await run()).toBe("main thread");
    pool.postMessage.mockResolvedValueOnce(new ArrayBuffer(4));
    expect(await run()).toBe("worker");
    expect(pool.postMessage).toHaveBeenCalledTimes(3);
  });

  it("a worker that cannot start turns the workers off", async () => {
    const run = await subset();
    // the pool's `onerror`: the script did not load
    pool.postMessage.mockRejectedValueOnce(new Event("error"));
    expect(await run()).toBe("main thread");
    expect(await run()).toBe("main thread");
    expect(pool.postMessage).toHaveBeenCalledTimes(1);
  });
});
