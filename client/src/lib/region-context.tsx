import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { RegionCode } from "@shared/schema";

interface RegionContextType {
  activeRegion: RegionCode;
  setActiveRegion: (region: RegionCode) => void;
  selectedRegions: RegionCode[];
  toggleSelectedRegion: (region: RegionCode) => void;
  setSelectedRegions: (regions: RegionCode[]) => void;
}

const RegionContext = createContext<RegionContextType>({
  activeRegion: "A",
  setActiveRegion: () => {},
  selectedRegions: ["A"],
  toggleSelectedRegion: () => {},
  setSelectedRegions: () => {},
});

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const [activeRegion, setActiveRegionState] = useState<RegionCode>("A");
  const [selectedRegionsSet, setSelectedRegionsSet] = useState<Set<RegionCode>>(() => new Set(["A"]));

  const setActiveRegion = useCallback((region: RegionCode) => {
    setActiveRegionState(region);
    setSelectedRegionsSet((prev) => {
      const next = new Set(prev);
      next.add(region);
      return next;
    });
  }, []);

  const toggleSelectedRegion = useCallback((region: RegionCode) => {
    setSelectedRegionsSet((prev) => {
      const next = new Set(prev);
      if (next.has(region)) {
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
    setSelectedRegionsSet(new Set(regions));
  }, []);

  const selectedRegions = useMemo(() => {
    const order: RegionCode[] = ["A", "B", "C", "D"];
    return order.filter((r) => selectedRegionsSet.has(r));
  }, [selectedRegionsSet]);

  const value = useMemo<RegionContextType>(() => ({
    activeRegion,
    setActiveRegion,
    selectedRegions,
    toggleSelectedRegion,
    setSelectedRegions,
  }), [activeRegion, setActiveRegion, selectedRegions, toggleSelectedRegion, setSelectedRegions]);

  return (
    <RegionContext.Provider value={value}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion() {
  return useContext(RegionContext);
}
