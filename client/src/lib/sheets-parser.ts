export interface ParsedShiftCell {
  raw: string;
  venueCode: string;
  roleCode: string;
  startTime: string;
  endTime: string;
  isLeave: boolean;
  leaveType?: string;
  isUnknownVenue: boolean;
}

export interface ParsedEmployeeRow {
  category: string;
  employeeCode: string;
  employmentType: string;
  name: string;
  cells: (ParsedShiftCell | null)[];
  found: boolean;
  employeeId?: number;
}

export interface ParseResult {
  year: number;
  month: number;
  daysInMonth: number;
  employees: ParsedEmployeeRow[];
  allVenueCodes: string[];
  venueShortNames?: string[];
}

export const LEAVE_CODES: Record<string, string> = {
  "休": "休假",
  "休假": "休假",
  "特休": "特休",
  "生理假": "生理假",
  "病假": "病假",
  "事假": "事假",
  "補休": "補休",
  "喪假": "喪假",
  "公假": "公假",
  "國定假": "國定假",
  "A": "曠職",
  "D": "曠職",
  "AB": "曠職",
};

const ROLE_CODES = ["救", "教", "指", "行", "辦", "櫃", "管", "守", "清", "資", "PT"];

const TIME_REGEX = /(\d{3,4})-(\d{3,4})/;

function parseTime(raw: string): string {
  if (raw.length === 3) raw = "0" + raw;
  return raw.substring(0, 2) + ":" + raw.substring(2, 4);
}

function splitVenueAndRole(
  prefix: string,
  knownVenueCodes: string[],
  venueShortNames: string[] = []
): { venueCode: string; roleCode: string } {
  if (!prefix) return { venueCode: "", roleCode: "" };

  // Step 1: user-confirmed abbreviations from the mapping cache (longest first).
  // "北清" in cache → prefix.startsWith("北清") → {venue:"北清", role:""} ✓
  // "新" in cache → prefix.startsWith("新") → "新辦" → {venue:"新", role:"辦"} ✓
  const sortedKnown = [...knownVenueCodes].sort((a, b) => b.length - a.length);
  for (const code of sortedKnown) {
    if (prefix.startsWith(code)) {
      return { venueCode: code, roleCode: prefix.substring(code.length) };
    }
  }

  // Step 2: venue-plausibility role-code heuristic (first import when cache is empty).
  // A split is accepted ONLY when the venue part is a plausible abbreviation checked against
  // the venue shortNames. Single-char venues MUST start a shortName (strict); multi-char venues
  // can be contained anywhere in a shortName (permissive, for abbreviations like "松山").
  //
  // Results with shortNames=["三重商工","新北高中","松山國小",...]:
  //   "新辦": venue="新" (1 char) → "新北高中".startsWith("新") → accept → {venue:"新",role:"辦"} ✓
  //   "商救": venue="商" (1 char) → no shortName startsWith("商") → reject → step 3 ✓ (first import)
  //           (after user maps "商救", cache step 1 handles it on subsequent imports)
  //   "北清": venue="北" (1 char) → no shortName startsWith("北") → reject → step 3 ✓
  //   "松山救": venue="松山" (2 chars) → "松山國小".includes("松山") → accept → {venue:"松山",role:"救"} ✓
  for (let len = 1; len < prefix.length; len++) {
    const potentialVenue = prefix.substring(0, len);
    const potentialRole = prefix.substring(len);
    if (ROLE_CODES.includes(potentialRole) || potentialRole === "PT") {
      const isPlausible = potentialVenue.length === 1
        ? venueShortNames.some(n => n.startsWith(potentialVenue))
        : venueShortNames.some(n => n.includes(potentialVenue));
      if (isPlausible) {
        return { venueCode: potentialVenue, roleCode: potentialRole };
      }
    }
  }

  // Step 3: no plausible role split found — entire prefix is the venue abbreviation.
  return { venueCode: prefix, roleCode: "" };
}

export function parseShiftCell(raw: string, knownVenueCodes: string[] = [], venueShortNames: string[] = []): ParsedShiftCell | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-" || trimmed === "—" || trimmed === "　" || trimmed === "") return null;

  if (LEAVE_CODES[trimmed]) {
    return {
      raw: trimmed,
      venueCode: "",
      roleCode: "",
      startTime: "00:00",
      endTime: "00:00",
      isLeave: true,
      leaveType: LEAVE_CODES[trimmed],
      isUnknownVenue: false,
    };
  }

  for (const [code, leaveType] of Object.entries(LEAVE_CODES)) {
    if (trimmed.startsWith(code) && trimmed.length > code.length) {
      const suffix = trimmed.substring(code.length);
      if (!TIME_REGEX.test(suffix)) {
        return {
          raw: trimmed,
          venueCode: "",
          roleCode: "",
          startTime: "00:00",
          endTime: "00:00",
          isLeave: true,
          leaveType,
          isUnknownVenue: false,
        };
      }
    }
  }

  const timeMatch = trimmed.match(TIME_REGEX);
  if (!timeMatch) {
    return null;
  }

  const timeIndex = trimmed.indexOf(timeMatch[0]);
  const prefix = trimmed.substring(0, timeIndex).trim();

  const startTime = parseTime(timeMatch[1]);
  const endTime = parseTime(timeMatch[2]);

  const { venueCode, roleCode } = splitVenueAndRole(prefix, knownVenueCodes, venueShortNames);

  return {
    raw: trimmed,
    venueCode,
    roleCode,
    startTime,
    endTime,
    isLeave: false,
    isUnknownVenue: false,
  };
}

function looksLikeEmployeeRow(cols: string[]): boolean {
  if (cols.length < 5) return false;
  const code = cols[1]?.trim() || "";
  const name = cols[3]?.trim() || "";
  return code.length > 0 && name.length > 0;
}

export function parseTSV(tsv: string, year: number, month: number, knownVenueCodes: string[] = [], venueShortNames: string[] = []): ParseResult {
  const lines = tsv.split("\n").map(l => l.trimEnd());
  const daysInMonth = new Date(year, month, 0).getDate();

  const employeeRows: ParsedEmployeeRow[] = [];
  let headerParsed = false;
  let dayColumnStart = -1;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split("\t");

    if (!headerParsed) {
      const hasDate = cols.some(c => /^\d{1,2}日?$/.test(c.trim()));
      if (hasDate) {
        dayColumnStart = cols.findIndex(c => /^1日?$/.test(c.trim()));
        if (dayColumnStart < 0) {
          dayColumnStart = cols.findIndex((c, i) => i > 0 && /^\d{1,2}日?$/.test(c.trim()));
        }
        headerParsed = true;
        continue;
      }
      const hasWeekday = cols.some(c => ["日", "一", "二", "三", "四", "五", "六"].includes(c.trim()));
      if (hasWeekday) continue;

      if (looksLikeEmployeeRow(cols)) {
        headerParsed = true;
        dayColumnStart = 4;
      } else {
        continue;
      }
    }

    if (cols.length < 5) continue;

    const category = cols[0]?.trim() || "";
    const employeeCode = cols[1]?.trim() || "";
    const employmentType = cols[2]?.trim() || "";
    const name = cols[3]?.trim() || "";

    if (!employeeCode || !name) continue;
    if (/^\d{4}年/.test(category) || /^\d{1,2}月/.test(category)) continue;
    if (!/^\d{6,8}$/.test(employeeCode)) continue;

    const colStart = dayColumnStart >= 0 ? dayColumnStart : 4;
    const cells: (ParsedShiftCell | null)[] = [];

    for (let d = 0; d < daysInMonth; d++) {
      const colIndex = colStart + d;
      const cellRaw = colIndex < cols.length ? cols[colIndex]?.trim() || "" : "";
      cells.push(parseShiftCell(cellRaw, knownVenueCodes, venueShortNames));
    }

    employeeRows.push({
      category,
      employeeCode,
      employmentType,
      name,
      cells,
      found: false,
    });
  }

  const allVenueCodes = new Set<string>();
  for (const emp of employeeRows) {
    for (const cell of emp.cells) {
      if (cell && !cell.isLeave && cell.venueCode) {
        allVenueCodes.add(cell.venueCode);
      }
    }
  }

  return {
    year,
    month,
    daysInMonth,
    employees: employeeRows,
    allVenueCodes: Array.from(allVenueCodes),
  };
}
