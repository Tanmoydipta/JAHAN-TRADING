# Jahan Trading System — Resale & Deployment Guide

**For: Software vendors selling Jahan Trading System to multiple customers**

This guide explains how to customize and deploy the Jahan Trading System for each customer with their own cloud MySQL database.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Pre-Sales Checklist](#pre-sales-checklist)
3. [Setup for Each Customer](#setup-for-each-customer)
4. [Deployment to Customer](#deployment-to-customer)
5. [Customer Support Basics](#customer-support-basics)
6. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

**Key Principle:** Each customer gets their own self-contained deployment:
- **Executable Folder:** `dist/JahanTradingSystem/` (they run the `.exe`)
- **Database:** Cloud-hosted (Aiven, DigitalOcean, etc.) — customer manages their own
- **Customization:** Only `config.json` changes — company name, address, database connection
- **Data Isolation:** By design (separate databases per customer) + by application (`client_id` support)

**Why this model?**
- ✓ Customers control their own data
- ✓ No vendor lock-in (they own the database)
- ✓ Simple deployment (just an .exe folder)
- ✓ Easy to resell to many customers
- ✓ Minimal ongoing infrastructure cost for you

---

## Pre-Sales Checklist

Before selling to a customer, ensure they have (or are willing to set up):

- [ ] A cloud MySQL database account
  - Recommended: [Aiven Free Tier](https://aiven.io/free-mysql-database) ($0, single-node, sleeps after inactivity)
  - Or: [DigitalOcean Managed MySQL](https://www.digitalocean.com/pricing/managed-databases) ($15/mo, reliable, no surprises)
- [ ] Database connection details (host, port, username, password, database name)
- [ ] Windows PC (the exe is built for Windows; Linux version available on request)
- [ ] Basic comfort with running a local application (double-click exe → login)

---

## Setup for Each Customer

### Step 1: Gather Customer Information

Collect these details from the customer (via email or form):

**Company & Branding:**
- Company / Firm Name
- Business Tagline (optional; defaults to "Importers, Exporters & Wholesale Distributors")
- Official Address
- Phone Number(s)
- Official Email
- Website (optional)
- Invoice Footer Note (optional)

**Database Connection:**
- Database Host (e.g., `mysql-xxxxx.aivencloud.com`)
- Database Port (usually 3306)
- Database Username (e.g., `avnadmin` for Aiven)
- Database Password
- Database Name (e.g., `defaultdb` for Aiven)

### Step 2: Generate Customized config.json

Run the config generator script (Python 3.7+):

```bash
python generate_customer_config.py
```

This interactive script will:
1. Ask you to enter all customer details
2. Load the template `config.json`
3. Customize it with company name, address, and database connection
4. Output `config_CustomerName.json`

**Example:**
```
$ python generate_customer_config.py

--- CUSTOMER COMPANY DETAILS ---
Company / Firm Name: Acme Trading Ltd
Business Tagline / Sub-Heading [Importers, Exporters & Wholesale Distributors]: 
Official Address: 123 Main Street, Dhaka, Bangladesh
Phone Number(s): +880 1234-567890
Official Email: info@acmetrading.com
Website [www.jahantrading.com]: www.acmetrading.com

--- MYSQL DATABASE CONNECTION DETAILS ---
Database Host / Server Address: mysql-abc123.aivencloud.com
Database Port [3306]: 
Database Username: avnadmin
Database Password: secret_password_xyz
Database Name: defaultdb

--- OPTIONAL SETTINGS ---
Invoice Footer Note [Goods once sold...]: 

✓ CONFIG GENERATED SUCCESSFULLY
Output file: config_Acme_Trading_Ltd.json
```

### Step 3: Prepare the Deployment Package

Rename the generated config file to `config.json`:

```bash
# From your project root:
cp config_Acme_Trading_Ltd.json dist/JahanTradingSystem/_internal/config.json
```

Or manually:
1. Open `dist/JahanTradingSystem/_internal/config.json` in a text editor
2. Replace it with the contents of `config_Acme_Trading_Ltd.json`

**The entire folder to ship:**
```
dist/JahanTradingSystem/
├── JahanTradingSystem.exe       ← Customer double-clicks this
├── _internal/
│   ├── config.json              ← Customized for this customer
│   ├── static/                  ← UI files
│   └── ...other binaries...
```

### Step 4: Verify Before Shipping (Recommended)

Before giving to the customer, test it once:

1. **From the exe folder**, double-click `JahanTradingSystem.exe`
2. Wait 2–3 seconds for the browser to open
3. You should see the login screen
4. Login with: `admin` / `admin123`
5. Dashboard should load without errors
6. Check that **Database mode** in the System Status (sidebar) shows `MYSQL Connected`

If you see errors:
- Database connection failed → re-check the host, port, username, password
- No tables created → the database user may lack CREATE TABLE permission
- See [Troubleshooting](#troubleshooting) below

---

## Deployment to Customer

### Option A: Email/Download Link

1. **Create a ZIP file** of `dist/JahanTradingSystem/`
   ```bash
   cd dist
   # On Windows: use 7-Zip, WinRAR, or built-in right-click → "Send to > Compressed"
   # On Mac/Linux:
   zip -r JahanTradingSystem.zip JahanTradingSystem/
   ```

2. **Host it** on your server or a file-sharing service (Google Drive, Dropbox, etc.)

3. **Send to customer:**
   ```
   Subject: Jahan Trading System - Installation & Setup

   Hi [Customer],

   Your Jahan Trading System is ready! Please download and follow the setup guide:

   Download: [LINK_TO_ZIP]
   Setup Guide: [LINK_TO_SETUP_PDF_OR_EMAIL_BODY_BELOW]

   If you have any questions, reply to this email.

   Best regards,
   [Your Support Name]
   ```

### Option B: USB Drive

For customers without reliable internet:
1. Zip the folder
2. Burn to USB drive
3. Physically mail or hand-deliver

---

## Customer Setup Instructions (Send This)

Forward these instructions to each customer after they download/receive their installation:

---

### **CUSTOMER SETUP: Quick Start (5 minutes)**

1. **Extract the ZIP**
   - Right-click `JahanTradingSystem.zip` → Extract All
   - You'll get a folder named `JahanTradingSystem`

2. **Run the Application**
   - Open the `JahanTradingSystem` folder
   - Double-click `JahanTradingSystem.exe`
   - Wait 2–3 seconds for your browser to open
   - You should see the **Jahan Trading System Login** screen

3. **First Login**
   - Username: `admin`
   - Password: `admin123`
   - Client Profile: `CLI-001 (Main Branch)` (default)
   - Click **Secure System Login**

4. **Initial Setup**
   - Dashboard loads → you're in!
   - **IMPORTANT:** Change the admin password immediately
     - Go to **User & Password Setup** → Create a new strong password
     - Then log out and log back in with the new password

5. **Add Your Company Details**
   - Go to **Business Pad Setup**
   - Update company name, address, phone, email
   - Save

6. **Start Using**
   - Go to **Entry Points** → **Add / Update Product**
   - Create products and start entering sales/purchases

### **Troubleshooting**

**Q: Nothing happens when I double-click the exe**
- A: Check that your antivirus isn't blocking it. On first run, Windows Defender may ask for permission — allow it.

**Q: "Database connection failed" or "MySQL connection error"**
- A: Check that:
  1. Your cloud database (Aiven/DigitalOcean) is running
  2. The hostname is correct (check your cloud provider's dashboard)
  3. The username and password are exact matches (copy-paste, not type)
  4. Your cloud provider hasn't blocked your IP (check firewall rules)

**Q: "Permission denied" on database operations**
- A: Your database user may lack CREATE TABLE rights. Contact your cloud provider to grant `ALL PRIVILEGES` on the database.

**Q: The app is very slow**
- A: This is expected over slow internet (Aiven free tier or distant servers). Local MySQL on your office network would be faster. For now, be patient on load times.

**Q: How do I add more users for my team?**
- A: In the app, go to **User & Password Setup** → **New User & Password Creation**. Create a new login for each team member and assign their role (Sales Clerk, Inventory Manager, etc.).

**Q: Can I use this on multiple computers?**
- A: Yes! Give the `JahanTradingSystem` folder to anyone on your team. They run the same exe and it connects to the same database (as long as the config.json is the same).

**Q: How do I backup my data?**
- A: Backups are automatic with Aiven/DigitalOcean. Log into your cloud provider's dashboard to download backups or enable automated daily backups.

**Q: Support / Help?**
- A: Email us at [YOUR_SUPPORT_EMAIL]. Include:
  - What you were doing
  - What happened
  - Any error messages you saw
  - Your company name

---

## Customer Support Basics

### Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Won't start (exe closes instantly) | Wrong Python, missing Flask | Rebuild exe with Python 3.14 (or your latest) |
| "No module named flask" | Exe built with wrong Python | See above; rebuild and redeploy |
| Database connection times out | Firewall blocking port 3306 | Customer's ISP/cloud provider firewall — have them check DB provider's network settings |
| Slow first login | Database query slow | Normal on first run; caches data after |
| Duplicate Chalan numbers | User created multiple sales in quick succession | Design works correctly; Chalan numbers are sequential and unique per customer |
| Can't see data from another user | Expected — app is single-client mode by default | Configure `client_id` in config.json if multi-branch setup needed |

### Escalation Path

1. **Customer emails you** with the issue
2. **Collect info:** error message, what they were doing, screenshot
3. **Ask them to:**
   - Verify database is online (check cloud provider's dashboard)
   - Try restarting the exe
   - Check antivirus / firewall isn't blocking the app
4. **If still broken:** escalate to the development team with:
   - Customer's exact steps to reproduce
   - Error logs (if they can provide them)
   - Their database provider (Aiven/DigitalOcean/other)

---

## Security Considerations

### For You (Vendor)

- [ ] **config.json contains passwords** — never commit it to git
- [ ] **Use .gitignore** to exclude config files:
  ```
  config_*.json
  dist/JahanTradingSystem/_internal/config.json
  ```
- [ ] **Version control the template** (`config.json` in repo) but not customer configs
- [ ] **Distribute securely** — use HTTPS links, encrypted email, or secure file sharing (not plaintext email)

### For Customers

- [ ] **Change default admin password** immediately on first login
- [ ] **Keep config.json secure** — it contains their DB password
- [ ] **Use strong database passwords** (generated by cloud provider or 16+ char random)
- [ ] **Restrict database access** to their office IP only (cloud provider firewall settings)
- [ ] **Enable automated backups** in Aiven/DigitalOcean dashboard
- [ ] **Do not share the exe folder** with untrusted parties (contains DB password in plaintext)

---

## Scaling to Multiple Customers

### After 5–10 Customers

Consider automating the deployment:

1. **Config generator in web form** (instead of CLI script)
   - Customer fills web form → you generate config.json
   - Auto-creates ZIP and sends download link
   - Saves time for you

2. **Self-service deployment** (advanced)
   - Customer sets up their own database (Aiven/DigitalOcean)
   - You provide a self-serve download page with the config generator
   - Customer never deals with you on setup — just support after

3. **License key / activation** (if needed)
   - Add a simple license check in `app.py` on login
   - Prevents unauthorized use

---

## FAQ

**Q: Can I resell this without disclosing that it's based on your system?**
- A: That depends on your license agreement. If you have the source code rights, typically yes. Check your licensing terms.

**Q: What if a customer's database gets corrupted?**
- A: They restore from backups (managed by Aiven/DigitalOcean). You can also provide fresh copies of the schema by re-running `python database.py init_db()` — it recreates tables (won't overwrite existing data).

**Q: Can I host a single database for all my customers?**
- A: Yes! The app supports multi-tenancy via `client_id`. Every customer would share one database but data is segregated by `client_id` in config.json. More complex to manage but cheaper. Contact the dev team if you want to pursue this.

**Q: How do I handle updates (bug fixes, new features)?**
- A: Rebuild the exe with the latest source code, then re-run the config generator to create new configs for each customer. Ship them updated `.exe` folders. They replace their old folder or extract to a new location.

---

## Questions?

If you have questions about resale, deployment, or customization, contact:
- **Email:** [YOUR_EMAIL]
- **Discord/Slack:** [YOUR_CHAT_LINK] (optional)

Good luck selling! 🚀

---

*Last updated: July 2026*
