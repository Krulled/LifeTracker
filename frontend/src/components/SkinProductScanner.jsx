import React, { useState, useRef, useEffect } from "react";

const PRODUCT_TYPES = [
  { value: "medicated_wash",  label: "Medicated Wash" },
  { value: "gentle_wash",     label: "Gentle Wash" },
  { value: "moisturizer",     label: "Moisturizer" },
  { value: "sunscreen",       label: "Sunscreen" },
  { value: "heavy_occlusive", label: "Heavy Occlusive" },
  { value: "treatment",       label: "Treatment" },
  { value: "other",           label: "Other" },
];

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
          resolve({ b64, mime, blob });
        };
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.82);
    };
    img.src = url;
  });
}

export default function SkinProductScanner({ onSaved, onClose }) {
  const [step,              setStep]              = useState("upload");
  const [image,             setImage]             = useState(null);
  const [productName,       setProductName]       = useState("");
  const [brand,             setBrand]             = useState("");
  const [productType,       setProductType]       = useState("other");
  const [activeIngredients, setActiveIngredients] = useState("");
  const [faceSafe,          setFaceSafe]          = useState(true);
  const [aiSummary,         setAiSummary]         = useState("");
  const [confidence,        setConfidence]        = useState(null);
  const [saving,            setSaving]            = useState(false);
  const [error,             setError]             = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    return () => {
      if (image?.objectUrl) URL.revokeObjectURL(image.objectUrl);
    };
  }, [image]);

  async function handleFile(file) {
    if (!file) return;
    const compressed = await compressImage(file);
    const objectUrl  = URL.createObjectURL(compressed.blob);
    setImage({ ...compressed, objectUrl });
    setError(null);
    await analyze(compressed);
  }

  async function analyze(compressed) {
    setStep("scanning");
    setError(null);
    try {
      const res  = await fetch("/api/skincare/products/scan", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ image: compressed.b64, mime_type: compressed.mime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setProductName(data.product_name || "");
      setBrand(data.brand || "");
      setProductType(data.product_type || "other");
      setActiveIngredients(data.active_ingredients || "");
      setFaceSafe(data.face_safe !== false);
      setAiSummary(data.ai_summary || "");
      setConfidence(data.confidence || null);
      setStep("review");
    } catch (err) {
      setError(err.message);
      setStep("review");
    } finally {
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!productName.trim()) { setError("Product name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const res  = await fetch("/api/skincare/products", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          product_name:       productName.trim(),
          brand:              brand.trim() || null,
          product_type:       productType,
          active_ingredients: activeIngredients.trim() || null,
          face_safe:          faceSafe,
          ai_summary:         aiSummary.trim() || null,
          photo_b64:          image?.b64 || null,
          photo_mime:         image?.mime || "image/jpeg",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function resetToUpload() {
    if (image?.objectUrl) URL.revokeObjectURL(image.objectUrl);
    setStep("upload"); setImage(null);
    setProductName(""); setBrand(""); setProductType("other");
    setActiveIngredients(""); setFaceSafe(true); setAiSummary("");
    setConfidence(null); setError(null);
  }

  return (
    <div className="sps-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sps-sheet">
        <div className="sps-handle" />

        {step === "upload" && (
          <>
            <div className="sps-title">📷 Scan Product</div>
            <div className="sps-sub">Photograph the front label or ingredients panel</div>
            <div
              className="sps-dropzone"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
            >
              <span className="sps-dropzone-icon">📦</span>
              <div>Tap to take photo or choose from library</div>
              <div className="sps-dropzone-hint">Front label · Ingredients panel</div>
            </div>
            <input
              ref={fileRef} type="file" accept="image/*" capture="environment"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files[0])}
            />
            <button className="sps-btn-ghost" onClick={onClose} style={{ marginTop: 12 }}>Cancel</button>
          </>
        )}

        {step === "scanning" && (
          <div className="sps-scanning">
            <div className="sps-spinner">🔍</div>
            <div>Identifying product…</div>
          </div>
        )}

        {step === "review" && (
          <form onSubmit={handleSave}>
            <div className="sps-title">Review Product</div>
            <div className="sps-sub">AI identified the following — edit anything that's wrong</div>

            {confidence === "low" && (
              <div className="sps-confidence-warn">
                ⚠️ Low confidence scan — please verify all fields below
              </div>
            )}
            {image?.objectUrl && (
              <img src={image.objectUrl} className="sps-preview-img" alt="Product" />
            )}
            {error && <div className="sps-error">{error}</div>}

            <div className="sps-field">
              <label className="sps-label">Brand</label>
              <input className="sps-input" value={brand}
                onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" />
            </div>
            <div className="sps-field">
              <label className="sps-label">Product Name *</label>
              <input className="sps-input" value={productName} required
                onChange={(e) => setProductName(e.target.value)} placeholder="Full product name" />
            </div>
            <div className="sps-field">
              <label className="sps-label">Product Type</label>
              <div className="sps-type-chips">
                {PRODUCT_TYPES.map((pt) => (
                  <button key={pt.value} type="button"
                    className={`sps-type-chip${productType === pt.value ? " sps-type-chip-active" : ""}`}
                    onClick={() => setProductType(pt.value)}>{pt.label}</button>
                ))}
              </div>
            </div>
            <div className="sps-field">
              <label className="sps-label">Active Ingredients</label>
              <input className="sps-input" value={activeIngredients}
                onChange={(e) => setActiveIngredients(e.target.value)}
                placeholder="e.g. 2% Salicylic Acid, Niacinamide" />
            </div>
            <div className="sps-field">
              <label className="sps-label">Face Safe?</label>
              <div className="sps-face-safe-row">
                <button type="button"
                  className={`sps-safe-btn${faceSafe ? " sps-safe-btn-yes" : ""}`}
                  onClick={() => setFaceSafe(true)}>✓ Safe for Face</button>
                <button type="button"
                  className={`sps-safe-btn${!faceSafe ? " sps-safe-btn-no" : ""}`}
                  onClick={() => setFaceSafe(false)}>🚫 Exclude from Face</button>
              </div>
            </div>
            {aiSummary && (
              <div className="sps-ai-summary">
                <span className="sps-ai-badge">AI</span> {aiSummary}
              </div>
            )}
            <div className="sps-actions">
              <button type="button" className="sps-btn-ghost" onClick={resetToUpload}>← Back</button>
              <button type="submit" className="sps-btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save to Inventory"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
