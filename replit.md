# PT 排班管理系統 (PT Scheduling System)

## Overview
This project is a comprehensive workforce scheduling management system designed for Personal Training (PT) staff operating across multiple venues and regions. Its primary purpose is to streamline the scheduling process, ensure compliance with Taiwan labor laws, and provide robust tools for employee and venue management, alongside attendance tracking. The system aims to enhance operational efficiency, reduce administrative overhead, and ensure legal adherence in staff deployment.

## User Preferences
I prefer that you communicate in a clear and concise manner, focusing on the most impactful changes or information. When working on the codebase, I appreciate an iterative approach, with major architectural decisions or significant feature implementations discussed and approved before proceeding. Please ensure that all changes align with the existing architectural patterns and maintain high code quality. I prefer detailed explanations for complex features or decisions.

## System Architecture
The system is built with a modern web stack:
- **Frontend**: React, Vite, TypeScript, Tailwind CSS, and Shadcn UI provide a responsive and intuitive user interface. `wouter` is used for client-side routing, and `TanStack React Query` manages server state efficiently.
- **Backend**: Express.js handles API requests, integrated with PostgreSQL for data storage and Drizzle ORM for database interactions.
- **Core Features**:
    - **Regional Management**: Organizes operations across four distinct regions (三蘆戰區, 松山國小, 新竹區, 內勤) using tab-based navigation.
    - **Smart Scheduler**: Features a spreadsheet-like weekly grid for intuitive shift planning and editing. Includes functionality for batch shift creation and template-based scheduling.
    - **Labor Law Compliance**: Incorporates a sophisticated HR Eye engine to validate schedules against Taiwan labor laws (e.g., 7-day rest, 12-hour daily limit, 11-hour rest gap). Leave types (休假/特休/病假/事假/喪假/公假) are recognized and appropriately bypass certain labor law validations.
    - **Employee Portal**: A dedicated portal accessible via LINE Login, offering personal schedules, mandatory guideline acknowledgments, and a directory of today's coworkers. Includes a full-page transparent watermark for security. Features an anomaly report button that generates formatted text (employee info, clock-in details, GPS data) for copying and sending to the LINE 400 account (https://lin.ee/TupPc0V).
    - **Attendance System**: Supports GPS-based clock-in/out via LINE (webhook and LIFF app), with early arrival/late departure detection and reason selection. Includes features for clock amendment requests and overtime requests, with an admin review process and audit trails. Allows for attendance data import via XLSX files from external systems.
    - **Venue and Employee Management**: CRUD operations for employees and venues, with features like cross-region employee dispatching and Ragic database synchronization for employee data.
    - **Dispatch Personnel**: Separate `dispatch_shifts` table for non-database personnel. Rendered in a purple-themed collapsible section at the bottom of the schedule grid, with add/edit/delete dialog supporting name, venue, time, company, phone, role, and notes.
    - **Shift Reminders**: Automated LINE push notifications for upcoming shifts.
- **UI/UX Decisions**: The design prioritizes clarity and efficiency, using Shadcn UI components for consistency. Color-coding is used for shift types (e.g., orange for dispatched staff, distinct colors for leave types) and status indicators (e.g., blue/orange badges for early/late clock-ins). Employee pickers persist selections per region for improved user experience.

## External Dependencies
- **PostgreSQL**: Primary database for all system data.
- **LINE Messaging API**: Used for LINE Login authentication, GPS clock-in/out via webhooks and LIFF app, and push notifications for shift reminders.
- **Ragic**: External database used for synchronizing employee information.
- **Google Maps**: Integrated for displaying user position during GPS clock-in.
- **駿斯運動事業股份有限公司 Attendance System**: Source of attendance data for XLSX imports.