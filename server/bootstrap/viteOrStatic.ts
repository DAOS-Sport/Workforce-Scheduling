import type { Express } from "express";
import type { Server } from "http";
import { serveStatic } from "../static";

/**
 * Mount Vite (dev) or the pre-built static assets (production), depending
 * on NODE_ENV. Must be called LAST, after every API route is registered,
 * because Vite installs a catch-all that would otherwise swallow /api/*.
 */
export async function setupClientServing(httpServer: Server, app: Express): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("../vite");
    await setupVite(httpServer, app);
  }
}
