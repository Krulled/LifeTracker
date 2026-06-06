"""
seed_data.py — Optional helper to populate the database with sample entries.
Run: python seed_data.py
"""
import sys
import os
from datetime import date, timedelta
import random

# Make sure we can import app/models from the same directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db
from models import SleepEntry


SAMPLE_TAGS = [
    "#cervicalpillow",
    "#weed",
    "#highstress_shift",
    "#alcohol",
    "#earlyshift",
    "#lateshift",
    "#exercise_pm",
    None,
    None,
    None,
]


def random_time(hour_min, hour_max):
    h = random.randint(hour_min, hour_max)
    m = random.choice([0, 15, 30, 45])
    return f"{h:02d}:{m:02d}"


def minutes_between(start, end):
    sh, sm = map(int, start.split(":"))
    eh, em = map(int, end.split(":"))
    s = sh * 60 + sm
    e = eh * 60 + em
    if e >= s:
        return e - s
    return (1440 - s) + e


def seed(n=30):
    with app.app_context():
        db.create_all()
        today = date.today()
        created = 0
        for i in range(n, 0, -1):
            entry_date = today - timedelta(days=i)
            if SleepEntry.query.filter_by(entry_date=entry_date).first():
                continue

            bed_time = random_time(22, 23)
            # sleep latency 5–45 minutes
            latency = random.randint(5, 45)
            bh, bm = map(int, bed_time.split(":"))
            sleep_total = bh * 60 + bm + latency
            sleep_time = f"{(sleep_total // 60) % 24:02d}:{sleep_total % 60:02d}"

            # sleep duration 360–540 minutes (6–9 hours)
            duration = random.randint(360, 540)
            wake_total = sleep_total + duration
            wake_time = f"{(wake_total // 60) % 24:02d}:{wake_total % 60:02d}"

            oob_extra = random.randint(0, 30)
            oob_total = wake_total + oob_extra
            out_of_bed_time = f"{(oob_total // 60) % 24:02d}:{oob_total % 60:02d}"

            miles = round(random.uniform(0.5, 8.0), 1)
            caffeine_hour = random.choice([None, "13:00", "14:00", "15:00", "16:00", "17:00"])

            entry = SleepEntry(
                entry_date=entry_date,
                bed_time=bed_time,
                sleep_time=sleep_time,
                wake_time=wake_time,
                out_of_bed_time=out_of_bed_time,
                sleep_duration_minutes=duration,
                sleep_cycles=round(duration / 90, 1),
                sleep_latency_minutes=latency,
                inertia_score=random.randint(1, 10),
                energy_score=random.randint(3, 10),
                ankle_pain_score=random.randint(2, 10),
                stress_score=random.randint(1, 9),
                ankle_mobility_score=random.randint(3, 10),
                miles_walked=miles,
                caffeine_cutoff_time=caffeine_hour,
                naps=random.choice([True, False, False]),
                nap_duration_minutes=random.randint(15, 45) if random.random() < 0.2 else None,
                tags=random.choice(SAMPLE_TAGS),
                notes=None,
            )
            db.session.add(entry)
            created += 1

        db.session.commit()
        print(f"Seeded {created} entries.")


if __name__ == "__main__":
    seed()
