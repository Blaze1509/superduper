# Security Fixes TODO

## Fix 1 — HTTPS (Deploy to Railway/Render)
**Risk:** Plain HTTP allows anyone on same network to intercept tokens  
**Fix:** Deploy backend to Railway or Render — free tier, auto HTTPS  
**Files affected:** `backend/` (no code change, just hosting)  
**Steps:**
- Push backend to GitHub
- Connect repo to Railway/Render
- Set environment variables from `.env` in their dashboard
- Update `EXPO_PUBLIC_API_URL` in `mobile/.env` and `admin/app.json` to new HTTPS URL

---

## Fix 2 — Verify firm_id server-side against token
**Risk:** Hacker can manually set `x-firm-id` header to any firm's ID and read/write their data  
**Fix:** On every request, verify that the `x-firm-id` header matches the `firm_id` bound to the activated token in DB  
**Files affected:** `backend/server.js`  
**What to do:**
- Create a middleware that takes `x-firm-id` + `x-device-token` headers
- Query DB to confirm that token belongs to that firm_id and is still valid
- Reject request if mismatch

---

## Fix 3 — Remove admin credentials from frontend code
**Risk:** Anyone who decompiles the admin APK can read `blaze` / `Blaze@1509` in plain text and call admin APIs directly  
**Fix:** Admin app sends credentials to a backend login endpoint → backend verifies → issues a short-lived session token → admin app uses session token for all subsequent requests  
**Files affected:** `admin/src/api/admin.js`, `admin/src/screens/LoginScreen.js`, `backend/server.js`  
**What to do:**
- Add `POST /api/admin/login` endpoint on backend that verifies credentials and returns a session token (JWT or random token stored in DB)
- Admin app stores session token in AsyncStorage
- All admin API calls send session token in header instead of raw credentials
- Credentials only exist in backend `.env`

---

## Fix 4 — Rate limiting on /api/activate
**Risk:** No limit on activation attempts — hacker can try millions of tokens per second  
**Fix:** Max 10 activation attempts per IP per 15 minutes  
**Files affected:** `backend/server.js`  
**What to do:**
- Install `express-rate-limit` package
- Apply rate limiter middleware specifically on `/api/activate` and `/api/check-activation`

---

## Fix 5 — Input sanitization and validation
**Risk:** Malformed or oversized data sent to API can crash server or corrupt DB  
**Fix:** Validate all incoming request fields before processing  
**Files affected:** `backend/server.js`  
**What to do:**
- Check required fields exist and are correct types on all endpoints
- Limit string lengths (token max 64 chars, firm name max 100 chars etc.)
- Return proper 400 errors for invalid input

---

## Fix 6 — Protect .env file
**Risk:** Accidentally pushing `.env` to GitHub exposes full database access  
**Fix:** Ensure `.env` is in `.gitignore` and use platform environment variables when hosted  
**Files affected:** `backend/.gitignore`  
**What to do:**
- Confirm `.env` is listed in `backend/.gitignore`
- Never commit `.env` to any repo
- On Railway/Render set all env vars through their dashboard UI

---

## Fix 7 — Regular database backups
**Risk:** Data loss if hosting provider has an outage or DB gets corrupted  
**Fix:** Automated daily backups  
**What to do:**
- Enable automatic backups on Railway/Render/Neon (most have this built in)
- Or set up a cron job that dumps DB daily and saves to cloud storage

---

## Fix 8 — Biometric lock on admin app
**Risk:** If your phone is stolen/unlocked, anyone can open admin app and generate tokens  
**Fix:** Add fingerprint/face ID check when admin app opens  
**Files affected:** `admin/App.js`  
**What to do:**
- Install `expo-local-authentication`
- On app open, require biometric authentication before showing login/dashboard

---

## Priority Order
| Priority | Fix | Impact |
|----------|-----|--------|
| 1 | Fix 2 — firm_id verification | CRITICAL |
| 2 | Fix 3 — remove credentials from frontend | CRITICAL |
| 3 | Fix 1 — HTTPS deployment | HIGH |
| 4 | Fix 4 — rate limiting | MEDIUM |
| 5 | Fix 6 — .env protection | MEDIUM |
| 6 | Fix 5 — input validation | MEDIUM |
| 7 | Fix 8 — biometric lock | LOW |
| 8 | Fix 7 — DB backups | LOW |
