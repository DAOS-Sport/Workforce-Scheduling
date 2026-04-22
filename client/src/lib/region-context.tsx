import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { RegionCode } from "@shared/schema";

const REGION_ORDER: RegionCode[] = ["A", "B", "C", "D"];

interface RegionContextType {
  activeRegion: RegionCode;
  setActiveRegion: (region: RegionCode) => void;
  // Multi-select view scope. Always contains activeRegion as an invariant.
  // Single-select pages can ignore this entirely; switching activeRegion
  // does NOT silently add other regions, so no cross-page leakage occurs.
  selectedRegions: RegionCode[];
  toggleSelectedRegion: (region: RegionCode) => void;
  setSelectedRegions: (regions: RegionCode[]) => void;
  resetSelectedRegionsToActive: () => void;
}

const RegionContext = createContext<RegionContextType>({
  activeRegion: "A",
  setActiveRegion: () => {},
  selectedRegions: ["A"],
  toggleSelectedRegion: () => {},
  setSelectedRegions: () => {},
  resetSelectedRegionsToActive: () => {},
});

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const [activeRegion, setActiveRegionState] = useState<RegionCode>("A");
  const [selectedRegionsSet, setSelectedRegionsSet] = useState<Set<RegionCode>>(() => new Set<RegionCode>(["A"]));

  const setActiveRegion = useCallback((region: RegionCode) => {
    setActiveRegionState(region);
    // Maintain invariant: activeRegion ∈ selectedRegions.
    // We DO NOT preserve previously selected regions when primary changes
    // unless the new primary was already one of them — this prevents
    // multi-select scope from silently leaking across navigations.
    setSelectedRegionsSet((prev) => {
      if (prev.has(region)) return prev;
      return new Set<RegionCode>([region]);
    });
  }, []);

  const toggleSelectedRegion = useCallback((region: RegionCode) => {
    setSelectedRegionsSet((prev) => {
      const next = new Set(prev);
      if (next.has(region)) {
        // Never remove the primary region (UI should also guard).
        if (next.size <= 1) return prev;
        next.delete(region);
      } else {
        next.add(region);
      }
      return next;
    });
  }, []);

  const setSelectedRegions = useCallback((regions: RegionCode[]) => {
    if (regions.length === 0) return;
    setSelectedRegionsSet(new Set<RegionCode>(regions));
  }, []);

  const resetSelectedRegionsToActive = useCallback(() => {
    setSelectedRegionsSet(new Set<RegionCode>([activeRegion]));
  }, [activeRegion]);

  const selectedRegions = useMemo(
    () => REGION_ORDER.filter((r) => selectedRegionsSet.has(r)),
    [selectedRegionsSet],
  );

  const value = useMemo<RegionContextType>(() => ({
    activeRegion,
    setActiveRegion,
    selectedRegions,
    toggleSelectedRegion,
    setSelectedRegions,
    resetSelectedRegionsToActive,
  }), [activeRegion, setActiveRegion, selectedRegions, toggleSelectedRegion, setSelectedRegions, resetSelectedRegionsToActive]);

  return (
    <RegionContext.Provider value={value}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion() {
  return useContext(RegionContext);
}
