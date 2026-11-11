import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushMessages, pushMessagesResult, replyMessages } from "./line";

vi.mock("../shared/health/healthState", () => ({ recordIntegration: vi.fn() }));
const recipient = "U00000000000000000000000000000000";
const messages = [{ type: "text", text: "synthetic push" }];
const key = "123e4567-e89b-52d3-a456-426614174000";

beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("LINE push transport", () => {
  it.each([[200, "accepted"], [202, "accepted"], [409, "accepted"], [400, "rejected"], [401, "rejected"], [429, "rejected"], [500, "unknown"], [503, "unknown"]] as const)("classifies keyed HTTP %i as %s", async (status, outcome) => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status }));
    expect(await pushMessagesResult(recipient, messages, key)).toBe(outcome);
  });

  it("gives every push request a fresh ten-second timeout and passes the key only to push", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await pushMessagesResult(recipient, messages, key);
    await pushMessagesResult(recipient, messages, key);
    await replyMessages("synthetic-reply-token", messages);
    expect(timeout.mock.calls).toEqual([[10_000], [10_000], [10_000]]);
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][1]!.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0][1]!.signal).not.toBe(calls[1][1]!.signal);
    expect(calls[0][1]!.headers).toHaveProperty("X-Line-Retry-Key", key);
    expect(calls[2][1]!.headers).not.toHaveProperty("X-Line-Retry-Key");
    expect(calls[2][1]!.signal).toBeInstanceOf(AbortSignal);
    expect(calls[2][1]!.signal).not.toBe(calls[0][1]!.signal);
  });

  it.each([400, 409, 500])("preserves boolean false for unkeyed HTTP %i", async (status) => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status }));
    expect(await pushMessages(recipient, messages)).toBe(false);
  });

  it("preserves boolean true for successful legacy pushes", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
    expect(await pushMessages(recipient, messages)).toBe(true);
  });

  it.each([new DOMException("synthetic timeout", "TimeoutError"), new TypeError("synthetic connection error")])("returns unknown on transport failure and false for legacy callers", async (err) => {
    vi.mocked(fetch).mockRejectedValue(err);
    expect(await pushMessagesResult(recipient, messages, key)).toBe("unknown");
    expect(await pushMessages(recipient, messages)).toBe(false);
  });
});

describe("LINE reply timeout", () => {
  it("abandons a slow response at ten seconds through the existing error outcome", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("synthetic timeout", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise<Response>((resolve, reject) => {
      setTimeout(() => resolve(new Response(null, { status: 200 })), 30_000);
      const signal = init?.signal;
      if (signal) signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    let outcome: string | undefined;
    void replyMessages("synthetic-reply-token", messages).then((result) => { outcome = result; });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe("error");
    expect(timeout.mock.calls).toEqual([[10_000]]);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
