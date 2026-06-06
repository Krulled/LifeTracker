import { useState } from "react";

const MEAL_TYPES  = ["breakfast","lunch","dinner","snack"];
const MEAL_ICONS  = { breakfast:"🌅", lunch:"☀️", dinner:"🌙", snack:"🍎" };
const MEAL_LABELS = { breakfast:"Breakfast", lunch:"Lunch", dinner:"Dinner", snack:"Snacks" };

const BLANK_ITEM = () => ({ food_name:"", calories:"", protein_g:"", carbs_g:"", fat_g:"" });

export default function TemplatesPanel({ templates, onApply, onDelete, onSave, isFuture, byMeal, onClose }) {
  const [applyingId,   setApplyingId]   = useState(null);
  const [applyTarget,  setApplyTarget]  = useState({});
  const [showSave,     setShowSave]     = useState(null);   // meal type for "save from logged"
  const [saveName,     setSaveName]     = useState("");
  const [savingTpl,    setSavingTpl]    = useState(false);
  const [flash,        setFlash]        = useState(null);
  // New template builder
  const [showCreate,   setShowCreate]   = useState(false);
  const [createName,   setCreateName]   = useState("");
  const [createMeal,   setCreateMeal]   = useState("lunch");
  const [createItems,  setCreateItems]  = useState([BLANK_ITEM()]);
  const [creatingTpl,  setCreatingTpl]  = useState(false);

  function showFlash(ok, text) {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), 2500);
  }

  async function handleApply(tpl) {
    const target = applyTarget[tpl.id] || tpl.meal_type || "lunch";
    setApplyingId(tpl.id);
    await onApply(tpl.id, target);
    setApplyingId(null);
    showFlash(true, `"${tpl.name}" added to ${MEAL_LABELS[target]}!`);
  }

  async function handleSaveFromMeal(e) {
    e.preventDefault();
    const name = saveName.trim();
    if (!name || !showSave) return;
    const items = byMeal[showSave] || [];
    if (!items.length) return;
    setSavingTpl(true);
    const ok = await onSave(items, name, showSave);
    setSavingTpl(false);
    if (ok) {
      showFlash(true, "Template saved!");
      setSaveName(""); setShowSave(null);
    } else {
      showFlash(false, "Save failed — try again.");
    }
  }

  function updateCreateItem(i, field, value) {
    setCreateItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: value } : it));
  }
  function addCreateItem() { setCreateItems(prev => [...prev, BLANK_ITEM()]); }
  function removeCreateItem(i) {
    if (createItems.length === 1) return;
    setCreateItems(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleCreate(e) {
    e.preventDefault();
    const name = createName.trim();
    if (!name) return;
    const validItems = createItems.filter(it => it.food_name.trim() && it.calories);
    if (!validItems.length) return;
    const items = validItems.map(it => ({
      food_name: it.food_name.trim(),
      calories:  parseInt(it.calories, 10) || 0,
      protein_g: it.protein_g ? parseFloat(it.protein_g) : null,
      carbs_g:   it.carbs_g   ? parseFloat(it.carbs_g)   : null,
      fat_g:     it.fat_g     ? parseFloat(it.fat_g)     : null,
    }));
    setCreatingTpl(true);
    const ok = await onSave(items, name, createMeal);
    setCreatingTpl(false);
    if (ok) {
      showFlash(true, "Template created!");
      setShowCreate(false); setCreateName(""); setCreateMeal("lunch"); setCreateItems([BLANK_ITEM()]);
    } else {
      showFlash(false, "Save failed — try again.");
    }
  }

  const mealsWithFood = MEAL_TYPES.filter(t => (byMeal[t] || []).length > 0);

  return (
    <div className="tpl-panel card">
      <div className="tpl-panel-header">
        <span className="tpl-panel-icon">📋</span>
        <span className="tpl-panel-title">Meal Templates</span>
        <span className="tpl-panel-count">{templates.length} saved</span>
        <button
          className={`tpl-new-btn${showCreate ? " active" : ""}`}
          onClick={() => { setShowCreate(v => !v); setShowSave(null); }}
          title="Build a new template from scratch"
        >
          ＋ New
        </button>
        <button className="tpl-panel-close" onClick={onClose} title="Close">✕</button>
      </div>

      {flash && (
        <div className={`meal-tpl-flash${flash.ok ? "" : " error"}`}>{flash.text}</div>
      )}

      {/* ── Build from scratch ── */}
      {showCreate && (
        <form className="tpl-create-form" onSubmit={handleCreate}>
          <div className="tpl-create-row">
            <input
              className="form-input tpl-create-name"
              placeholder="Template name…"
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              required
              autoFocus
            />
            <select
              className="form-input tpl-create-meal-sel"
              value={createMeal}
              onChange={e => setCreateMeal(e.target.value)}
              style={{ colorScheme:"dark" }}
            >
              {MEAL_TYPES.map(m => <option key={m} value={m}>{MEAL_ICONS[m]} {MEAL_LABELS[m]}</option>)}
            </select>
          </div>

          <div className="tpl-create-items">
            <div className="tpl-create-items-header">
              <span>Food</span><span>Cal *</span><span>P g</span><span>C g</span><span>F g</span><span />
            </div>
            {createItems.map((it, i) => (
              <div key={i} className="tpl-create-item-row">
                <input className="form-input" placeholder="Food name" value={it.food_name}
                  onChange={e => updateCreateItem(i, "food_name", e.target.value)} required />
                <input className="form-input" type="number" min="0" placeholder="cal" value={it.calories}
                  onChange={e => updateCreateItem(i, "calories", e.target.value)} required />
                <input className="form-input" type="number" min="0" step="0.1" placeholder="—" value={it.protein_g}
                  onChange={e => updateCreateItem(i, "protein_g", e.target.value)} />
                <input className="form-input" type="number" min="0" step="0.1" placeholder="—" value={it.carbs_g}
                  onChange={e => updateCreateItem(i, "carbs_g", e.target.value)} />
                <input className="form-input" type="number" min="0" step="0.1" placeholder="—" value={it.fat_g}
                  onChange={e => updateCreateItem(i, "fat_g", e.target.value)} />
                <button type="button" className="tpl-item-del" onClick={() => removeCreateItem(i)}
                  disabled={createItems.length === 1}>✕</button>
              </div>
            ))}
            <button type="button" className="tpl-add-item-btn" onClick={addCreateItem}>＋ Add item</button>
          </div>

          <div className="tpl-create-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={creatingTpl}>
              {creatingTpl ? "Saving…" : "💾 Save Template"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => { setShowCreate(false); setCreateName(""); setCreateItems([BLANK_ITEM()]); }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ── Save from logged meal ── */}
      {!isFuture && !showCreate && mealsWithFood.length > 0 && (
        <div className="tpl-save-bar">
          <span className="tpl-save-label">Save today's meal as template:</span>
          <div className="tpl-save-btns">
            {mealsWithFood.map(t => (
              <button
                key={t}
                className={`tpl-save-meal-btn${showSave === t ? " active" : ""}`}
                onClick={() => { setShowSave(showSave === t ? null : t); setSaveName(""); }}
              >
                {MEAL_ICONS[t]} {MEAL_LABELS[t]}
              </button>
            ))}
          </div>
          {showSave && (
            <form className="tpl-save-form" onSubmit={handleSaveFromMeal}>
              <input
                className="form-input tpl-save-input"
                placeholder={`Name for this ${MEAL_LABELS[showSave]} template…`}
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                autoFocus
                required
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingTpl}>
                {savingTpl ? "Saving…" : "💾 Save"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => { setShowSave(null); setSaveName(""); }}>
                Cancel
              </button>
            </form>
          )}
        </div>
      )}

      {templates.length === 0 && !showCreate ? (
        <div className="tpl-empty">
          <div className="tpl-empty-icon">📋</div>
          <div className="tpl-empty-text">No templates saved yet.</div>
          <div className="tpl-empty-sub">
            Hit <strong>＋ New</strong> to build one from scratch, or log a meal and save it directly.
          </div>
        </div>
      ) : !showCreate && (
        <div className="tpl-list">
          {templates.map(t => (
            <div key={t.id} className="tpl-card">
              <div className="tpl-card-info">
                <div className="tpl-card-name">{t.name}</div>
                <div className="tpl-card-meta">
                  <span className="tpl-meta-cal">{t.total_calories} cal</span>
                  <span className="tpl-meta-dot">·</span>
                  <span>{t.item_count} item{t.item_count !== 1 ? "s" : ""}</span>
                  {t.meal_type && (
                    <>
                      <span className="tpl-meta-dot">·</span>
                      <span className="tpl-meta-type">{MEAL_LABELS[t.meal_type] || t.meal_type}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="tpl-card-actions">
                <select
                  className="tpl-meal-select"
                  value={applyTarget[t.id] || t.meal_type || "lunch"}
                  onChange={e => setApplyTarget(prev => ({ ...prev, [t.id]: e.target.value }))}
                  disabled={!!applyingId}
                  style={{ colorScheme:"dark" }}
                >
                  {MEAL_TYPES.map(m => (
                    <option key={m} value={m}>{MEAL_LABELS[m]}</option>
                  ))}
                </select>
                <button
                  className="tpl-apply-btn"
                  onClick={() => handleApply(t)}
                  disabled={!!applyingId || isFuture}
                  title="Add this template to the selected meal"
                >
                  {applyingId === t.id
                    ? <span className="spinner" style={{ width:12, height:12 }} />
                    : "＋ Add"}
                </button>
                <button
                  className="tpl-del-btn"
                  onClick={() => onDelete(t.id)}
                  title="Delete template"
                  disabled={!!applyingId}
                >🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
