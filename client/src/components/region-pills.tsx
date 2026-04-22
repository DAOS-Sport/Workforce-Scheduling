import { useRegion } from "@/lib/region-context";
import { REGIONS_DATA, type RegionCode } from "@shared/schema";
import { MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function RegionPills() {
  const { activeRegion, setActiveRegion, selectedRegions, toggleSelectedRegion } = useRegion();
  const selectedSet = new Set(selectedRegions);

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="pills-region">
      {REGIONS_DATA.map((region) => {
        const code = region.code as RegionCode;
        const isSelected = selectedSet.has(code);
        const isPrimary = code === activeRegion;
        const isLastSelected = isSelected && selectedRegions.length === 1;

        return (
          <button
            key={code}
            type="button"
            onClick={(e) => {
              if (e.shiftKey || e.metaKey || e.ctrlKey) {
                if (!isLastSelected) toggleSelectedRegion(code);
              } else {
                if (isSelected && !isPrimary) {
                  setActiveRegion(code);
                } else if (!isSelected) {
                  toggleSelectedRegion(code);
                  setActiveRegion(code);
                } else if (isPrimary) {
                  if (!isLastSelected) toggleSelectedRegion(code);
                }
              }
            }}
            data-testid={`pill-region-${code}`}
            data-active={isPrimary}
            data-selected={isSelected}
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
              isSelected
                ? isPrimary
                  ? "bg-juns-teal text-white border-juns-teal shadow-sm"
                  : "bg-juns-teal/10 text-juns-navy border-juns-teal/40"
                : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-50",
            )}
            title={isPrimary ? "主區域（再點一次取消）" : isSelected ? "點擊設為主區域 / Shift+點擊移除" : "點擊新增"}
          >
            <MapPin className="h-3 w-3" />
            <span>{region.name}</span>
            {isSelected && !isPrimary && <Check className="h-3 w-3" />}
          </button>
        );
      })}
    </div>
  );
}
