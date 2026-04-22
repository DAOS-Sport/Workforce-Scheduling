import { REGIONS_DATA, type RegionCode } from "@shared/schema";
import { MapPin, Star } from "lucide-react";
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

        // Plain click on the pill body: toggle selection only.
        // Primary region cannot be deselected (parent toggle enforces this).
        // Selecting/adding a region does NOT change the primary; user must
        // click the star button to promote a region to primary. This keeps
        // write-target semantics anchored to activeRegion.
        const handlePillClick = () => {
          if (isPrimary) return; // primary cannot be deselected
          onToggleSelected(code);
        };

        const handleStarClick = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (isPrimary) return;
          if (!isSelected) {
            // Star on unselected → also add to selection.
            onToggleSelected(code);
          }
          onSetActive(code);
        };

        return (
          <div
            key={code}
            className={cn(
              "inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium border transition-all select-none",
              isPrimary ? "cursor-default" : "cursor-pointer",
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
                ? "主區域（寫入目標，無法取消）"
                : isSelected
                  ? "點擊取消勾選；點星號設為主區域"
                  : "點擊勾選顯示；點星號設為主區域"
            }
          >
            <MapPin className="h-3 w-3" />
            <span>{region.name}</span>
            <button
              type="button"
              onClick={handleStarClick}
              disabled={isPrimary}
              className={cn(
                "ml-0.5 rounded-full p-0.5 transition-colors",
                isPrimary
                  ? "cursor-default"
                  : isSelected
                    ? "hover:bg-juns-teal/20"
                    : "hover:bg-slate-200",
              )}
              data-testid={`button-set-primary-${code}`}
              title={isPrimary ? "已是主區域" : "設為主區域"}
              aria-label={isPrimary ? "已是主區域" : "設為主區域"}
            >
              <Star
                className={cn(
                  "h-3 w-3",
                  isPrimary ? "fill-current text-white" : "text-slate-400",
                )}
              />
            </button>
          </div>
        );
      })}
    </div>
  );
}
