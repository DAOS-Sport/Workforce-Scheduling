import { db } from "./db";
import { regions, venues } from "@shared/schema";
import { REGIONS_DATA } from "@shared/schema";

export async function seedDatabase() {
  const existingRegions = await db.select().from(regions);
  if (existingRegions.length > 0) {
    console.log("Database already seeded, skipping...");
    return;
  }

  console.log("Seeding database...");

  const regionRecords: Record<string, number> = {};
  for (const r of REGIONS_DATA) {
    const [created] = await db.insert(regions).values({ name: r.name, code: r.code }).returning();
    regionRecords[r.code] = created.id;
  }

  const venueData = [
    { name: "三重商工館", shortName: "三重商工", regionCode: "A", address: "新北市三重區中正北路163號", lat: 25.0645, lng: 121.4873 },
    { name: "新北高中館", shortName: "新北高中", regionCode: "A", address: "新北市三重區三信路1號", lat: 25.0712, lng: 121.4956 },
    { name: "三民高中館", shortName: "三民高中", regionCode: "A", address: "新北市蘆洲區三民路60號", lat: 25.0834, lng: 121.4789 },
    { name: "松山國小館", shortName: "松山國小", regionCode: "B", address: "台北市松山區八德路四段746號", lat: 25.0498, lng: 121.5785 },
    { name: "新竹科學園區", shortName: "新竹科園", regionCode: "C", address: "新竹市東區新安路2號", lat: 24.7862, lng: 120.9976 },
  ];

  for (const v of venueData) {
    await db.insert(venues).values({
      name: v.name,
      shortName: v.shortName,
      regionId: regionRecords[v.regionCode],
      address: v.address,
      latitude: v.lat,
      longitude: v.lng,
      radius: 100,
    });
  }

  console.log("Database seeded successfully!");
}
