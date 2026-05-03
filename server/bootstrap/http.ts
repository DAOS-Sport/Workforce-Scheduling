/**
 * server/bootstrap/http.ts
 *
 * Encapsulates HTTP server creation and the port-listen call.
 * bootstrap/index.ts delegates both concerns here so it only orchestrates
 * the high-level startup sequence.
 */
import { createServer, type Server } from "http";
import type { Express } from "express";
import { log } from "../shared/log";

export function buildHttpServer(app: Express): Server {
  return createServer(app);
}

export function startListening(
  httpServer: Server,
  onListening: () => void,
): void {
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      onListening();
    },
  );
}
