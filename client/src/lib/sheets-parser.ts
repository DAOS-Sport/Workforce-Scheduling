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

  // Step 1: user-confirmed venue codes from localStorage cache, longest match first.
  const sortedKnown = [...knownVenueCodes].sort((a, b) => b.length - a.length);
  for (const code of sortedKnown) {
    if (prefix.startsWith(code)) {
      return { venueCode: code, roleCode: prefix.substring(code.length) };
    }
  }

  // Step 2: role-code heuristic — split when venue prefix is found in any known shortName.
  // Uses includes so abbreviations like "商" (from "三重商工") are matched on first import.
  // Step 1 cache takes priority; ambiguous first-import cases resolve on subsequent imports.
  for (let len = 1; len < prefix.length; len++) {
    const potentialVenue = prefix.substring(0, len);
    const potentialRole = prefix.substring(len);
    if (ROLE_CODES.includes(potentialRole) || potentialRole === "PT") {
      if (venueShortNames.some(n => n.includes(potentialVenue))) {
        return { venueCode: potentialVenue, roleCode: potentialRole };
      }
    }
  }

  // Step 3: no split found — treat entire prefix as venue abbreviation.
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
