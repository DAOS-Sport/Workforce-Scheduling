import net from "node:net";
import { describe, expect, it } from "vitest";
import { concurrently } from "./itest";

describe("integration harness", () => {
  it("refuses fetch to any host outside this machine", async () => {
    await expect(fetch("https://api.line.me/v2/bot/message/push")).rejects.toThrow("itest: fetch blocked to api.line.me");
  });

  it("refuses raw sockets to any host outside this machine", async () => {
    const error = await new Promise<Error>((resolve) => {
      const socket = net.connect({ host: "203.0.113.10", port: 443 });
      socket.on("error", resolve);
    });
    expect(error.message).toBe("itest: outbound connection blocked to 203.0.113.10");
  });

  it("concurrently starts every call before any of them finishes", async () => {
    const started: number[] = [];
    let finishedBeforeAllStarted = false;
    await concurrently(5, async (i) => {
      started.push(i);
      await Promise.resolve();
      if (started.length < 5) finishedBeforeAllStarted = true;
    });
    expect([started.length, finishedBeforeAllStarted]).toEqual([5, false]);
  });
});
