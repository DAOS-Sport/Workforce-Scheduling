import { describe, expect, it, vi } from "vitest";
import { createLogBuffer, redactLogMessage } from "./buffer";

describe("persistent log buffer", () => {
  it("redacts full quoted secrets and plain landline numbers", () => {
    const masked = redactLogMessage('password="correct horse battery staple" {"token":"alpha beta"} 0223456789 employeeId=42');
    for (const secret of ['correct','horse','battery','staple','alpha','beta','0223456789']) expect(masked).not.toContain(secret);
    expect(masked).toContain('employeeId=42');
  });
  it("redacts known identifiers and credentials while retaining internal ids", () => {
    const raw = 'U1234567890abcdef1234567890abcdef a@example.test +886-912-345-678 0912-345-678 02-2345-6789 Bearer abc.def.xyz token=secret-value api_key: hidden employeeId=42';
    const masked = redactLogMessage(raw);
    for (const secret of ['U1234567890abcdef1234567890abcdef','a@example.test','912-345-678','2345-6789','abc.def.xyz','secret-value','hidden']) expect(masked).not.toContain(secret);
    expect(masked).toContain('employeeId=42');
  });

  it("bounds message input before redacting and keeps buffered secrets masked", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const buffer = createLogBuffer({ write });
    buffer.add({ level: 'warn', pipeline: 'x', message: `token=${'a'.repeat(5000)} outside-input-limit` });
    buffer.add({ level: 'warn', pipeline: 'x', message: `a@example.test Bearer abc.def.xyz ${'z '.repeat(2000)}` });

    await buffer.flush();

    const messages = write.mock.calls[0][0].map((entry: { message: string }) => entry.message);
    expect(messages[0]).toBe('token=[REDACTED]');
    expect(messages[1]).toHaveLength(2000);
    expect(messages[1]).toContain('[EMAIL] Bearer [REDACTED]');
    expect(messages[1]).not.toContain('a@example.test');
    expect(messages[1]).not.toContain('abc.def.xyz');
  });

  it("handles a 200KB continuous alphanumeric message within one second", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const buffer = createLogBuffer({ write });
    const message = 'a1'.repeat(100 * 1024);
    const started = performance.now();

    buffer.add({ level: 'warn', pipeline: 'x', message });

    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1000);
    await buffer.flush();
    expect(write.mock.calls[0][0][0].message).toBe(message.slice(0, 2000));
  });

  it("drops the oldest records at capacity and batches without blocking callers", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const buffer = createLogBuffer({ write, capacity: 3 });
    for (let n = 0; n < 5; n++) buffer.add({ level: 'warn', pipeline: 'shift.manage', message: String(n) });
    expect(buffer.size()).toBe(3);
    expect(write).not.toHaveBeenCalled();
    await buffer.flush();
    expect(write.mock.calls[0][0].map((r: any) => r.message)).toEqual(['2','3','4']);
    expect(buffer.size()).toBe(0);
  });

  it("drops a failed batch, contains synchronous failures and prevents diagnostic recursion", async () => {
    let buffer: ReturnType<typeof createLogBuffer>;
    const failed = vi.fn(() => buffer.add({ level: 'error', pipeline: 'server.errors', message: 'collector failure' }));
    buffer = createLogBuffer({ write: () => { throw Error('down'); }, onWriteFailure: failed });
    buffer.add({ level: 'error', pipeline: 'shift.manage', message: 'original' });
    await expect(buffer.flush()).resolves.toBeUndefined();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(buffer.size()).toBe(0);
    await buffer.flush();
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("keeps the total in-flight and queued memory bounded and serializes flushes", async () => {
    let finish!: () => void;
    const write = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const buffer = createLogBuffer({ write, capacity: 3 });
    buffer.add({ level:'warn',pipeline:'x',message:'one' });
    const first = buffer.flush();
    for(let n=0;n<10;n++) buffer.add({level:'warn',pipeline:'x',message:String(n)});
    expect(buffer.size()).toBeLessThanOrEqual(3);
    await buffer.flush();
    expect(write).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });
});
