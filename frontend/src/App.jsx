import React, { useState } from 'react';
const API_BASE = import.meta.env.VITE_API_URL || '';
const apiUrl = (path) => API_BASE ? `${API_BASE}${path}` : `/api${path}`;

function App() {
  const [patients, setPatients] = useState([
    {
      patient_name: 'Barnaby, John Kenneth',
      dob: '1964-06-22',
      medications: [{ name: 'Olanzapine 10mg', quantity: '2', time: 'Evening(2100)' }]
    }
  ]);

  const [originalPdfUrl, setOriginalPdfUrl] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [activeTab, setActiveTab] = useState('original');

  const [parseProgressText, setParseProgressText] = useState("");
  // ✨ 用來判斷是不是在「排隊等待」狀態，來切換顏色
  const [isWaiting, setIsWaiting] = useState(false);

  const currentDate = new Date();
  const [reportYear, setReportYear] = useState(currentDate.getFullYear());
  const [reportMonth, setReportMonth] = useState(currentDate.getMonth() + 1);

  const handlePdfUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const fileUrl = URL.createObjectURL(file);
    setOriginalPdfUrl(fileUrl);
    setActiveTab('original');

    setParsing(true);
    setIsWaiting(false);
    setParseProgressText("⏳ 準備高精度解析中...");

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(apiUrl('/parse-pdf'), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error("伺服器連線失敗");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n');
          buffer = parts.pop();

          for (const part of parts) {
            if (!part.trim()) continue;
            try {
              const data = JSON.parse(part);

              if (data.status === 'start') {
                setParseProgressText(`🤖 AI 準備就緒，共 ${data.total} 頁...`);
                setIsWaiting(false);
              } else if (data.status === 'progress') {
                setParseProgressText(`⚡ GPT-4o 高精度解析中：第 ${data.current} / ${data.total} 頁`);
                setIsWaiting(false);
              } else if (data.status === 'waiting') {
                // ✨ 收到排隊訊號，變成橘色警告！
                setParseProgressText(data.message);
                setIsWaiting(true);
              } else if (data.status === 'done') {
                if (data.result.year) setReportYear(data.result.year);
                if (data.result.month) setReportMonth(data.result.month);
                if (data.result.patients) setPatients(data.result.patients);
                setParseProgressText("✅ 解析完成！");
                setIsWaiting(false);
              } else if (data.status === 'error') {
                alert("解析失敗：" + data.message);
                setIsWaiting(false);
              }
            } catch (e) {
              console.error("JSON 解析錯誤:", e);
            }
          }
        }
      }
    } catch (error) {
      alert("上傳或解析時發生錯誤: " + error.message);
    } finally {
      setParsing(false);
      setTimeout(() => setParseProgressText(""), 3000);
      event.target.value = null;
    }
  };

  const updatePatientInfo = (pIndex, field, value) => {
    const newPatients = [...patients];
    newPatients[pIndex][field] = value;
    setPatients(newPatients);
  };

  const updateMedication = (pIndex, mIndex, field, value) => {
    const newPatients = [...patients];
    newPatients[pIndex].medications[mIndex][field] = value;
    setPatients(newPatients);
  };

  const addMedication = (pIndex) => {
    const newPatients = [...patients];
    newPatients[pIndex].medications.push({ name: '', quantity: '1', time: 'Morning(0800)' });
    setPatients(newPatients);
  };

  const generatePDF = async () => {
    setLoading(true);
    try {
      const payload = { year: parseInt(reportYear), month: parseInt(reportMonth), patients: patients };
      const response = await fetch(apiUrl('/generate-mar'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error("Network response was not ok");
      const blob = await response.blob();
      setPdfUrl(URL.createObjectURL(blob));
      setActiveTab('generated');
    } catch (error) {
      alert("產生 PDF 失敗");
    } finally {
      setLoading(false);
    }
  };

  const colors = {
    bg: '#f3f4f6',
    surface: '#ffffff',
    border: '#e5e7eb',
    primary: '#0f172a',
    secondary: '#3b82f6',
    warning: '#f59e0b',    // 橘黃色警告
    textMain: '#1e293b',
    textMuted: '#64748b',
  };

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', margin: 0, padding: 0, fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: colors.bg, boxSizing: 'border-box' }}>

      <div style={{ width: '420px', minWidth: '420px', display: 'flex', flexDirection: 'column', background: colors.surface, borderRight: `1px solid ${colors.border}`, zIndex: 10, boxShadow: '4px 0 15px rgba(0,0,0,0.03)' }}>

        <div style={{ padding: '24px', borderBottom: `1px solid ${colors.border}` }}>
          <h2 style={{ margin: 0, color: colors.primary, fontSize: '20px', fontWeight: '700', letterSpacing: '-0.5px' }}>MAR Report System</h2>
          <p style={{ margin: '4px 0 0 0', color: colors.textMuted, fontSize: '13px' }}>Automated prescription parsing & generation</p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

          <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: `1px dashed #cbd5e1` }}>
            <h4 style={{ margin: '0 0 12px 0', color: colors.textMain, fontSize: '14px', fontWeight: '600' }}>Step 1: Upload Source Document</h4>
            <input
              type="file"
              accept="application/pdf"
              onChange={handlePdfUpload}
              disabled={parsing}
              style={{ fontSize: '13px', width: '100%', color: colors.textMuted, cursor: 'pointer' }}
            />
            {/* ✨ 即時進度顯示區：如果正在排隊，就變成橘色警告色！ */}
            {parseProgressText && (
              <div style={{
                color: isWaiting ? '#b45309' : colors.secondary,
                fontWeight: '700', marginTop: '12px', fontSize: '13px', padding: '8px',
                background: isWaiting ? '#fef3c7' : '#e0f2fe',
                borderRadius: '4px', textAlign: 'center'
              }}>
                {parseProgressText}
              </div>
            )}
          </div>

          <div style={{ background: colors.surface, padding: '16px', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
            <h4 style={{ margin: '0 0 12px 0', color: colors.textMain, fontSize: '14px', fontWeight: '600' }}>Report Period</h4>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: colors.textMuted, fontWeight: '600', marginBottom: '4px' }}>Year</label>
                <input type="number" value={reportYear} onChange={e => setReportYear(e.target.value)} style={{ width: '100%', padding: '6px 8px', border: `1px solid ${colors.border}`, borderRadius: '4px', fontSize: '13px', outline: 'none' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '12px', color: colors.textMuted, fontWeight: '600', marginBottom: '4px' }}>Month</label>
                <select value={reportMonth} onChange={e => setReportMonth(e.target.value)} style={{ width: '100%', padding: '6px 8px', border: `1px solid ${colors.border}`, borderRadius: '4px', fontSize: '13px', outline: 'none', background: '#fff' }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                    <option key={m} value={m}>{m} 月</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {patients.map((p, pIndex) => (
              <div key={pIndex} style={{ border: `1px solid ${colors.border}`, padding: '16px', borderRadius: '8px', background: colors.surface, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>

                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '12px', color: colors.textMuted, fontWeight: '600', marginBottom: '4px' }}>Patient Name</label>
                    <input value={p.patient_name} onChange={e => updatePatientInfo(pIndex, 'patient_name', e.target.value)} style={{ width: '100%', padding: '8px 10px', border: `1px solid ${colors.border}`, borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box', color: colors.textMain, outline: 'none' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '12px', color: colors.textMuted, fontWeight: '600', marginBottom: '4px' }}>Date of Birth</label>
                    <input value={p.dob || ''} onChange={e => updatePatientInfo(pIndex, 'dob', e.target.value)} style={{ width: '100%', padding: '8px 10px', border: `1px solid ${colors.border}`, borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box', color: colors.textMain, outline: 'none' }} />
                  </div>
                </div>

                <h4 style={{ margin: '0 0 12px 0', color: colors.textMain, fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Medications</h4>

                {p.medications.map((med, mIndex) => (
                  <div key={mIndex} style={{ borderBottom: `1px solid #f1f5f9`, paddingBottom: '12px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                      <div style={{ flex: 2 }}>
                        <label style={{ display: 'block', fontSize: '11px', color: colors.textMuted, marginBottom: '4px' }}>Name & Dosage</label>
                        <input value={med.name} onChange={e => updateMedication(pIndex, mIndex, 'name', e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: '13px', border: `1px solid ${colors.border}`, borderRadius: '4px', boxSizing: 'border-box', outline: 'none' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '11px', color: colors.textMuted, marginBottom: '4px' }}>Qty</label>
                        <input type="text" value={med.quantity} onChange={e => updateMedication(pIndex, mIndex, 'quantity', e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: '13px', border: `1px solid ${colors.border}`, borderRadius: '4px', boxSizing: 'border-box', outline: 'none' }} />
                      </div>
                      <div style={{ flex: 1.2 }}>
                        <label style={{ display: 'block', fontSize: '11px', color: colors.textMuted, marginBottom: '4px' }}>Schedule</label>
                        <select value={med.time} onChange={e => updateMedication(pIndex, mIndex, 'time', e.target.value)} style={{ width: '100%', padding: '6px 4px', fontSize: '13px', border: `1px solid ${colors.border}`, borderRadius: '4px', boxSizing: 'border-box', outline: 'none', background: '#fff' }}>
                          <option value="Morning(0800)">Morning</option>
                          <option value="Noon(1200)">Noon</option>
                          <option value="Dinner(1700)">Dinner</option>
                          <option value="Evening(2100)">Evening</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={() => addMedication(pIndex)} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '12px', background: '#f8fafc', border: `1px solid ${colors.border}`, borderRadius: '4px', color: colors.textMain, fontWeight: '500', transition: 'all 0.2s' }}>
                  + Add Medication
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '24px', borderTop: `1px solid ${colors.border}`, background: '#f8fafc' }}>
          <button
            onClick={generatePDF}
            disabled={loading || parsing}
            style={{ width: '100%', padding: '14px', background: colors.primary, color: 'white', border: 'none', cursor: 'pointer', borderRadius: '8px', fontWeight: '600', fontSize: '15px', letterSpacing: '0.5px', transition: 'all 0.2s', opacity: (loading || parsing) ? 0.7 : 1 }}
          >
            {loading ? 'Generating Report...' : 'Step 2: Generate MAR'}
          </button>
        </div>

      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', padding: '20px', boxSizing: 'border-box' }}>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: colors.surface, borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', border: `1px solid ${colors.border}`, overflow: 'hidden' }}>

          <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, background: '#fafafa' }}>
            <button
              onClick={() => setActiveTab('original')}
              style={{
                padding: '16px 24px', cursor: 'pointer', border: 'none', fontWeight: '600', fontSize: '14px', transition: 'all 0.2s', outline: 'none',
                background: activeTab === 'original' ? colors.surface : 'transparent',
                color: activeTab === 'original' ? colors.secondary : colors.textMuted,
                borderBottom: activeTab === 'original' ? `2px solid ${colors.secondary}` : '2px solid transparent'
              }}
            >
              Source Document
            </button>
            <button
              onClick={() => setActiveTab('generated')}
              style={{
                padding: '16px 24px', cursor: 'pointer', border: 'none', fontWeight: '600', fontSize: '14px', transition: 'all 0.2s', outline: 'none',
                background: activeTab === 'generated' ? colors.surface : 'transparent',
                color: activeTab === 'generated' ? colors.primary : colors.textMuted,
                borderBottom: activeTab === 'generated' ? `2px solid ${colors.primary}` : '2px solid transparent'
              }}
            >
              Generated MAR Report
            </button>
          </div>

          <div style={{ flex: 1, display: 'flex', background: '#e5e5e5' }}>

            {activeTab === 'original' && (
              originalPdfUrl ? (
                <iframe src={originalPdfUrl} style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}></iframe>
              ) : (
                <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: colors.textMuted, fontSize: '15px' }}>
                  Please upload a source document on the left panel.
                </div>
              )
            )}

            {activeTab === 'generated' && (
              pdfUrl ? (
                <iframe src={pdfUrl} style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}></iframe>
              ) : (
                <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: colors.textMuted, fontSize: '15px' }}>
                  Click "Generate MAR" to preview the report.
                </div>
              )
            )}

          </div>
        </div>
      </div>

    </div>
  );
}

export default App;