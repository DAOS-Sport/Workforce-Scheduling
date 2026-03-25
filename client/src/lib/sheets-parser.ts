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
  "A": "休假",
  "D": "休假",
  "AB": "休假",
};

const ROLE_CODES = ["救", "教", "指", "行", "櫃", "管", "守", "清", "資", "PT"];

const TIME_REGEX = /(\d{3,4})-(\d{3,4})/;

function parseTime(raw: string): string {
  if (raw.length === 3) raw = "0" + raw;
  return raw.substring(0, 2) + ":" + raw.substring(2, 4);
}

function splitVenueAndRole(prefix: string, knownVenueCodes: string[]): { venueCode: string; roleCode: string } {
  if (!prefix) return { venueCode: "", roleCode: "" };

  const sortedKnown = [...knownVenueCodes].sort((a, b) => b.length - a.length);
  for (const code of sortedKnown) {
    if (prefix.startsWith(code)) {
      const roleCode = prefix.substring(code.length);
      return { venueCode: code, roleCode };
    }
  }

  for (let len = 4; len >= 1; len--) {
    if (prefix.length < len) continue;
    const potentialVenue = prefix.substring(0, len);
    const potentialRole = prefix.substring(len);
    if (!potentialRole || ROLE_CODES.includes(potentialRole) || potentialRole === "PT") {
      return { venueCode: potentialVenue, roleCode: potentialRole };
    }
  }

  return { venueCode: prefix.substring(0, 1), roleCode: prefix.substring(1) };
}

export function parseShiftCell(raw: string, knownVenueCodes: string[] = []): ParsedShiftCell | null {
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

  const timeMatch = trimmed.match(TIME_REGEX);
  if (!timeMatch) {
    return null;
  }

  const timeIndex = trimmed.indexOf(timeMatch[0]);
  const prefix = trimmed.substring(0, timeIndex).trim();

  const startTime = parseTime(timeMatch[1]);
  const endTime = parseTime(timeMatch[2]);

  const { venueCode, roleCode } = splitVenueAndRole(prefix, knownVenueCodes);

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

export function parseTSV(tsv: string, year: number, month: number, knownVenueCodes: string[] = []): ParseResult {
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
    if (/^\d{1,2}$/.test(employeeCode) && /^\d{1,2}$/.test(name)) continue;

    const colStart = dayColumnStart >= 0 ? dayColumnStart : 4;
    const cells: (ParsedShiftCell | null)[] = [];

    for (let d = 0; d < daysInMonth; d++) {
      const colIndex = colStart + d;
      const cellRaw = colIndex < cols.length ? cols[colIndex]?.trim() || "" : "";
      cells.push(parseShiftCell(cellRaw, knownVenueCodes));
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
