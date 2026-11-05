/** Known venues (address, coordinates, tax id, region) that the Ragic venue sync and the boot seed agree on. */

export interface VenueInfo {
  region: string;
  address: string;
  lat: number;
  lng: number;
  taxId: string;
  isInternal: boolean;
  operationType: string;
}

const HQ_ADDRESS = "新北市永和區秀朗路2段148巷5弄13號4樓";
const HQ_LAT = 25.0082;
const HQ_LNG = 121.5133;
const COMPANY_TAX_ID = "66601546";

export const VENUE_DATA: Record<string, VenueInfo> = {
  "新北高中": { region: "A", address: "新北市三重區三信路1號", lat: 25.08725005030422, lng: 121.49125601819283, taxId: "85300099", isInternal: false, operationType: "OT" },
  "三民高中": { region: "A", address: "新北市蘆洲區三民路96號", lat: 25.08647850866701, lng: 121.4742795576005, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "三重商工": { region: "A", address: "新北市三重區中正北路163號", lat: 25.068783172507857, lng: 121.48241151452356, taxId: "85184649", isInternal: false, operationType: "OT" },
  "新莊國中": { region: "A", address: "新北市新莊區中正路211號", lat: 25.0358, lng: 121.4520, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "松山國小": { region: "B", address: "台北市松山區八德路四段746號", lat: 25.050835631078957, lng: 121.57794212990194, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "國防醫學大學": { region: "B", address: "台北市內湖區民權東路六段161號", lat: 25.0640, lng: 121.6076, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "士東國小": { region: "B", address: "台北市士林區中山北路六段392號", lat: 25.1110, lng: 121.5275, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "大湖國小": { region: "B", address: "台北市內湖區大湖山莊街170號", lat: 25.0832, lng: 121.6016, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "溪口國小": { region: "B", address: "台北市文山區景福街225號", lat: 24.9893, lng: 121.5391, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "建成國中": { region: "B", address: "台北市大同區長安西路37-1號", lat: 25.0513, lng: 121.5212, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "士林國小": { region: "B", address: "台北市士林區大東路165號", lat: 25.0937, lng: 121.5253, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "義方國小": { region: "B", address: "台北市北投區珠海路155號", lat: 25.1326, lng: 121.5065, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "百齡高中": { region: "B", address: "台北市士林區承德路四段177號", lat: 25.0867, lng: 121.5213, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "清江國小": { region: "B", address: "台北市北投區公館路220號", lat: 25.1218, lng: 121.5029, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "福林國小": { region: "B", address: "台北市士林區福志路75號", lat: 25.0979, lng: 121.5249, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "明倫高中": { region: "B", address: "台北市大同區承德路三段336號", lat: 25.0700, lng: 121.5180, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "民生國中": { region: "B", address: "台北市松山區新東街30巷1號", lat: 25.0584, lng: 121.5639, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "永吉國中": { region: "B", address: "台北市信義區松隆路161號", lat: 25.0428, lng: 121.5708, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "西湖國中": { region: "B", address: "台北市內湖區環山路一段27號", lat: 25.0786, lng: 121.5651, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "陽明高中": { region: "B", address: "台北市士林區中正路510號", lat: 25.0930, lng: 121.5167, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "台灣科技大學": { region: "B", address: "台北市大安區基隆路四段43號", lat: 25.0127, lng: 121.5416, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "勞務採購" },
  "新竹科學園區": { region: "C", address: "新竹市東區新安路2號", lat: 24.7862, lng: 120.9976, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "新屋高中": { region: "C", address: "桃園市新屋區中興路111號", lat: 24.9722, lng: 121.1061, taxId: COMPANY_TAX_ID, isInternal: false, operationType: "OT" },
  "駿斯運動事業股份有限公司": { region: "D", address: HQ_ADDRESS, lat: HQ_LAT, lng: HQ_LNG, taxId: COMPANY_TAX_ID, isInternal: true, operationType: "內勤單位" },
  "人力資源處": { region: "D", address: HQ_ADDRESS, lat: HQ_LAT, lng: HQ_LNG, taxId: COMPANY_TAX_ID, isInternal: true, operationType: "內勤單位" },
  "數位轉型發展處": { region: "D", address: HQ_ADDRESS, lat: HQ_LAT, lng: HQ_LNG, taxId: COMPANY_TAX_ID, isInternal: true, operationType: "內勤單位" },
  "營運管理處": { region: "D", address: HQ_ADDRESS, lat: HQ_LAT, lng: HQ_LNG, taxId: COMPANY_TAX_ID, isInternal: true, operationType: "內勤單位" },
  "行銷事業處": { region: "D", address: HQ_ADDRESS, lat: HQ_LAT, lng: HQ_LNG, taxId: COMPANY_TAX_ID, isInternal: true, operationType: "內勤單位" },
};

export const VENUE_TO_REGION: Record<string, string> = Object.fromEntries(
  Object.entries(VENUE_DATA).map(([k, v]) => [k, v.region])
);

