import { db } from "./db";
import { regions, venues, employees } from "@shared/schema";
import { REGIONS_DATA } from "@shared/schema";
import { eq } from "drizzle-orm";

const VENUE_FULL_DATA = [
  { name: "新北高中", shortName: "新北高中", regionCode: "A", address: "新北市三重區三信路1號", lat: 25.08725005030422, lng: 121.49125601819283, taxId: "85300099", operationType: "OT" },
  { name: "三民高中", shortName: "三民高中", regionCode: "A", address: "新北市蘆洲區三民路96號", lat: 25.08647850866701, lng: 121.4742795576005, taxId: "66601546", operationType: "OT" },
  { name: "三重商工", shortName: "三重商工", regionCode: "A", address: "新北市三重區中正北路163號", lat: 25.068783172507857, lng: 121.48241151452356, taxId: "85184649", operationType: "OT" },
  { name: "新莊國中", shortName: "新莊國中", regionCode: "A", address: "新北市新莊區中正路211號", lat: 25.0358, lng: 121.4520, taxId: "66601546", operationType: "OT" },
  { name: "松山國小", shortName: "松山國小", regionCode: "B", address: "台北市松山區八德路四段746號", lat: 25.050835631078957, lng: 121.57794212990194, taxId: "66601546", operationType: "OT" },
  { name: "國防醫學大學", shortName: "國防醫學大學", regionCode: "B", address: "台北市內湖區民權東路六段161號", lat: 25.0640, lng: 121.6076, taxId: "66601546", operationType: "OT" },
  { name: "士東國小", shortName: "士東國小", regionCode: "B", address: "台北市士林區中山北路六段392號", lat: 25.1110, lng: 121.5275, taxId: "66601546", operationType: "OT" },
  { name: "大湖國小", shortName: "大湖國小", regionCode: "B", address: "台北市內湖區大湖山莊街170號", lat: 25.0832, lng: 121.6016, taxId: "66601546", operationType: "OT" },
  { name: "溪口國小", shortName: "溪口國小", regionCode: "B", address: "台北市文山區景福街225號", lat: 24.9893, lng: 121.5391, taxId: "66601546", operationType: "OT" },
  { name: "建成國中", shortName: "建成國中", regionCode: "B", address: "台北市大同區長安西路37-1號", lat: 25.0513, lng: 121.5212, taxId: "66601546", operationType: "OT" },
  { name: "士林國小", shortName: "士林國小", regionCode: "B", address: "台北市士林區大東路165號", lat: 25.0937, lng: 121.5253, taxId: "66601546", operationType: "OT" },
  { name: "義方國小", shortName: "義方國小", regionCode: "B", address: "台北市北投區珠海路155號", lat: 25.1326, lng: 121.5065, taxId: "66601546", operationType: "OT" },
  { name: "百齡高中", shortName: "百齡高中", regionCode: "B", address: "台北市士林區承德路四段177號", lat: 25.0867, lng: 121.5213, taxId: "66601546", operationType: "OT" },
  { name: "清江國小", shortName: "清江國小", regionCode: "B", address: "台北市北投區公館路220號", lat: 25.1218, lng: 121.5029, taxId: "66601546", operationType: "OT" },
  { name: "福林國小", shortName: "福林國小", regionCode: "B", address: "台北市士林區福志路75號", lat: 25.0979, lng: 121.5249, taxId: "66601546", operationType: "勞務採購" },
  { name: "明倫高中", shortName: "明倫高中", regionCode: "B", address: "台北市大同區承德路三段336號", lat: 25.0700, lng: 121.5180, taxId: "66601546", operationType: "勞務採購" },
  { name: "民生國中", shortName: "民生國中", regionCode: "B", address: "台北市松山區新東街30巷1號", lat: 25.0584, lng: 121.5639, taxId: "66601546", operationType: "勞務採購" },
  { name: "永吉國中", shortName: "永吉國中", regionCode: "B", address: "台北市信義區松隆路161號", lat: 25.0428, lng: 121.5708, taxId: "66601546", operationType: "勞務採購" },
  { name: "西湖國中", shortName: "西湖國中", regionCode: "B", address: "台北市內湖區環山路一段27號", lat: 25.0786, lng: 121.5651, taxId: "66601546", operationType: "勞務採購" },
  { name: "陽明高中", shortName: "陽明高中", regionCode: "B", address: "台北市士林區中正路510號", lat: 25.0930, lng: 121.5167, taxId: "66601546", operationType: "勞務採購" },
  { name: "台灣科技大學", shortName: "台灣科技大學", regionCode: "B", address: "台北市大安區基隆路四段43號", lat: 25.0127, lng: 121.5416, taxId: "66601546", operationType: "勞務採購" },
  { name: "新竹科學園區", shortName: "新竹科園", regionCode: "C", address: "新竹市東區新安路2號", lat: 24.7862, lng: 120.9976, taxId: "66601546", operationType: "OT" },
  { name: "新屋高中", shortName: "新屋高中", regionCode: "C", address: "桃園市新屋區中興路111號", lat: 24.9722, lng: 121.1061, taxId: "66601546", operationType: "OT" },
  { name: "駿斯運動事業股份有限公司", shortName: "駿斯運動事業股份有限公司", regionCode: "D", address: "新北市永和區秀朗路2段148巷5弄13號4樓", lat: 25.0082, lng: 121.5133, taxId: "66601546", operationType: "內勤單位", isInternal: true },
  { name: "人力資源處", shortName: "人力資源處", regionCode: "D", address: "新北市永和區秀朗路2段148巷5弄13號4樓", lat: 25.0082, lng: 121.5133, taxId: "66601546", operationType: "內勤單位", isInternal: true },
  { name: "數位轉型發展處", shortName: "數位轉型發展處", regionCode: "D", address: "新北市永和區秀朗路2段148巷5弄13號4樓", lat: 25.0082, lng: 121.5133, taxId: "66601546", operationType: "內勤單位", isInternal: true },
  { name: "營運管理處", shortName: "營運管理處", regionCode: "D", address: "新北市永和區秀朗路2段148巷5弄13號4樓", lat: 25.0082, lng: 121.5133, taxId: "66601546", operationType: "內勤單位", isInternal: true },
  { name: "行銷事業處", shortName: "行銷事業處", regionCode: "D", address: "新北市永和區秀朗路2段148巷5弄13號4樓", lat: 25.0082, lng: 121.5133, taxId: "66601546", operationType: "內勤單位", isInternal: true },
];

export async function seedDatabase() {
  const existingRegions = await db.select().from(regions);

  if (existingRegions.length === 0) {
    console.log("Seeding database (fresh)...");
    const regionRecords: Record<string, number> = {};
    for (const r of REGIONS_DATA) {
      const [created] = await db.insert(regions).values({ name: r.name, code: r.code }).returning();
      regionRecords[r.code] = created.id;
    }

    for (const v of VENUE_FULL_DATA) {
      await db.insert(venues).values({
        name: v.name,
        shortName: v.shortName,
        regionId: regionRecords[v.regionCode],
        address: v.address,
        latitude: v.lat,
        longitude: v.lng,
        radius: 200,
        taxId: v.taxId,
        isInternal: !!(v as any).isInternal,
        operationType: v.operationType,
      });
    }

    console.log("Database seeded successfully!");
    return;
  }

  console.log("Checking for missing regions/venues...");
  const regionMap = new Map(existingRegions.map((r) => [r.code, r.id]));

  for (const r of REGIONS_DATA) {
    if (!regionMap.has(r.code)) {
      const [created] = await db.insert(regions).values({ name: r.name, code: r.code }).returning();
      regionMap.set(r.code, created.id);
      console.log(`  Added region: ${r.name} (${r.code})`);
    }
  }

  const existingVenues = await db.select().from(venues);
  const existingNames = new Set(existingVenues.map((v) => v.shortName));

  let addedCount = 0;
  let updatedCount = 0;

  for (const v of VENUE_FULL_DATA) {
    const regionId = regionMap.get(v.regionCode);
    if (!regionId) continue;

    const existing = existingVenues.find(
      (ev) => ev.shortName === v.shortName || ev.name === v.name || ev.name === v.name + "館"
    );

    if (existing) {
      const updates: Record<string, any> = {};
      if (!existing.taxId && v.taxId) updates.taxId = v.taxId;
      if (!existing.operationType) updates.operationType = v.operationType;
      if (!existing.address && v.address) updates.address = v.address;
      if (v.lat && existing.latitude !== v.lat) updates.latitude = v.lat;
      if (v.lng && existing.longitude !== v.lng) updates.longitude = v.lng;
      updates.radius = 200;
      if (v.regionCode === "D" && existing.regionId !== regionId) {
        updates.regionId = regionId;
        updates.isInternal = true;
      }

      if (Object.keys(updates).length > 0) {
        await db.update(venues).set(updates).where(eq(venues.id, existing.id));
        updatedCount++;
      }
    } else {
      await db.insert(venues).values({
        name: v.name,
        shortName: v.shortName,
        regionId,
        address: v.address,
        latitude: v.lat,
        longitude: v.lng,
        radius: 200,
        taxId: v.taxId,
        isInternal: !!(v as any).isInternal,
        operationType: v.operationType,
      });
      addedCount++;
    }
  }

  if (addedCount > 0 || updatedCount > 0) {
    console.log(`  Venues: ${addedCount} added, ${updatedCount} updated`);
  } else {
    console.log("  All venues up to date");
  }

  const INITIAL_ADMIN_LINE_ID = "U8fd0e4be4e44a1304f9fa2e9855f4559";
  const [adminEmp] = await db.select().from(employees).where(eq(employees.lineId, INITIAL_ADMIN_LINE_ID));
  if (adminEmp && !adminEmp.isAdmin) {
    await db.update(employees).set({ isAdmin: true }).where(eq(employees.id, adminEmp.id));
    console.log(`  Set ${adminEmp.name} as initial admin`);
  }
}
