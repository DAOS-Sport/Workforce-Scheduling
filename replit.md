# PT 排班管理系統 (PT Scheduling System)

## Overview
A workforce scheduling management system for PT (personal training) staff across multiple venues and regions. Features smart spreadsheet-like scheduling, Taiwan labor law compliance engine, employee/venue management, and attendance tracking.

## Recent Changes
- 2026-02-21: Ragic sync now strictly filters: only imports employees with status "在職" AND role "行政櫃台" or "救生員"; other roles are skipped with error message
- 2026-02-21: Shift dialog now includes "排班範本" dropdown between role and time inputs; loads venue shift templates filtered by dayType (weekday/weekend) and role, auto-fills start/end time on selection; "自訂時間" option for manual input
- 2026-02-21: Added batch shift creation (POST /api/shifts/batch) with labor law validation; shift dialog now has batch mode toggle with date grid picker and quick-select buttons (same weekday, all, clear)
- 2026-02-21: Venue summary rows moved to regular tbody rows (not sticky), background #1d283a80
- 2026-02-21: Added Ragic employee sync (server/ragic.ts) - pulls from ap7.ragic.com, auto-maps department→region (新北高中/三民高中/三重商工→三蘆戰區), sets role (救生/櫃台) and employmentType (full_time/part_time)
- 2026-02-21: Added employmentType field to employees table for full-time/part-time classification
- 2026-02-21: Schedule editor now groups employees by employment type × role (正職救生→正職櫃台→兼職救生→兼職櫃台), full-time on top
- 2026-02-21: Employee management page shows Ragic sync button, employment type badge, sync result summary
- 2026-02-20: Venue shift templates now auto-populate as virtual schedule slots in schedule editor; templates show with "範本" badge and can be edited/deleted (materializes to real slots)
- 2026-02-20: Added POST /api/schedule-slots/materialize endpoint for atomic template-to-slot conversion
- 2026-02-20: Portal enhancements: removed calendar download buttons, enlarged calendar cells with time+venue, attendance summary card, collapsible guidelines review
- 2026-02-18: Added Employee Portal (/portal) with LINE Login, mandatory guidelines confirmation, personal schedule calendar, today's coworkers with one-click dial, watermark security
- 2026-02-18: Added venue-specific fixed guidelines (固定守則 bound to venues), venue badge display, filtered acknowledgment by scheduled employees
- 2026-02-18: Added lineId field to employees for LINE Login integration
- 2026-02-18: Added 守則管理 (Guidelines Management) page with 3 categories (固定守則/每月說明/保密同意書), CRUD, preview, employee acknowledgment tracking
- 2026-02-18: Added venue shift templates (venueShiftTemplates table) for weekday/weekend role-based staffing requirements per venue
- 2026-02-18: Updated venue edit dialog with weekday/weekend tabs for managing shift templates with role/count
- 2026-02-18: Added role-based shortage summary in schedule editor (per-venue role icons + shortage counts)
- 2026-02-18: Rebuilt schedule editor: venue-centric grid (venue rows × date columns), input time slot requirements per venue per date
- 2026-02-18: Added scheduleSlots table for per-date venue requirements
- 2026-02-18: Added attendance xlsx upload & audit feature
- 2026-02-18: Initial MVP build with regional grouping, smart scheduler, labor law validation, employee/venue CRUD, seed data

## Architecture
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + Shadcn UI
- **Backend**: Express.js + PostgreSQL + Drizzle ORM
- **Routing**: wouter (frontend), Express (backend API)
- **State**: TanStack React Query for server state

## Project Structure
```
client/src/
  pages/          - Dashboard, Schedule, Employees, Venues, Attendance, Guidelines, Portal
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
- **Attendance Import**: Upload xlsx from 駿斯 attendance system
- **Employee Portal** (/portal): LINE Login, mandatory guideline confirmation, personal schedule, today's coworkers with one-click phone call, name+code watermark security

## Employee Portal (/portal)
- **Authentication**: LINE Login OAuth 2.1 flow, verifies employee by LINE user ID in database
- **Guidelines Check**: Full-screen mandatory confirmation before accessing schedule. Includes venue-specific rules, monthly announcements, confidentiality agreements. Monthly acknowledgment cycle.
- **Personal Schedule**: Calendar or list view of employee's own shifts. Export to iOS (.ics) or Google Calendar.
- **Today's Coworkers**: Shows same-venue coworkers for today with one-click phone dial (tel: link). Only shows name, role, phone - no salary/address.
- **Watermark**: Full-page transparent watermark with employee name + code for screenshot deterrence.
- **Required env vars**: LINE_CHANNEL_ID, LINE_CHANNEL_SECRET (server), VITE_LINE_CHANNEL_ID (client)

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
- POST /api/portal/line-callback (LINE OAuth token exchange)
- POST /api/portal/verify (verify employee by LINE ID)
- GET /api/portal/my-shifts/:employeeId/:startDate/:endDate
- GET /api/portal/today-coworkers/:employeeId
- GET /api/portal/guidelines-check/:employeeId
- POST /api/portal/acknowledge-all
- POST /api/ragic-sync (sync employees from Ragic database)
