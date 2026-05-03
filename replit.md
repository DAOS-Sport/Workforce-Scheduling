# PT 排班管理系統 (PT Scheduling System)

## Overview
This project is a comprehensive workforce scheduling management system for Personal Training (PT) staff across multiple venues. Its core purpose is to streamline scheduling, ensure compliance with Taiwan labor laws, and provide robust tools for employee and venue management, alongside attendance tracking. The system aims to enhance operational efficiency, reduce administrative overhead, and ensure legal adherence in staff deployment, ultimately improving management capabilities and staff satisfaction.

## User Preferences
I prefer that you communicate in a clear and concise manner, focusing on the most impactful changes or information. When working on the codebase, I appreciate an iterative approach, with major architectural decisions or significant feature implementations discussed and approved before proceeding. Please ensure that all changes align with the existing architectural patterns and maintain high code quality. I prefer detailed explanations for complex features or decisions.

## System Architecture
The system is built with a modern web stack:
- **Frontend**: React, Vite, TypeScript, Tailwind CSS, and Shadcn UI for a responsive UI. `wouter` for routing, `TanStack React Query` for server state.
- **Backend**: Express.js for API requests, PostgreSQL for data, and Drizzle ORM for database interactions.
- **Server Architecture**: Layered `server/` directory structure. Modules are fully decomposed into `types`, `repository`, `service`, and `routes` files, ensuring clear separation of concerns. A thin `storage` façade delegates to per-domain repositories. Root-level legacy files (`line-webhook.ts`, `internal-api.ts`, `ragic.ts`) have been modularized into their respective feature modules with re-export shims.
- **Core Features**:
    - **Regional Management**: Organizes operations across four regions with tab-based navigation.
    - **Smart Scheduler**: Spreadsheet-like weekly grid for shift planning, batch creation, and template-based scheduling.
    - **Labor Law Compliance**: HR Eye engine validates schedules against Taiwan labor laws (e.g., 7-day rest, 12-hour daily limit, 11-hour rest gap, four-week 160h/176h limits). Recognizes leave types to bypass certain validations. Compliance dashboard for four-week flexible working hours.
    - **Employee Portal**: LINE Login access to personal schedules, mandatory guideline acknowledgments, coworker directory, and anomaly reporting.
    - **Anomaly Management**: Admin dashboard for monitoring and managing clock-in anomalies, with filtering, batch resolution, and email notifications.
    - **Attendance System**: GPS-based clock-in/out via LINE (webhook/LIFF), with early/late detection, reason selection, amendment requests, and overtime requests. Supports XLSX data import.
    - **LINE ID Auto-Binding**: LINE webhook handles `follow`, `text` (employee code binding), and `location` (clock-in) events.
    - **Venue and Employee Management**: CRUD operations, cross-region employee dispatching, and Ragic database synchronization for employee data.
    - **Dispatch Personnel**: Manages non-database personnel shifts within the schedule grid.
    - **Shift Notes**: Allows admin to add freeform notes to shifts, visible to employees in the portal.
    - **Announcements System**: Admin CRUD for announcements, displayed as active banners in the employee portal based on region and expiry.
    - **Pending Count Badges**: Displays counts of pending clock amendments, overtime requests, leave requests, and anomaly reports in the admin UI.
    - **Automated Notifications**: Shift reminders and missing clock-in alerts via LINE and email.
    - **Cross-Region Dispatch Visibility**: Dispatched employee shifts are visible in both source and destination region schedules.
    - **Weekly Attendance Report**: Admin page displaying per-employee weekly clock-in status, with push notification and email summary options.
    - **Hours Report**: Admin page for monthly shift hours report, grouped by role, with region filtering and CSV export.
    - **Overtime Clock-In Integration**: Automated overtime request creation when employees clock out late and select "加班", with admin approval and integration into salary reports.
    - **Four-Week Flexible Working Hours Compliance**: Comprehensive compliance checks and reporting for four-week flexible working hours, including warnings and blocking errors.
- **UI/UX Decisions**: Prioritizes clarity and efficiency using Shadcn UI. Features color-coding for shift types and status indicators, and persistent employee picker selections.

## External Dependencies
- **PostgreSQL**: Primary data store.
- **LINE Messaging API**: For LINE Login, GPS clock-in/out (webhooks, LIFF app), and push notifications.
- **Ragic**: External database for employee information synchronization.
- **Google Maps**: Used for displaying user position during GPS clock-in.
- **Gmail SMTP**: For sending anomaly notification emails via nodemailer.
- **駿斯運動事業股份有限公司 Attendance System**: Source for XLSX attendance data imports.