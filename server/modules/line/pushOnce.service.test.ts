import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushMessagesResult } from "../../adapters/line";
import { pushDedupRepository } from "./pushDedup.repository";
import { pushOnce } from "./pushOnce.service";

vi.mock("./pushDedup.repository", () => ({ pushDedupRepository: { claim: vi.fn(), finish: vi.fn() } }));
vi.mock("../../shared/health/healthState", () => ({ recordIntegration: vi.fn() }));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => undefined) }));

const slot = { scope: "test-delivery", period: "2026-11-11", employeeId: 901, refId: "synthetic-shift" };
const messages = [{ type: "text", text: "synthetic message" }];
const send = (key: string) => pushMessagesResult("U00000000000000000000000000000000", messages, key);
const headers = () => vi.mocked(fetch).mock.calls.map(([, init]) => (init!.headers as Record<string, string>)["X-Line-Retry-Key"]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pushDedupRepository.claim).mockResolvedValue({ attempt: 1, reclaimed: false });
  vi.mocked(pushDedupRepository.finish).mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("pushOnce delivery retries", () => {
  it.each(["timeout", "connection", "5xx"])("retries %s with the same UUID and succeeds in the same round", async (failure) => {
    const request = vi.mocked(fetch);
    if (failure === "5xx") request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    else request.mockRejectedValueOnce(failure === "timeout" ? new DOMException("synthetic timeout", "TimeoutError") : new TypeError("synthetic connection error"));
    request.mockResolvedValueOnce(new Response(null, { status: 200 }));

    expect(await pushOnce(slot, send)).toEqual({ outcome: "sent", attempt: 1, reclaimed: false });
    expect(headers()).toHaveLength(2);
    expect(headers()[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(headers()[1]).toBe(headers()[0]);
    expect(vi.mocked(delay).mock.calls).toEqual([[1_000]]);
  });

  it("treats keyed 409 as sent and does not resend", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 409, headers: { "x-line-accepted-request-id": "synthetic-request" } }));
    expect((await pushOnce(slot, send)).outcome).toBe("sent");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pushDedupRepository.finish).toHaveBeenCalledWith({ ...slot }, "sent");
  });

  it("leaves pending after three unknown responses and backs off for one then three seconds", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    expect((await pushOnce(slot, send)).outcome).toBe("unknown");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(new Set(headers()).size).toBe(1);
    expect(pushDedupRepository.finish).not.toHaveBeenCalled();
    expect(vi.mocked(delay).mock.calls).toEqual([[1_000], [3_000]]);
  });

  it("retries thrown sends at most twice, leaving the slot pending", async () => {
    const throwingSend = vi.fn(async (_key: string): Promise<never> => { throw new Error("synthetic abrupt send failure"); });
    expect((await pushOnce(slot, throwingSend)).outcome).toBe("unknown");
    expect(throwingSend).toHaveBeenCalledTimes(3);
    expect(new Set(throwingSend.mock.calls.map(([key]) => key)).size).toBe(1);
    expect(pushDedupRepository.finish).not.toHaveBeenCalled();
  });

  it("advances the key only after rejection advances the attempt", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 400 })).mockResolvedValueOnce(new Response(null, { status: 200 }));
    expect((await pushOnce(slot, send)).outcome).toBe("failed");
    expect(pushDedupRepository.finish).toHaveBeenCalledWith(slot, "failed");
    vi.mocked(pushDedupRepository.claim).mockResolvedValueOnce({ attempt: 2, reclaimed: true });
    expect((await pushOnce(slot, send)).outcome).toBe("sent");
    expect(headers()[1]).not.toBe(headers()[0]);
    expect(delay).not.toHaveBeenCalled();
  });

  it("preserves the deterministic key when a later process reclaims the same attempt", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    vi.mocked(pushDedupRepository.finish).mockRejectedValue(new Error("synthetic write failure"));
    expect((await pushOnce(slot, send)).outcome).toBe("unknown");
    expect(pushDedupRepository.finish).toHaveBeenCalledTimes(3);
    vi.mocked(pushDedupRepository.claim).mockResolvedValueOnce({ attempt: 1, reclaimed: true });
    vi.mocked(pushDedupRepository.finish).mockResolvedValue(undefined);
    expect(await pushOnce(slot, send)).toEqual({ outcome: "sent", attempt: 1, reclaimed: true });
    expect(headers()[1]).toBe(headers()[0]);
    expect(vi.mocked(delay).mock.calls).toEqual([[250], [750]]);
  });

  it("retries finish without sending again", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    vi.mocked(pushDedupRepository.finish).mockRejectedValueOnce(new Error("synthetic transient finish error"));
    expect((await pushOnce(slot, send)).outcome).toBe("sent");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pushDedupRepository.finish).toHaveBeenCalledTimes(2);
  });

  it("skips an unclaimed slot without calling LINE", async () => {
    vi.mocked(pushDedupRepository.claim).mockResolvedValueOnce(null);
    expect(await pushOnce(slot, send)).toEqual({ outcome: "skipped", attempt: 0, reclaimed: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});
