from datetime import datetime, date, timedelta
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class AICache(db.Model):
    __tablename__ = "ai_cache"

    id           = db.Column(db.Integer, primary_key=True, autoincrement=True)
    cache_key    = db.Column(db.String(100), unique=True, nullable=False)
    response_json = db.Column(db.Text, nullable=False)
    entry_hash   = db.Column(db.String(64), nullable=True)
    generated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class SleepEntry(db.Model):
    __tablename__ = "sleep_entries"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    entry_date = db.Column(db.Date, unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    # Sleep times (stored as "HH:MM" strings)
    bed_time = db.Column(db.String(5), nullable=False)
    sleep_time = db.Column(db.String(5), nullable=False)
    wake_time = db.Column(db.String(5), nullable=False)
    out_of_bed_time = db.Column(db.String(5), nullable=False)

    # Calculated fields
    sleep_duration_minutes = db.Column(db.Integer, nullable=True)
    sleep_cycles = db.Column(db.Float, nullable=True)
    sleep_latency_minutes = db.Column(db.Integer, nullable=True)

    # Subjective scores (1-10)
    inertia_score = db.Column(db.Integer, nullable=False)
    energy_score = db.Column(db.Integer, nullable=False)
    stress_score = db.Column(db.Integer, nullable=False)

    # Activity
    miles_walked = db.Column(db.Float, nullable=True)
    caffeine_cutoff_time = db.Column(db.String(5), nullable=True)
    caffeine_mg = db.Column(db.Integer, nullable=True)
    naps = db.Column(db.Boolean, default=False, nullable=False)
    nap_duration_minutes = db.Column(db.Integer, nullable=True)

    # Ankle — only logged when there's something to note
    ankle_notes = db.Column(db.Text, nullable=True)

    # Tags and notes
    tags = db.Column(db.String(500), nullable=True)
    notes = db.Column(db.Text, nullable=True)

    def to_dict(self):  # noqa: C901
        return {
            "id": self.id,
            "entry_date": self.entry_date.isoformat() if self.entry_date else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "bed_time": self.bed_time,
            "sleep_time": self.sleep_time,
            "wake_time": self.wake_time,
            "out_of_bed_time": self.out_of_bed_time,
            "sleep_duration_minutes": self.sleep_duration_minutes,
            "sleep_cycles": self.sleep_cycles,
            "sleep_latency_minutes": self.sleep_latency_minutes,
            "inertia_score": self.inertia_score,
            "energy_score": self.energy_score,
            "stress_score": self.stress_score,
            "miles_walked": self.miles_walked,
            "caffeine_cutoff_time": self.caffeine_cutoff_time,
            "caffeine_mg": self.caffeine_mg,
            "naps": self.naps,
            "nap_duration_minutes": self.nap_duration_minutes,
            "ankle_notes": self.ankle_notes,
            "tags": self.tags,
            "notes": self.notes,
        }


class FoodEntry(db.Model):
    __tablename__ = "food_entries"

    id         = db.Column(db.Integer, primary_key=True, autoincrement=True)
    entry_date = db.Column(db.Date, nullable=False, index=True)
    meal_type  = db.Column(db.String(20), nullable=False, default="snack")
    food_name  = db.Column(db.String(200), nullable=False)
    calories   = db.Column(db.Integer, nullable=False)
    protein_g  = db.Column(db.Float, nullable=True)
    carbs_g    = db.Column(db.Float, nullable=True)
    fat_g      = db.Column(db.Float, nullable=True)
    notes      = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":         self.id,
            "entry_date": self.entry_date.isoformat() if self.entry_date else None,
            "meal_type":  self.meal_type,
            "food_name":  self.food_name,
            "calories":   self.calories,
            "protein_g":  self.protein_g,
            "carbs_g":    self.carbs_g,
            "fat_g":      self.fat_g,
            "notes":      self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Task(db.Model):
    __tablename__ = "tasks"

    id           = db.Column(db.Integer, primary_key=True, autoincrement=True)
    title        = db.Column(db.String(300), nullable=False)
    description  = db.Column(db.Text, nullable=True)
    priority     = db.Column(db.Integer, nullable=False, default=3)  # 1=critical 2=high 3=medium 4=low
    status       = db.Column(db.String(20), nullable=False, default="todo")  # todo/in_progress/done
    list_name    = db.Column(db.String(20), nullable=False, default="work")  # work / social
    due_date     = db.Column(db.Date, nullable=True)
    tags         = db.Column(db.String(500), nullable=True)
    created_at   = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at   = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)

    def to_dict(self):
        return {
            "id":           self.id,
            "title":        self.title,
            "description":  self.description,
            "priority":     self.priority,
            "status":       self.status,
            "list_name":    self.list_name,
            "due_date":     self.due_date.isoformat() if self.due_date else None,
            "tags":         self.tags,
            "created_at":   self.created_at.isoformat() if self.created_at else None,
            "updated_at":   self.updated_at.isoformat() if self.updated_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class Habit(db.Model):
    __tablename__ = "habits"

    id         = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name       = db.Column(db.String(100), nullable=False)
    icon       = db.Column(db.String(10),  nullable=False, default="⭐")
    color      = db.Column(db.String(7),   nullable=False, default="#00d4aa")
    is_active  = db.Column(db.Boolean,     nullable=False, default=True)
    created_at = db.Column(db.DateTime,    nullable=False, default=datetime.utcnow)

    logs = db.relationship("HabitLog", backref="habit", lazy=True, cascade="save-update, merge")

    def current_streak(self, today=None):
        today = today or date.today()
        log_dates = sorted([l.log_date for l in self.logs], reverse=True)
        if not log_dates:
            return 0
        if log_dates[0] == today:
            check = today
        elif log_dates[0] == today - timedelta(days=1):
            check = today - timedelta(days=1)
        else:
            return 0
        streak = 0
        for d in log_dates:
            if d == check:
                streak += 1
                check -= timedelta(days=1)
            else:
                break
        return streak

    def logged_today(self, today=None):
        today = today or date.today()
        return any(l.log_date == today for l in self.logs)

    def to_dict(self, today=None):
        return {
            "id":           self.id,
            "name":         self.name,
            "icon":         self.icon,
            "color":        self.color,
            "is_active":    self.is_active,
            "created_at":   self.created_at.isoformat(),
            "streak":       self.current_streak(today),
            "logged_today": self.logged_today(today),
        }


class HabitLog(db.Model):
    __tablename__ = "habit_logs"

    id       = db.Column(db.Integer, primary_key=True, autoincrement=True)
    habit_id = db.Column(db.Integer, db.ForeignKey("habits.id"), nullable=False)
    log_date = db.Column(db.Date,    nullable=False)

    __table_args__ = (db.UniqueConstraint("habit_id", "log_date", name="uq_habit_log"),)

    def to_dict(self):
        return {"id": self.id, "habit_id": self.habit_id, "log_date": self.log_date.isoformat()}


class MoodEntry(db.Model):
    __tablename__ = "mood_entries"

    id            = db.Column(db.Integer, primary_key=True, autoincrement=True)
    entry_date    = db.Column(db.Date,    nullable=False, unique=True)
    mood_score    = db.Column(db.Integer, nullable=False)           # 1–10
    energy_score  = db.Column(db.Integer, nullable=True)            # 1–10
    anxiety_score = db.Column(db.Integer, nullable=True)            # 1–10 (1=calm, 10=anxious)
    note          = db.Column(db.Text,    nullable=True)
    tags          = db.Column(db.Text,    nullable=True)            # JSON array of tag strings
    created_at    = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        import json as _json
        return {
            "id":            self.id,
            "entry_date":    self.entry_date.isoformat(),
            "mood_score":    self.mood_score,
            "energy_score":  self.energy_score,
            "anxiety_score": self.anxiety_score,
            "note":          self.note,
            "tags":          _json.loads(self.tags) if self.tags else [],
            "created_at":    self.created_at.isoformat(),
        }


class ExerciseEntry(db.Model):
    __tablename__ = "exercise_entries"

    id               = db.Column(db.Integer, primary_key=True, autoincrement=True)
    entry_date       = db.Column(db.Date,    nullable=False, index=True)
    exercise_type    = db.Column(db.String(30),  nullable=False, default="other")
    name             = db.Column(db.String(100), nullable=False)
    duration_minutes = db.Column(db.Integer, nullable=False, default=0)
    intensity        = db.Column(db.Integer, nullable=True)          # 1–10
    calories_burned  = db.Column(db.Integer, nullable=True)
    sets             = db.Column(db.Integer, nullable=True)
    reps             = db.Column(db.Integer, nullable=True)
    weight_lbs       = db.Column(db.Float,   nullable=True)
    group_name       = db.Column(db.String(100), nullable=True)
    notes            = db.Column(db.Text,    nullable=True)
    created_at       = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":               self.id,
            "entry_date":       self.entry_date.isoformat(),
            "exercise_type":    self.exercise_type,
            "name":             self.name,
            "duration_minutes": self.duration_minutes,
            "intensity":        self.intensity,
            "calories_burned":  self.calories_burned,
            "sets":             self.sets,
            "reps":             self.reps,
            "weight_lbs":       self.weight_lbs,
            "group_name":       self.group_name,
            "notes":            self.notes,
            "created_at":       self.created_at.isoformat(),
        }


class HydrationLog(db.Model):
    __tablename__ = "hydration_logs"

    id         = db.Column(db.Integer, primary_key=True, autoincrement=True)
    log_date   = db.Column(db.Date,    nullable=False, unique=True)
    glasses    = db.Column(db.Integer, nullable=False, default=0)
    goal       = db.Column(db.Integer, nullable=False, default=8)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow,
                           onupdate=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":         self.id,
            "log_date":   self.log_date.isoformat(),
            "glasses":    self.glasses,
            "goal":       self.goal,
            "pct":        round(self.glasses / self.goal, 2) if self.goal else 0,
            "updated_at": self.updated_at.isoformat(),
        }


class WeightEntry(db.Model):
    __tablename__ = "weight_entries"

    id           = db.Column(db.Integer, primary_key=True, autoincrement=True)
    entry_date   = db.Column(db.Date,  nullable=False, unique=True)
    weight_lbs   = db.Column(db.Float, nullable=False)
    body_fat_pct = db.Column(db.Float, nullable=True)
    notes        = db.Column(db.Text,  nullable=True)
    created_at   = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":           self.id,
            "entry_date":   self.entry_date.isoformat(),
            "weight_lbs":   round(self.weight_lbs, 1),
            "body_fat_pct": round(self.body_fat_pct, 1) if self.body_fat_pct else None,
            "notes":        self.notes,
            "created_at":   self.created_at.isoformat(),
        }


class WeeklyReview(db.Model):
    __tablename__ = "weekly_reviews"

    id               = db.Column(db.Integer, primary_key=True, autoincrement=True)
    week_start       = db.Column(db.Date, nullable=False, unique=True)  # Monday
    week_end         = db.Column(db.Date, nullable=False)               # Sunday
    # Self-ratings 1–5
    rating_sleep     = db.Column(db.Integer, nullable=True)
    rating_nutrition = db.Column(db.Integer, nullable=True)
    rating_exercise  = db.Column(db.Integer, nullable=True)
    rating_mood      = db.Column(db.Integer, nullable=True)
    rating_habits    = db.Column(db.Integer, nullable=True)
    rating_overall   = db.Column(db.Integer, nullable=True)
    # Reflections
    went_well        = db.Column(db.Text, nullable=True)
    fell_apart       = db.Column(db.Text, nullable=True)
    next_focus       = db.Column(db.Text, nullable=True)
    # AI summary
    ai_summary       = db.Column(db.Text, nullable=True)
    created_at       = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at       = db.Column(db.DateTime, default=datetime.utcnow,
                                 onupdate=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":               self.id,
            "week_start":       self.week_start.isoformat(),
            "week_end":         self.week_end.isoformat(),
            "rating_sleep":     self.rating_sleep,
            "rating_nutrition": self.rating_nutrition,
            "rating_exercise":  self.rating_exercise,
            "rating_mood":      self.rating_mood,
            "rating_habits":    self.rating_habits,
            "rating_overall":   self.rating_overall,
            "went_well":        self.went_well,
            "fell_apart":       self.fell_apart,
            "next_focus":       self.next_focus,
            "ai_summary":       self.ai_summary,
            "created_at":       self.created_at.isoformat(),
            "updated_at":       self.updated_at.isoformat(),
        }


class ExerciseTemplate(db.Model):
    __tablename__ = "exercise_templates"

    id          = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name        = db.Column(db.String(100), nullable=False)
    day_tag     = db.Column(db.String(20),  nullable=True)   # e.g. "Monday", "Push Day"
    notes       = db.Column(db.Text,        nullable=True)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    items = db.relationship(
        "ExerciseTemplateItem", backref="template",
        lazy=True, cascade="all, delete-orphan",
        order_by="ExerciseTemplateItem.sort_order",
    )

    def to_dict(self):
        return {
            "id":             self.id,
            "name":           self.name,
            "day_tag":        self.day_tag,
            "notes":          self.notes,
            "created_at":     self.created_at.isoformat(),
            "items":          [i.to_dict() for i in self.items],
            "total_minutes":  sum(i.duration_minutes for i in self.items),
            "total_calories": sum(i.calories_burned or 0 for i in self.items),
            "item_count":     len(self.items),
        }


class ExerciseTemplateItem(db.Model):
    __tablename__ = "exercise_template_items"

    id               = db.Column(db.Integer, primary_key=True, autoincrement=True)
    template_id      = db.Column(db.Integer, db.ForeignKey("exercise_templates.id"), nullable=False)
    name             = db.Column(db.String(100), nullable=False)
    exercise_type    = db.Column(db.String(30),  nullable=False, default="other")
    duration_minutes = db.Column(db.Integer,     nullable=False, default=0)
    intensity        = db.Column(db.Integer,     nullable=True)
    calories_burned  = db.Column(db.Integer,     nullable=True)
    sets             = db.Column(db.Integer,     nullable=True)
    reps             = db.Column(db.Integer,     nullable=True)
    weight_lbs       = db.Column(db.Float,       nullable=True)
    sort_order       = db.Column(db.Integer,     nullable=False, default=0)

    def to_dict(self):
        return {
            "id":               self.id,
            "name":             self.name,
            "exercise_type":    self.exercise_type,
            "duration_minutes": self.duration_minutes,
            "intensity":        self.intensity,
            "calories_burned":  self.calories_burned,
            "sets":             self.sets,
            "reps":             self.reps,
            "weight_lbs":       self.weight_lbs,
        }


class MealTemplate(db.Model):
    __tablename__ = "meal_templates"

    id         = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name       = db.Column(db.String(100), nullable=False)
    meal_type  = db.Column(db.String(20),  nullable=True)   # suggested meal slot
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    items = db.relationship(
        "MealTemplateItem", backref="template",
        lazy=True, cascade="all, delete-orphan",
        order_by="MealTemplateItem.sort_order",
    )

    def to_dict(self):
        return {
            "id":             self.id,
            "name":           self.name,
            "meal_type":      self.meal_type,
            "created_at":     self.created_at.isoformat(),
            "items":          [i.to_dict() for i in self.items],
            "total_calories": sum(i.calories for i in self.items),
            "item_count":     len(self.items),
        }


class MealTemplateItem(db.Model):
    __tablename__ = "meal_template_items"

    id          = db.Column(db.Integer, primary_key=True, autoincrement=True)
    template_id = db.Column(db.Integer, db.ForeignKey("meal_templates.id"), nullable=False)
    food_name   = db.Column(db.String(200), nullable=False)
    calories    = db.Column(db.Integer, nullable=False)
    protein_g   = db.Column(db.Float, nullable=True)
    carbs_g     = db.Column(db.Float, nullable=True)
    fat_g       = db.Column(db.Float, nullable=True)
    sort_order  = db.Column(db.Integer, nullable=False, default=0)

    def to_dict(self):
        return {
            "id":        self.id,
            "food_name": self.food_name,
            "calories":  self.calories,
            "protein_g": self.protein_g,
            "carbs_g":   self.carbs_g,
            "fat_g":     self.fat_g,
        }


class Chore(db.Model):
    """A recurring household chore with a recurrence rule."""
    __tablename__ = "chores"

    id         = db.Column(db.Integer,  primary_key=True, autoincrement=True)
    name       = db.Column(db.String(200), nullable=False)
    icon       = db.Column(db.String(10),  nullable=False, default="🧹")
    color      = db.Column(db.String(20),  nullable=False, default="#60a5fa")
    # recurrence: "daily" | "weekdays" | "weekends" | "custom"
    recurrence = db.Column(db.String(20),  nullable=False, default="custom")
    # JSON array of ints 0-6 (0=Mon), used when recurrence="custom"
    days       = db.Column(db.Text,        nullable=False, default="[]")
    active     = db.Column(db.Boolean,     nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    logs = db.relationship(
        "ChoreLog", backref="chore", lazy=True, cascade="all, delete-orphan"
    )

    def to_dict(self):
        import json as _json
        return {
            "id":         self.id,
            "name":       self.name,
            "icon":       self.icon,
            "color":      self.color,
            "recurrence": self.recurrence,
            "days":       _json.loads(self.days or "[]"),
            "active":     self.active,
            "created_at": self.created_at.isoformat(),
        }


class ChoreLog(db.Model):
    """Tracks whether a chore was completed on a given date."""
    __tablename__ = "chore_logs"

    id         = db.Column(db.Integer,  primary_key=True, autoincrement=True)
    chore_id   = db.Column(db.Integer,  db.ForeignKey("chores.id"), nullable=False)
    log_date   = db.Column(db.Date,     nullable=False)
    completed  = db.Column(db.Boolean,  nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("chore_id", "log_date", name="uq_chore_log"),
    )


class Supplement(db.Model):
    __tablename__ = "supplements"

    id         = db.Column(db.Integer,    primary_key=True, autoincrement=True)
    name       = db.Column(db.String(100), nullable=False)
    icon       = db.Column(db.String(10),  nullable=False, default="💊")
    is_active  = db.Column(db.Boolean,     nullable=False, default=True)
    created_at = db.Column(db.DateTime,    default=datetime.utcnow, nullable=False)

    logs = db.relationship("SupplementLog", backref="supplement", cascade="all, delete-orphan")

    def to_dict(self, today=None):
        taken = False
        if today:
            log   = SupplementLog.query.filter_by(supplement_id=self.id, log_date=today).first()
            taken = bool(log)
        return {
            "id":          self.id,
            "name":        self.name,
            "icon":        self.icon,
            "is_active":   self.is_active,
            "taken_today": taken,
            "created_at":  self.created_at.isoformat(),
        }


class SupplementLog(db.Model):
    __tablename__ = "supplement_logs"

    id            = db.Column(db.Integer, primary_key=True, autoincrement=True)
    supplement_id = db.Column(db.Integer, db.ForeignKey("supplements.id"), nullable=False)
    log_date      = db.Column(db.Date,    nullable=False)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("supplement_id", "log_date", name="uq_supplement_log"),
    )


class WeeklyPlan(db.Model):
    """One row per week — stores targets set at the start of the week."""
    __tablename__ = "weekly_plans"

    id                  = db.Column(db.Integer, primary_key=True, autoincrement=True)
    week_start          = db.Column(db.Date, nullable=False, unique=True)
    target_sleep_hours  = db.Column(db.Float,   nullable=True)
    target_workouts     = db.Column(db.Integer, nullable=True)
    target_calorie_days = db.Column(db.Integer, nullable=True)
    target_habit_pct    = db.Column(db.Integer, nullable=True)
    notes               = db.Column(db.Text,    nullable=True)
    created_at          = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":                   self.id,
            "week_start":           self.week_start.isoformat() if self.week_start else None,
            "target_sleep_hours":   self.target_sleep_hours,
            "target_workouts":      self.target_workouts,
            "target_calorie_days":  self.target_calorie_days,
            "target_habit_pct":     self.target_habit_pct,
            "notes":                self.notes,
            "created_at":           self.created_at.isoformat(),
        }


class UserProfile(db.Model):
    """Single-row profile — TDEE inputs and per-module goals."""
    __tablename__ = "user_profile"

    id              = db.Column(db.Integer,    primary_key=True)
    height_in       = db.Column(db.Float,      nullable=True)   # total inches
    weight_lbs      = db.Column(db.Float,      nullable=True)
    age             = db.Column(db.Integer,    nullable=True)
    sex             = db.Column(db.String(10), nullable=True)   # 'male'|'female'
    activity_level  = db.Column(db.String(20), nullable=True)   # sedentary|light|moderate|active|very_active
    goal_type       = db.Column(db.String(10), nullable=True)   # lose|maintain|gain
    calorie_goal    = db.Column(db.Integer,    nullable=True)
    sleep_goal_hrs  = db.Column(db.Float,      nullable=True)
    habit_goal_pct  = db.Column(db.Integer,    nullable=True)
    goal_weight_lbs = db.Column(db.Float,      nullable=True)
    weekly_pace_lbs = db.Column(db.Float,      nullable=True)   # lbs/week target
    updated_at      = db.Column(db.DateTime,   default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "height_in":       self.height_in,
            "weight_lbs":      self.weight_lbs,
            "age":             self.age,
            "sex":             self.sex,
            "activity_level":  self.activity_level,
            "goal_type":       self.goal_type,
            "calorie_goal":    self.calorie_goal,
            "sleep_goal_hrs":  self.sleep_goal_hrs,
            "habit_goal_pct":  self.habit_goal_pct,
            "goal_weight_lbs": self.goal_weight_lbs,
            "weekly_pace_lbs": self.weekly_pace_lbs,
        }


class ScreenTimeEntry(db.Model):
    """One row per date — focus hours + leisure screen time."""
    __tablename__ = "screen_time_entries"

    id           = db.Column(db.Integer,    primary_key=True, autoincrement=True)
    entry_date   = db.Column(db.Date,       nullable=False, unique=True)
    focus_hours  = db.Column(db.Float,      nullable=True)
    screen_hours = db.Column(db.Float,      nullable=True)
    note         = db.Column(db.Text,       nullable=True)
    created_at   = db.Column(db.DateTime,   default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":           self.id,
            "entry_date":   self.entry_date.isoformat() if self.entry_date else None,
            "focus_hours":  self.focus_hours,
            "screen_hours": self.screen_hours,
            "note":         self.note,
        }


class BodyMeasurement(db.Model):
    """One row per date — upsert on save."""
    __tablename__ = "body_measurements"

    id             = db.Column(db.Integer, primary_key=True, autoincrement=True)
    entry_date     = db.Column(db.Date, nullable=False, unique=True)
    waist_in       = db.Column(db.Float, nullable=True)
    hips_in        = db.Column(db.Float, nullable=True)
    chest_in       = db.Column(db.Float, nullable=True)
    left_arm_in    = db.Column(db.Float, nullable=True)
    right_arm_in   = db.Column(db.Float, nullable=True)
    left_thigh_in  = db.Column(db.Float, nullable=True)
    right_thigh_in = db.Column(db.Float, nullable=True)
    notes          = db.Column(db.Text, nullable=True)
    created_at     = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":             self.id,
            "entry_date":     self.entry_date.isoformat() if self.entry_date else None,
            "waist_in":       self.waist_in,
            "hips_in":        self.hips_in,
            "chest_in":       self.chest_in,
            "left_arm_in":    self.left_arm_in,
            "right_arm_in":   self.right_arm_in,
            "left_thigh_in":  self.left_thigh_in,
            "right_thigh_in": self.right_thigh_in,
            "notes":          self.notes,
            "created_at":     self.created_at.isoformat(),
        }


class SkincareLog(db.Model):
    __tablename__ = "skincare_logs"

    id         = db.Column(db.Integer, primary_key=True, autoincrement=True)
    log_date   = db.Column(db.Date,    nullable=False, unique=True)
    am_done    = db.Column(db.Boolean, nullable=False, default=False)
    pm_done    = db.Column(db.Boolean, nullable=False, default=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow,
                           onupdate=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":         self.id,
            "log_date":   self.log_date.isoformat(),
            "am_done":    self.am_done,
            "pm_done":    self.pm_done,
            "updated_at": self.updated_at.isoformat(),
        }


class SkinCareStep(db.Model):
    """User-defined skincare routine steps (AM, PM, or both)."""
    __tablename__ = "skincare_steps"

    id          = db.Column(db.Integer,    primary_key=True, autoincrement=True)
    name        = db.Column(db.String(100), nullable=False)
    time_of_day = db.Column(db.String(4),  nullable=False, default="am")  # 'am' | 'pm'
    order_index = db.Column(db.Integer,    nullable=False, default=0)
    is_active   = db.Column(db.Boolean,    nullable=False, default=True)
    created_at  = db.Column(db.DateTime,   default=datetime.utcnow, nullable=False)

    step_logs = db.relationship("SkinCareStepLog", backref="step",
                                cascade="all, delete-orphan", lazy=True)

    def to_dict(self):
        return {
            "id":          self.id,
            "name":        self.name,
            "time_of_day": self.time_of_day,
            "order_index": self.order_index,
            "is_active":   self.is_active,
        }


class SkinCareStepLog(db.Model):
    """Daily completion record for a single skincare step."""
    __tablename__ = "skincare_step_logs"

    id           = db.Column(db.Integer,    primary_key=True, autoincrement=True)
    log_date     = db.Column(db.Date,       nullable=False, index=True)
    step_id      = db.Column(db.Integer,    db.ForeignKey("skincare_steps.id"), nullable=False)
    completed    = db.Column(db.Boolean,    nullable=False, default=False)
    product_used = db.Column(db.String(200), nullable=True)
    created_at   = db.Column(db.DateTime,   default=datetime.utcnow, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("log_date", "step_id", name="uq_skincare_step_log"),
    )

    def to_dict(self):
        return {
            "id":           self.id,
            "log_date":     self.log_date.isoformat(),
            "step_id":      self.step_id,
            "completed":    self.completed,
            "product_used": self.product_used,
        }


class SkinConditionLog(db.Model):
    """Daily skin condition check — outcome data separate from routine compliance."""
    __tablename__ = "skin_condition_logs"

    id              = db.Column(db.Integer, primary_key=True, autoincrement=True)
    log_date        = db.Column(db.Date,    nullable=False, unique=True, index=True)
    feel_score      = db.Column(db.Integer, nullable=True)   # 1-5  (5 = great)
    breakout_count  = db.Column(db.Integer, nullable=True)   # 0-3  (0 = none)
    oiliness_score  = db.Column(db.Integer, nullable=True)   # 1-5  (1 = very oily)
    notes           = db.Column(db.Text,    nullable=True)
    created_at      = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at      = db.Column(db.DateTime, default=datetime.utcnow,
                                onupdate=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":             self.id,
            "log_date":       self.log_date.isoformat(),
            "feel_score":     self.feel_score,
            "breakout_count": self.breakout_count,
            "oiliness_score": self.oiliness_score,
            "notes":          self.notes,
        }


class SkinPhotoAnalysis(db.Model):
    """Face photo skin analysis — photo stored as blob with AI-generated dermatologist scores."""
    __tablename__ = "skin_photo_analyses"

    id              = db.Column(db.Integer,     primary_key=True, autoincrement=True)
    photo_date      = db.Column(db.Date,        nullable=False, index=True)
    photo_data      = db.Column(db.LargeBinary, nullable=False)
    photo_mime      = db.Column(db.String(20),  nullable=False, default="image/jpeg")
    feel_score      = db.Column(db.Integer,     nullable=True)   # 1-5
    breakout_count  = db.Column(db.Integer,     nullable=True)   # 0-3
    oiliness_score  = db.Column(db.Integer,     nullable=True)   # 1-5
    redness         = db.Column(db.Integer,     nullable=True)   # 1-5 (5=no redness)
    texture         = db.Column(db.Integer,     nullable=True)   # 1-5 (5=smooth)
    hydration       = db.Column(db.Integer,     nullable=True)   # 1-5 (5=well-hydrated)
    report          = db.Column(db.Text,        nullable=True)
    created_at      = db.Column(db.DateTime,    default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":             self.id,
            "photo_date":     self.photo_date.isoformat(),
            "feel_score":     self.feel_score,
            "breakout_count": self.breakout_count,
            "oiliness_score": self.oiliness_score,
            "redness":        self.redness,
            "texture":        self.texture,
            "hydration":      self.hydration,
            "report":         self.report,
            "created_at":     self.created_at.isoformat(),
        }


class ScannedProduct(db.Model):
    __tablename__ = "scanned_products"

    id                = db.Column(db.Integer, primary_key=True, autoincrement=True)
    product_name      = db.Column(db.String(200), nullable=False, unique=True)
    serving_size_text = db.Column(db.String(100), nullable=True)
    calories          = db.Column(db.Integer, nullable=False, default=0)
    protein_g         = db.Column(db.Float, nullable=True)
    carbs_g           = db.Column(db.Float, nullable=True)
    fat_g             = db.Column(db.Float, nullable=True)
    use_count         = db.Column(db.Integer, nullable=False, default=1)
    last_used         = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":               self.id,
            "product_name":     self.product_name,
            "serving_size_text": self.serving_size_text,
            "calories":         self.calories,
            "protein_g":        self.protein_g,
            "carbs_g":          self.carbs_g,
            "fat_g":            self.fat_g,
            "use_count":        self.use_count,
        }


class SkinProduct(db.Model):
    """User's skincare product inventory — scanned once via Claude vision, never re-scanned."""
    __tablename__ = "skin_products"

    id                 = db.Column(db.Integer,     primary_key=True, autoincrement=True)
    product_name       = db.Column(db.String(200), nullable=False)
    brand              = db.Column(db.String(100), nullable=True)
    product_type       = db.Column(db.String(50),  nullable=False, default="other")
    # product_type values: medicated_wash | gentle_wash | moisturizer | sunscreen | heavy_occlusive | treatment | other
    active_ingredients = db.Column(db.Text,        nullable=True)   # comma-separated string
    face_safe          = db.Column(db.Boolean,     nullable=False,  default=True)
    ai_summary         = db.Column(db.Text,        nullable=True)
    photo_data         = db.Column(db.LargeBinary, nullable=True)
    photo_mime         = db.Column(db.String(20),  nullable=True,   default="image/jpeg")
    created_at         = db.Column(db.DateTime,    default=datetime.utcnow, nullable=False)

    def to_dict(self):
        return {
            "id":                 self.id,
            "product_name":       self.product_name,
            "brand":              self.brand,
            "product_type":       self.product_type,
            "active_ingredients": self.active_ingredients,
            "face_safe":          self.face_safe,
            "ai_summary":         self.ai_summary,
            "has_photo":          self.photo_data is not None,
            "created_at":         self.created_at.isoformat(),
        }


class DailyRoutine(db.Model):
    """Generated skincare routine for a date — persisted for idempotent rendering (Layer 3)."""
    __tablename__ = "daily_routines"

    id              = db.Column(db.Integer,  primary_key=True, autoincrement=True)
    routine_date    = db.Column(db.Date,     nullable=False, unique=True, index=True)
    routine_json    = db.Column(db.Text,     nullable=False)   # JSON string
    explanation     = db.Column(db.Text,     nullable=True)    # Claude's 2-sentence explanation
    workout_context = db.Column(db.Text,     nullable=True)    # snapshot of exercise data used
    generated_at    = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self):
        import json as _json
        return {
            "routine_date":    self.routine_date.isoformat(),
            "routine":         _json.loads(self.routine_json),
            "explanation":     self.explanation,
            "workout_context": self.workout_context,
            "generated_at":    self.generated_at.isoformat(),
        }


class RoutineStepLog(db.Model):
    """Per-step completion state for daily AI routines — keyed by date + step_key."""
    __tablename__ = "routine_step_logs"

    id           = db.Column(db.Integer,    primary_key=True, autoincrement=True)
    log_date     = db.Column(db.Date,       nullable=False, index=True)
    step_key     = db.Column(db.String(50), nullable=False)   # e.g. "morning_0", "post_workout_1"
    completed    = db.Column(db.Boolean,    nullable=False, default=False)
    completed_at = db.Column(db.DateTime,   nullable=True)

    __table_args__ = (
        db.UniqueConstraint("log_date", "step_key", name="uq_routine_step_log"),
    )

    def to_dict(self):
        return {
            "log_date":     self.log_date.isoformat(),
            "step_key":     self.step_key,
            "completed":    self.completed,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }


class SkinWorkoutLog(db.Model):
    """Workout events logged via the skincare chat — isolated from the main Exercise module."""
    __tablename__ = "skin_workout_logs"

    id               = db.Column(db.Integer,     primary_key=True, autoincrement=True)
    log_date         = db.Column(db.Date,        nullable=False, index=True)
    exercise_type    = db.Column(db.String(30),  nullable=False, default="cardio")
    name             = db.Column(db.String(100), nullable=False, default="Workout")
    sweat_level      = db.Column(db.String(10),  nullable=False, default="medium")
    logged_at_pst    = db.Column(db.String(20),  nullable=True)   # "HH:MM AM/PM" client-local
    duration_minutes = db.Column(db.Integer,     nullable=True)
    created_at       = db.Column(db.DateTime,    default=datetime.utcnow, nullable=False)
