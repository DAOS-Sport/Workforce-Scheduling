import { REGIONS_DATA, type RegionCode } from "@shared/schema";
import { MapPin, Star, Check } from "lucide-react";
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

        const handlePillClick = () => {
          // Plain click toggles selection. Primary cannot be deselected
          // (toggleSelectedRegion in parent enforces this invariant).
          if (isPrimary) return;
          if (!isSelected) {
            // Newly selecting also promotes to primary for fast single-region switching.
            onToggleSelected(code);
            onSetActive(code);
            return;
          }
          // Deselect (allowed because not primary).
          onToggleSelected(code);
        };

        const handleStarClick = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (isPrimary || !isSelected) return;
          onSetActive(code);
        };

        return (
          <div
            key={code}
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer select-none",
              isSelected
                ? isPrimary
                  ? "bg-juns-teal text-white border-juns-teal shadow-sm"
                  : "bg-juns-teal/10 text-juns-navy border-juns-teal/40"
                : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-50",
            )}
            data-testid={`pill-region-${code}`}
            data-active={isPrimary}
            data-selected={isSelected}
            onClick={handlePillClick}
            role="button"
            title={
              isPrimary
                ? "主區域（無法取消）"
                : isSelected
                  ? "點擊取消勾選；點星號設為主區域"
                  : "點擊勾選並設為主區域"
            }
          >
            {isPrimary ? (
              <Star className="h-3 w-3 fill-current" />
            ) : (
              <MapPin className="h-3 w-3" />
            )}
            <span>{region.name}</span>
            {isSelected && !isPrimary && (
              <button
                type="button"
                onClick={handleStarClick}
                className="ml-0.5 rounded p-0.5 hover:bg-juns-teal/20 transition-colors"
                data-testid={`button-set-primary-${code}`}
                title="設為主區域"
              >
                <Star className="h-3 w-3" />
              </button>
            )}
            {isSelected && !isPrimary && <Check className="h-3 w-3" />}
          </div>
        );
      })}
    </div>
  );
}
