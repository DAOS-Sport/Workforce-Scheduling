import { createContext, useContext, useState } from "react";
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
  const [activeRegion, setActiveRegion] = useState<RegionCode>("A");

  return (
    <RegionContext.Provider value={{ activeRegion, setActiveRegion }}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion() {
  return useContext(RegionContext);
}
