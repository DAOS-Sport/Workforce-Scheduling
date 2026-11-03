import { COACH_TIME_RE, cleanEmployeeDisplayName, splitCoachLineParts, tokenizeCoachLine, tokenNames, usefulLines } from './parse';
import { displayNameWithLineStatus, isLineBound, metaFor, type Roster } from './roster';
import type { Employee, EmployeeMeta, NameAliases } from './types';

export interface CellEdit {
  value: string;
  employees: readonly EmployeeMeta[];
}

export type PickTarget = { kind: 'course' } | { kind: 'gap'; timeLabel: string };

function withMeta(meta: readonly EmployeeMeta[], emp: Employee): readonly EmployeeMeta[] {
  return meta.some(x => String(x.employeeId) === String(emp.id)) ? meta : [...meta, metaFor(emp)];
}

function appendLine(prev: string, line: string): string {
  return prev ? `${prev}\n${line}` : line;
}

export function applyPickedEmployee(prevValue: string, prevMeta: readonly EmployeeMeta[], emp: Employee, target: PickTarget, roster: Roster): CellEdit {
  const prev = String(prevValue || '').trim();
  if (target.kind === 'gap') {
    return { value: appendLine(prev, `${displayNameWithLineStatus(emp)} ${target.timeLabel}`), employees: withMeta(prevMeta, emp) };
  }
  const already = usefulLines(prev).some(
    line => cleanEmployeeDisplayName(line) === emp.name || tokenizeCoachLine(line).some(tok => tokenNames(tok, roster.names).includes(emp.name)),
  );
  return { value: already ? prev : appendLine(prev, displayNameWithLineStatus(emp)), employees: withMeta(prevMeta, emp) };
}

export function applyTempCoach(prevValue: string, prevMeta: readonly EmployeeMeta[], name: string, target: PickTarget): CellEdit {
  const prev = String(prevValue || '').trim();
  if (target.kind === 'gap') return { value: appendLine(prev, `${name} ${target.timeLabel}`), employees: prevMeta };
  return { value: usefulLines(prev).some(l => l.trim() === name) ? prev : appendLine(prev, name), employees: prevMeta };
}

export function normalizeCoachCellText(text: string, roster: Roster, aliases: NameAliases): string {
  if (!text.trim()) return text;
  return text
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(line => {
      const p = splitCoachLineParts(line, aliases);
      if (!p.name) return line;
      const emp = roster.employees.find(e => String(e.name || '').trim() === p.name);
      if (!emp) return line;
      const rebuilt = `${p.marker}${emp.name}${p.follow ? '跟課' : ''}${p.days}${isLineBound(emp) ? '' : '（未綁定）'}`;
      const chk = splitCoachLineParts(rebuilt, aliases);
      if (chk.marker !== p.marker || chk.name !== p.name || chk.days !== p.days || chk.follow !== p.follow) return line;
      return rebuilt;
    })
    .join('\n');
}

export function removeDutyLine(prevValue: string, raw: string): string | null {
  const target = String(raw || '').trim();
  if (!target) return null;
  let done = false;
  return String(prevValue || '')
    .split(/\r?\n/)
    .filter(l => {
      if (!done && l.trim() === target) {
        done = true;
        return false;
      }
      return true;
    })
    .join('\n')
    .replace(/\n+$/, '');
}

export function removeCoach(prevValue: string, name: string, roster: Roster): string {
  let done = false;
  const kept: string[] = [];
  String(prevValue || '')
    .split(/\r?\n/)
    .forEach(line => {
      if (done) {
        kept.push(line);
        return;
      }
      let hit = false;
      const rebuilt: string[] = [];
      tokenizeCoachLine(line).forEach(tok => {
        const dayM = String(tok.body || '').replace(COACH_TIME_RE, ' ').match(/[1-5]+/g);
        const daySuffix = dayM ? ' ' + dayM.join('') : '';
        const remain: string[] = [];
        tokenNames(tok, roster.names).forEach(nm => {
          if (!hit && nm === name) hit = true;
          else remain.push(nm);
        });
        if (remain.length) rebuilt.push((tok.marker || '') + remain.join('') + daySuffix);
      });
      if (!hit) {
        kept.push(line);
        return;
      }
      done = true;
      if (rebuilt.length) kept.push(rebuilt.join(''));
    });
  return kept.join('\n').replace(/\n+$/, '');
}
