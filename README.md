# EaseMyRentals

> Premium managed rental platform for Bangalore — built for property owners, tenants, and admins.

A full-stack Ruby web application with role-based portals, a 3D public website, and a PostgreSQL backend. Deployable in one command via Docker.

---

## Features

### Public Website
- 3D interactive UI — tilt cards, parallax hero, scroll-reveal animations, extruded buttons
- Pink & orange premium design with Playfair Display + Plus Jakarta Sans typography
- Property listings (rent/deposit hidden — "Get in Touch" CTA instead)
- Contact form with dynamic fields for owners and tenants
- WhatsApp integration

### Admin Portal
- Manage properties, tenants, owners, inspections, assets, payments, listings, enquiries
- Maintenance requests dashboard with status management
- Real-time notification badges on tabs
- Full CRUD on all resources

### Owner Portal
- View assigned properties, inspection photos, payment history
- Submit and track maintenance requests
- Receive notifications from admin

### Tenant Portal (read-only)
- View assigned property, room details, assets, payments, inspections
- Submit maintenance/service requests (only write action)
- Track request status

### Backend
- Ruby + WEBrick (no framework)
- PostgreSQL with `bcrypt` password hashing
- Role-based API with session cookies
- Auto-seeds demo data on first boot

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Ruby 3.3, WEBrick, pg gem |
| Database | PostgreSQL 15 |
| Frontend | Vanilla JS, CSS3 (no framework) |
| Fonts | Playfair Display, Plus Jakarta Sans |
| Proxy | Nginx |
| Containers | Docker + Docker Compose |

---

## Demo Credentials

Auto-seeded on first startup when the database is empty.

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@easemyrentals.com` | `admin123` |
| Owner | `owner@example.com` | `owner123` |
| Owner 2 | `owner2@example.com` | `owner123` |
| Owner 3 | `owner3@example.com` | `owner123` |
| Tenant | `tenant@example.com` | `tenant123` |
| Tenant 2 | `tenant2@example.com` | `tenant123` |
| Tenant 3–5 | `tenant3-5@example.com` | `tenant123` |

> ⚠️ Change the admin credentials in `.env` before production use.

See `DEMO_CREDENTIALS.md` for full details on how seeding works.

---

## Run Locally (Docker)

```bash
git clone https://github.com/keshawdewangan/EaseMyrentals.git
cd EaseMyrentals
cp .env.example .env          # edit passwords if needed
docker compose up --build
```

Open: `http://127.0.0.1:8000`

---

## Run Locally (Native Ruby)

Requires Ruby 3.3+ and PostgreSQL running locally.

```bash
bundle install
export DATABASE_URL=postgres:///easemyrentals_development
bin/dev
```

Open: `http://127.0.0.1:8000`

---

## Deploy to Production (Oracle VM / Any Linux Server)

### 1. Install Docker on the server

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
sudo apt install -y docker-compose-plugin
```

### 2. Open firewall ports

**Oracle Cloud Console** → VCN → Security Lists → Add Ingress Rules for TCP ports `80`, `443`, `8080`.

```bash
# Also open in OS firewall
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8080 -j ACCEPT
sudo netfilter-persistent save
```

### 3. Clone and configure

```bash
git clone https://github.com/keshawdewangan/EaseMyrentals.git
cd EaseMyrentals
cp .env.example .env
nano .env    # set POSTGRES_PASSWORD, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD
chmod +x deploy.sh backup.sh
```

### 4. Deploy

```bash
./deploy.sh
```

Site will be live at: `http://YOUR_SERVER_IP:8080`

---

## Redeploying / Updating

```bash
git pull
./deploy.sh
```

The script automatically:
- Backs up the database before every deploy
- Rebuilds only the app container (DB data untouched)
- Waits for health check and prints the live URL

---

## Database Backup & Restore

```bash
# Create a backup
./backup.sh

# Restore from a backup file
./backup.sh restore backups/backup_20240501_120000.sql
```

Backups are saved to `./backups/` (gitignored). Last 10 backups are kept automatically.

---

## Migrating Data to a New Server

```bash
# 1. Backup on old server
./backup.sh

# 2. Copy to new server
scp backups/backup_*.sql ubuntu@NEW_SERVER_IP:~/EaseMyrentals/backups/

# 3. On new server — deploy first, then restore
./deploy.sh
./backup.sh restore backups/backup_*.sql
docker compose -f docker-compose.prod.yml restart app
```

---

## Data Persistence

Data lives in named Docker volumes — independent of git and safe across deploys.

| Environment | Volume Name |
|-------------|-------------|
| Dev | `emr_postgres_dev_data` |
| Prod | `emr_postgres_prod_data` |

```bash
docker compose down        # ✅ Safe — data survives
docker compose down -v     # ❌ DESTROYS all data permanently
```

---

## Project Structure

```
EaseMyRentals/
├── server.rb                  # Full backend (routes, auth, DB logic)
├── Gemfile                    # Ruby dependencies
├── Dockerfile                 # App container
├── docker-compose.yml         # Dev stack
├── docker-compose.prod.yml    # Production stack (app + db + nginx)
├── nginx.conf                 # Reverse proxy with rate limiting
├── deploy.sh                  # One-click production deploy
├── backup.sh                  # Database backup & restore
├── .env.example               # Environment variable template
├── DEMO_CREDENTIALS.md        # All seed accounts documented
└── public/
    ├── index.html             # Public website
    ├── app.js                 # Frontend logic (portals + public site)
    ├── styles.css             # Base styles
    ├── premium-styles.css     # Pink/orange premium theme
    ├── 3d-styles.css          # 3D depth, tilt, parallax effects
    └── 3d-effects.js          # Mouse tilt + scroll reveal JS engine
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_PASSWORD` | Database password | *(required)* |
| `POSTGRES_USER` | Database user | `easemyrentals` |
| `POSTGRES_DB` | Database name | `easemyrentals` |
| `SUPERADMIN_EMAIL` | Admin login email | `admin@easemyrentals.com` |
| `SUPERADMIN_PASSWORD` | Admin login password | `admin123` |
| `SUPERADMIN_NAME` | Admin display name | `EaseMyRentals Admin` |
| `PORT` | App server port | `8000` |

---

## Media Storage

Admin can paste image/video URLs or upload local files (stored as data URLs in PostgreSQL). For production scale, replace with Firebase Storage, S3, or Cloudinary and save only the public URL.

---

## License

Private — EaseMyRentals © 2024. All rights reserved.
