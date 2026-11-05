import { systemConfigs } from "@shared/schema";
import { db } from "../infra/db";
import { withTx, type Tx } from "../infra/db/tx";
import { log } from "../shared/log";
import { employeeService } from "../modules/employee/employee.service";
import { guidelineService } from "../modules/guideline/guideline.service";

const MARKER_PREFIX = "migration:";
export const INITIAL_ADMIN_LINE_ID = "U8fd0e4be4e44a1304f9fa2e9855f4559";

interface DataMigration {
  name: string;
  apply: (tx: Tx) => Promise<void>;
}

/** Data a new database starts with. Each runs once, in a database that has never run it, and never again. */
const MIGRATIONS: DataMigration[] = [
  {
    name: "initial-sick-leave-guideline-v1",
    apply: async (tx) => {
      await guidelineService.createGuideline(
        {
          category: "工作規則",
          title: "病假注意事項",
          content: "請病假需於返回上班後三日內提交就診證明（醫院收據或診斷書），否則將視同曠職。如有疑問請洽詢主管或 HR 部門。",
          contentType: "text",
          sortOrder: 10,
          isActive: true,
        },
        tx,
      );
    },
  },
  {
    name: "initial-admin-v1",
    apply: async (tx) => {
      const admin = await employeeService.getEmployeeByLineId(INITIAL_ADMIN_LINE_ID, tx);
      if (admin && !admin.isAdmin) await employeeService.updateEmployee(admin.id, { isAdmin: true }, tx);
    },
  },
];

/**
 * Apply each migration once. The marker row in system_configs is claimed in the same transaction as the migration, so two
 * instances starting together apply it once and a failed migration leaves no marker behind.
 *
 * A database that already has regions is older than this mechanism: its data is as the administrators left it (a deleted
 * guideline stays deleted, a revoked administrator stays revoked), so there the marker is written ("baselined") and
 * nothing else happens.
 */
export async function runOneTimeDataMigrations({ freshDatabase }: { freshDatabase: boolean }): Promise<void> {
  for (const migration of MIGRATIONS) {
    await withTx(async (tx) => {
      const claimed = await tx
        .insert(systemConfigs)
        .values({ key: MARKER_PREFIX + migration.name, value: freshDatabase ? "applied" : "baselined" })
        .onConflictDoNothing()
        .returning({ key: systemConfigs.key });
      if (claimed.length === 0 || !freshDatabase) return;
      await migration.apply(tx);
      log(`一次性資料遷移已套用: ${migration.name}`, "db");
    });
  }
}
