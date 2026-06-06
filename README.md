# Sleep Tracker MVP

A personal sleep tracking application with a dark SOC-analyst aesthetic. Log your daily sleep metrics, track subjective scores, and export your data for AI-powered analysis.

---

## Prerequisites

- **Python 3.9+** — [python.org](https://python.org)
- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **pip** (comes with Python)
- **npm** (comes with Node.js)

---

## Quick Start (Windows)

Double-click **`start.bat`** in the project root.

This will:
1. Open a terminal for the backend — installs Python dependencies and starts Flask on port 3030
2. Open a terminal for the frontend — installs npm packages and starts Vite on port 9999

Then open your browser to: **http://localhost:9999**

---

## Manual Start

### Backend
```bash
cd backend
pip install -r requirements.txt
python app.py
```
Flask runs on `http://localhost:3030`. The SQLite database (`sleep_tracker.db`) is created automatically on first run.

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Vite runs on `http://localhost:9999` and proxies `/api` requests to the Flask backend.

---

## Optional: Seed Sample Data

To populate the database with 30 days of randomized sample data for testing:

```bash
cd backend
python seed_data.py
```

---

## How to Use the App

### New Entry Tab
Fill in your sleep data for the day:

1. **Sleep Times** — Enter bed time, when you fell asleep, wake time, and when you got out of bed. A live preview shows calculated duration, cycles, and sleep latency.
2. **Today's Scores** — Rate 5 metrics on 1–10 sliders: sleep inertia, energy level, ankle pain, daily stress, and ankle mobility.
3. **Activity & Context** — Log miles walked, caffeine cutoff time, naps, tags, and free-form notes.
4. Click **Log Sleep Entry** to save.

The form defaults to today's date. Change the date field to backfill past days.

### History Tab
- View aggregate stats (averages across all entries) in the dashboard cards at the top.
- Browse a table of your last 30 entries.
- **Click any row** to open an edit modal — modify or delete that entry.

### Export Tab
- See a summary of your dataset (total days, date range, averages).
- Click **Export JSON for AI** to download all entries as a structured JSON file.
- Copy the **AI Analysis Prompt Template** to use with Claude or ChatGPT.

---

## AI Export Feature

1. Go to the **Export** tab
2. Click **Export JSON for AI** — saves `sleep_data_YYYY-MM-DD.json`
3. Click **Copy Prompt** to copy the analysis prompt
4. Open a new chat in [Claude](https://claude.ai) or [ChatGPT](https://chatgpt.com)
5. Paste the prompt, then paste the contents of your JSON file below it
6. The AI will analyze correlations between caffeine timing, activity, sleep cycles, ankle health, and more — generating personalized recommendations

The prompt instructs the AI to analyze 8 dimensions of your data including caffeine/inertia correlations, optimal sleep duration, tag effects, and ankle pain trends.

---

## Architecture

```
SleepTracker/
├── backend/
│   ├── app.py          Flask API + business logic
│   ├── models.py       SQLAlchemy SleepEntry model
│   ├── requirements.txt
│   └── seed_data.py    Optional test data generator
├── frontend/
│   ├── src/
│   │   ├── App.jsx              Tab navigation shell
│   │   ├── index.css            Global dark theme styles
│   │   └── components/
│   │       ├── EntryForm.jsx    Sleep entry triage form
│   │       ├── Dashboard.jsx    Aggregate stats cards
│   │       ├── HistoryTable.jsx Entry table + edit modal
│   │       └── ExportPanel.jsx  JSON export + AI prompt
│   ├── package.json
│   └── vite.config.js   (proxies /api to :3030)
├── ai_prompt_template.txt
├── start.bat
└── README.md
```

## API Endpoints

| Method | Endpoint              | Description                  |
|--------|-----------------------|------------------------------|
| GET    | /api/entries          | All entries (date desc)      |
| POST   | /api/entries          | Create new entry             |
| GET    | /api/entries/:id      | Single entry                 |
| PUT    | /api/entries/:id      | Update entry                 |
| DELETE | /api/entries/:id      | Delete entry                 |
| GET    | /api/export/json      | Download all entries as JSON |
| GET    | /api/stats            | Aggregate statistics         |
