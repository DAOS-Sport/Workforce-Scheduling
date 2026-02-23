import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Clock, CheckCircle, XCircle, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

interface ClockRecord {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  venueId: number | null;
  shiftId: number | null;
  clockType: string;
  latitude: number;
  longitude: number;
  distance: number | null;
  status: string;
  failReason: string | null;
  clockTime: string;
  matchedVenueName: string | null;
}

function getTaiwanToday(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ClockRecordsPage() {
  const today = getTaiwanToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const { data: records = [], isLoading } = useQuery<ClockRecord[]>({
    queryKey: ["/api/clock-records", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/clock-records?startDate=${startDate}&endDate=${endDate}`);
      return res.json();
    },
  });

  const successCount = records.filter((r) => r.status === "success").length;
  const warningCount = records.filter((r) => r.status === "warning").length;
  const failCount = records.filter((r) => r.status === "fail").length;

  const goDay = (offset: number) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + offset);
    const str = d.toISOString().slice(0, 10);
    setStartDate(str);
    setEndDate(str);
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" data-testid="text-clock-title">GPS 打卡紀錄</h1>
          <p className="text-sm text-muted-foreground">LINE 一鍵打卡記錄查詢與管理</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="icon" onClick={() => goDay(-1)} data-testid="button-prev-day">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-40"
          data-testid="input-start-date"
        />
        <span className="text-muted-foreground">至</span>
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="w-40"
          data-testid="input-end-date"
        />
        <Button variant="outline" size="icon" onClick={() => goDay(1)} data-testid="button-next-day">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setStartDate(today); setEndDate(today); }}
          data-testid="button-today"
        >
          今天
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card data-testid="card-stat-success">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">打卡成功</p>
              <p className="text-lg font-bold text-green-600">{successCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-warning">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-yellow-500/10 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">無排班打卡</p>
              <p className="text-lg font-bold text-yellow-600">{warningCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-fail">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-red-500/10 flex items-center justify-center">
              <XCircle className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">打卡失敗</p>
              <p className="text-lg font-bold text-red-600">{failCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">打卡記錄明細</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">載入中...</div>
          ) : records.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">此日期範圍無打卡紀錄</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">時間</th>
                    <th className="text-left p-3 font-medium">員工</th>
                    <th className="text-left p-3 font-medium">類型</th>
                    <th className="text-left p-3 font-medium">場館</th>
                    <th className="text-left p-3 font-medium">距離</th>
                    <th className="text-left p-3 font-medium">狀態</th>
                    <th className="text-left p-3 font-medium">備註</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/30" data-testid={`row-clock-${r.id}`}>
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          {new Date(r.clockTime).toLocaleString("zh-TW", {
                            timeZone: "Asia/Taipei",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium">{r.employeeName}</div>
                        <div className="text-xs text-muted-foreground">{r.employeeCode}</div>
                      </td>
                      <td className="p-3">
                        <Badge variant={r.clockType === "in" ? "default" : "secondary"}>
                          {r.clockType === "in" ? "上班" : "下班"}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          {r.matchedVenueName || "—"}
                        </div>
                      </td>
                      <td className="p-3">
                        {r.distance !== null ? `${r.distance}m` : "—"}
                      </td>
                      <td className="p-3">
                        {r.status === "success" && (
                          <Badge className="bg-green-500/10 text-green-600 border-green-500/20" data-testid={`status-success-${r.id}`}>
                            <CheckCircle className="h-3 w-3 mr-1" /> 成功
                          </Badge>
                        )}
                        {r.status === "warning" && (
                          <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20" data-testid={`status-warning-${r.id}`}>
                            <AlertTriangle className="h-3 w-3 mr-1" /> 警告
                          </Badge>
                        )}
                        {r.status === "fail" && (
                          <Badge className="bg-red-500/10 text-red-600 border-red-500/20" data-testid={`status-fail-${r.id}`}>
                            <XCircle className="h-3 w-3 mr-1" /> 失敗
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs max-w-[200px] truncate">
                        {r.failReason || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
