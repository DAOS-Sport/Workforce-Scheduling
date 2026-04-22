import { REGIONS_DATA, type RegionCode } from "@shared/schema";
import { MapPin, SquareCheck, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface RegionPillsProps {
  selectedRegions: RegionCode[];
  onToggleSelected: (region: RegionCode) => void;
}

export function RegionPills({ selectedRegions, onToggleSelected }: RegionPillsProps) {
  const selectedSet = new Set(selectedRegions);
  const isLastSelected = selectedSet.size <= 1;

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="pills-region">
      {REGIONS_DATA.map((region) => {
        const code = region.code as RegionCode;
        const isSelected = selectedSet.has(code);
        const cannotUncheck = isSelected && isLastSelected;

        const handleClick = () => {
          if (cannotUncheck) return;
          onToggleSelected(code);
        };

        return (
          <div
            key={code}
            className={cn(
              "inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full text-xs font-medium border transition-all select-none",
              cannotUncheck ? "cursor-default" : "cursor-pointer",
              isSelected
                ? "bg-juns-teal/10 text-juns-navy border-juns-teal/40 hover:bg-juns-teal/15"
                : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-50",
            )}
            data-testid={`pill-region-${code}`}
            data-selected={isSelected}
            onClick={handleClick}
            role="button"
            aria-pressed={isSelected}
            title={
              cannotUncheck
                ? "至少要保留一個區域"
                : isSelected
                  ? "點擊取消顯示此區"
                  : "點擊加入顯示此區"
            }
          >
            <MapPin className={cn("h-3 w-3", isSelected ? "text-juns-teal" : "text-slate-400")} />
            <span>{region.name}</span>
            {isSelected ? (
              <SquareCheck className="h-3.5 w-3.5 text-juns-teal" />
            ) : (
              <Square className="h-3.5 w-3.5 text-slate-300" />
            )}
          </div>
        );
      })}
    </div>
  );
}
