import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { notificationRecipients } from "@shared/schema";
import { db } from "../../infra/db";
import { LOCK_NS } from "../../infra/db/tx";
import { concurrently, resetDatabase, warmPool } from "../../test/itest";
import { runWhileLockHeld } from "../../test/lock";
import { notificationService } from "./notification.service";

beforeEach(async () => {
  await resetDatabase();
  await warmPool(4);
});

const rows = () => db.select().from(notificationRecipients);

describe("adding a notification recipient", () => {
  it("lets one of two simultaneous requests for the same address in, whatever the letter case", async () => {
    const results = await concurrently(2, (i) => notificationService.create({ email: i === 0 ? "Ops@Example.invalid" : "ops@example.invalid" }));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.status).toBe(409);
    expect(await rows()).toHaveLength(1);
  });

  it("waits for the recipient lock of that address", async () => {
    const { finishedWhileHeld, outcome } = await runWhileLockHeld(LOCK_NS.notificationRecipient, "ops@example.invalid", () =>
      notificationService.create({ email: "OPS@example.invalid" }),
    );

    expect(finishedWhileHeld).toBe(false);
    expect(outcome.status).toBe("fulfilled");
  });

  it("still requires an address", async () => {
    await expect(notificationService.create({ email: "  " })).rejects.toThrow("缺少 email");
  });
});

describe("changing a notification recipient", () => {
  it("refuses an address another recipient already has", async () => {
    await notificationService.create({ email: "a@example.invalid" });
    const b = await notificationService.create({ email: "b@example.invalid" });

    await expect(notificationService.update(b.id, { email: "A@example.invalid" })).rejects.toMatchObject({ status: 409 });
    expect((await rows()).map((r) => r.email).sort()).toEqual(["a@example.invalid", "b@example.invalid"]);
  });

  it("changes only the columns a recipient has: an id in the body does not rewrite the key", async () => {
    const a = await notificationService.create({ email: "a@example.invalid" });

    const updated = await notificationService.update(a.id, { id: a.id + 500, enabled: false });

    expect(updated?.id).toBe(a.id);
    expect((await db.select().from(notificationRecipients).where(eq(notificationRecipients.id, a.id)))[0].enabled).toBe(false);
  });

  it("rejects a value of the wrong type instead of writing it", async () => {
    const a = await notificationService.create({ email: "a@example.invalid" });

    await expect(notificationService.update(a.id, { enabled: "maybe" })).rejects.toMatchObject({ name: "ZodError" });
    expect((await rows())[0].enabled).toBe(true);
  });
});
