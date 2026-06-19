# TLA HRMS — The Live Agents Attendance & Payroll Management System

Enterprise-grade HRMS for managing employees, attendance, leaves, holidays, shifts, targets, commissions, payroll, and reports — built with the **MERN** stack and a modern React + Material UI frontend.

> **Stack** — React 18 (Vite), Redux Toolkit, MUI 5, React Router 6, React Query, Axios, Recharts, React Hook Form on the frontend · Node.js, Express 4, MongoDB (Mongoose), JWT, Bcrypt, Multer, Nodemailer, PDFKit, ExcelJS on the backend.

---

## ✨ Features

### Authentication & Access Control
- JWT auth with **15-minute access tokens** and **7-day refresh token rotation**
- Forgot-password / reset-password flow (email-based)
- Change password from profile menu
- 4 roles — `SUPER_ADMIN`, `HR_MANAGER`, `TEAM_LEADER`, `EMPLOYEE`
- Route- and component-level role guards

### HR Management
- Full employee CRUD with profile pictures, CNIC, fingerprint ID, designations
- Departments, designations, shifts, holidays
- Bulk and granular employee status toggles

### Time & Attendance
- Browser **Clock-in / Clock-out** with break and lunch tracking
- **Fingerprint biometric import** (matched by `fingerprintId`)
- Late/early detection from shift schedule + grace minutes
- Per-employee monthly view, admin-wide attendance report
- Manual adjustment by HR

### Leaves
- Apply / approve / reject with remarks and email notifications
- Leave balance tracker (Casual / Sick / Annual / Emergency)
- Calendar + analytics dashboard

### Performance & Commissions
- Daily / weekly / monthly **Targets** with completion %
- **Top performers** ranking
- Commissions with auto-computed `amount = sales × rate / 100`

### Payroll
- One-click monthly **payroll generation** (single or bulk)
- Auto computation of basic + commission + bonuses − late/absent deductions
- **PDF payslip** generated with PDFKit, downloadable + emailed
- Mark-as-paid workflow

### Reporting & Analytics
- Excel export (.xlsx) for Attendance, Leaves, Salary, Commission, Performance
- Dashboards with Recharts (area/pie/bar/line)
- Recent activity feed

### Settings & Notifications
- Company profile + logo upload
- Configurable working days, hours, deductions, bonus thresholds
- In-app notification center + email notifications

### UX
- Dark / light theme (persisted)
- Responsive layout with collapsible sidebar
- Glassmorphism AppBar, gradient highlights, modern enterprise design (BambooHR / Zoho / Keka inspired)

---

## 📁 Project Structure

```
TLA HRMS/
├── backend/      # Node.js + Express + MongoDB API
└── frontend/     # React + Vite SPA
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ and **npm** 9+
- **MongoDB** running locally on `mongodb://127.0.0.1:27017` (or hosted, e.g. MongoDB Atlas)
- (Optional) SMTP credentials for emails

### 1. Backend setup

```powershell
cd backend
npm install
copy .env.example .env
```

Edit `backend/.env` and set at minimum:

```
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/tla_hrms
JWT_ACCESS_SECRET=replace_me
JWT_REFRESH_SECRET=replace_me_too
SEED_ADMIN_EMAIL=admin@tlahrms.com
SEED_ADMIN_PASSWORD=Admin@12345
```

Seed the database (creates default admin, sample users, departments, shifts, holidays, settings):

```powershell
npm run seed
```

Start the API:

```powershell
npm run dev
```

API runs at **http://localhost:5000** · Base URL: **`/api/v1`** · Health check: **`/health`**

### 2. Frontend setup

```powershell
cd ../frontend
npm install
copy .env.example .env
```

`frontend/.env` defaults already point at the local API:

```
VITE_API_URL=http://localhost:5000/api/v1
VITE_API_BASE=http://localhost:5000
```

Start the dev server:

```powershell
npm run dev
```

App runs at **http://localhost:5173**

---

## 🔐 Default Login Credentials

| Role          | Email                  | Password     |
| ------------- | ---------------------- | ------------ |
| Super Admin   | admin@tlahrms.com      | Admin@12345  |
| HR Manager    | hr@tlahrms.com         | Hr@12345     |
| Team Leader   | lead@tlahrms.com       | Lead@12345   |
| Employee      | employee@tlahrms.com   | Emp@12345    |

> **Change these immediately in production.**

---

## 📡 Key API Endpoints

All endpoints are prefixed with `/api/v1`.

| Group            | Path                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| Auth             | `/auth/login`, `/auth/refresh`, `/auth/me`, `/auth/forgot-password` |
| Employees        | `/employees` (CRUD)                                                  |
| Attendance       | `/attendance/clock-in`, `/attendance/today`, `/attendance/me/month` |
| Leaves           | `/leaves`, `/leaves/me`, `/leaves/:id/action`                       |
| Holidays         | `/holidays`, `/holidays/upcoming`                                    |
| Shifts           | `/shifts`                                                            |
| Departments      | `/departments`                                                       |
| Targets          | `/targets`, `/targets/me`, `/targets/ranking`                       |
| Commissions      | `/commissions`                                                       |
| Payroll          | `/payroll/generate`, `/payroll/generate-bulk`, `/payroll/:id/payslip` |
| Reports          | `/reports/{attendance\|leave\|salary\|commission\|performance}`      |
| Settings         | `/settings`                                                          |
| Notifications    | `/notifications`                                                     |
| Dashboard        | `/dashboard/admin`, `/dashboard/employee`                           |

Add `?format=xlsx` to any reports endpoint to download an Excel file.

---

## 🧰 Useful Scripts

### Backend
```powershell
npm run dev     # nodemon
npm start       # production
npm run seed    # reset & seed default data
```

### Frontend
```powershell
npm run dev     # vite dev server
npm run build   # production build
npm run preview # preview built bundle
```

---

## 🔒 Security Notes

- Passwords hashed with **bcrypt** (10 rounds)
- Helmet, CORS, rate limiting, XSS sanitization, HPP, and Mongo sanitize enabled
- JWT secrets must be rotated for production deployments
- Profile pictures and payslips are served from `/uploads/...` static path

---

## 📄 License

Proprietary — © The Live Agents. All rights reserved.
