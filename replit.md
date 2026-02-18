# PT 排班管理系統 (PT Scheduling System)

## Overview
A workforce scheduling management system for PT (personal training) staff across multiple venues and regions. Features smart spreadsheet-like scheduling, Taiwan labor law compliance engine, employee/venue management, and attendance tracking.

## Recent Changes
- 2026-02-18: Added 守則管理 (Guidelines Management) page with 3 categories (固定守則/每月說明/保密同意書), CRUD, preview, employee acknowledgment tracking
- 2026-02-18: Added venue shift templates (venueShiftTemplates table) for weekday/weekend role-based staffing requirements per venue
- 2026-02-18: Updated venue edit dialog with weekday/weekend tabs for managing shift templates with role/count
- 2026-02-18: Added role-based shortage summary in schedule editor (per-venue role icons + shortage counts)
- 2026-02-18: Added role icons (LifeBuoy/Dumbbell/UserRound/Sparkles/ShieldCheck) next to employee names in schedule cells
- 2026-02-18: Rebuilt schedule editor: venue-centric grid (venue rows × date columns), input time slot requirements per venue per date (e.g., 0630-1600 救生1人), gap analysis in collapsible drawer
- 2026-02-18: Added scheduleSlots table for per-date venue requirements (replaces fixed day-of-week venueRequirements for scheduling)
- 2026-02-18: Added attendance xlsx upload & audit feature (打卡紀錄 import, anomaly detection, stats, filterable table)
- 2026-02-18: Initial MVP build with regional grouping, smart scheduler, labor law validation, employee/venue CRUD, seed data

## Architecture
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + Shadcn UI
- **Backend**: Express.js + PostgreSQL + Drizzle ORM
- **Routing**: wouter (frontend), Express (backend API)
- **State**: TanStack React Query for server state

## Project Structure
```
client/src/
  pages/          - Dashboard, Schedule, Employees, Venues, Attendance, Guidelines
  components/     - AppSidebar, RegionTabs, ShiftCellEditor, VacancyFooter, ThemeToggle
  lib/            - queryClient, theme-provider, region-context, labor-law
server/
  index.ts        - Express server entry
  routes.ts       - API endpoints
  storage.ts      - Database storage layer (IStorage interface)
  db.ts           - Database connection
  seed.ts         - Seed data
  labor-validation.ts - Server-side labor law validation
shared/
  schema.ts       - Drizzle schema definitions
```

## Key Features
- **Regional Tabs**: 3 regions (三蘆戰區/松山區/新竹區) with tab-based switching
- **Smart Scheduler**: Spreadsheet-like weekly grid with cell editing
- **Labor Law Engine (HR Eye)**: 7-day rest, 12h daily limit, 11h rest gap
- **Dispatch Mode**: Orange-highlighted cells for outsourced staff
- **Vacancy Footer**: Real-time shortage monitoring
- **Attendance Import**: Upload xlsx from 駿斯 attendance system, auto-parse 打卡紀錄 sheet, detect late/early/anomaly/missing punches

## Attendance Upload Format
- Source: 駿斯運動事業股份有限公司 attendance system xlsx export
- Required sheet: 「打卡紀錄」(daily attendance records)
- Required columns: 員工編號, 姓名, 打卡日期
- Optional columns: 部門, 表定上班/下班時間, 上班/下班打卡時間, 遲到, 早退, 出勤異常, 請假, 加班, GPS打卡地點
- Period auto-detected from sheet name pattern: YYYY.MM.DD-YYYY.MM.DD
- Records matched to system employees via employeeCode

## API Routes
- GET /api/employees/:regionCode
- POST /api/employees
- PATCH /api/employees/:id
- GET /api/venues/:regionCode
- POST /api/venues
- PATCH /api/venues/:id
- GET /api/shifts/:regionCode/:startDate/:endDate
- POST /api/shifts (with labor law validation)
- PATCH /api/shifts/:id
- DELETE /api/shifts/:id
- GET /api/venue-requirements/:regionCode
- GET /api/schedule-slots/:regionCode/:startDate/:endDate
- POST /api/schedule-slots
- PATCH /api/schedule-slots/:id
- DELETE /api/schedule-slots/:id
- GET /api/venue-shift-templates/:venueId
- POST /api/venue-shift-templates
- POST /api/venue-shift-templates/batch/:venueId
- DELETE /api/venue-shift-templates/:id
- POST /api/attendance-upload (multipart file upload, parses xlsx)
- GET /api/attendance-uploads
- GET /api/attendance-records/:uploadId
- GET /api/attendance-records?startDate=&endDate=&employeeCodes=
- DELETE /api/attendance-upload/:id
- GET /api/guidelines?category=fixed|monthly|confidentiality
- GET /api/guidelines/:id
- POST /api/guidelines
- PATCH /api/guidelines/:id
- DELETE /api/guidelines/:id
- GET /api/guidelines/:id/acknowledgments
- POST /api/guideline-ack
