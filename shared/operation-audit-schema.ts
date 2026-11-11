import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type AuditActorSnapshot = {
  kind: "personal" | "shared_password" | "employee" | "system";
  employeeId?: number;
  name?: string;
};

export const operationAudit = pgTable("operation_audit", {
  id: serial("id").primaryKey(),
  entity: text("entity").notNull(),
  recordId: text("record_id").notNull(),
  employeeId: integer("employee_id"),
  action: text("action").notNull(),
  actor: jsonb("actor").$type<AuditActorSnapshot>().notNull(),
  before: jsonb("before_data"),
  after: jsonb("after_data"),
  mutationId: integer("mutation_id"),
  transactionId: text("transaction_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const auditMutations = pgTable("audit_mutations", {
  id: serial("id").primaryKey(),
  tableName: text("table_name").notNull(),
  recordId: text("record_id").notNull(),
  operation: text("operation").notNull(),
  actor: jsonb("actor").$type<AuditActorSnapshot>().notNull(),
  sharedPasswordEnabled: boolean("shared_password_enabled").notNull().default(true),
  before: jsonb("before_data"),
  after: jsonb("after_data"),
  transactionId: text("transaction_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
