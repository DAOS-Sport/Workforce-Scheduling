import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Shield, Clock, Trash2 } from "lucide-react";
import type { Venue, Shift, Employee, ShiftValidationError } from "@shared/schema";
import { validateAllRules } from "@/lib/labor-law";

interface ShiftCellEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
  date: string;
  venues: Venue[];
  existingShifts: Shift[];
  currentShift?: Shift;
  onSave: (data: {
    venueId: number;
    startTime: string;
    endTime: string;
    isDispatch: boolean;
    dispatchCompany?: string;
    dispatchName?: string;
    dispatchPhone?: string;
  }) => void;
  onDelete?: () => void;
}

export function ShiftCellEditor({
  open,
  onOpenChange,
  employee,
  date,
  venues,
  existingShifts,
  currentShift,
  onSave,
  onDelete,
}: ShiftCellEditorProps) {
  const [venueId, setVenueId] = useState<string>(currentShift?.venueId?.toString() || "");
  const [startTime, setStartTime] = useState(currentShift?.startTime || "08:00");
  const [endTime, setEndTime] = useState(currentShift?.endTime || "17:00");
  const [isDispatch, setIsDispatch] = useState(currentShift?.isDispatch || false);
  const [dispatchCompany, setDispatchCompany] = useState(currentShift?.dispatchCompany || "");
  const [dispatchName, setDispatchName] = useState(currentShift?.dispatchName || "");
  const [dispatchPhone, setDispatchPhone] = useState(currentShift?.dispatchPhone || "");
  const [violations, setViolations] = useState<ShiftValidationError[]>([]);

  const handleTimeChange = (field: "start" | "end", value: string) => {
    if (field === "start") setStartTime(value);
    else setEndTime(value);
    setTimeout(() => {
      const st = field === "start" ? value : startTime;
      const et = field === "end" ? value : endTime;
      if (st && et) {
        const errors = validateAllRules(employee.id, date, st, et, existingShifts, currentShift?.id);
        setViolations(errors);
      }
    }, 0);
  };

  const handleSave = () => {
    if (!venueId || !startTime || !endTime) return;
    const errors = validateAllRules(employee.id, date, startTime, endTime, existingShifts, currentShift?.id);
    if (errors.some((e) => e.type === "seven_day_rest" || e.type === "daily_12h")) {
      setViolations(errors);
      return;
    }
    onSave({
      venueId: parseInt(venueId),
      startTime,
      endTime,
      isDispatch,
      dispatchCompany: isDispatch ? dispatchCompany : undefined,
      dispatchName: isDispatch ? dispatchName : undefined,
      dispatchPhone: isDispatch ? dispatchPhone : undefined,
    });
    onOpenChange(false);
  };

  const hasBlockingError = violations.some(
    (v) => v.type === "seven_day_rest" || v.type === "daily_12h"
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            排班編輯 — {employee.name}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{date}</p>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>場館</Label>
            <Select value={venueId} onValueChange={setVenueId}>
              <SelectTrigger data-testid="select-venue">
                <SelectValue placeholder="選擇場館" />
              </SelectTrigger>
              <SelectContent>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={v.id.toString()}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Label>上班時間</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => handleTimeChange("start", e.target.value)}
                data-testid="input-start-time"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label>下班時間</Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => handleTimeChange("end", e.target.value)}
                data-testid="input-end-time"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-md border p-3">
            <Switch
              checked={isDispatch}
              onCheckedChange={setIsDispatch}
              data-testid="switch-dispatch"
            />
            <div>
              <Label className="text-sm font-medium">派遣模式</Label>
              <p className="text-xs text-muted-foreground">標記為外部派遣人員</p>
            </div>
          </div>

          {isDispatch && (
            <div className="space-y-3 rounded-md border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 p-3">
              <div className="space-y-2">
                <Label className="text-xs">派遣公司</Label>
                <Input
                  value={dispatchCompany}
                  onChange={(e) => setDispatchCompany(e.target.value)}
                  placeholder="公司名稱"
                  data-testid="input-dispatch-company"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">派遣姓名</Label>
                <Input
                  value={dispatchName}
                  onChange={(e) => setDispatchName(e.target.value)}
                  placeholder="姓名"
                  data-testid="input-dispatch-name"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">聯絡電話</Label>
                <Input
                  value={dispatchPhone}
                  onChange={(e) => setDispatchPhone(e.target.value)}
                  placeholder="電話"
                  data-testid="input-dispatch-phone"
                />
              </div>
            </div>
          )}

          {violations.length > 0 && (
            <div className="space-y-2">
              {violations.map((v, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-md p-3 text-sm ${
                    v.type === "rest_11h"
                      ? "bg-yellow-50 dark:bg-yellow-950/30 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800"
                      : "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800"
                  }`}
                  data-testid={`alert-violation-${v.type}`}
                >
                  {v.type === "rest_11h" ? (
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  ) : (
                    <Shield className="h-4 w-4 mt-0.5 shrink-0" />
                  )}
                  <span>{v.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row gap-2 justify-between sm:justify-between">
          <div>
            {currentShift && onDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onDelete();
                  onOpenChange(false);
                }}
                data-testid="button-delete-shift"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                刪除
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-shift">
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={!venueId || !startTime || !endTime || hasBlockingError}
              data-testid="button-save-shift"
            >
              儲存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
