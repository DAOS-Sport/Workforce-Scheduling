import { describe, expect, it } from "vitest";
import { currentAuditActor, withAuditActor } from "./actor";

describe("audit actor attribution", () => {
  it("keeps the authenticated employee id and current name across async work", async () => {
    const personal = { kind: "personal" as const, employeeId: 17, name: "當下姓名" };
    await withAuditActor(personal, async () => {
      await Promise.resolve();
      expect(currentAuditActor()).toEqual(personal);
    });
    expect(currentAuditActor()).toEqual({ kind: "system" });
  });

  it("does not leak the actor between concurrent requests or invent an employee for shared login", async () => {
    const seen = await Promise.all([
      withAuditActor({ kind: "personal", employeeId: 4, name: "甲" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return currentAuditActor();
      }),
      withAuditActor({ kind: "shared_password" }, async () => {
        await Promise.resolve();
        return currentAuditActor();
      }),
    ]);
    expect(seen).toEqual([{ kind: "personal", employeeId: 4, name: "甲" }, { kind: "shared_password" }]);
  });
});
