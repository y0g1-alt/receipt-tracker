import { useState, useRef } from "react";

const CATEGORIES = [
  "Groceries / Food at home",
  "Eating out / Takeaway",
  "Rent / Mortgage",
  "Utilities",
  "Internet / Phone",
  "Transport / Fuel",
  "Health / Pharmacy / Doctor",
  "Insurance",
  "Clothing / Shoes",
  "Personal care / Beauty",
  "Home & Household supplies",
  "Subscriptions",
  "Entertainment / Activities",
  "Gym / Fitness",
  "Education / Books / Courses",
  "Travel / Hotels / Flights",
  "Gifts",
  "Charity / Donations",
  "Pet care",
  "Miscellaneous / Other",
];

const CURRENCIES = ["ILS ₪", "USD $", "EUR €", "GBP £", "AUD $", "CAD $"];

const CURRENCY_SYMBOLS = {
  "ILS ₪": "₪",
  "USD $": "$",
  "EUR €": "€",
  "GBP £": "£",
  "AUD $": "A$",
  "CAD $": "C$",
};

const today = () => new Date().toISOString().split("T")[0];

const STORAGE_KEY = "receipt-tracker-entries";

const loadEntries = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveEntries = (entries) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    console.error("Could not save to localStorage");
  }
};

const emptyForm = {
  date: today(),
  vendor: "",
  amount: "",
  currency: "ILS ₪",
  category: CATEGORIES[0],
  notes: "",
};

function callClaude(messages, systemPrompt) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    }),
  }).then((r) => r.json());
}

export default function ReceiptTracker() {
  const [entries, setEntries] = useState(loadEntries);
  const [form, setForm] = useState(emptyForm);
  const [view, setView] = useState("add");
  const [scanning, setScanning] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [toast, setToast] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const fileRef = useRef();

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      setImagePreview(dataUrl);
      const base64 = dataUrl.split(",")[1];
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const scanReceipt = async () => {
    if (!imageBase64) return;
    setScanning(true);
    try {
      const systemPrompt = `You are a receipt data extractor. Extract receipt details and return ONLY a JSON object with these exact keys: date (YYYY-MM-DD format, today if unclear), vendor (store/restaurant name), amount (number only, no currency symbol), currency (one of: ILS ₪, USD $, EUR €, GBP £, AUD $, CAD $), category (must be exactly one from this list: ${CATEGORIES.join(", ")}), notes (brief description of main items or empty string). Return only valid JSON, no other text.`;
      const data = await callClaude(
        [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
              { type: "text", text: "Extract the receipt details from this image." },
            ],
          },
        ],
        systemPrompt
      );
      const text = data.content?.find((b) => b.type === "text")?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setForm({
        date: parsed.date || today(),
        vendor: parsed.vendor || "",
        amount: String(parsed.amount || ""),
        currency: parsed.currency || "ILS ₪",
        category: CATEGORIES.includes(parsed.category) ? parsed.category : CATEGORIES[0],
        notes: parsed.notes || "",
      });
      showToast("Receipt scanned — please review");
    } catch {
      showToast("Couldn't read receipt — please fill in manually", "error");
    }
    setScanning(false);
  };

  const saveEntry = () => {
    if (!form.vendor || !form.amount || isNaN(parseFloat(form.amount))) {
      showToast("Please add a vendor and valid amount", "error");
      return;
    }
    const entry = { ...form, amount: parseFloat(form.amount), id: editingId || Date.now() };
    let updated;
    if (editingId) {
      updated = entries.map((e) => (e.id === editingId ? entry : e));
      setEditingId(null);
      showToast("Entry updated");
    } else {
      updated = [entry, ...entries];
      showToast("Entry saved");
    }
    setEntries(updated);
    saveEntries(updated);
    setForm(emptyForm);
    setImagePreview(null);
    setImageBase64(null);
  };

  const deleteEntry = (id) => {
    const updated = entries.filter((e) => e.id !== id);
    setEntries(updated);
    saveEntries(updated);
    showToast("Entry deleted");
  };

  const editEntry = (entry) => {
    setForm({ ...entry, amount: String(entry.amount) });
    setEditingId(entry.id);
    setView("add");
  };

  const exportCSV = () => {
    if (!entries.length) return;
    const header = "Date,Vendor,Amount,Currency,Category,Notes\n";
    const rows = entries
      .map((e) => `${e.date},"${e.vendor}",${e.amount},${e.currency},"${e.category}","${e.notes}"`)
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSV downloaded");
  };

  const totals = entries.reduce((acc, e) => {
    const key = e.category;
    if (!acc[key]) acc[key] = {};
    if (!acc[key][e.currency]) acc[key][e.currency] = 0;
    acc[key][e.currency] += e.amount;
    return acc;
  }, {});

  const grandTotals = entries.reduce((acc, e) => {
    if (!acc[e.currency]) acc[e.currency] = 0;
    acc[e.currency] += e.amount;
    return acc;
  }, {});

  const formatAmount = (amount, currency) =>
    `${CURRENCY_SYMBOLS[currency] || ""}${amount.toFixed(2)}`;

  return (
    <div style={{ fontFamily: "'Georgia', serif", minHeight: "100vh", background: "#f5f0eb", color: "#1a1a1a" }}>
      <div style={{ background: "#1a1a1a", padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 4, color: "#888", textTransform: "uppercase", marginBottom: 4 }}>Personal Finance</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#f5f0eb", letterSpacing: -0.5 }}>Receipt Tracker</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setView("add")} style={{ padding: "8px 20px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 13, fontFamily: "inherit", background: view === "add" ? "#c8a96e" : "#333", color: view === "add" ? "#1a1a1a" : "#aaa", fontWeight: 600, letterSpacing: 0.5 }}>Add</button>
          <button onClick={() => setView("dashboard")} style={{ padding: "8px 20px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 13, fontFamily: "inherit", background: view === "dashboard" ? "#c8a96e" : "#333", color: view === "dashboard" ? "#1a1a1a" : "#aaa", fontWeight: 600, letterSpacing: 0.5 }}>Dashboard</button>
          <button onClick={exportCSV} style={{ padding: "8px 20px", borderRadius: 4, border: "1px solid #444", cursor: "pointer", fontSize: 13, fontFamily: "inherit", background: "transparent", color: "#888", letterSpacing: 0.5 }}>Export CSV</button>
        </div>
      </div>

      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: toast.type === "error" ? "#c0392b" : "#27ae60", color: "#fff", padding: "12px 20px", borderRadius: 6, fontSize: 13, fontFamily: "inherit", boxShadow: "0 4px 20px rgba(0,0,0,0.2)" }}>
          {toast.msg}
        </div>
      )}

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
        {view === "add" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
            <div>
              <div style={{ fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#888", marginBottom: 20 }}>
                {editingId ? "Edit Entry" : "New Entry"}
              </div>
              <div onClick={() => fileRef.current.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }} style={{ border: "2px dashed #c8a96e", borderRadius: 8, padding: "20px", textAlign: "center", cursor: "pointer", marginBottom: 20, background: imagePreview ? "#fff" : "transparent" }}>
                {imagePreview ? (
                  <img src={imagePreview} alt="receipt" style={{ maxHeight: 160, maxWidth: "100%", borderRadius: 4 }} />
                ) : (
                  <div>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
                    <div style={{ fontSize: 13, color: "#888" }}>Drop receipt photo or click to upload</div>
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
              </div>

              {imagePreview && (
                <button onClick={scanReceipt} disabled={scanning} style={{ width: "100%", padding: "10px", marginBottom: 20, background: "#c8a96e", border: "none", borderRadius: 6, cursor: scanning ? "not-allowed" : "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 700, letterSpacing: 1, color: "#1a1a1a", opacity: scanning ? 0.7 : 1 }}>
                  {scanning ? "Scanning..." : "Scan Receipt"}
                </button>
              )}

              {[{ label: "Date", key: "date", type: "date" }, { label: "Vendor / Store", key: "vendor", type: "text", placeholder: "e.g. Shufersal" }, { label: "Amount", key: "amount", type: "number", placeholder: "0.00" }].map(({ label, key, type, placeholder }) => (
                <div key={key} style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#888", marginBottom: 5 }}>{label}</label>
                  <input type={type} value={form[key]} placeholder={placeholder} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, fontFamily: "inherit", background: "#fff", boxSizing: "border-box", outline: "none" }} />
                </div>
              ))}

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#888", marginBottom: 5 }}>Currency</label>
                <select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#888", marginBottom: 5 }}>Category</label>
                <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, fontFamily: "inherit", background: "#fff", boxSizing: "border-box" }}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#888", marginBottom: 5 }}>Notes (optional)</label>
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="What did you buy?" style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, fontFamily: "inherit", background: "#fff", boxSizing: "border-box", resize: "vertical" }} />
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={saveEntry} style={{ flex: 1, padding: "12px", background: "#1a1a1a", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 700, letterSpacing: 1, color: "#f5f0eb" }}>
                  {editingId ? "Update Entry" : "Save Entry"}
                </button>
                {editingId && (
                  <button onClick={() => { setEditingId(null); setForm(emptyForm); setImagePreview(null); }} style={{ padding: "12px 16px", background: "transparent", border: "1px solid #ddd", borderRadius: 6, cursor: "pointer", fontSize: 13, fontFamily: "inherit", color: "#888" }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#888", marginBottom: 20 }}>Recent Entries ({entries.length})</div>
              {entries.length === 0 ? (
                <div style={{ color: "#bbb", fontSize: 14, fontStyle: "italic", paddingTop: 40, textAlign: "center" }}>No entries yet</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {entries.slice(0, 10).map((e) => (
                    <div key={e.id} style={{ background: "#fff", borderRadius: 8, padding: "14px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{e.vendor}</div>
                        <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{e.date} · {e.category}</div>
                        {e.notes && <div style={{ fontSize: 12, color: "#aaa", fontStyle: "italic" }}>{e.notes}</div>}
                      </div>
                      <div style={{ textAlign: "right", marginLeft: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: 16, color: "#c8a96e" }}>{formatAmount(e.amount, e.currency)}</div>
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <button onClick={() => editEntry(e)} style={{ fontSize: 11, color: "#888", background: "none", border: "none", cursor: "pointer", padding: 0 }}>edit</button>
                          <button onClick={() => deleteEntry(e.id)} style={{ fontSize: 11, color: "#c0392b", background: "none", border: "none", cursor: "pointer", padding: 0 }}>delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {view === "dashboard" && (
          <div>
            <div style={{ fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#888", marginBottom: 24 }}>Spending Overview</div>
            {Object.keys(grandTotals).length > 0 && (
              <div style={{ display: "flex", gap: 12, marginBottom: 32, flexWrap: "wrap" }}>
                {Object.entries(grandTotals).map(([currency, total]) => (
                  <div key={currency} style={{ background: "#1a1a1a", borderRadius: 10, padding: "20px 28px", color: "#f5f0eb" }}>
                    <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#888", marginBottom: 6 }}>Total {currency}</div>
                    <div style={{ fontSize: 32, fontWeight: 700, color: "#c8a96e" }}>{formatAmount(total, currency)}</div>
                  </div>
                ))}
              </div>
            )}
            {Object.keys(totals).length === 0 ? (
              <div style={{ color: "#bbb", fontSize: 14, fontStyle: "italic", textAlign: "center", paddingTop: 60 }}>No data yet — add some entries first</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {Object.entries(totals).sort((a, b) => Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0)).map(([category, byCurrency]) => (
                  <div key={category} style={{ background: "#fff", borderRadius: 8, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 13, color: "#444", flex: 1 }}>{category}</div>
                    <div style={{ textAlign: "right" }}>
                      {Object.entries(byCurrency).map(([currency, total]) => (
                        <div key={currency} style={{ fontWeight: 700, fontSize: 15, color: "#c8a96e" }}>{formatAmount(total, currency)}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
