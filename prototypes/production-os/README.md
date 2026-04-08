# Pinhead Production OS — Prototype

## Overview

Production management system prototype for a garment printing house.
Built with React 19 + Zustand 5 + Vite 7. Mock data, no backend.

**Purpose:** Visual prototype to validate UX/UI before integrating into the main Pinhead OS (pinhead-react + Supabase).

## Quick Start

```bash
cd prototypes/production-os
npm install
npm run dev    # → http://localhost:5174
npm run build  # production build
```

## Screens (11 routes)

### Core Screens

| Route | Screen | Purpose | User |
|-------|--------|---------|------|
| `/` | Workshop Board | Task queue per workshop | Workshop operators |
| `/director` | Control Tower | KPIs, load, bottlenecks, pipeline | Director |
| `/capacity` | Capacity Board | Weekly heatmap, deadline forecast | Director / ROP |
| `/analytics` | Analytics | Throughput, cycle time, daily load, worker perf | Director |
| `/kanban` | Kanban Mock | Order lifecycle with production timeline | Managers |

### Display Screens (full-screen, no NavBar)

| Route | Screen | Purpose |
|-------|--------|---------|
| `/andon` | Andon Board | Factory floor wall display, dark theme, auto-refresh 30s |
| `/kiosk` | Kiosk View | Tablet at workstation, one task at a time, 80px buttons |
| `/tv` | TV Dashboard | Office TV, real-time KPIs, scrolling ticker |

### Utility Screens

| Route | Screen | Purpose |
|-------|--------|---------|
| `/instructions/:taskId` | Work Instructions | Step-by-step carousel from order data |
| `/scan` | QR Scanner | Find task by order number |
| `/batches` | Batch Optimization | Group orders by technique + color for shared runs |

## Features

### Workshop Operations
- 6 workshops: Cutting, Screen Printing, DTF, Embroidery, Sewing, Packaging+QC
- 5 route templates based on print technique (panel_print, dtf_print, garment_print, screen_emb, no_print)
- Task lifecycle: pending → ready → in_progress → done / blocked
- Handoff protocol with notes between workshops
- Problem picker (6 typed categories)
- Quick actions on cards (Start / Done without opening drawer)

### Quality Control
- QC Checklist (6 items) for packaging_qc tasks
- Defect tracking: type, count, notes, yield %
- Structured problem reporting

### Communication
- Comments thread per task
- Event log (all actions timestamped)
- Photo upload on tasks
- Notification bell with badge + browser push notifications
- Handoff notes between workshops

### Planning & Analytics
- Weekly capacity heatmap (Mon-Fri × 6 workshops)
- Deadline risk assessment (critical/warning/ok)
- Throughput per workshop
- Average cycle time per operation
- Worker performance metrics
- Daily load chart (last 7 days)
- Batch optimization (group by technique + textile color)

### UX
- Touch-first design (44px+ targets, 72-80px action buttons)
- Mobile responsive (bottom nav at <480px)
- Workshop identity (colored hero, colored tabs)
- Status change animation (flash-start)
- Sticky filter bar
- Print support (Ctrl+P on task detail)
- Keyboard navigation (arrows in Kiosk, ESC to exit displays)

## Architecture

```
src/
├── App.jsx                    # Router (11 routes), Layout with conditional NavBar
├── main.jsx                   # Entry point
├── data/
│   ├── workshops.js           # 6 workshops, route templates, problem types
│   ├── orders.js              # 12 mock orders (real garment printing types)
│   ├── tasks.js               # ~50 auto-generated tasks with varied statuses
│   └── workers.js             # 11 mock workers
├── store/
│   └── useWorkshopStore.js    # Zustand: tasks, orders, events, comments, photos, defects, QC, notifications
├── components/
│   ├── WorkshopBoard.jsx      # Main workshop task queue + filters/search
│   ├── WorkshopSelector.jsx   # Workshop tabs
│   ├── TaskCard.jsx           # Task card with quick actions + mini barcode
│   ├── TaskDetail.jsx         # Drawer: full info, QC, defects, photos, comments, events
│   ├── OrderTimeline.jsx      # Horizontal operation timeline (compact/full)
│   ├── HandoffDialog.jsx      # "Pass to [next workshop]?" dialog
│   ├── QCChecklist.jsx        # 6-item quality checklist
│   ├── NotificationBell.jsx   # Bell + dropdown + browser push
│   ├── NavBar.jsx             # Global nav (top bar, bottom tabs on mobile)
│   ├── DirectorView.jsx       # Control Tower dashboard
│   ├── CapacityBoard.jsx      # Weekly heatmap + deadline forecast
│   ├── AnalyticsView.jsx      # Throughput, cycle time, worker perf
│   ├── KanbanMock.jsx         # 5-column Kanban with production timeline
│   ├── AndonBoard.jsx         # Factory floor display
│   ├── KioskView.jsx          # Tablet workstation view
│   ├── TVDashboard.jsx        # TV KPI display
│   ├── WorkInstructions.jsx   # Step-by-step work instructions
│   ├── QRScanner.jsx          # Order number scanner mock
│   └── BatchView.jsx          # Batch optimization
└── styles/
    ├── tokens.css             # Design tokens (from pinhead-react)
    └── workshop.css           # Global animations + base styles
```

## Mock Data

12 orders with real garment printing scenarios:
- Screen printing (200 tees, 300 tees, 150 tees, 120 tees, 500 tees)
- DTF (100 tees, 60 longsleeves)
- Embroidery (50 hoodies, 25 tees)
- Screen + Embroidery combo (40 hoodies)
- No print (80 sweatshirts, 75 shorts)

Tasks at various stages: some done, some in_progress, some ready, one blocked.

## Integration Plan

When ready to integrate into main Pinhead OS (pinhead-react):

1. **Supabase tables:** workshop_tasks, task_events, task_comments, task_photos, workshops
2. **DB trigger:** order.status → 'approved' → auto-generate tasks by route template
3. **Replace store:** useWorkshopStore → Supabase CRUD with Realtime
4. **Auth:** workshop_code on profiles, user attribution on all actions
5. **Bridge:** OrderTimeline in KanbanBoard OrderDrawer
6. **Routes:** Add /workshop, /director, /capacity to App.jsx with RoleGuard

See strategic plan: `.claude/plans/buzzing-moseying-flute.md`

## Design System

Uses Pinhead design tokens:
- Fonts: Inter (body), Barlow Condensed (display), Roboto Mono (numbers)
- Colors: workshop-specific (cutting=#8B5CF6, screen=#EF4444, dtf=#F97316, embroidery=#EC4899, sewing=#3B82F6, packaging_qc=#06A77D)
- Spacing: 4/8/12/16/24/32/48px scale
- Status: pending=#D1D5DB, ready=#93C5FD, in_progress=#3B82F6, done=#06A77D, blocked=#e63946
