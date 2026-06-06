import React, { useState, useRef } from "react";

const MEAL_TYPES  = ["breakfast","lunch","dinner","snack"];
const MEAL_LABELS = { breakfast:"Breakfast", lunch:"Lunch", dinner:"Dinner", snack:"Snacks" };

function getMealTypeFromTime() {
  const h = new Date().getHours();
  if (h >= 5  && h < 10) return "breakfast";
  if (h >= 10 && h < 14) return "lunch";
  if (h >= 14 && h < 18) return "snack";
  if (h >= 18 && h < 23) return "dinner";
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
          const dataURL = e.target.result;
          const [header, b64] = dataURL.split(",");
          const mime = header.match(/:(.*?);/)[1];
          resolve({ src: dataURL, b64, mime });
        };
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.82);
    };
    img.src = url;
  });
}

function recalcIngredient(ing, newGrams) {
  const g     = Math.max(0, parseFloat(newGrams) || 0);
  const ratio = g / 100;
  return {
    ...ing,
    estimated_grams: g,
    calories:  Math.round(ing.calories_per_100g * ratio),
    protein_g: Math.round(ing.protein_per_100g  * ratio * 10) / 10,
    carbs_g:   Math.round(ing.carbs_per_100g    * ratio * 10) / 10,
    fat_g:     Math.round(ing.fat_per_100g      * ratio * 10) / 10,
  };
}

const STEPS = [
  { key: "identifying", label: "Identifying ingredients" },
  { key: "looking_up",  label: "Looking up nutrition data" },
];

export default function FoodPhotoAnalyzer({ date, onAdd, onClose }) {
  const [image,       setImage]       = useState(null);
  const [step,        setStep]        = useState(null); // null | 'identifying' | 'looking_up' | 'review'
  const [dishName,    setDishName]    = useState("");
  const [description, setDescription] = useState("");
  const [ingredients, setIngredients] = useState([]);
  const [mealType,    setMealType]    = useState(getMealTypeFromTime());
  const [multiplier,  setMultiplier]  = useState(1);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState(null);
  const fileRef   = useRef(null);
  const cameraRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setStep(null);
    setIngredients([]);
    const compressed = await compressImage(file);
    setImage(compressed);
  }

  async function analyze() {
    if (!image) return;
    setError(null);
    setStep("identifying");
    try {
      // Step 1: Claude Vision → ingredient list + estimated grams
      const r1 = await fetch("/api/food/identify-ingredients", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ image: image.b64, mime_type: image.mime }),
      });
      const j1 = await r1.json();
      if (!r1.ok) throw new Error(j1.error || "Identification failed");

      setDishName(j1.dish_name || "");
      setDescription(j1.description || "");
      setStep("looking_up");

      // Step 2: USDA lookup → per-ingredient macros
      const r2 = await fetch("/api/food/calculate-nutrition", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ingredients: j1.ingredients }),
      });
      const j2 = await r2.json();
      if (!r2.ok) throw new Error(j2.error || "Nutrition lookup failed");

      setIngredients(j2.ingredients || []);
      setStep("review");
    } catch (err) {
      setError(err.message);
      setStep(null);
    }
  }

  function updateGrams(idx, newGrams) {
    setIngredients(prev => prev.map((ing, i) =>
      i === idx ? recalcIngredient(ing, newGrams) : ing
    ));
  }

  function removeIngredient(idx) {
    setIngredients(prev => prev.filter((_, i) => i !== idx));
  }

  const totals = ingredients.reduce((acc, ing) => ({
    calories:  acc.calories  + (ing.calories  || 0),
    protein_g: acc.protein_g + (ing.protein_g || 0),
    carbs_g:   acc.carbs_g   + (ing.carbs_g   || 0),
    fat_g:     acc.fat_g     + (ing.fat_g     || 0),
  }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

  const m = parseFloat(multiplier) || 1;
  const scaledTotals = {
    calories:  Math.round(totals.calories  * m),
    protein_g: Math.round(totals.protein_g * m * 10) / 10,
    carbs_g:   Math.round(totals.carbs_g   * m * 10) / 10,
    fat_g:     Math.round(totals.fat_g     * m * 10) / 10,
  };

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/food", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          food_name:  dishName || "Food",
          meal_type:  mealType,
          entry_date: date,
          calories:   scaledTotals.calories,
          protein_g:  scaledTotals.protein_g,
          carbs_g:    scaledTotals.carbs_g,
          fat_g:      scaledTotals.fat_g,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      onAdd(json);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const isAnalyzing = step === "identifying" || step === "looking_up";
  const currentStepIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box photo-analyzer-modal">
        <div className="modal-header">
          <span className="modal-title">📷 Scan Food</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Upload + progress ── */}
        {step !== "review" && (
          <div className="photo-upload-section">
            {image ? (
              <div className="photo-preview-wrap">
                <img src={image.src} className="photo-preview-img" alt="food preview" />
                {!isAnalyzing && (
                  <button className="photo-remove-btn"
                    onClick={() => { setImage(null); setError(null); setStep(null); }}>
                    ✕ Remove
                  </button>
                )}
              </div>
            ) : (
              <div className="photo-drop-area">
                <div className="photo-drop-icon">🍽️</div>
                <div className="photo-drop-text">Take or upload a photo of your meal</div>
                <div className="photo-drop-sub">AI identifies ingredients and looks up nutrition data</div>
              </div>
            )}

            {!isAnalyzing && (
              <div className="photo-input-btns">
                <button className="btn btn-ghost photo-btn" onClick={() => fileRef.current?.click()}>
                  📁 Gallery
                </button>
                <button className="btn btn-ghost photo-btn" onClick={() => cameraRef.current?.click()}>
                  📷 Camera
                </button>
              </div>
            )}

            <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }}
              onChange={e => handleFile(e.target.files[0])} onClick={e => { e.target.value = ""; }} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }}
              onChange={e => handleFile(e.target.files[0])} onClick={e => { e.target.value = ""; }} />

            {isAnalyzing && (
              <div className="scan-steps">
                {STEPS.map((s, i) => {
                  const done   = i < currentStepIdx;
                  const active = i === currentStepIdx;
                  return (
                    <div key={s.key} className={`scan-step${active ? " active" : done ? " done" : ""}`}>
                      <span className="scan-step-icon">
                        {done   ? "✓" : active
                          ? <span className="spinner" style={{ width:13, height:13 }} />
                          : <span className="scan-step-pending">○</span>}
                      </span>
                      <span className="scan-step-label">{s.label}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {error && (
              <div className="alert alert-error" style={{ marginTop:"0.75rem", fontSize:"0.8rem" }}>
                ✗ {error}
              </div>
            )}

            {image && !isAnalyzing && (
              <button className="btn btn-primary" style={{ width:"100%", marginTop:"0.75rem" }}
                onClick={analyze}>
                🔍 Analyze with AI
              </button>
            )}
          </div>
        )}

        {/* ── Review ── */}
        {step === "review" && (
          <form onSubmit={handleSave} className="photo-result-form">
            <div className="photo-result-header">
              <img src={image.src} className="photo-result-thumb" alt="food" />
              {description && <div className="photo-result-desc">{description}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">Dish Name</label>
              <input className="form-input" value={dishName}
                onChange={e => setDishName(e.target.value)} required />
            </div>

            {/* Ingredient breakdown */}
            <div className="scan-ingredient-section">
              <div className="scan-ingredient-header">
                <span>Ingredients</span>
                <span className="scan-ingredient-hint">Edit grams to adjust — macros update live</span>
              </div>

              <div className="scan-ingredient-table">
                <div className="scan-ing-row scan-ing-head">
                  <span className="scan-ing-name">Item</span>
                  <span className="scan-ing-g">g</span>
                  <span className="scan-ing-cal">Cal</span>
                  <span className="scan-ing-mac">P</span>
                  <span className="scan-ing-mac">C</span>
                  <span className="scan-ing-mac">F</span>
                  <span className="scan-ing-del" />
                </div>

                {ingredients.map((ing, idx) => (
                  <div key={idx} className="scan-ing-row">
                    <span className="scan-ing-name">
                      <span
                        className={ing.usda_matched ? "scan-source-dot usda" : "scan-source-dot ai"}
                        title={ing.usda_matched ? `USDA: ${ing.usda_name}` : "AI estimated"}
                      />
                      {ing.name}
                    </span>
                    <span className="scan-ing-g">
                      <input
                        className="scan-g-input"
                        type="number" min="0" step="1"
                        value={ing.estimated_grams}
                        onChange={e => updateGrams(idx, e.target.value)}
                      />
                    </span>
                    <span className="scan-ing-cal">{ing.calories}</span>
                    <span className="scan-ing-mac">{ing.protein_g}g</span>
                    <span className="scan-ing-mac">{ing.carbs_g}g</span>
                    <span className="scan-ing-mac">{ing.fat_g}g</span>
                    <span className="scan-ing-del">
                      <button type="button" className="scan-del-btn"
                        onClick={() => removeIngredient(idx)}>✕</button>
                    </span>
                  </div>
                ))}

                {/* Totals row */}
                <div className="scan-ing-row scan-ing-totals">
                  <span className="scan-ing-name">
                    Total{m !== 1 ? ` ×${m}` : ""}
                  </span>
                  <span className="scan-ing-g" />
                  <span className="scan-ing-cal">{scaledTotals.calories}</span>
                  <span className="scan-ing-mac">{scaledTotals.protein_g}g</span>
                  <span className="scan-ing-mac">{scaledTotals.carbs_g}g</span>
                  <span className="scan-ing-mac">{scaledTotals.fat_g}g</span>
                  <span className="scan-ing-del" />
                </div>
              </div>

              <div className="scan-source-legend">
                <span><span className="scan-source-dot usda" /> USDA database</span>
                <span><span className="scan-source-dot ai" /> AI estimated</span>
              </div>
            </div>

            {/* Serving multiplier */}
            <div className="photo-qty-row">
              <div className="photo-qty-label">
                <span className="photo-qty-title">Servings</span>
                <span className="photo-qty-hint">Scale up if you had multiple plates</span>
              </div>
              <div className="photo-qty-controls">
                <button type="button" className="photo-qty-step"
                  onClick={() => setMultiplier(v => Math.max(0.5, (parseFloat(v) || 1) - 0.5))}>−</button>
                <input className="form-input photo-qty-input" type="number" min="0.5" max="20" step="0.5"
                  value={multiplier} onChange={e => setMultiplier(e.target.value)} />
                <button type="button" className="photo-qty-step"
                  onClick={() => setMultiplier(v => (parseFloat(v) || 1) + 0.5)}>+</button>
              </div>
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
                disabled={saving || !ingredients.length} style={{ flex:1 }}>
                {saving ? "Saving…" : `＋ Add to ${MEAL_LABELS[mealType]}`}
              </button>
              <button type="button" className="btn btn-ghost"
                onClick={() => { setStep(null); setIngredients([]); }}>
                ← Retake
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
