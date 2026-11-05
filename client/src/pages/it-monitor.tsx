import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HealthMonitor } from "@/components/health-monitor";
import type { HealthReport } from "@/lib/health-view";

const HEALTH_REFRESH_MS = 60_000;

const toIso = (ms: number) => (ms > 0 ? new Date(ms).toISOString() : null);

export default function ItMonitorPage() {
  const query = useQuery<HealthReport>({
    queryKey: ["/api/admin/health"],
    refetchInterval: HEALTH_REFRESH_MS,
    // 離開分頁就不必每分鐘跑一次整份健康檢查。
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  // API 這一列的恢復時間：失敗之後第一次取報告成功的那一刻，之後的成功不會移動它。
  const [apiRecoveredAt, setApiRecoveredAt] = useState<string | null>(null);
  const failedBefore = useRef(false);
  useEffect(() => {
    if (query.isError) failedBefore.current = true;
    else if (query.isSuccess && failedBefore.current) {
      failedBefore.current = false;
      setApiRecoveredAt(toIso(query.dataUpdatedAt));
    }
  }, [query.isError, query.isSuccess, query.dataUpdatedAt]);

  return (
    <div className="h-full overflow-auto">
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <HealthMonitor
          report={query.data ?? null}
          error={query.isError ? query.error.message : null}
          fetchedAt={toIso(query.dataUpdatedAt)}
          failedAt={toIso(query.errorUpdatedAt)}
          apiRecoveredAt={apiRecoveredAt}
          now={new Date()}
          refreshing={query.isFetching}
          onRefresh={() => void query.refetch()}
        />
      </div>
    </div>
  );
}
