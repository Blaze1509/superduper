# LearnApp Implementation Documentation

## 1. Executive Summary

This project is a multi-part business application built around a shared backend and two client-facing interfaces:

- [mobile/App.js](mobile/App.js) is the main firm-facing React Native application used by activated users.
- [admin/App.js](admin/App.js) is the admin panel used by the super-admin to manage firms, generate activation tokens, revoke access, and monitor system state.
- [backend/server.js](backend/server.js) is the central Express API server that handles activation, firm management, entry management, exports, and Socket.IO realtime updates.
- [backend/db.js](backend/db.js) manages PostgreSQL schema setup, table migrations, and data initialization.

The implementation combines:

- firm-level data isolation
- secure token activation flow
- realtime admin dashboard updates
- PDF export and billing workflows
- app lock / panic security options
- encrypted payload communication between API clients and server

---

## 2. Project Structure

```text
learnapp/
├── admin/                     # Admin React Native app
│   ├── App.js
│   ├── src/
│   │   ├── api/admin.js
│   │   ├── screens/
│   │   │   ├── LoginScreen.js
│   │   │   ├── DashboardScreen.js
│   │   │   ├── FirmsScreen.js
│   │   │   ├── GenerateTokenScreen.js
│   │   │   └── TokensScreen.js
│   │   └── ...
│   └── package.json
├── backend/
│   ├── db.js
│   ├── server.js
│   ├── exports/
│   ├── fonts/
│   └── package.json
├── mobile/
│   ├── App.js
│   ├── src/
│   │   ├── api/
│   │   │   ├── config.js
│   │   │   └── entries.js
│   │   ├── context/
│   │   │   ├── ListsContext.js
│   │   │   ├── LanguageContext.js
│   │   │   └── ...
│   │   ├── screens/
│   │   │   ├── ActivationScreen.js
│   │   │   ├── MainScreen.js
│   │   │   ├── BillScreen.js
│   │   │   ├── QualityScreen.js
│   │   │   └── CreateScreen.js
│   │   └── utils/
│   │       ├── security.js
│   │       ├── storage.js
│   │       └── ...
│   └── package.json
├── implementation_plan.md
├── MULTI_TENANT_AUTH_PLAN.md
├── SECURITY_FIXES.md
├── IMPLEMENTATION_DOCUMENTATION.md
└── ...
```

---

## 3. Main Architectural Goal

The implementation is designed around a single shared backend that serves multiple firms while maintaining isolation between them.

The core business model is:

- each firm owns its own entries, records, and create-lists data
- admin can create firms and activation tokens
- mobile users activate a token and become bound to a specific firm
- every request is associated with a firm identity to prevent cross-firm leakage

The system uses a mix of:

- PostgreSQL as the source of truth
- Express for API orchestration
- Socket.IO for live updates
- Expo/React Native for client apps
- encrypted payloads for secure API transport

---

## 4. Backend Architecture

### 4.1 Server Boot and Core Setup

The backend entry point is [backend/server.js](backend/server.js). It does the following:

- creates the Express app and HTTP server
- binds Socket.IO to the same HTTP server
- configures CORS, JSON parsing, and Helmet headers
- initializes security rate limiting and request guards
- serves export files from the `exports` directory
- initializes the database with [backend/db.js](backend/db.js)
- exposes admin and mobile endpoints

Important server security layers present in the implementation:

- `helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false, frameguard: false })`
- CORS configuration with allowed origins fallback
- request rate limits for sensitive endpoints
- encrypted payload conversion on request/response cycle
- Basic Auth for the admin dashboard

### 4.2 Security Middleware and Payload Encryption

The application intentionally wraps API traffic with encryption logic.

In [backend/server.js](backend/server.js), incoming request bodies are decrypted if they include an `encryptedPayload` field, and all JSON responses are re-encrypted before leaving the server.

The same pattern is implemented in:

- [admin/src/api/admin.js](admin/src/api/admin.js)
- [mobile/src/api/config.js](mobile/src/api/config.js)

The shared secret is:

```js
const SHARED_SECRET = 'HACKER_PROOF_ENCRYPTION_KEY_2026';
```

This creates a lightweight transport-layer encryption layer even before the business logic runs.

### 4.3 Admin Authentication

The admin panel uses Basic Auth rather than JWT.

The `requireAdmin` middleware in [backend/server.js](backend/server.js) checks:

- `Authorization` header exists
- it starts with `Basic `
- username and password match the configured admin credentials

The credentials are resolved from environment variables:

```js
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'blaze';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Blaze@1509';
```

This means the admin interface is protected separately from the product app and is intended for super-admin actions only.

---

## 5. Database Design

The database schema is initialized in [backend/db.js](backend/db.js).

### 5.1 Core Tables

#### `firms`
Stores each business entity or tenant.

Columns include:

- `id`
- `name`
- `created_at`

This table is the root of tenant isolation.

#### `activation_tokens`
This table is the central activation engine for the mobile app.

Columns include:

- `id`
- `token`
- `firm_id`
- `expires_at`
- `is_used`
- `device_id`
- `revoke_count`
- `created_at`
- `username`
- `used_at`
- `is_panic`
- `pin_hash`
- `pin_salt`
- `pin_reset_required`

This table is used to:

- issue an activation token per firm
- bind a token to a device
- expire or revoke the token
- track panic state and PIN status
- define security / lock enforcement rules

#### `entries`
This contains the application’s main business records.

Fields include:

- `firm_id`
- `entry_date`
- `name`
- `quality`
- `item`
- `bags`
- `weight`
- `rate`
- `amount`
- `commission`
- `other_amount`
- `total`
- `market_fee`
- `p_amount`
- `is_marked`
- `is_paid`
- `bill_number`
- `godown`

These fields show the app is structured around trading/billing-type records rather than a simple CRUD app.

#### `create_lists`
This stores reusable list values used by the mobile app such as:

- `Name`
- `Item`
- `Godown`
- `Quality`

The table is designed to maintain list values per firm with uniqueness constraints.

### 5.2 Migration Logic

The initialization logic in [backend/db.js](backend/db.js) includes several important migration steps:

- creates default `Default Firm` if missing
- adds `firm_id` to existing entries if missing
- assigns old entries to the default firm
- creates unique combinations of `firm_id + section + value` within `create_lists`
- adds indexes for performance on entry date, name, flags, and firm relationships

This is a strong sign the project evolved from a single-tenant app into a multi-tenant design without breaking legacy data.

---

## 6. Admin Module

### 6.1 Admin App Bootstrap

[admin/App.js](admin/App.js) contains the authentication gate for the admin app.

It:

- reads `admin_auth_header` from local storage on app start
- sets the authorization header via `setAuthHeader()`
- restores the login state if valid
- falls back to a legacy flag named `admin_logged_in`
- logs out by clearing stored auth data

This means the admin app supports session persistence without requiring the user to log in repeatedly.

### 6.2 Login Screen

The admin login flow is implemented in [admin/src/screens/LoginScreen.js](admin/src/screens/LoginScreen.js).

It does the following:

- collects username and password
- validates non-empty values
- calls `checkCredentials(username, password)`
- stores the basic auth header in AsyncStorage
- redirects to the dashboard on success
- displays inline or alert-based login errors on failure

### 6.3 Dashboard and Navigation

The dashboard is implemented in [admin/src/screens/DashboardScreen.js](admin/src/screens/DashboardScreen.js).

It handles three main admin views:

- Firms
- Generate Token
- Tokens

It also manages:

- real-time socket connection state
- data refresh on mount
- quick navigation to generate token for a selected firm
- logout handling when a 401 unauthorized error occurs

### 6.4 Admin Data API

The admin API layer is in [admin/src/api/admin.js](admin/src/api/admin.js).

This file includes:

- `getApiBaseUrl()` to select the correct backend host for web or mobile environments
- `setAuthHeader()` and `buildBasicAuth()` for auth handling
- an Axios instance with request/response interceptors
- encrypted request payload handling
- helper calls for firms and token actions

Core admin actions:

- `checkCredentials()`
- `getFirms()`
- `addFirm(name)`
- `deleteFirm(id)`
- `generateToken(firm_id, duration, username)`
- `getTokens()`
- `deactivateFirm(firm_id)`
- `revokeToken(id)`
- `revertToken(id, duration)`
- `deleteToken(id)`
- `resetTokenPin(id, newPin, clearPin)`
- `resetPanic(id)`

### 6.5 Admin Views

The admin app includes custom screen components, including:

- [admin/src/screens/FirmsScreen.js](admin/src/screens/FirmsScreen.js)
- [admin/src/screens/GenerateTokenScreen.js](admin/src/screens/GenerateTokenScreen.js)
- [admin/src/screens/TokensScreen.js](admin/src/screens/TokensScreen.js)

These implement:

- firm creation and deletion
- token generation with custom time windows
- token revocation
- token reactivation
- device binding and lock-state reset
- clipboard-based token copy
- live token status display
- panic reset actions

---

## 7. Admin API Endpoints in the Backend

The following routes are implemented in [backend/server.js](backend/server.js).

### 7.1 Firms

#### `GET /api/admin/firms`
Returns all firms in the system.

#### `POST /api/admin/firms`
Creates a new firm with a provided name.

#### `DELETE /api/admin/firms/:id`
Deletes a firm and emits a realtime firms update.

### 7.2 Tokens

#### `POST /api/admin/generate-token`
Creates a new activation token for a selected firm.

Key logic:

- validates `firm_id`
- validates username/label input
- computes expiry time from duration values
- inserts a token into `activation_tokens`
- emits `tokens_update` to all connected clients

#### `GET /api/admin/tokens`
Returns all activation tokens with firm name and computed status.

#### `POST /api/admin/panic/reset`
Clears the panic flag for a token.

#### `POST /api/admin/deactivate/:firm_id`
Immediately deactivates all active tokens for a firm and marks the state as revoked.

#### `POST /api/admin/revoke-token/:id`
Revokes a single token by ID.

#### `POST /api/admin/revert-token/:id`
Reactivates a token by resetting expiry and clearing device usage status.

#### `DELETE /api/admin/tokens/:id`
Delete a token record from the DB.

#### `POST /api/admin/reset-token-pin/:id`
Updates or clears the app lock PIN attached to an activation token.

### 7.3 Mobile activation and security endpoints

#### `POST /api/activate`
Validates token input and binds it to a `device_id` if valid.

#### `POST /api/check-activation`
Checks whether the token is still valid and whether a device is active.

#### `POST /api/activation/check-pin-status`
Returns PIN metadata for the mobile app to sync remote app-lock config.

#### `POST /api/activation/update-pin`
Updates or clears the PIN data for a given token.

---

## 8. Real-Time Updates with Socket.IO

Socket.IO is a key part of the admin experience.

The server creates the Socket.IO server in [backend/server.js](backend/server.js):

```js
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
```

After admin actions, the backend emits:

- `tokens_update`
- `firms_update`

These events are consumed by the admin dashboard in [admin/src/screens/DashboardScreen.js](admin/src/screens/DashboardScreen.js):

```js
socket.on('tokens_update', (data) => setTokens(data || []));
socket.on('firms_update', (data) => setFirms(data || []));
```

This gives the admin app near-live status without manual refreshes.

---

## 9. Mobile Application Architecture

### 9.1 App Startup

The mobile app entry is [mobile/App.js](mobile/App.js).

It manages:

- device ID generation
- activation validation
- username tracking
- panic mode detection
- app lock state and PIN management
- app security checks using native modules where available

The app contains a `Tabs` navigator with these screens:

- Main Page
- Bill Page
- Quality
- Create

### 9.2 Device Identity and Activation Flow

The mobile app creates or reads a stable `device_id`:

- Android: `Application.androidId`
- iOS: `Application.getIosIdForVendorAsync()`
- Web: generated fallback value

This device ID is stored and sent to the backend during activation.

The activation process:

1. user enters token
2. token and device ID are sent to `/api/activate`
3. backend validates token existence, expiry, and usage state
4. token is marked as used and bound to the device
5. firm details are returned to the mobile app
6. app stores required firm metadata and proceeds into the dashboard

### 9.3 Token Validation and Session Check

The app uses [mobile/src/api/entries.js](mobile/src/api/entries.js) to call backend validation endpoints.

A central session check uses:

- `checkActivation(token, device_id)`
- `checkPinStatus(token, device_id)`

This ensures the app can detect:

- revoked tokens
- expired tokens
- changed PIN requirements
- panic mode activation

### 9.4 Storage and Security Helpers

[mobile/src/utils/storage.js](mobile/src/utils/storage.js) wraps persistent storage with cross-platform behavior.

It does the following:

- uses SecureStore on native devices when available
- falls back to AsyncStorage on web
- supports migration from legacy AsyncStorage keys

The app also uses [mobile/src/utils/security.js](mobile/src/utils/security.js) for:

- PIN verification
- remote sync logic
- app lock handling
- panic state enforcement

---

## 10. API Configuration and Request Patterns

### 10.1 Mobile API Configuration

[mobile/src/api/config.js](mobile/src/api/config.js) creates the shared Axios instance.

It:

- resolves backend URL from environment or local host detection
- sets `x-firm-id` header if a firm is known
- encrypts outgoing payloads using AES with a shared secret
- decrypts incoming payloads before delivering to the app

This is important because the app and backend both anticipate encrypted payloads at the transport layer.

### 10.2 Entries API

The main mobile business API is in [mobile/src/api/entries.js](mobile/src/api/entries.js).

It exposes methods for:

- activation and validation
- entries fetch/create/update/delete
- marking and paying records
- PDF export
- list CRUD operations

This file is effectively the main integration layer between the app UI and the centralized backend.

---

## 11. Lists and Data Synchronization

The project contains a `ListsContext` implementation and UI behaviors around reusable list values.

The intended pattern is:

- front-end list data should be fetched from the server
- updates are persisted in the database
- every firm has its own per-firm list values

The backend supports list-style operations through the `create_lists` table and related queries, which are integrated into the mobile app patterns.

This keeps the data consistent across devices for the same firm instead of relying only on local device storage.

---

## 12. PDF Export and Reporting

The backend includes export functionality in [backend/server.js](backend/server.js).

It supports:

- PDF generation via `jspdf` and `jspdf-autotable`
- Gujarati font support for local PDF rendering
- export directory creation under `backend/exports/`
- specialized export endpoints for account record and quality-wise reports

This indicates the app has more than just UI and activation logic — it’s built as a complete business reporting system.

---

## 13. Major Features Implemented

The current codebase implements the following features:

### Admin features
- secure admin authentication
- firm listing and creation
- firm deletion
- token generation with time durations
- token approval / revocation / reset
- panic reset controls
- live admin monitoring through socket events
- activation token binding to device IDs

### Mobile features
- activation using token + device ID
- session recovery on restart
- app lock / PIN management
- remote PIN sync from admin
- business entries management
- list management
- PDF export
- role-appropriate app-specific workflows

### Security features
- encrypted payloads
- rate limiting
- Helmet security headers
- Basic Auth for admin routes
- firm data isolation design
- PIN and panic security controls
- token expiry and revocation logic

---

## 14. Data Flow Overview

### Admin flow

1. Admin logs in with username and password.
2. Browser app sends Basic Auth header.
3. Backend verifies credentials.
4. Admin can list firms and tokens.
5. Token generation or revocation updates the database.
6. A Socket.IO event pushes fresh data to connected clients.

### Mobile activation flow

1. User enters token on the mobile app.
2. App sends token + device ID to the backend.
3. Backend validates token and expiry.
4. Token gets bound to the device and firm.
5. Mobile app reads firm context and loads business features.

### Operation flow

1. User submits data or entry updates.
2. Request is sent with firm context and encrypted payload.
3. Backend validates and stores the record under the associated `firm_id`.
4. Response is decrypted by the client and data is updated locally.

---

## 15. Implementation Notes and Design Decisions

### 15.1 Hybrid Admin + Mobile Architecture
The project uses two distinct front ends with a shared backend, which helps separate admin control from client usage.

### 15.2 Encryption at Application Layer
The app uses AES encryption before sending JSON payloads and decrypts responses automatically. This is a significant implementation choice and increases security for API traffic.

### 15.3 Real-Time Admin Experience
The admin dashboard is not static; it listens for live updates and refreshes session data automatically.

### 15.4 Firm Awareness
The system is built around a tenant identity, which is a core design requirement for multi-tenant operations.

### 15.5 Legacy-to-Modern Migration
The database initialization and migrations clearly show a codebase that has evolved from a single-tenant design to a multi-firm system while preserving older data.

---

## 16. Likely Usage Summary

This application is structured for:

- a business management workflow
- firm-level record isolation
- admin-controlled activation and access
- secure locked mobile app environment
- daily operations like entry tracking, payment marking, and export reporting

The architecture is suitable for a commercial or enterprise app that requires access control, per-firm data segmentation, and realtime administration.

---

## 17. Final Conclusion

This project is a complete implementation of a secure multi-firm business platform with:

- a React Native admin dashboard
- a React Native client app
- an Express server with PostgreSQL persistence
- realtime admin updates
- encrypted payload transport
- firm-based access controls
- token activation and security enforcement

The code in [backend/server.js](backend/server.js), [backend/db.js](backend/db.js), [mobile/App.js](mobile/App.js), and [admin/App.js](admin/App.js) demonstrates a strong working architecture that matches a real-world enterprise workflow rather than a basic demo app.
