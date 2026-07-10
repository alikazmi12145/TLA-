# TLA HRMS — Hostinger VPS Deployment Guide

End-to-end guide to run the TLA HRMS (Node/Express API + React/Vite SPA + MongoDB + ZKTeco K40 biometric) on a Hostinger KVM VPS with a real domain, HTTPS, and a live connection to your on-site K40 fingerprint device.

---

## 1. Recommended Hostinger Plan

Hostinger sells shared, cloud, and **KVM VPS** plans. Only KVM VPS gives you full root and the ability to install Node.js, MongoDB, Nginx, PM2, Tailscale, etc. Shared/Business hosting will **not** work for this project.

| Plan | vCPU | RAM | NVMe | Bandwidth | Good for |
|------|------|-----|------|-----------|----------|
| KVM 1 | 1 | 4 GB | 50 GB | 4 TB | ≤ 20 employees, testing |
| **KVM 2 (recommended)** | **2** | **8 GB** | **100 GB** | **8 TB** | **≤ 200 employees, production** |
| KVM 4 | 4 | 16 GB | 200 GB | 16 TB | ≥ 200 employees, multiple devices |

Also buy from Hostinger (or use Cloudflare):

- **A domain** (e.g. `tlahrms.com`) — you'll point a subdomain like `hrms.tlahrms.com` at the VPS.
- **SSL** — we'll generate a free Let's Encrypt certificate ourselves, no need to buy one.

**OS to install on the VPS:** Ubuntu 24.04 LTS (64-bit). All commands in this guide assume Ubuntu 24.04.

---

## 2. Architecture at a Glance

```
                                 ┌──────────────────────────────────────┐
Browser (HTTPS 443)              │  Hostinger KVM VPS (Ubuntu 24.04)    │
  hrms.tlahrms.com  ─────────▶   │  ┌───────────┐   ┌────────────────┐  │
                                 │  │  Nginx    │──▶│ Node API (PM2) │  │
                                 │  │ (reverse  │   │ port 5000      │  │
                                 │  │  proxy +  │   └──────┬─────────┘  │
                                 │  │  static)  │          │            │
                                 │  └───────────┘   ┌──────▼─────────┐  │
                                 │                  │  MongoDB 7     │  │
                                 │                  └────────────────┘  │
                                 │       ▲                              │
                                 │       │ Tailscale VPN (encrypted)    │
                                 └───────┼──────────────────────────────┘
                                         │
                     Office LAN          ▼
                     ┌───────────────────────────────────┐
                     │  Tailscale relay (a Windows/Linux │
                     │  PC on the same LAN as the K40)   │
                     │              │                    │
                     │              ▼                    │
                     │   ZKTeco K40  192.168.1.201:4370  │
                     └───────────────────────────────────┘
```

Key ideas:

- **One VPS** runs Nginx, the Node API, and MongoDB.
- **Frontend** is a static build (Vite `dist/`) served by Nginx.
- **Nginx** reverse-proxies `/api/*`, `/uploads/*`, and `/health` to the Node API on `127.0.0.1:5000`.
- The K40 sits on your office LAN — a **Tailscale VPN** lets the VPS reach it securely without opening the device to the public internet.

---

## 3. Before You Start

Have these ready:

- Hostinger VPS created, root password / SSH key noted.
- A domain (`tlahrms.com`) with access to its DNS panel.
- Your source code pushed to a Git repo (GitHub / GitLab). A **private** repo is fine — authenticate on the VPS with a personal access token.
- The **office machine** that will act as the Tailscale relay is powered on and connected to the same LAN as the K40.
- The K40's LAN IP (e.g. `192.168.1.201`), port (`4370`), and admin password (if any).

---

## 4. VPS Initial Setup

### 4.1 Log in and create a deploy user

```bash
ssh root@YOUR_VPS_IP
adduser deploy
usermod -aG sudo deploy
```

From your **local** machine, copy your SSH key so `deploy` can log in without a password:

```bash
ssh-copy-id deploy@YOUR_VPS_IP
```

### 4.2 Base security + firewall

Back on the VPS as `root` (or via `sudo`):

```bash
apt update && apt -y upgrade
ufw allow OpenSSH
ufw allow 'Nginx Full'      # opens 80 + 443
ufw --force enable
```

Optional but recommended: disable root SSH — edit `/etc/ssh/sshd_config`, set `PermitRootLogin no`, then `systemctl restart ssh`.

From now on, log in as `deploy`:

```bash
ssh deploy@YOUR_VPS_IP
```

---

## 5. Install Required Software

Run as `deploy` (uses `sudo` where needed).

### 5.1 Node.js 22 LTS + Git + Nginx + PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx
sudo npm i -g pm2
```

Verify:

```bash
node -v          # v22.x
npm -v
nginx -v
pm2 -v
```

### 5.2 MongoDB 7

```bash
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
```

Confirm:

```bash
systemctl status mongod --no-pager
mongosh --eval "db.runCommand({ ping: 1 })"
```

*(Alternative: skip installing MongoDB locally and use [MongoDB Atlas](https://www.mongodb.com/atlas) free tier. Paste the `mongodb+srv://…` URI into `MONGO_URI` in step 8.)*

### 5.3 Certbot (Let's Encrypt HTTPS)

```bash
sudo apt install -y certbot python3-certbot-nginx
```

---

## 6. Point Your Domain at the VPS

In your DNS panel (Hostinger or Cloudflare), add:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A    | hrms | `YOUR_VPS_PUBLIC_IP` | Auto |

Wait 1–5 minutes, then test from the VPS:

```bash
dig +short hrms.tlahrms.com
```

It should return the VPS IP.

---

## 7. Get the Code on the VPS

```bash
sudo mkdir -p /var/www/tla-hrms
sudo chown deploy:deploy /var/www/tla-hrms
cd /var/www/tla-hrms
git clone https://github.com/YOUR-USER/tla-hrms.git .
```

For private repos, use a personal access token:

```bash
git clone https://YOUR_USER:YOUR_TOKEN@github.com/YOUR-USER/tla-hrms.git .
```

---

## 8. Configure and Start the Backend

```bash
cd /var/www/tla-hrms/backend
npm ci --omit=dev
mkdir -p uploads/profile uploads/payslips uploads/logo
nano .env
```

Paste this — **replace all secrets** with your own values:

```env
NODE_ENV=production
PORT=5000

# Local MongoDB (or paste your Atlas URI)
MONGO_URI=mongodb://127.0.0.1:27017/tla_hrms

# Public URL of your frontend (comma-separate multiple if needed)
CLIENT_URL=https://hrms.tlahrms.com

# Where uploaded files (profile pics, payslips, logo) live
UPLOAD_DIR=uploads

# JWT — generate long random strings, e.g.  openssl rand -hex 48
JWT_ACCESS_SECRET=REPLACE_WITH_LONG_RANDOM_STRING
JWT_REFRESH_SECRET=REPLACE_WITH_ANOTHER_LONG_RANDOM_STRING
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
BCRYPT_SALT_ROUNDS=10

# Email (optional — needed only for password reset)
MAIL_HOST=smtp.hostinger.com
MAIL_PORT=465
MAIL_USER=hrms@tlahrms.com
MAIL_PASS=your-mailbox-password
MAIL_FROM="TLA HRMS <hrms@tlahrms.com>"

# Biometric — leave true until Tailscale is up (Step 11), then set to false
BIOMETRIC_MOCK=true
BIOMETRIC_POLL_INTERVAL_MS=60000
BIOMETRIC_TIMEOUT_MS=5000

# First-run super admin (used by the seeder)
SEED_ADMIN_EMAIL=admin@tlahrms.com
SEED_ADMIN_PASSWORD=ChangeMeStrong!123
SEED_ADMIN_NAME=Super Admin
```

Seed the initial super admin, then start under PM2:

```bash
node src/seeders/index.js
pm2 start src/server.js --name hrms-api
pm2 save
pm2 startup systemd -u deploy --hp /home/deploy
# ↑ run the exact command PM2 prints (starts with `sudo env …`)
```

Sanity check:

```bash
curl http://127.0.0.1:5000/health
# → {"status":"ok","time":"..."}
pm2 logs hrms-api --lines 30
```

---

## 9. Build the Frontend

The API and the SPA are served on the **same origin**, so the frontend only needs relative URLs.

```bash
cd /var/www/tla-hrms/frontend
cat > .env.production <<'EOF'
VITE_API_URL=/api/v1
VITE_API_BASE=
EOF
npm ci
npm run build          # produces dist/
```

---

## 10. Nginx Virtual Host

```bash
sudo tee /etc/nginx/sites-available/hrms > /dev/null <<'EOF'
server {
    listen 80;
    server_name hrms.tlahrms.com;

    client_max_body_size 25M;
    root /var/www/tla-hrms/frontend/dist;
    index index.html;

    # SPA — fall back to index.html for client-side routes
    location / {
        try_files $uri /index.html;
    }

    # Node API
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Uploaded files (profile pics, payslips, logo)
    location /uploads/ {
        proxy_pass http://127.0.0.1:5000;
    }

    # Health probe
    location /health {
        proxy_pass http://127.0.0.1:5000;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/hrms /etc/nginx/sites-enabled/hrms
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Visit `http://hrms.tlahrms.com` — the login page should load. Log in with the seeded admin credentials.

### 10.1 Enable HTTPS

```bash
sudo certbot --nginx -d hrms.tlahrms.com
```

Certbot updates the vhost to serve HTTPS on 443, redirects HTTP→HTTPS, and installs an auto-renew timer. Re-visit `https://hrms.tlahrms.com` — the padlock should be green.

---

## 11. Connect the K40 Device (Tailscale VPN)

The K40 lives on your office LAN, and a cloud VPS cannot reach it directly. **Tailscale** is the simplest, safest fix — it creates a private encrypted mesh between the VPS and one of your office machines.

### 11.1 Create a Tailscale account

Sign up free at <https://login.tailscale.com/start>. Free tier covers up to 100 devices.

### 11.2 Install Tailscale on the VPS

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# → opens a URL. Paste it in your browser and log in to authorise the VPS.
tailscale ip -4                        # note this address (e.g. 100.101.10.5)
```

### 11.3 Install Tailscale on an office machine (Windows/Linux/macOS)

Download the installer from the Tailscale website, log in with the same account. On the office machine, advertise the LAN so the VPS can reach the K40:

```bash
# On the office relay (Linux example)
sudo tailscale up --advertise-routes=192.168.1.0/24   # use your real LAN CIDR
```

Then in the Tailscale admin console (`https://login.tailscale.com/admin/machines`):

1. Open the office relay machine.
2. Click **Edit route settings…**
3. Enable the `192.168.1.0/24` subnet route.

Now from the VPS you should be able to reach the K40 by its LAN IP:

```bash
ping -c 3 192.168.1.201
nc -vz 192.168.1.201 4370             # should say "succeeded" or "open"
```

### 11.4 Register the device inside HRMS

1. Open the app → **Biometric Devices** → **New Device**.
2. Fill in:
   - **Name:** `Head Office K40`
   - **IP:** `192.168.1.201` (the K40's LAN IP)
   - **Port:** `4370`
   - **Connection Type:** `TCP`
   - **Enabled:** ✓
   - **Primary:** ✓ (mark this as the primary device)
3. Save → click **Test connection**. You should see `Online`, latency in ms.

### 11.5 Turn off mock mode

```bash
cd /var/www/tla-hrms/backend
nano .env
# change BIOMETRIC_MOCK=true → BIOMETRIC_MOCK=false
pm2 restart hrms-api
pm2 logs hrms-api --lines 50
```

You should see the biometric poller log lines every ~60 s. Employees created from now on are pushed to the K40 automatically, and the admin dashboard's **Enrollment** card reflects live status.

---

## 12. Post-Deployment Verification

Quick smoke test:

| # | Action | Expected result |
|---|--------|-----------------|
| 1 | Load `https://hrms.tlahrms.com` | Login page over HTTPS |
| 2 | Log in as super admin | Admin dashboard renders, "Announcements" card visible |
| 3 | Create a test employee | Stepper dialog: syncs to device, shows *Please enroll fingerprint* with the Device User ID |
| 4 | Punch that employee's finger on the K40 | Within 3 s, dialog flips to *Fingerprint enrolled* (green) |
| 5 | **Biometric Devices → Head Office K40 → Test connection** | `Online`, low ms |
| 6 | Post an announcement targeting *All employees* | Non-admin users see it on their dashboard + a bell notification |
| 7 | Wait ≤ 60 s after a real punch on the K40 | Attendance appears on the **Attendance** page |

---

## 13. Day-to-Day Operations

### 13.1 Deploy a code update

```bash
cd /var/www/tla-hrms
git pull

# Backend deps only if package.json changed
cd backend && npm ci --omit=dev

# Frontend rebuild
cd ../frontend && npm ci && npm run build

# Restart the API (Nginx picks up the new dist/ automatically)
pm2 restart hrms-api
```

Or save this as `~/deploy.sh` on the VPS and run `bash ~/deploy.sh` after each `git pull`.

### 13.2 Logs

```bash
pm2 logs hrms-api           # live tail of the API
pm2 logs hrms-api --lines 200
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
sudo journalctl -u mongod -f
```

### 13.3 Nightly MongoDB backup (cron)

```bash
mkdir -p /home/deploy/backups
crontab -e
```

Add:

```cron
0 2 * * * mongodump --db=tla_hrms --gzip --archive=/home/deploy/backups/hrms-$(date +\%F).gz && find /home/deploy/backups -type f -mtime +14 -delete
```

### 13.4 Back up the `uploads/` folder

```bash
# Run from the office/NAS side to pull nightly
rsync -avz deploy@YOUR_VPS_IP:/var/www/tla-hrms/backend/uploads/ ./hrms-uploads-backup/
```

### 13.5 Restore a backup

```bash
gunzip < /home/deploy/backups/hrms-2026-07-01.gz | mongorestore --archive --drop
```

---

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
|--------|-------------|-----|
| Site returns **502 Bad Gateway** | Node API is down | `pm2 status`, then `pm2 restart hrms-api`; check `pm2 logs`. |
| Frontend loads but every API call returns 404 | Nginx path or `VITE_API_URL` wrong | Confirm `VITE_API_URL=/api/v1` in `.env.production`, rebuild, reload Nginx. |
| Login says *Network Error* over HTTPS but works on HTTP | Mixed content / CORS | Make sure `CLIENT_URL=https://…` in backend `.env`, restart API. |
| **Device sync failed** on create employee | K40 unreachable from VPS | `ping 192.168.1.201` from VPS. If it fails, re-check Tailscale subnet route is approved and office relay is online. |
| Enrollment stuck on *Waiting* forever | Employee never punched OR wrong `deviceUserId` on the K40 | Ask employee to punch again; click **Check now** in the dialog; verify the enrolled ID on the K40 keypad matches. |
| Punches on K40 don't appear in Attendance | Poller disabled or overlap | Confirm `BIOMETRIC_MOCK=false` and `BIOMETRIC_POLL_INTERVAL_MS>0`; check `pm2 logs` for `[biometric]` lines. |
| MongoDB won't start | Disk full / permission | `df -h`, `sudo systemctl status mongod`, `sudo journalctl -u mongod -n 100`. |
| Certbot renewal fails | Firewall closed port 80 | `sudo ufw allow 'Nginx Full'`; run `sudo certbot renew --dry-run`. |
| Large image / payslip fails to upload | Nginx `client_max_body_size` too low | Raise the value in the vhost, `sudo systemctl reload nginx`. |
| Emails not sending | Wrong SMTP creds / port blocked | Try port `587` with `secure: false`; some hosts block 465 outbound. |

---

## 15. Security Checklist

- [ ] Non-root `deploy` user with SSH key login; root SSH disabled.
- [ ] `ufw` enabled — only 22, 80, 443 open publicly.
- [ ] Strong JWT secrets (≥ 48 random hex chars).
- [ ] Default admin password changed after first login.
- [ ] MongoDB bound to `127.0.0.1` only (default). *Do not* expose port 27017.
- [ ] HTTPS enforced (Certbot did this automatically).
- [ ] K40 device **not** port-forwarded to the public internet — reached only via Tailscale.
- [ ] Nightly MongoDB backup + weekly off-box copy of `uploads/`.
- [ ] `sudo unattended-upgrades` enabled for automatic security patches.

---

## 16. Quick Reference

| What | Where |
|------|-------|
| Backend code | `/var/www/tla-hrms/backend` |
| Backend env  | `/var/www/tla-hrms/backend/.env` |
| Frontend build | `/var/www/tla-hrms/frontend/dist` |
| Nginx vhost | `/etc/nginx/sites-available/hrms` |
| PM2 process | `hrms-api` (`pm2 ls`) |
| MongoDB data | `/var/lib/mongodb` |
| Uploads | `/var/www/tla-hrms/backend/uploads` |
| Backups | `/home/deploy/backups` |
| Health check | `https://hrms.tlahrms.com/health` |

You're live.
