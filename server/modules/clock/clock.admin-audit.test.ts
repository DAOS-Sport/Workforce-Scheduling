import { expect, it, vi } from "vitest";
vi.mock("../../infra/db", () => ({ db: {} }));
vi.mock("../../infra/db/tx", () => ({ withTx: vi.fn(), LOCK_NS: { clock: 101 }, lockXact: vi.fn() }));
import { clockService } from "./clock.service";

it("provides the required admin add/edit/delete write entry points", () => {
  expect(clockService).toHaveProperty("adminCreateRecord", expect.any(Function));
  expect(clockService).toHaveProperty("adminUpdateRecord", expect.any(Function));
  expect(clockService).toHaveProperty("adminDeleteRecord", expect.any(Function));
});
