# EaseMyRentals

Role-based rental management website for EaseMyRentals.

## What is included

- Public website with the current EaseMyRentals positioning, homes, renovation service, owner benefits, testimonials, and contact form
- Public rent and ad listings managed by admin
- Admin login to create owner and tenant accounts
- Admin entry screens for flat details, tenant assignment, inspections, assets, payments, and listings
- Admin listing media with multiple photos and a video
- Inspection image galleries visible to owners and tenants
- Owner login to view only their properties, inspection details, and payment details
- Tenant login to view only their assigned property, assets, and payment details
- PostgreSQL-backed user login credentials with `bcrypt` password hashes
- PostgreSQL-backed rental records for properties, inspections, assets, payments, listings, and enquiries
- Same Firebase web config as QuickMart exposed in `public/app.js`

## Run locally

Use Ruby 3.3+ with PostgreSQL available locally.

```bash
export DATABASE_URL=postgres:///easemyrentals_development
bundle install
bin/dev
```

Open:

```text
http://127.0.0.1:8000
```

## Demo logins

```text
Admin:  admin@easemyrentals.com / admin123
Owner:  owner@example.com / owner123
Tenant: tenant@example.com / tenant123
```

Change these before using the app outside local testing.

If you already have data in `data/easemyrentals.json`, the first PostgreSQL boot imports it as seed data when the `emr_users` table is empty. Existing demo credentials are re-hashed with `bcrypt`.

## Docker

This mirrors the QuickMart deployment style and avoids macOS system Ruby native-extension issues:

```bash
cp .env.example .env
docker compose up --build
```

Open:

```text
http://127.0.0.1:8000
```

## GitHub Readiness

- `.gitignore` excludes local env files, bundled gems, logs, and Docker Postgres data.
- `.env.example` documents the Docker/Postgres environment variables.
- `.github/workflows/ci.yml` runs Ruby syntax checks, validates Docker Compose config, and builds the app image.

## Media Storage

Admin can paste image/video URLs or select local files in the browser. Local file selections are stored as data URLs in PostgreSQL for the current MVP. For production-scale media, move uploaded files to Firebase Storage, S3, or another object store and save only the public URLs in PostgreSQL.
