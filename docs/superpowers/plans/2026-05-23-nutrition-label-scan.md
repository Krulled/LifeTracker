# Nutrition Label Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "🏷️ Scan Label" button to the Calorie Tracker that lets users photograph a nutrition facts panel, review AI-extracted per-serving macros, set how many servings they ate, and log the entry — with a product cache for repeat items.

**Architecture:** Two-button entry (council-validated): existing "📷 Scan" for plated meals is unchanged; a new "🏷️ Scan Label" button opens `NutritionLabelScanner.jsx`. Backend adds a `POST /api/food/scan-label` endpoint using Claude vision (Sonnet 4.6) to OCR the label and a `ScannedProduct` SQLite table that caches recent scans as quick-taps. The review step shows editable per-serving fields so users can correct OCR errors before scaling by quantity.

**Tech Stack:** React (JSX), Python Flask, SQLite/SQLAlchemy, Anthropic Claude `claude-sonnet-4-6` vision, existing `_strip_json_fences` helper in `app.py`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| **Modify** | `backend/models.py` | Add `ScannedProduct` model |
| **Modify** | `backend/app.py` | Add `scan-label` + product-cache endpoints; import `ScannedProduct` |
| **Create** | `frontend/src/components/NutritionLabelScanner.jsx` | Full label scan modal (upload → scan → review → save) |
| **Modify** | `frontend/src/components/CalorieModule.jsx` | Add "🏷️ Scan Label" button + state + render `NutritionLabelScanner` |
| **Modify** | `frontend/src/index.css` | Add NLS-specific CSS classes |

---

## Task 1: Add `ScannedProduct` model to `backend/models.py`

**Files:**
- Modify: `backend/models.py` — append new model at end of file

- [ ] **Step 1.1 — Append the model**

Open `backend/models.py` and add this block at the very end of the file:

```python
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
```

- [ ] **Step 1.2 — Verify the model is importable**

```bash
cd backend
python -c "from models import ScannedProduct; print('OK')"
```

Expected output: `OK`

- [ ] **Step 1.3 — Commit**

```bash
git add backend/models.py
git commit -m "feat: add ScannedProduct model for label scan cache"
```

---

## Task 2: Add backend endpoints to `backend/app.py`

**Files:**
- Modify: `backend/app.py` — add import, three new route functions after the existing `analyze_food_photo` function (around line 976)

- [ ] **Step 2.1 — Add `ScannedProduct` to the import line**

Find the existing import line near the top of `app.py` that imports from `models`. It looks like:

```python
from models import (SleepEntry, ... SkinPhotoAnalysis)
```

Add `ScannedProduct` to that import list.

- [ ] **Step 2.2 — Add the `scan_nutrition_label` endpoint**

Insert the following three route functions immediately after the closing of `analyze_food_photo` (after line ~976):

```python
@app.route("/api/food/scan-label", methods=["POST"])
def scan_nutrition_label():
    data      = request.get_json(force=True) or {}
    image_b64 = data.get("image")
    mime_type = data.get("mime_type", "image/jpeg")

    if not image_b64:
        return jsonify({"error": "No image provided"}), 400

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "Vision AI not configured"}), 503

    try:
        import anthropic
        client  = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model      = "claude-sonnet-4-6",
            max_tokens = 512,
            messages   = [{
                "role": "user",
                "content": [
                    {
                        "type":   "image",
                        "source": {
                            "type":       "base64",
                            "media_type": mime_type,
                            "data":       image_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "This is a photo of a nutrition facts label from a food package. "
                            "Extract the nutritional information and return ONLY valid JSON — no markdown, no explanation:\n"
                            "{\n"
                            '  "product_name": "brand and product name if visible, otherwise best description",\n'
                            '  "serving_size_text": "serving size exactly as printed, e.g. \'1 bar (68g)\' or \'1 cup (240ml)\'",\n'
                            '  "calories": integer per serving,\n'
                            '  "protein_g": float per serving,\n'
                            '  "carbs_g": float per serving (use Total Carbohydrate, not net carbs),\n'
                            '  "fat_g": float per serving (use Total Fat)\n'
                            "}\n\n"
                            "Rules:\n"
                            "- Use per-serving values (first column if multiple shown)\n"
                            "- product_name: include brand if visible, e.g. 'Clif Bar - Chocolate Chip'\n"
                            "- If a macro value is not visible, use 0\n"
                            "- serving_size_text: copy exactly as printed on the label"
                        ),
                    },
                ],
            }],
        )
        text   = _strip_json_fences(message.content[0].text)
        result = json.loads(text)
        return jsonify({
            "product_name":      str(result.get("product_name") or "Packaged Food")[:200],
            "serving_size_text": str(result.get("serving_size_text") or "1 serving")[:100],
            "calories":          max(0, int(result.get("calories") or 0)),
            "protein_g":         round(float(result.get("protein_g") or 0), 1),
            "carbs_g":           round(float(result.get("carbs_g")   or 0), 1),
            "fat_g":             round(float(result.get("fat_g")     or 0), 1),
        })
    except json.JSONDecodeError:
        return jsonify({"error": "Could not read label — try a clearer, well-lit photo"}), 500
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/food/scanned-products", methods=["GET"])
def get_scanned_products():
    products = ScannedProduct.query.order_by(
        ScannedProduct.last_used.desc()
    ).limit(8).all()
    return jsonify([p.to_dict() for p in products])


@app.route("/api/food/scanned-products", methods=["POST"])
def upsert_scanned_product():
    data = request.get_json(force=True) or {}
    name = str(data.get("product_name") or "").strip()[:200]
    if not name:
        return jsonify({"error": "product_name required"}), 400

    existing = ScannedProduct.query.filter_by(product_name=name).first()
    if existing:
        existing.calories          = int(data.get("calories") or existing.calories)
        existing.protein_g         = data.get("protein_g", existing.protein_g)
        existing.carbs_g           = data.get("carbs_g",   existing.carbs_g)
        existing.fat_g             = data.get("fat_g",     existing.fat_g)
        existing.serving_size_text = data.get("serving_size_text", existing.serving_size_text)
        existing.use_count        += 1
        existing.last_used         = datetime.utcnow()
    else:
        existing = ScannedProduct(
            product_name      = name,
            serving_size_text = data.get("serving_size_text"),
            calories          = int(data.get("calories") or 0),
            protein_g         = data.get("protein_g"),
            carbs_g           = data.get("carbs_g"),
            fat_g             = data.get("fat_g"),
        )
        db.session.add(existing)
    db.session.commit()
    return jsonify(existing.to_dict())
```

- [ ] **Step 2.3 — Smoke-test the backend locally**

Start the Flask server (or use `start.bat`), then run:

```bash
curl -s http://localhost:3030/api/food/scanned-products
```

Expected: `[]` (empty JSON array — table exists, no rows yet)

```bash
curl -s -X POST http://localhost:3030/api/food/scanned-products \
  -H "Content-Type: application/json" \
  -d '{"product_name":"Test Bar","calories":200,"protein_g":10,"carbs_g":25,"fat_g":7}'
```

Expected: JSON object with `id`, `product_name`, `calories`, `use_count: 1`

```bash
curl -s http://localhost:3030/api/food/scanned-products
```

Expected: JSON array containing the product just inserted.

- [ ] **Step 2.4 — Commit**

```bash
git add backend/app.py backend/models.py
git commit -m "feat: add scan-label endpoint and scanned-products cache API"
```

---

## Task 3: Create `frontend/src/components/NutritionLabelScanner.jsx`

**Files:**
- Create: `frontend/src/components/NutritionLabelScanner.jsx`

- [ ] **Step 3.1 — Create the component file**

Create `frontend/src/components/NutritionLabelScanner.jsx` with the following content:

```jsx
import React, { useState, useRef, useEffect } from "react";

const MEAL_TYPES  = ["breakfast","lunch","dinner","snack"];
const MEAL_LABELS = { breakfast:"Breakfast", lunch:"Lunch", dinner:"Dinner", snack:"Snacks" };

function getMealTypeFromTime() {
  const h = new Date().getHours();
  if (h >= 5  && h < 10)  return "breakfast";
  if (h >= 10 && h < 14)  return "lunch";
  if (h >= 14 && h < 18)  return "snack";
  if (h >= 18 && h < 23)  return "dinner";
  return "snack";
}

function compressImage(file) {
  return new Promise((resolve) => {
    const MAX_DIM = 1024;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
        else       { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const [header, b64] = e.target.result.split(",");
          const mime = header.match(/:(.*?);/)[1];
          resolve({ src: e.target.result, b64, mime });
        };
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.82);
    };
    img.src = url;
  });
}

export default function NutritionLabelScanner({ date, onAdd, onClose }) {
  const [image,           setImage]           = useState(null);
  const [step,            setStep]            = useState(null); // null | "scanning" | "review"
  const [productName,     setProductName]     = useState("");
  const [servingSizeText, setServingSizeText] = useState("");
  const [perServing,      setPerServing]      = useState({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  const [quantity,        setQuantity]        = useState(1);
  const [mealType,        setMealType]        = useState(getMealTypeFromTime());
  const [recentProducts,  setRecentProducts]  = useState([]);
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState(null);
  const fileRef   = useRef(null);
  const cameraRef = useRef(null);

  useEffect(() => {
    fetch("/api/food/scanned-products")
      .then(r => r.json())
      .then(data => setRecentProducts(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    const compressed = await compressImage(file);
    setImage(compressed);
  }

  async function analyze() {
    if (!image) return;
    setError(null);
    setStep("scanning");
    try {
      const r = await fetch("/api/food/scan-label", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ image: image.b64, mime_type: image.mime }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Label scan failed");
      setProductName(j.product_name || "");
      setServingSizeText(j.serving_size_text || "");
      setPerServing({
        calories:  j.calories  || 0,
        protein_g: j.protein_g || 0,
        carbs_g:   j.carbs_g   || 0,
        fat_g:     j.fat_g     || 0,
      });
      setQuantity(1);
      setStep("review");
    } catch (err) {
      setError(err.message);
      setStep(null);
    }
  }

  function applyRecentProduct(p) {
    setProductName(p.product_name);
    setServingSizeText(p.serving_size_text || "");
    setPerServing({
      calories:  p.calories  || 0,
      protein_g: p.protein_g || 0,
      carbs_g:   p.carbs_g   || 0,
      fat_g:     p.fat_g     || 0,
    });
    setQuantity(1);
    setImage(null);
    setStep("review");
  }

  const qty = parseFloat(quantity) || 1;
  const scaled = {
    calories:  Math.round(perServing.calories  * qty),
    protein_g: Math.round(perServing.protein_g * qty * 10) / 10,
    carbs_g:   Math.round(perServing.carbs_g   * qty * 10) / 10,
    fat_g:     Math.round(perServing.fat_g     * qty * 10) / 10,
  };

  async function handleSave(e) {
    e.preventDefault();
    if (!productName.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/food", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          food_name:  productName.trim(),
          meal_type:  mealType,
          entry_date: date,
          calories:   scaled.calories,
          protein_g:  scaled.protein_g || null,
          carbs_g:    scaled.carbs_g   || null,
          fat_g:      scaled.fat_g     || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      // Cache for future quick-access (fire-and-forget)
      fetch("/api/food/scanned-products", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name:      productName.trim(),
          serving_size_text: servingSizeText,
          calories:          perServing.calories,
          protein_g:         perServing.protein_g,
          carbs_g:           perServing.carbs_g,
          fat_g:             perServing.fat_g,
        }),
      }).catch(() => {});
      onAdd(json);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box photo-analyzer-modal">
        <div className="modal-header">
          <span className="modal-title">🏷️ Scan Nutrition Label</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Upload / Scanning ── */}
        {step !== "review" && (
          <div className="photo-upload-section">

            {/* Recent products */}
            {recentProducts.length > 0 && (
              <div className="nls-recent-section">
                <span className="nls-recent-label">Recent</span>
                <div className="nls-recent-chips">
                  {recentProducts.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      className="nls-recent-chip"
                      onClick={() => applyRecentProduct(p)}
                    >
                      {p.product_name}
                      <span className="nls-recent-cal">{p.calories} cal</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {image ? (
              <div className="photo-preview-wrap">
                <img src={image.src} className="photo-preview-img" alt="label preview" />
                {step !== "scanning" && (
                  <button className="photo-remove-btn"
                    onClick={() => { setImage(null); setError(null); setStep(null); }}>
                    ✕ Remove
                  </button>
                )}
              </div>
            ) : (
              <div className="photo-drop-area">
                <div className="photo-drop-icon">🏷️</div>
                <div className="photo-drop-text">Photo the nutrition facts panel</div>
                <div className="photo-drop-sub">AI reads serving size and macros directly from the label</div>
              </div>
            )}

            {step !== "scanning" && (
              <div className="photo-input-btns">
                <button type="button" className="btn btn-ghost photo-btn"
                  onClick={() => fileRef.current?.click()}>
                  📁 Gallery
                </button>
                <button type="button" className="btn btn-ghost photo-btn"
                  onClick={() => cameraRef.current?.click()}>
                  📷 Camera
                </button>
              </div>
            )}

            <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }}
              onChange={e => handleFile(e.target.files[0])} onClick={e => { e.target.value = ""; }} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment"
              style={{ display:"none" }}
              onChange={e => handleFile(e.target.files[0])} onClick={e => { e.target.value = ""; }} />

            {step === "scanning" && (
              <div className="scan-steps">
                <div className="scan-step active">
                  <span className="scan-step-icon">
                    <span className="spinner" style={{ width:13, height:13 }} />
                  </span>
                  <span className="scan-step-label">Reading nutrition label…</span>
                </div>
              </div>
            )}

            {error && (
              <div className="alert alert-error" style={{ marginTop:"0.75rem", fontSize:"0.8rem" }}>
                ✗ {error}
              </div>
            )}

            {image && step !== "scanning" && (
              <button className="btn btn-primary" style={{ width:"100%", marginTop:"0.75rem" }}
                onClick={analyze}>
                🔍 Read Label
              </button>
            )}
          </div>
        )}

        {/* ── Review ── */}
        {step === "review" && (
          <form onSubmit={handleSave} className="photo-result-form">
            {image && (
              <div className="photo-result-header">
                <img src={image.src} className="photo-result-thumb" alt="label" />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Product Name</label>
              <input className="form-input" value={productName}
                onChange={e => setProductName(e.target.value)} required autoFocus />
            </div>

            {servingSizeText && (
              <div className="nls-serving-size">
                Per serving: <strong>{servingSizeText}</strong>
              </div>
            )}

            {/* Editable per-serving macros */}
            <div className="nls-facts-section">
              <div className="nls-facts-header">
                <span>Per serving</span>
                <span className="nls-facts-hint">Edit any value if the scan was off</span>
              </div>
              <div className="nls-facts-grid">
                <div className="nls-fact-cell">
                  <label className="nls-fact-label">Calories</label>
                  <input className="form-input nls-fact-input" type="number" min="0"
                    value={perServing.calories}
                    onChange={e => setPerServing(p => ({ ...p, calories: parseInt(e.target.value, 10) || 0 }))} />
                </div>
                <div className="nls-fact-cell">
                  <label className="nls-fact-label">Protein g</label>
                  <input className="form-input nls-fact-input" type="number" min="0" step="0.1"
                    value={perServing.protein_g}
                    onChange={e => setPerServing(p => ({ ...p, protein_g: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="nls-fact-cell">
                  <label className="nls-fact-label">Carbs g</label>
                  <input className="form-input nls-fact-input" type="number" min="0" step="0.1"
                    value={perServing.carbs_g}
                    onChange={e => setPerServing(p => ({ ...p, carbs_g: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="nls-fact-cell">
                  <label className="nls-fact-label">Fat g</label>
                  <input className="form-input nls-fact-input" type="number" min="0" step="0.1"
                    value={perServing.fat_g}
                    onChange={e => setPerServing(p => ({ ...p, fat_g: parseFloat(e.target.value) || 0 }))} />
                </div>
              </div>
            </div>

            {/* Quantity */}
            <div className="photo-qty-row">
              <div className="photo-qty-label">
                <span className="photo-qty-title">Servings eaten</span>
                <span className="photo-qty-hint">
                  {qty !== 1 ? `×${qty} = ${scaled.calories} cal` : `${scaled.calories} cal total`}
                </span>
              </div>
              <div className="photo-qty-controls">
                <button type="button" className="photo-qty-step"
                  onClick={() => setQuantity(v => Math.max(0.5, (parseFloat(v) || 1) - 0.5))}>−</button>
                <input className="form-input photo-qty-input" type="number" min="0.5" max="20" step="0.5"
                  value={quantity} onChange={e => setQuantity(e.target.value)} />
                <button type="button" className="photo-qty-step"
                  onClick={() => setQuantity(v => (parseFloat(v) || 1) + 0.5)}>+</button>
              </div>
            </div>

            {/* Scaled totals summary */}
            <div className="nls-scaled-totals">
              <span className="nls-scaled-cal">{scaled.calories} cal</span>
              {scaled.protein_g > 0 && <span className="nls-scaled-macro">P {scaled.protein_g}g</span>}
              {scaled.carbs_g   > 0 && <span className="nls-scaled-macro">C {scaled.carbs_g}g</span>}
              {scaled.fat_g     > 0 && <span className="nls-scaled-macro">F {scaled.fat_g}g</span>}
            </div>

            {/* Meal type */}
            <div className="form-group">
              <label className="form-label">Add to meal</label>
              <div className="photo-meal-row">
                {MEAL_TYPES.map(mt => (
                  <button key={mt} type="button"
                    className={`photo-meal-btn${mealType === mt ? " active" : ""}`}
                    onClick={() => setMealType(mt)}>
                    {MEAL_LABELS[mt]}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="alert alert-error" style={{ fontSize:"0.8rem" }}>✗ {error}</div>
            )}

            <div style={{ display:"flex", gap:"0.5rem", marginTop:"1rem" }}>
              <button type="submit" className="btn btn-primary"
                disabled={saving || !productName.trim()} style={{ flex:1 }}>
                {saving ? "Saving…" : `＋ Add to ${MEAL_LABELS[mealType]}`}
              </button>
              <button type="button" className="btn btn-ghost"
                onClick={() => { setStep(null); if (!image) { setProductName(""); setServingSizeText(""); } }}>
                {image ? "← Retake" : "← Back"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3.2 — Commit**

```bash
git add frontend/src/components/NutritionLabelScanner.jsx
git commit -m "feat: add NutritionLabelScanner component"
```

---

## Task 4: Wire `NutritionLabelScanner` into `CalorieModule.jsx`

**Files:**
- Modify: `frontend/src/components/CalorieModule.jsx`

Four changes in `CalorieDayPanel` (the inner component, not the top-level export):

- [ ] **Step 4.1 — Add the import at top of file**

At the top of `CalorieModule.jsx`, add:

```jsx
import NutritionLabelScanner from "./NutritionLabelScanner.jsx";
```

- [ ] **Step 4.2 — Add `showLabelScanner` state**

In `CalorieDayPanel`, find the existing state block that includes `showPhotoScanner`:

```jsx
const [showTemplates,    setShowTemplates]    = useState(false);
const [showPhotoScanner, setShowPhotoScanner] = useState(false);
```

Add the new state directly after:

```jsx
const [showTemplates,    setShowTemplates]    = useState(false);
const [showPhotoScanner, setShowPhotoScanner] = useState(false);
const [showLabelScanner, setShowLabelScanner] = useState(false);
```

- [ ] **Step 4.3 — Add the "🏷️ Scan Label" button**

Find the existing "📷 Scan" button in the JSX (it's inside a `div` with `showPhotoScanner`):

```jsx
{!isFuture && (
  <button
    className="photo-scan-btn"
    onClick={() => { setShowPhotoScanner(true); setActiveForm(null); setShowTemplates(false); }}
    title="Scan food photo with AI"
  >
    📷 Scan
  </button>
)}
```

Replace it with:

```jsx
{!isFuture && (
  <>
    <button
      className="photo-scan-btn"
      onClick={() => { setShowPhotoScanner(true); setActiveForm(null); setShowTemplates(false); setShowLabelScanner(false); }}
      title="Scan a photo of your meal"
    >
      📷 Scan
    </button>
    <button
      className="photo-scan-btn nls-scan-btn"
      onClick={() => { setShowLabelScanner(true); setActiveForm(null); setShowTemplates(false); setShowPhotoScanner(false); }}
      title="Scan a nutrition label"
    >
      🏷️ Label
    </button>
  </>
)}
```

- [ ] **Step 4.4 — Add `handleLabelAdd` handler and render the modal**

Find the existing `handlePhotoAdd` function:

```jsx
function handlePhotoAdd(entry) {
  setEntries(prev => [...prev, entry]);
  onMutated();
}
```

Add a parallel handler directly after it:

```jsx
function handleLabelAdd(entry) {
  setEntries(prev => [...prev, entry]);
  onMutated();
}
```

Then find where `FoodPhotoAnalyzer` is rendered at the bottom of the `CalorieDayPanel` return (inside the `<>` fragment):

```jsx
{showPhotoScanner && (
  <FoodPhotoAnalyzer
    date={date}
    onAdd={handlePhotoAdd}
    onClose={() => setShowPhotoScanner(false)}
  />
)}
```

Add the label scanner immediately after:

```jsx
{showLabelScanner && (
  <NutritionLabelScanner
    date={date}
    onAdd={handleLabelAdd}
    onClose={() => setShowLabelScanner(false)}
  />
)}
```

- [ ] **Step 4.5 — Commit**

```bash
git add frontend/src/components/CalorieModule.jsx
git commit -m "feat: wire NutritionLabelScanner into CalorieDayPanel"
```

---

## Task 5: Add CSS for `NutritionLabelScanner`

**Files:**
- Modify: `frontend/src/index.css` — append new rules at the end

- [ ] **Step 5.1 — Append CSS to `frontend/src/index.css`**

Add the following at the very end of `frontend/src/index.css`:

```css
/* ── NutritionLabelScanner ─────────────────────────────────── */
.nls-scan-btn {
  background: rgba(165, 214, 255, 0.1);
  border-color: rgba(165, 214, 255, 0.3);
  color: #a5d6ff;
}
.nls-scan-btn:hover {
  background: rgba(165, 214, 255, 0.18);
}

/* Recent products strip */
.nls-recent-section {
  margin-bottom: 0.75rem;
}
.nls-recent-label {
  display: block;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 0.35rem;
}
.nls-recent-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.nls-recent-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--surface-2, #1e2533);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 10px 3px 8px;
  font-size: 0.75rem;
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nls-recent-chip:hover {
  background: var(--accent-muted, rgba(88, 166, 255, 0.12));
  border-color: var(--accent);
}
.nls-recent-cal {
  font-size: 0.68rem;
  color: var(--text-dim);
  flex-shrink: 0;
}

/* Serving size display */
.nls-serving-size {
  font-size: 0.8rem;
  color: var(--text-dim);
  margin-bottom: 0.75rem;
}

/* Per-serving facts grid */
.nls-facts-section {
  margin-bottom: 0.75rem;
}
.nls-facts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 0.4rem;
}
.nls-facts-hint {
  font-size: 0.68rem;
  font-weight: 400;
  color: var(--text-dim);
}
.nls-facts-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.4rem;
}
.nls-fact-cell {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.nls-fact-label {
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.nls-fact-input {
  text-align: center;
  padding: 4px 6px !important;
  font-size: 0.82rem !important;
}

/* Scaled totals summary bar */
.nls-scaled-totals {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--surface-2, #1e2533);
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  margin-bottom: 0.75rem;
}
.nls-scaled-cal {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--accent);
  font-family: var(--font-mono);
}
.nls-scaled-macro {
  font-size: 0.75rem;
  color: var(--text-dim);
  font-family: var(--font-mono);
}
```

- [ ] **Step 5.2 — Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add NutritionLabelScanner CSS"
```

---

## Task 6: Build, verify, and deploy

- [ ] **Step 6.1 — Run the frontend build**

```bash
cd frontend && npm run build
```

Expected: build completes with no errors. Watch for TypeScript/lint errors on the new import.

- [ ] **Step 6.2 — Manual QA checklist (local)**

Start the app with `start.bat`, then open http://localhost:9999, navigate to Calorie Tracker, select today.

| Check | Expected |
|-------|----------|
| Both buttons visible next to Templates | "📷 Scan" and "🏷️ Label" side by side |
| "🏷️ Label" opens label scanner modal | Modal appears with "🏷️ Scan Nutrition Label" title |
| No recent products on first open | Only drop area and Gallery/Camera buttons visible |
| Upload a clear nutrition label photo | Preview appears, "🔍 Read Label" button appears |
| Click "🔍 Read Label" | Spinner shows, then review step appears |
| Review step shows product name, serving size, 4 macro fields | All pre-filled from AI scan |
| Edit a macro value (e.g. change calories) | Value updates, scaled total updates |
| Change servings to 2 | Scaled totals double |
| Change servings to 0.5 | Scaled totals halve |
| Click "+ Add to Lunch" | Modal closes, entry appears in Lunch section |
| Reopen "🏷️ Label" | Recent products chip appears for the product just saved |
| Click the recent product chip | Review step opens with pre-filled data, no photo |
| Close modal with ✕ or backdrop click | Modal dismisses |

- [ ] **Step 6.3 — Deploy to Fly.io**

```bash
flyctl deploy --app life-tracker-zach
```

Expected: deploy completes, machine reaches started state.

- [ ] **Step 6.4 — Smoke-test production**

Open https://life-tracker-zach.fly.dev, authenticate, navigate to Calorie Tracker, verify both buttons appear.

- [ ] **Step 6.5 — Final commit tag**

```bash
git tag nutrition-label-scan-v1
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Scan and detect nutrition tables → `POST /api/food/scan-label` with Claude Sonnet vision
- ✅ Ask for quantity → `servings eaten` stepper in review step
- ✅ Record accurately → editable per-serving fields + scaled totals
- ✅ Two-button entry (council decision) → "📷 Scan" + "🏷️ Label"
- ✅ Product cache for repeat items → `ScannedProduct` model + upsert endpoint + recent chips

**Placeholder scan:** No TBDs, all code blocks complete.

**Type consistency:**
- `product_name` used consistently across model, API, and component
- `perServing.calories/protein_g/carbs_g/fat_g` matches what the API returns (`calories`, `protein_g`, `carbs_g`, `fat_g`)
- `onAdd(json)` matches the `handleLabelAdd` prop signature in CalorieModule (same as `handlePhotoAdd`)
- `ScannedProduct.to_dict()` field names match what `GET /api/food/scanned-products` returns and what the component reads (`p.product_name`, `p.calories`, etc.)
