import { REGIONS_DATA, type RegionCode } from "@shared/schema";
import { MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface RegionPillsProps {
  activeRegion: RegionCode;
  selectedRegions: RegionCode[];
  onSetActive: (region: RegionCode) => void;
  onToggleSelected: (region: RegionCode) => void;
}

export function RegionPills({ activeRegion, selectedRegions, onSetActive, onToggleSelected }: RegionPillsProps) {
  const selectedSet = new Set(selectedRegions);

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="pills-region">
      {REGIONS_DATA.map((region) => {
        const code = region.code as RegionCode;
        const isSelected = selectedSet.has(code);
        const isPrimary = code === activeRegion;

        const handleClick = (e: React.MouseEvent) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            // Modifier-click: toggle non-primary regions only.
            if (isPrimary) return;
            onToggleSelected(code);
            return;
          }
          // Plain click on primary: no-op (cannot deselect primary).
          if (isPrimary) return;
          // Plain click on selected non-primary: promote to primary.
          if (isSelected) {
            onSetActive(code);
            return;
          }
          // Plain click on unselected: add to selection AND make primary.
          onToggleSelected(code);
          onSetActive(code);
        };

        return (
          <button
            key={code}
            type="button"
            onClick={handleClick}
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
            title={
              isPrimary
                ? "主區域（無法取消）"
                : isSelected
                  ? "點擊設為主區域 / Shift+點擊移除"
                  : "點擊新增並設為主區域 / Shift+點擊只新增"
            }
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
