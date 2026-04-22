import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { RegionCode } from "@shared/schema";

interface RegionContextType {
  activeRegion: RegionCode;
  setActiveRegion: (region: RegionCode) => void;
}

const RegionContext = createContext<RegionContextType>({
  activeRegion: "A",
  setActiveRegion: () => {},
});

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const [activeRegion, setActiveRegionState] = useState<RegionCode>("A");

  const setActiveRegion = useCallback((region: RegionCode) => {
    setActiveRegionState(region);
  }, []);

  const value = useMemo<RegionContextType>(() => ({
    activeRegion,
    setActiveRegion,
  }), [activeRegion, setActiveRegion]);

  return (
    <RegionContext.Provider value={value}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion() {
  return useContext(RegionContext);
}
