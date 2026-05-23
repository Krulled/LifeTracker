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
                onClick={() => { setStep(null); if (!image) { setProductName(""); setServingSizeText(""); setPerServing({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }); } }}>
                {image ? "← Retake" : "← Back"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
