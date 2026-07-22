/**
 * MCP (Model Context Protocol) server — lets external AI clients such as
 * Claude Desktop / Claude Code / Claude web connect to this project.
 *
 * Endpoint: POST /mcp  (Streamable HTTP transport, stateless mode)
 * Auth: same token scheme as the internal API (INTERNAL_API_TOKEN via
 *       Authorization: Bearer / X-Internal-Token / X-API-Key / ?token=).
 *
 * Two tool groups:
 *   1. Business tools — read scheduling data (regions, venues, employees,
 *      shifts, anomaly reports) through the storage façade.
 *   2. Code-level tools — read/write project files, run shell commands and
 *      SQL queries. These operate on the environment this server runs in;
 *      file edits only persist in the development workspace (a published
 *      deployment's filesystem is ephemeral).
 */
import type { Express, Request, Response } from "express";
import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { storage } from "../../storage";
import { db } from "../../infra/db";
import { sql } from "drizzle-orm";
const PROJECT_ROOT = process.cwd();

// Dangerous (code-level) tools are always on in development; in production
// they require an explicit opt-in via MCP_ENABLE_DANGEROUS_TOOLS=true.
const DANGEROUS_TOOLS_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.MCP_ENABLE_DANGEROUS_TOOLS === "true";

function safePath(p: string): string {
  const resolved = path.resolve(PROJECT_ROOT, p);
  if (resolved !== PROJECT_ROOT && !resolved.startsWith(PROJECT_ROOT + path.sep)) {
    throw new Error("Path escapes project root");
  }
  return resolved;
}

/**
 * Header-only token auth for /mcp. Unlike the internal API, the query-string
 * `?token=` form is deliberately NOT accepted here — this endpoint can expose
 * shell/DB access, and URL tokens leak into logs and browser history.
 * Uses MCP_TOKEN if set, otherwise falls back to INTERNAL_API_TOKEN.
 */
function requireMcpToken(req: Request, res: Response, next: () => void) {
  const expected = process.env.MCP_TOKEN || process.env.INTERNAL_API_TOKEN;
  if (!expected) {
    return res.status(503).json({
      code: "MCP_DISABLED",
      message: "No MCP_TOKEN or INTERNAL_API_TOKEN configured on the server",
    });
  }
  let provided: string | undefined;
  const auth = req.header("authorization");
  const m = auth ? /^Bearer\s+(.+)$/i.exec(auth.trim()) : null;
  if (m) provided = m[1].trim();
  if (!provided) provided = req.header("x-internal-token")?.trim() || req.header("x-api-key")?.trim();
  if (!provided) {
    return res.status(401).json({
      code: "MISSING_TOKEN",
      message: "Missing token. Provide Authorization: Bearer, X-Internal-Token, or X-API-Key header.",
    });
  }
  if (provided !== expected) {
    return res.status(403).json({ code: "INVALID_TOKEN", message: "Invalid token" });
  }
  next();
}

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "pt-scheduling-system", version: "1.0.0" });

  // ── Business tools ──────────────────────────────────────────────────────
  server.registerTool(
    "list_regions",
    { description: "列出所有營運區域 (regions)", inputSchema: {} },
    async () => textResult(await storage.getRegions())
  );

  server.registerTool(
    "list_venues",
    {
      description: "列出場館。可用 regionId 篩選；不帶參數則列出全部區域的場館。",
      inputSchema: { regionId: z.number().optional() },
    },
    async ({ regionId }) => {
      if (regionId != null) return textResult(await storage.getVenuesByRegion(regionId));
      const regions = await storage.getRegions();
      const all = await Promise.all(regions.map((r) => storage.getVenuesByRegion(r.id)));
      return textResult(all.flat());
    }
  );

  server.registerTool(
    "list_employees",
    {
      description: "列出員工。可選 regionId 篩選，或用 employeeCode 查單一員工。",
      inputSchema: { regionId: z.number().optional(), employeeCode: z.string().optional() },
    },
    async ({ regionId, employeeCode }) => {
      if (employeeCode) {
        const emp = await storage.getEmployeeByCode(employeeCode);
        return textResult(emp ?? { error: "找不到該員工編號" });
      }
      if (regionId != null) return textResult(await storage.getEmployeesByRegion(regionId));
      return textResult(await storage.getAllEmployees());
    }
  );

  server.registerTool(
    "get_shifts",
    {
      description:
        "查詢班表。必填 startDate / endDate (YYYY-MM-DD)。可選 employeeCode 只看單一員工。",
      inputSchema: {
        startDate: z.string().describe("YYYY-MM-DD"),
        endDate: z.string().describe("YYYY-MM-DD"),
        employeeCode: z.string().optional(),
      },
    },
    async ({ startDate, endDate, employeeCode }) => {
      if (employeeCode) {
        const emp = await storage.getEmployeeByCode(employeeCode);
        if (!emp) return textResult({ error: "找不到該員工編號" });
        return textResult(
          await storage.getShiftsByEmployeeAndDateRange(emp.id, startDate, endDate)
        );
      }
      return textResult(await storage.getAllShiftsByDateRange(startDate, endDate));
    }
  );

  server.registerTool(
    "list_anomaly_reports",
    { description: "列出員工異常通報 (anomaly reports)", inputSchema: {} },
    async () => textResult(await storage.getAnomalyReports())
  );

  // ── Code-level tools (gated) ────────────────────────────────────────────
  if (!DANGEROUS_TOOLS_ENABLED) return server;

  server.registerTool(
    "list_files",
    {
      description: "列出專案目錄內容（相對於專案根目錄）。",
      inputSchema: { dirPath: z.string().default(".") },
    },
    async ({ dirPath }) => {
      const entries = await fs.readdir(safePath(dirPath), { withFileTypes: true });
      return textResult(
        entries
          .filter((e) => e.name !== "node_modules" && e.name !== ".git")
          .map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`)
          .join("\n")
      );
    }
  );

  server.registerTool(
    "read_file",
    {
      description: "讀取專案檔案內容（相對路徑）。",
      inputSchema: { filePath: z.string() },
    },
    async ({ filePath }) => textResult(await fs.readFile(safePath(filePath), "utf-8"))
  );

  server.registerTool(
    "write_file",
    {
      description:
        "寫入/覆蓋專案檔案（相對路徑）。注意：只有在開發環境執行才會真正改到程式碼庫；已部署的正式環境檔案系統是暫時性的。",
      inputSchema: { filePath: z.string(), content: z.string() },
    },
    async ({ filePath, content }) => {
      const p = safePath(filePath);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content, "utf-8");
      return textResult(`已寫入 ${filePath} (${content.length} bytes)`);
    }
  );

  server.registerTool(
    "run_command",
    {
      description:
        "在專案根目錄執行 shell 指令（120 秒逾時）。請小心使用，具完整系統權限。",
      inputSchema: { command: z.string() },
    },
    async ({ command }) =>
      new Promise((resolve) => {
        exec(
          command,
          { cwd: PROJECT_ROOT, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
          (err, stdout, stderr) => {
            resolve(
              textResult(
                [
                  err ? `exit: ${err.code ?? "error"} ${err.killed ? "(timeout)" : ""}` : "exit: 0",
                  stdout && `--- stdout ---\n${stdout}`,
                  stderr && `--- stderr ---\n${stderr}`,
                ]
                  .filter(Boolean)
                  .join("\n")
              )
            );
          }
        );
      })
  );

  server.registerTool(
    "run_sql",
    {
      description:
        "對此環境的 PostgreSQL 資料庫執行 SQL（開發環境連開發資料庫；正式部署連正式資料庫）。支援 SELECT/INSERT/UPDATE 等，請小心破壞性操作。",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const result = await db.execute(sql.raw(query));
      const rows = (result as any).rows ?? result;
      return textResult(rows);
    }
  );

  return server;
}

export function mountMcpRoutes(app: Express): void {
  const handler = async (req: Request, res: Response) => {
    try {
      const server = buildMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[MCP] request failed:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  app.post("/mcp", requireMcpToken, handler);
  // Stateless mode: GET (SSE stream) and DELETE (session end) are not supported.
  app.get("/mcp", requireMcpToken, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null,
    });
  });
  app.delete("/mcp", requireMcpToken, (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null,
    });
  });
}
