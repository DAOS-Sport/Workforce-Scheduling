import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
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
    // Switching activeRegion does not silently add other regions; if the new
    // activeRegion wasn't in the multi-select set, reset to just it.
    setSelectedRegionsSet((prev) => {
      if (prev.has(region)) return prev;
      return new Set<RegionCode>([region]);
    });
  }, []);

  const activeRegionRef = useRef<RegionCode>(activeRegion);
  activeRegionRef.current = activeRegion;

  const toggleSelectedRegion = useCallback((region: RegionCode) => {
    setSelectedRegionsSet((prev) => {
      const next = new Set(prev);
      if (next.has(region)) {
        if (next.size <= 1) return prev; // never empty
        next.delete(region);
        // If we just removed the activeRegion, auto-promote the first
        // remaining region (REGION_ORDER) so write paths stay valid.
        if (region === activeRegionRef.current) {
          const fallback = REGION_ORDER.find((r) => next.has(r));
          if (fallback) setActiveRegionState(fallback);
        }
      } else {
        next.add(region);
      }
      return next;
    });
  }, []);

  const setSelectedRegions = useCallback((regions: RegionCode[]) => {
    if (regions.length === 0) return;
    const next = new Set<RegionCode>(regions);
    // Maintain invariant: activeRegion ∈ selectedRegions. If the caller's
    // list does not contain the current activeRegion, promote the first
    // region in REGION_ORDER instead of silently re-adding the old one.
    if (!next.has(activeRegionRef.current)) {
      const fallback = REGION_ORDER.find((r) => next.has(r));
      if (fallback) setActiveRegionState(fallback);
    }
    setSelectedRegionsSet(next);
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
