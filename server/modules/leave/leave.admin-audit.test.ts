import { expect, it, vi } from "vitest";
vi.mock("../../infra/db", () => ({ db: {} }));
vi.mock("../../infra/db/tx", () => ({ withTx: vi.fn(), LOCK_NS: { leaveBalance: 102 }, lockXact: vi.fn() }));
import { leaveService } from "./leave.service";

it("provides the required leave revoke and adjustment write entry points", () => {
  expect(leaveService).toHaveProperty("revoke", expect.any(Function));
  expect(leaveService).toHaveProperty("adjustRequest", expect.any(Function));
});
