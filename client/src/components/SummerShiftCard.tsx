import { MapPin } from "lucide-react";

interface SummerShiftCardProps {
  date: string;
  startTime: string;
  endTime: string;
  venueName: string;
  role: string;
  notes?: string | null;
  idx: number;
}

export function SummerShiftCard({ date, startTime, endTime, venueName, role, notes, idx }: SummerShiftCardProps) {
  return (
    <div
      className="border border-juns-border rounded-lg p-3 bg-white"
      data-testid={`card-summer-shift-${idx}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-juns-navy">{date}</span>
        <span className="text-xs text-slate-500">{startTime} - {endTime}</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <MapPin className="h-3.5 w-3.5 text-slate-400" />
        <span>{venueName}</span>
      </div>
      <div className="text-xs text-slate-500 mt-1">{role}</div>
      {notes && (
        <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-blue-700">
          {notes}
        </div>
      )}
    </div>
  );
}
