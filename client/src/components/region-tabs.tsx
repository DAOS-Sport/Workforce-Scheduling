import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRegion } from "@/lib/region-context";
import { REGIONS_DATA, type RegionCode } from "@shared/schema";
import { MapPin } from "lucide-react";

export function RegionTabs() {
  const { activeRegion, setActiveRegion } = useRegion();

  return (
    <Tabs value={activeRegion} onValueChange={(v) => setActiveRegion(v as RegionCode)} className="flex justify-center">
      <TabsList data-testid="tabs-region">
        {REGIONS_DATA.map((region) => (
          <TabsTrigger
            key={region.code}
            value={region.code}
            data-testid={`tab-region-${region.code}`}
            className="gap-1.5"
          >
            <MapPin className="h-3.5 w-3.5" />
            <span>{region.name}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
