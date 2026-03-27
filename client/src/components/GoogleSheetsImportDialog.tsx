import { useState, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseTSV, type ParsedEmployeeRow, type ParsedShiftCell, LEAVE_CODES } from "@/lib/sheets-parser";
import type { Venue } from "@shared/schema";
import { CheckCircle2, XCircle, AlertTriangle, FileSpreadsheet, ChevronRight, ChevronLeft, Loader2, FileUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface GoogleSheetsImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentYear: number;
  currentMonth: number;
}

const YEARS = [2024, 2025, 2026, 2027];
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

type Step = "month" | "paste" | "preview" | "venue-mapping" | "confirm" | "done";
type ViolationMode = "warn" | "dispatch";

interface EmployeeLookup {
  [code: string]: { id: number; name: string; employeeCode: string; status: string } | undefined;
}

interface VenueMapping {
  [shortCode: string]: number;
}

interface ImportShift {
  employeeId: number;
  venueId: number;
  date: string;
  startTime: string;
  endTime: string;
  role: string;
}

const ROLE_CODE_MAP: Record<string, string> = {
  "救": "救生",
  "教": "教練",
  "指": "指導員",
  "行": "行政",
  "辦": "行政",
  "櫃": "櫃台",
  "管": "管理",
  "守": "守望",
  "清": "清潔",
  "資": "資訊班",
  "PT": "PT",
  "": "救生",
};

function buildShiftRole(roleCode: string): string {
  return ROLE_CODE_MAP[roleCode] || "救生";
}

const LEAVE_ROLE_VALUES = new Set(Object.values(LEAVE_CODES));
const LS_VENUE_KEY = "import-venue-code-mapping";

function loadVenueMappingCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_VENUE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveVenueMappingCache(mapping: Record<string, string>) {
  try {
    localStorage.setItem(LS_VENUE_KEY, JSON.stringify(mapping));
  } catch {}
}

function CellBadge({ cell, venueMapping }: { cell: ParsedShiftCell | null; venueMapping: VenueMapping }) {
  if (!cell) return <span className="text-[10px] text-muted-foreground/40">—</span>;
  if (cell.isLeave) {
    return <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">{cell.leaveType?.replace("假", "")}</span>;
  }
  const hasVenue = !!venueMapping[cell.venueCode];
  return (
    <span className={`text-[10px] font-medium ${hasVenue ? "text-green-700 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
      {cell.venueCode}{cell.roleCode}
    </span>
  );
}

export function GoogleSheetsImportDialog({
  open,
  onOpenChange,
  currentYear,
  currentMonth,
}: GoogleSheetsImportDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("month");
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [tsvText, setTsvText] = useState("");
  const [parseError, setParseError] = useState("");
  const [parsedEmployees, setParsedEmployees] = useState<ParsedEmployeeRow[]>([]);
  const [allVenueCodes, setAllVenueCodes] = useState<string[]>([]);
  const [venueMapping, setVenueMapping] = useState<VenueMapping>({});
  const [autoSuggestedCodes, setAutoSuggestedCodes] = useState<Set<string>>(new Set());
  const [skipExisting, setSkipExisting] = useState(true);
  const [violationMode, setViolationMode] = useState<ViolationMode>("dispatch");
  const [isLoading, setIsLoading] = useState(false);
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [importResult, setImportResult] = useState<{
    created: number;
    skipped: number;
    errors: string[];
    warnings: string[];
    dispatched: string[];
  } | null>(null);

  const { data: allVenues = [] } = useQuery<Venue[]>({
    queryKey: ["/api/venues-all"],
    enabled: open,
  });

  const buildAutoVenueMapping = useCallback((codes: string[], venues: Venue[]): { mapping: VenueMapping; suggested: Set<string> } => {
    const cache = loadVenueMappingCache();
    const mapping: VenueMapping = {};
    const suggested = new Set<string>();

    for (const code of codes) {
      if (cache[code]) {
        const cachedVenue = venues.find(v => v.shortName === cache[code] || String(v.id) === cache[code]);
        if (cachedVenue) {
          mapping[code] = cachedVenue.id;
          continue;
        }
      }
      const exact = venues.find(v => v.shortName === code);
      if (exact) { mapping[code] = exact.id; suggested.add(code); continue; }
      const byPrefix = code.length >= 2 ? venues.find(v => v.shortName.startsWith(code)) : undefined;
      if (byPrefix) { mapping[code] = byPrefix.id; suggested.add(code); continue; }
      const byContains = code.length >= 2 ? venues.find(v => v.shortName.includes(code)) : undefined;
      if (byContains) { mapping[code] = byContains.id; suggested.add(code); continue; }
      const byName = venues.find(v => v.name === code);
      if (byName) { mapping[code] = byName.id; suggested.add(code); }
    }
    return { mapping, suggested };
  }, []);

  const unmappedVenueCodes = useMemo(() => {
    return allVenueCodes.filter(code => !venueMapping[code]);
  }, [allVenueCodes, venueMapping]);

  const handleClose = () => {
    setStep("month");
    setTsvText("");
    setParseError("");
    setParsedEmployees([]);
    setAllVenueCodes([]);
    setVenueMapping({});
    setAutoSuggestedCodes(new Set());
    setImportResult(null);
    onOpenChange(false);
  };

  const handleParseTsv = useCallback(async (tsv: string) => {
    setParseError("");
    if (!tsv.trim()) {
      setParseError("請貼上班表資料或上傳 XLSX 檔案");
      return;
    }

    const knownCodes = allVenues.map(v => v.shortName);
    const result = parseTSV(tsv, year, month, knownCodes);
    if (result.employees.length === 0) {
      setParseError("無法解析員工資料，請確認格式正確（Tab 分隔，欄位順序：類別、員工代號、正兼職、姓名、第1日...）");
      return;
    }

    setIsLoading(true);
    try {
      const codes = result.employees.map(e => e.employeeCode);
      const lookupRes = await fetch(`/api/employees?codes=${codes.join(",")}`, { credentials: "include" });
      if (!lookupRes.ok) throw new Error(await lookupRes.text());
      const lookup: EmployeeLookup = await lookupRes.json();

      const enriched = result.employees.map(emp => ({
        ...emp,
        found: !!lookup[emp.employeeCode],
        employeeId: lookup[emp.employeeCode]?.id,
      }));
      setParsedEmployees(enriched);
      setAllVenueCodes(result.allVenueCodes);

      const { mapping, suggested } = buildAutoVenueMapping(result.allVenueCodes, allVenues);
      setVenueMapping(mapping);
      setAutoSuggestedCodes(suggested);

      setStep("preview");
    } catch (err: any) {
      setParseError("查詢員工資料失敗：" + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [year, month, allVenues, buildAutoVenueMapping]);

  const handleParse = useCallback(() => handleParseTsv(tsvText), [tsvText, handleParseTsv]);

  const handleXlsxUpload = useCallback(async (file: File) => {
    setXlsxLoading(true);
    setParseError("");
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array", raw: false });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("找不到工作表");
      const sheet = wb.Sheets[sheetName];
      const tsv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t", blankrows: false });
      setTsvText(tsv);
      await handleParseTsv(tsv);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "XLSX 解析失敗";
      setParseError("XLSX 解析失敗：" + msg);
    } finally {
      setXlsxLoading(false);
    }
  }, [handleParseTsv]);

  const handlePreviewNext = useCallback(() => {
    const hasUnmapped = allVenueCodes.some(code => !venueMapping[code]);
    setStep(hasUnmapped ? "venue-mapping" : "confirm");
  }, [allVenueCodes, venueMapping]);

  const updateVenueMapping = useCallback((code: string, venueId: number | null) => {
    setVenueMapping(prev => {
      const next = venueId ? { ...prev, [code]: venueId } : (({ [code]: _, ...rest }) => rest)(prev);
      const venue = allVenues.find(v => v.id === venueId);
      if (venue) {
        const cache = loadVenueMappingCache();
        cache[code] = venue.shortName;
        saveVenueMappingCache(cache);
      }
      return next;
    });
  }, [allVenues]);

  const importData = useMemo((): { shifts: ImportShift[]; notFoundEmployees: string[]; totalLeave: number } => {
    const shifts: ImportShift[] = [];
    const notFound: string[] = [];
    let totalLeave = 0;
    const daysInMonth = new Date(year, month, 0).getDate();

    for (const emp of parsedEmployees) {
      if (!emp.found || !emp.employeeId) {
        if (!notFound.includes(emp.name)) notFound.push(emp.name);
        continue;
      }

      const firstNonLeaveVenueId = (() => {
        for (let d = 0; d < daysInMonth; d++) {
          const c = emp.cells[d];
          if (c && !c.isLeave && c.venueCode) {
            const vid = venueMapping[c.venueCode];
            if (vid) return vid;
          }
        }
        return allVenues[0]?.id;
      })();

      for (let d = 0; d < daysInMonth; d++) {
        const cell = emp.cells[d];
        if (!cell) continue;

        const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d + 1).padStart(2, "0")}`;

        if (cell.isLeave && cell.leaveType) {
          if (!firstNonLeaveVenueId) continue;
          totalLeave++;
          shifts.push({
            employeeId: emp.employeeId,
            venueId: firstNonLeaveVenueId,
            date: dateStr,
            startTime: "00:00",
            endTime: "00:00",
            role: cell.leaveType,
          });
          continue;
        }

        if (!cell.isLeave && cell.venueCode) {
          const venueId = venueMapping[cell.venueCode];
          if (!venueId) continue;

          shifts.push({
            employeeId: emp.employeeId,
            venueId,
            date: dateStr,
            startTime: cell.startTime,
            endTime: cell.endTime,
            role: buildShiftRole(cell.roleCode),
          });
        }
      }
    }

    return { shifts, notFoundEmployees: notFound, totalLeave };
  }, [parsedEmployees, venueMapping, year, month, allVenues]);

  const handleImport = async () => {
    const { shifts } = importData;
    if (shifts.length === 0) {
      toast({ title: "無可匯入的班次", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/shifts/import-batch", { shifts, skipExisting, violationMode });
      const result = await res.json();
      setImportResult({
        created: result.created,
        skipped: result.skipped,
        errors: result.errors ?? [],
        warnings: result.warnings ?? [],
        dispatched: result.dispatched ?? [],
      });
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      if ((result.dispatched ?? []).length > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/dispatch-shifts"] });
      }
    } catch (err: any) {
      toast({ title: "匯入失敗", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const { shifts: previewShifts, notFoundEmployees, totalLeave } = importData;

  const daysInMonth = new Date(year, month, 0).getDate();
  const foundCount = parsedEmployees.filter(e => e.found).length;
  const notFoundCount = parsedEmployees.length - foundCount;

  const stepTitle: Record<Step, string> = {
    month: "選擇要匯入的年份與月份",
    paste: "貼上班表資料或上傳 XLSX 檔案",
    preview: "解析預覽 — 員工與班次辨識結果",
    "venue-mapping": "設定場館代碼對應",
    confirm: "確認匯入設定",
    done: "匯入完成",
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            匯入班表
          </DialogTitle>
          <DialogDescription>{stepTitle[step]}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {step === "month" && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="import-year-select">年份</Label>
                  <select
                    id="import-year-select"
                    value={year}
                    onChange={e => setYear(Number(e.target.value))}
                    data-testid="select-import-year"
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {YEARS.map(y => (
                      <option key={y} value={y}>{y} 年</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="import-month-select">月份</Label>
                  <select
                    id="import-month-select"
                    value={month}
                    onChange={e => setMonth(Number(e.target.value))}
                    data-testid="select-import-month"
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {MONTHS.map(m => (
                      <option key={m} value={m}>{m} 月</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                選擇班表所屬的年份和月份，這將用來對應日期欄位。
              </p>
            </div>
          )}

          {step === "paste" && (
            <div className="space-y-4 py-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleXlsxUpload(file);
                  e.target.value = "";
                }}
              />
              <div
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file && file.name.endsWith(".xlsx")) handleXlsxUpload(file);
                  else toast({ title: "請選擇 .xlsx 檔案", variant: "destructive" });
                }}
                data-testid="dropzone-xlsx"
              >
                {xlsxLoading ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <span className="text-sm">正在解析 XLSX...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FileUp className="h-8 w-8 text-primary/60" />
                    <span className="text-sm font-medium text-foreground">點擊或拖曳上傳 XLSX 班表</span>
                    <span className="text-xs">支援 .xlsx 格式（Excel 2007+）</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">或</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="space-y-2">
                <Label>直接貼上班表資料（從 Excel / Google Sheets 複製）</Label>
                <textarea
                  className="w-full h-48 p-3 text-xs font-mono border border-border rounded-md bg-background text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="在 Excel 或 Google Sheets 中選取班表範圍，複製（Ctrl+C），再貼到這裡（Ctrl+V）..."
                  value={tsvText}
                  onChange={e => setTsvText(e.target.value)}
                  data-testid="textarea-tsv-input"
                />
              </div>
              {parseError && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {parseError}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                格式：每列一位員工，欄位依序為「類別、員工代號、正兼職、姓名、第1日...」。班次如「商救0900-1800」「新辦1300-2200」，請假如「休」「特休」「事假」。
              </p>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  已找到員工 {foundCount} 位
                </span>
                {notFoundCount > 0 && (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <XCircle className="h-3 w-3" />
                    未找到 {notFoundCount} 位
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-200 dark:bg-amber-800" />
                  未知場館代碼
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-200 dark:bg-blue-800" />
                  請假
                </span>
              </div>

              <div className="border rounded-md overflow-auto max-h-[340px]">
                <table className="text-[10px] border-collapse">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left px-2 py-1.5 border-b border-r font-medium min-w-[80px]">員工</th>
                      <th className="text-left px-2 py-1.5 border-b border-r font-medium min-w-[60px]">代號</th>
                      <th className="text-left px-2 py-1.5 border-b border-r font-medium w-7">狀態</th>
                      {Array.from({ length: daysInMonth }, (_, i) => (
                        <th key={i} className="px-1 py-1.5 border-b border-r font-medium w-7 text-center">{i + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedEmployees.map((emp, idx) => (
                      <tr key={idx} className={`border-b last:border-b-0 ${!emp.found ? "bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                        <td className="px-2 py-1 border-r font-medium whitespace-nowrap max-w-[80px] overflow-hidden" data-testid={`preview-emp-name-${idx}`}>
                          {emp.name}
                        </td>
                        <td className="px-2 py-1 border-r text-muted-foreground whitespace-nowrap">{emp.employeeCode}</td>
                        <td className="px-2 py-1 border-r text-center">
                          {emp.found ? (
                            <CheckCircle2 className="h-3 w-3 text-green-500 mx-auto" />
                          ) : (
                            <XCircle className="h-3 w-3 text-amber-500 mx-auto" />
                          )}
                        </td>
                        {Array.from({ length: daysInMonth }, (_, d) => {
                          const cell = emp.cells[d];
                          const isUnknownVenue = cell && !cell.isLeave && cell.venueCode && !venueMapping[cell.venueCode];
                          return (
                            <td
                              key={d}
                              className={`px-0.5 py-1 border-r text-center whitespace-nowrap${
                                isUnknownVenue ? " bg-amber-50 dark:bg-amber-950/30" : ""
                              }${cell?.isLeave ? " bg-blue-50 dark:bg-blue-950/20" : ""}`}
                              title={cell?.raw}
                            >
                              <CellBadge cell={cell ?? null} venueMapping={venueMapping} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === "venue-mapping" && (
            <div className="space-y-4 py-4">
              <div className="text-sm text-muted-foreground">
                以下場館代碼尚未自動對應，請手動選擇對應的系統場地。未設定的代碼對應的班次將跳過：
              </div>

              {allVenueCodes.filter(code => venueMapping[code]).length > 0 && (
                <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-3">
                  <div className="text-xs font-medium text-green-700 dark:text-green-400 mb-1.5">已建議對應（可手動修改）：</div>
                  <div className="flex flex-wrap gap-2">
                    {allVenueCodes.filter(code => venueMapping[code]).map(code => {
                      const venue = allVenues.find(v => v.id === venueMapping[code]);
                      const isSuggested = autoSuggestedCodes.has(code);
                      return (
                        <div key={code} className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                          <Badge variant="secondary" className="font-bold">{code}</Badge>
                          <span>→</span>
                          <span>{venue?.shortName}</span>
                          {isSuggested ? (
                            <span className="text-[10px] text-green-500 dark:text-green-600">（自動建議）</span>
                          ) : (
                            <span className="text-[10px] text-blue-500 dark:text-blue-400">（已記憶）</span>
                          )}
                          <CheckCircle2 className="h-3 w-3" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {unmappedVenueCodes.map(code => (
                  <div key={code} className="flex items-center gap-3 p-3 border rounded-md">
                    <div className="w-20 text-center">
                      <Badge variant="secondary" className="text-base font-bold">{code}</Badge>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1">
                      <select
                        value={venueMapping[code] ? String(venueMapping[code]) : ""}
                        onChange={e => {
                          const val = e.target.value;
                          updateVenueMapping(code, val ? Number(val) : null);
                        }}
                        data-testid={`select-venue-mapping-${code}`}
                        className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="">選擇對應場地（不選則跳過）</option>
                        {allVenues.map(v => (
                          <option key={v.id} value={String(v.id)}>
                            {v.shortName} ({v.name})
                          </option>
                        ))}
                      </select>
                    </div>
                    {venueMapping[code] ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "confirm" && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-primary" data-testid="text-import-shift-count">
                    {previewShifts.filter(s => !LEAVE_ROLE_VALUES.has(s.role)).length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">班次</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-blue-600" data-testid="text-import-leave-count">
                    {totalLeave}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">請假</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className={`text-2xl font-bold ${notFoundCount > 0 ? "text-amber-600" : "text-green-600"}`} data-testid="text-import-not-found-count">
                    {notFoundCount}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">未找到員工</div>
                </div>
              </div>

              {notFoundEmployees.length > 0 && (
                <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400 mb-2">
                    <AlertTriangle className="h-4 w-4" />
                    以下員工未找到，將跳過其班次（{notFoundEmployees.length} 位）：
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {notFoundEmployees.map(name => (
                      <Badge key={name} variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 rounded-md border p-3">
                <Switch
                  checked={skipExisting}
                  onCheckedChange={setSkipExisting}
                  data-testid="switch-skip-existing"
                />
                <div>
                  <Label className="text-sm font-medium">跳過已有班次</Label>
                  <p className="text-xs text-muted-foreground">
                    {skipExisting ? "同日同員工已有班次時跳過，不覆蓋" : "同日同員工已有班次時覆蓋更新"}
                  </p>
                </div>
              </div>

              <div className="rounded-md border p-4 space-y-3">
                <Label className="text-sm font-medium">違規班次處理方式</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setViolationMode("dispatch")}
                    data-testid="radio-violation-dispatch"
                    className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors ${
                      violationMode === "dispatch"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center ${violationMode === "dispatch" ? "border-primary" : "border-muted-foreground"}`}>
                        {violationMode === "dispatch" && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      </div>
                      <span className="text-sm font-medium">🔀 轉派遣模式</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-5">違規班次自動移至派遣區，不計入員工正職工時</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViolationMode("warn")}
                    data-testid="radio-violation-warn"
                    className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors ${
                      violationMode === "warn"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center ${violationMode === "warn" ? "border-primary" : "border-muted-foreground"}`}>
                        {violationMode === "warn" && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      </div>
                      <span className="text-sm font-medium">⚠️ 警告模式</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-5">全部匯入，違規班次標記警告，可事後手動修改</p>
                  </button>
                </div>
              </div>

              <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 text-sm text-blue-700 dark:text-blue-300">
                <strong>匯入範圍：</strong>{year} 年 {month} 月，共 {previewShifts.length} 筆記錄（含請假）
              </div>
            </div>
          )}

          {step === "done" && importResult && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">匯入完成</span>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-green-600" data-testid="text-result-created">
                    {importResult.created}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">已匯入</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-purple-600" data-testid="text-result-dispatched">
                    {importResult.dispatched.length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">轉派遣</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-amber-600" data-testid="text-result-warnings">
                    {importResult.warnings.length}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">警告</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-muted-foreground" data-testid="text-result-skipped">
                    {importResult.skipped}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">已跳過</div>
                </div>
              </div>

              {importResult.dispatched.length > 0 && (
                <div className="rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 p-3 space-y-1" data-testid="import-dispatched">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-purple-700 dark:text-purple-400 mb-1">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    自動轉派遣（工時違規，已建立於派遣區）：
                  </div>
                  {importResult.dispatched.slice(0, 8).map((d, i) => (
                    <div key={i} className="text-xs text-purple-700 dark:text-purple-400">{d}</div>
                  ))}
                  {importResult.dispatched.length > 8 && (
                    <div className="text-xs text-muted-foreground">...還有 {importResult.dispatched.length - 8} 筆</div>
                  )}
                </div>
              )}

              {importResult.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1" data-testid="import-warnings">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    勞基法警告（已匯入，建議確認）：
                  </div>
                  {importResult.warnings.slice(0, 8).map((w, i) => (
                    <div key={i} className="text-xs text-amber-700 dark:text-amber-400">{w}</div>
                  ))}
                  {importResult.warnings.length > 8 && (
                    <div className="text-xs text-muted-foreground">...還有 {importResult.warnings.length - 8} 則警告</div>
                  )}
                </div>
              )}

              {importResult.errors.length > 0 && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 space-y-1">
                  <div className="text-sm font-medium text-destructive">錯誤（未匯入）：</div>
                  {importResult.errors.slice(0, 5).map((err, i) => (
                    <div key={i} className="text-xs text-destructive">{err}</div>
                  ))}
                  {importResult.errors.length > 5 && (
                    <div className="text-xs text-muted-foreground">...還有 {importResult.errors.length - 5} 個錯誤</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between gap-2 border-t pt-4">
          <div>
            {step !== "month" && step !== "done" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (step === "paste") setStep("month");
                  else if (step === "preview") setStep("paste");
                  else if (step === "venue-mapping") setStep("preview");
                  else if (step === "confirm") setStep(unmappedVenueCodes.length > 0 ? "venue-mapping" : "preview");
                }}
                data-testid="button-import-back"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                上一步
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleClose} data-testid="button-import-cancel">
              {step === "done" ? "關閉" : "取消"}
            </Button>
            {step === "month" && (
              <Button size="sm" onClick={() => setStep("paste")} data-testid="button-import-next-month">
                下一步
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === "paste" && (
              <Button size="sm" onClick={handleParse} disabled={isLoading || xlsxLoading} data-testid="button-import-parse">
                {isLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                解析並預覽
              </Button>
            )}
            {step === "preview" && (
              <Button size="sm" onClick={handlePreviewNext} data-testid="button-import-next-preview">
                下一步
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === "venue-mapping" && (
              <Button size="sm" onClick={() => setStep("confirm")} data-testid="button-import-next-venue">
                下一步
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === "confirm" && (
              <Button size="sm" onClick={handleImport} disabled={isLoading || previewShifts.length === 0} data-testid="button-import-confirm">
                {isLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                確認匯入 {previewShifts.length} 筆
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
