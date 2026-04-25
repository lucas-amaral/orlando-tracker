# 🌴 Orlando Tracker

Automatic flight price and theme park ticket monitor for **Porto Alegre → Orlando** for **Jan/Feb 2027**.

Runs for free in the cloud and sends me an email when prices drop below your thresholds.

---

## What it does

- ✈️ Monitors flights POA → MCO (round trip, 4 passengers, 12–18 days)
- 🏰 Monitors tickets for 4 Disney parks (with "4-Park Magic Ticket" promotion detection)
- 🎬 Monitors tickets for 3 Universal parks (Studios, Islands of Adventure, Epic Universe)
- 💰 Converts everything to R$ with daily exchange rates
- 📧 Sends email alerts when any price drops below a threshold
- 📊 Web dashboard with price history
- ⏰ Runs automatically 2× per day (7am and 7pm, Brasília time)

---

## Step 1 — Set up the database (Supabase)

1. Go to https://supabase.com and create an account (free)
2. Click **"New Project"**
3. Fill in:
   - Name: `orlando-tracker`
   - Database password: save this password!
   - Region: `South America (São Paulo)`
4. Wait ~2 minutes for the project to be created
5. Go to **Settings → Database**
6. Scroll to **"Connection string"** and copy the URI in this format:
   ```
   postgresql://postgres:[PASSWORD]@db.[ID].supabase.co:5432/postgres
   ```
7. Save this string — you'll use it in Render

---

## Step 2 — Configure Gmail for sending emails

1. Go to Gmail account at https://myaccount.google.com
2. Enable **2-Step Verification** (required for app passwords)
3. Go to **Security → App passwords**
4. Select "Other (custom name)" → type `Orlando Tracker`
5. Click **Generate**
6. Copy the 16-character password generated (e.g., `abcd efgh ijkl mnop`)
7. Save it — this is `GMAIL_APP_PASSWORD`

---

## Step 3 — Push the code to GitHub

```bash
# 1. Create a repository on GitHub (can be private)
#    Go to https://github.com/new

# 2. On your machine, enter the project folder:
cd orlando-tracker

# 3. Initialize git and push the code:
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/orlando-tracker.git
git branch -M main
git push -u origin main
```

---

## Step 4 — Deploy on Render.com

1. Go to https://render.com and create an account
2. Click **"New +"** → **"Web Service"**
3. Connect GitHub account and select the `orlando-tracker` repository
4. Configure:
   - **Name:** `orlando-tracker`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node src/index.js`
   - **Plan:** `Free`
5. Scroll to **"Environment Variables"** and add:

| Variable | Value                                 |
|---|---------------------------------------|
| `DATABASE_URL` | Supabase URL copied in Step 1         |
| `GMAIL_USER` | email@gmail.com                       |
| `GMAIL_APP_PASSWORD` | App password from Step 2              |
| `ALERT_EMAIL_TO` | email@gmail.com (or another)          |
| `FLIGHT_ALERT_THRESHOLD` | `14000` (alert if 4 pax < R$14,000)   |
| `DISNEY_ALERT_THRESHOLD` | `9000` (alert if 4 tickets < R$9,000) |
| `UNIVERSAL_ALERT_THRESHOLD` | `7000` (alert if 4 tickets < R$7,000) |
| `RUN_ON_START` | `true`                                |
| `NUM_PASSENGERS` | `4`                                   |

6. Click **"Create Web Service"**
7. Wait for the deploy (~3 minutes)

---

## Step 5 — Create database tables

After deployment, open the Render shell (or run locally with your variables):

**Option A — Via Render Shell:**
1. In the Render dashboard, open the service
2. Click **"Shell"**
3. Type: `node src/db/setup.js`

**Option B — Locally:**
```bash
# 1. Create the .env file with your variables (based on .env.example)
cp .env.example .env
# Edit .env with your real values

# 2. Install dependencies
npm install

# 3. Create tables
npm run setup-db
```

---

## Access the dashboard

After deployment, the dashboard will be at:
```
https://orlando-tracker.onrender.com
```

You can access it anytime to see the latest prices found.

> ⚠️ **Note about Render's free tier:** The free tier "sleeps" after 15 minutes of inactivity. Internal cron jobs keep running, but the dashboard may take ~30s to load after becoming inactive. To avoid this, you can use UptimeRobot (free) to ping every 14 minutes.

---

## Keep Render awake (optional but recommended)

1. Go to https://uptimerobot.com and create a free account
2. Click **"+ Add New Monitor"**
3. Configure:
   - Monitor Type: `HTTP(s)`
   - URL: `https://orlando-tracker.onrender.com/health`
   - Monitoring Interval: `5 minutes`
4. Save — now the service will never sleep

---

## Run a manual check

You can force a check anytime:

- **Via browser:** Visit `https://orlando-tracker.onrender.com/run-check`
- **Via terminal:** `npm run check`

---

## Customize alert thresholds

Edit the environment variables in the Render dashboard:

- `FLIGHT_ALERT_THRESHOLD` — Maximum acceptable price for flights (4 people, round trip, in R$)
- `DISNEY_ALERT_THRESHOLD` — Maximum price for 4 Disney tickets (4 days)  
- `UNIVERSAL_ALERT_THRESHOLD` — Maximum price for 4 Universal tickets (3 days)

**Reference prices (April/2026):**

| Item | Typical price | Good price | Suggested threshold |
|---|---|---|---|
| Flights 4 pax (POA→MCO) | R$ 18,000–24,000 | < R$ 15,000 | R$ 14,000 |
| Disney 4 days × 4 pax | R$ 11,600–14,000 | < R$ 10,000 | R$ 9,000 |
| Universal 3 days × 4 pax | R$ 9,000–12,000 | < R$ 8,000 | R$ 7,000 |

---

## Money-saving tips

### Flights
- **Best dates:** Flights on Tuesday or Wednesday departing in **mid-January** (weeks 2–3) are cheapest
- **Recommended airline:** Azul has direct flights from Campinas; LATAM connects through GRU. Combining Azul (POA→VCP) + international carrier can be cheaper
- **Ideal advance booking:** 3–6 months ahead (Jul/Aug/Sep 2026)

### Disney tickets
- **"4-Park Magic Ticket" deal:** When available, visit all 4 parks paying for 3 days — saves R$ 500–1,000 per person
- **Where to buy in BRL:** orlandoparabrasileiros.com or decolar.com (no IOF, installment options)
- **Avoid:** Park box office (up to 30% more expensive)

### Universal tickets
- **Epic Universe:** New park opening in 2025 — include in "3-Park Explorer" package
- **Frequent deals:** "3 days for the price of 2" appears 2–3× per year
- **Where to buy:** orlandoparabrasileiros.com has better prices than the official site for Brazilians

---

## Project structure

```
orlando-tracker/
├── src/
│   ├── index.js          # Web server + cron jobs
│   ├── check.js          # Manual check
│   ├── scrapers/
│   │   ├── flights.js    # Flight scraper
│   │   ├── disney.js     # Disney tickets scraper
│   │   └── universal.js  # Universal tickets scraper
│   ├── alerts/
│   │   └── email.js      # Email sending
│   ├── db/
│   │   ├── client.js     # PostgreSQL connection
│   │   └── setup.js      # Table creation
│   └── utils/
│       ├── logger.js     # Logger
│       └── exchange.js   # USD→BRL exchange rate
├── .env.example          # Environment variables template
├── render.yaml           # Render configuration
├── package.json
└── README.md
```

---

## Troubleshooting

**Dashboard won't open:**
- Check if the Render deployment succeeded (Logs tab)
- Wait ~30s if the service was sleeping

**Emails not arriving:**
- Verify the Gmail App Password is correct (no spaces)
- Confirm that 2-Step Verification is enabled on your Google account
- Check your spam folder

**Database won't connect:**
- Confirm the `DATABASE_URL` matches exactly what you copied from Supabase
- Verify you ran `npm run setup-db` to create the tables

**Prices not showing on dashboard:**
- Visit `/run-check` to force a check
- Airline websites block scrapers frequently — this is normal
- The system uses fallback with historical estimates when scrapers fail

---

## Important notice

This system performs automated searches on public websites. Some sites may occasionally block access — this is expected and the system has fallbacks. Displayed prices are for reference; always confirm on the official website before purchasing.
