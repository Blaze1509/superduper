# Multi-Tenant Authentication & Firm Management Feature

## Overview

Add a login system to the existing React Native + Express + Neon PostgreSQL app so that multiple firms can use the same app with completely isolated data. A super-admin (the developer/owner) manages firms and users via a separate web admin panel.

---

## Current State

- React Native mobile app (Expo SDK 54) with 4 tabs: Main Page, Bill Page, Quality, Create
- Express + Neon PostgreSQL backend at `C:\Users\joypa\OneDrive\Desktop\learnapp\backend\`
- Mobile app at `C:\Users\joypa\OneDrive\Desktop\learnapp\mobile\`
- No authentication, no user isolation — all data is shared
- Persistent lists (Name/Item/Godown/Quality) stored in AsyncStorage on device
- API base URL config at `mobile/src/api/config.js`
- All API calls made via axios in `mobile/src/api/entries.js`

---

## Goal

1. Each firm's data is completely isolated from other firms
2. Super-admin (developer) manages firms and users via a web admin panel
3. Mobile users just see a login screen — enter username + password — get into their firm's data
4. No self-registration — all accounts created by super-admin only
5. Users stay logged in after app restart (token persisted in AsyncStorage)
6. Minimal performance impact — use indexed `firm_id` column on all tables

---

## Architecture

### Data Isolation Strategy
- **Single database, row-level isolation** — one extra `firm_id` column on every table
- Every query automatically filtered by `firm_id` from JWT token
- `firm_id` indexed for fast lookups — actually faster than current unfiltered queries
- No separate DB per firm — one connection pool, one schema, one backup

### Auth Strategy
- **JWT (JSON Web Token)** — stateless, no server-side session storage
- Token contains: `user_id`, `firm_id`, `username`, `role`
- Token stored in mobile AsyncStorage — persists across app restarts
- Every API request sends `Authorization: Bearer <token>` header
- Backend middleware decodes token and attaches `firm_id` to every request automatically

---

## Database Schema Changes

### New Tables

```sql
-- Firms table
CREATE TABLE firms (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  firm_id INTEGER REFERENCES firms(id) ON DELETE CASCADE,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'member', -- 'superadmin' | 'admin' | 'member'
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create lists table (move from AsyncStorage to DB)
CREATE TABLE create_lists (
  id SERIAL PRIMARY KEY,
  firm_id INTEGER REFERENCES firms(id) ON DELETE CASCADE,
  section VARCHAR(50) NOT NULL, -- 'Name' | 'Item' | 'Godown' | 'Quality'
  value VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(firm_id, section, value)
);
```

### Changes to Existing Tables

```sql
-- Add firm_id to entries table
ALTER TABLE entries ADD COLUMN firm_id INTEGER REFERENCES firms(id);
CREATE INDEX idx_entries_firm_id ON entries(firm_id);

-- Add firm_id index on create_lists
CREATE INDEX idx_create_lists_firm_id ON create_lists(firm_id);
```

### Super Admin
- One hardcoded super-admin account in `.env` (username + password)
- Super-admin has no `firm_id` — can see all firms in admin panel
- Super-admin never uses the mobile app, only the web admin panel

---

## Backend Changes

### New Files
```
backend/
├── middleware/
│   └── auth.js          ← JWT decode middleware, attaches firm_id to req
├── routes/
│   ├── authRoutes.js    ← POST /api/auth/login
│   └── adminRoutes.js   ← Admin panel routes (firms + users CRUD)
└── admin/
    └── index.html       ← Super-admin web panel (served as static file)
```

### New Environment Variables (`.env`)
```
JWT_SECRET=your_secret_key_here
SUPERADMIN_USERNAME=admin
SUPERADMIN_PASSWORD=your_admin_password
```

### New API Endpoints

#### Auth
```
POST /api/auth/login
  Body: { username, password }
  Returns: { token, user: { id, username, firm_id, role } }
```

#### Admin Panel (super-admin only, separate auth check)
```
GET    /api/admin/firms           ← list all firms
POST   /api/admin/firms           ← create new firm { name }
DELETE /api/admin/firms/:id       ← delete firm + all its data

GET    /api/admin/firms/:id/users ← list users of a firm
POST   /api/admin/users           ← create user { firm_id, username, password, role }
PUT    /api/admin/users/:id       ← update user (reset password, change role)
DELETE /api/admin/users/:id       ← delete user
```

#### Existing Endpoints (add firm_id filter via middleware)
```
All existing /api/entries routes — no URL change
Middleware automatically injects firm_id from JWT into every query
```

### Auth Middleware (`backend/middleware/auth.js`)
```js
// Decodes JWT, attaches req.firmId and req.userId to every protected request
// All /api/entries, /api/mark-entries, /api/pay-entries etc. go through this
// /api/auth/login and /admin routes are excluded
```

### Changes to Existing Routes (`server.js`)
- All `entries` queries get `WHERE firm_id = $n` added
- `INSERT` queries include `firm_id` value from `req.firmId`
- Socket.IO events scoped to firm room: `socket.join(firm_id)` on connect

---

## Create Lists — Move from AsyncStorage to Database

Currently the Name/Item/Godown/Quality lists are stored in AsyncStorage on the device. With multi-tenant, these must move to the database so all firm members share the same lists.

### Changes
- New `create_lists` table in DB (see schema above)
- New API endpoints:
  ```
  GET    /api/lists              ← get all lists for firm { Name: [], Item: [], ... }
  POST   /api/lists              ← add item { section, value }
  DELETE /api/lists/:section/:value ← remove item
  ```
- `ListsContext.js` — replace AsyncStorage with API calls
- On app start, fetch lists from backend instead of AsyncStorage
- Add/remove operations call API and update local state

---

## Mobile App Changes

### New Files
```
mobile/src/
├── screens/
│   └── LoginScreen.js       ← username + password + login button
├── context/
│   └── AuthContext.js       ← stores token, user info, login/logout functions
└── api/
    └── auth.js              ← POST /api/auth/login axios call
```

### Changed Files

#### `App.js`
- Wrap everything with `AuthProvider`
- If no token in AsyncStorage → show `LoginScreen`
- If token exists → show tab navigator as normal
- Logout option (clears token, goes back to login)

#### `mobile/src/api/entries.js`
- Add axios request interceptor that attaches `Authorization: Bearer <token>` header to every request automatically

#### `mobile/src/context/ListsContext.js`
- Replace AsyncStorage with API calls to `/api/lists`
- Load lists from backend on mount
- Add/remove via API

#### `mobile/src/context/AuthContext.js` (new)
```js
// Stores: token, user (id, username, firm_id, role)
// Functions: login(username, password), logout()
// On mount: checks AsyncStorage for existing token
// login() → calls /api/auth/login → saves token to AsyncStorage
// logout() → clears AsyncStorage token → redirects to LoginScreen
```

### Login Screen (`LoginScreen.js`)
- Clean minimal UI matching app style (indigo theme)
- Username field + Password field (secureTextEntry)
- Login button — shows loading spinner while authenticating
- Error message on wrong credentials
- No register button — accounts created by admin only
- "Developed by JOY PATEL" at bottom

---

## Admin Web Panel (`backend/admin/index.html`)

Single HTML file served by Express at `/admin`. No framework — plain HTML + CSS + vanilla JS fetch calls.

### Features
- Super-admin login form (separate from mobile login)
- **Firms section:**
  - Table listing all firms (id, name, user count, created date)
  - "Add Firm" button → input firm name → creates firm
  - Delete firm button (with confirmation)
- **Users section:**
  - Select a firm from dropdown → shows its users
  - Table: username, role, created date, actions
  - "Add User" button → form: select firm, username, password, role
  - Reset password button per user
  - Delete user button
- Clean minimal styling matching the app's indigo color scheme

### Access
- URL: `http://yourserver:3001/admin`
- Protected by super-admin username/password from `.env`
- Completely separate from mobile JWT auth

---

## Security Notes

- Passwords hashed with `bcrypt` (salt rounds: 10) — never stored plain
- JWT secret in `.env` — never hardcoded
- All `/api/*` routes (except `/api/auth/login`) require valid JWT
- Admin routes require super-admin role check
- `firm_id` always comes from JWT, never from request body — client cannot spoof it
- HTTPS should be used in production (Neon already requires SSL)

---

## New NPM Packages

### Backend
```
npm install jsonwebtoken bcrypt
```

### Mobile
```
# Nothing new — axios interceptors + AsyncStorage already installed
```

---

## Implementation Order

1. **DB schema** — add firms, users, create_lists tables, add firm_id to entries
2. **Backend auth** — login route, JWT middleware, protect all existing routes
3. **Backend admin routes** — firms + users CRUD
4. **Admin web panel** — single HTML file
5. **Move create_lists to DB** — new API endpoints + update ListsContext
6. **Mobile AuthContext** — token storage + login/logout
7. **Mobile LoginScreen** — UI
8. **Mobile axios interceptor** — auto-attach token to all requests
9. **Test** — create firm via admin, add user, login on mobile, verify data isolation

---

## File Reference (Current Codebase)

| File | Purpose |
|------|---------|
| `backend/server.js` | Main Express server, all API routes, Socket.IO |
| `backend/db.js` | PostgreSQL pool, initDB() creates/alters tables |
| `mobile/App.js` | Tab navigator, LanguageProvider, ListsProvider |
| `mobile/src/api/config.js` | BASE_URL |
| `mobile/src/api/entries.js` | All axios API calls |
| `mobile/src/context/ListsContext.js` | Name/Item/Godown/Quality lists (currently AsyncStorage) |
| `mobile/src/context/LanguageContext.js` | EN/GU translations |
| `mobile/src/screens/MainScreen.js` | Main entry list, add/edit/delete/pay |
| `mobile/src/screens/QualityScreen.js` | Quality/mark page |
| `mobile/src/screens/BillScreen.js` | Bill grouping + modal |
| `mobile/src/screens/CreateScreen.js` | Manage Name/Item/Godown/Quality lists |

---

## Summary of What Changes vs What Stays Same

| | Changes | Stays Same |
|--|---------|------------|
| DB | +3 new tables, +firm_id column on entries | All existing columns, all existing data |
| Backend | +auth middleware, +admin routes, +list routes | All existing entry routes (just add WHERE firm_id) |
| Mobile UI | +Login screen | All 4 tabs, all features, all UI |
| Mobile data | Lists from DB instead of AsyncStorage | Everything else identical |
| User experience | Login once, stay logged in | App works exactly the same after login |
