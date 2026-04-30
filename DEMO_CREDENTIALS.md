# EaseMyRentals — Demo Credentials

These accounts are **automatically created** on first startup when the database is empty.  
No manual setup needed after a fresh clone + deploy.

---

## Admin

| Field    | Value                        |
|----------|------------------------------|
| Email    | Set via `SUPERADMIN_EMAIL` in `.env` |
| Password | Set via `SUPERADMIN_PASSWORD` in `.env` |
| Default  | `admin@easemyrentals.com` / `admin123` |

> ⚠️ Change the default admin password in `.env` before production use.

---

## Owner Accounts

| Name         | Email               | Password   |
|--------------|---------------------|------------|
| Rajesh Kumar | owner@example.com   | owner123   |
| Sneha Nair   | owner2@example.com  | owner123   |
| Vikram Singh | owner3@example.com  | owner123   |

---

## Tenant Accounts

| Name          | Email               | Password   |
|---------------|---------------------|------------|
| Priya Sharma  | tenant@example.com  | tenant123  |
| Aarav Mehta   | tenant2@example.com | tenant123  |
| Maya Rao      | tenant3@example.com | tenant123  |
| Shalini Patel | tenant4@example.com | tenant123  |
| Arjun Das     | tenant5@example.com | tenant123  |

---

## How Seeding Works

1. On first startup, the app checks if the database has any users.
2. If empty → seeds all the above accounts + sample properties, payments, inspections, etc.
3. If data already exists → **skips seeding entirely** (your real data is safe).

This means:
- ✅ Fresh clone on new server → demo accounts work immediately
- ✅ Re-deploy existing server → your real tenant/owner accounts are preserved
- ✅ `docker compose up --build` → rebuilds app, database untouched

---

## Data Persistence

Data lives in a **named Docker volume**, not in the git repo:
- Dev:  `emr_postgres_dev_data`
- Prod: `emr_postgres_prod_data`

### Safe operations (data survives):
```bash
docker compose up --build      # rebuild app code
docker compose restart         # restart containers
docker compose down            # stop containers (volume kept)
./deploy.sh                    # production deploy (auto-backs up first)
```

### DANGEROUS (data lost):
```bash
docker compose down -v         # ⚠️ DESTROYS all data permanently
docker volume rm emr_postgres_prod_data  # ⚠️ DESTROYS all data
```

---

## Backup & Restore

```bash
# Create a backup
./backup.sh

# Restore from a backup file
./backup.sh restore backups/backup_20240501_120000.sql
```
