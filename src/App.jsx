import { useState, useCallback, useEffect } from "react";

// ── EXIF parser ──
function parseExifDate(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xFFD8) return null;
    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);
      const length = view.getUint16(offset + 2);
      if (marker === 0xFFE1) {
        const exifStr = String.fromCharCode(...new Uint8Array(buffer, offset + 4, 6));
        if (exifStr.startsWith("Exif")) {
          const tiffStart = offset + 10;
          const tiffView = new DataView(buffer, tiffStart);
          const littleEndian = tiffView.getUint16(0) === 0x4949;
          const ifdOffset = tiffView.getUint32(4, littleEndian);
          const entries = tiffView.getUint16(ifdOffset, littleEndian);
          for (let i = 0; i < entries; i++) {
            const entryOffset = ifdOffset + 2 + i * 12;
            const tag = tiffView.getUint16(entryOffset, littleEndian);
            if (tag === 0x9003 || tag === 0x0132) {
              const valueOffset = tiffView.getUint32(entryOffset + 8, littleEndian);
              const dateStr = String.fromCharCode(
                ...new Uint8Array(buffer, tiffStart + valueOffset, 19)
              );
              const m = dateStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
              if (m) return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]);
            }
          }
        }
      }
      offset += 2 + length;
    }
  } catch(e) {}
  return null;
}

const pad = n => String(n).padStart(2, "0");

function fmtDiff(d) {
  if (d === null) return "--";
  const s = Math.abs(d);
  if (s < 60) return (d >= 0 ? "+" : "-") + s + "s";
  return (d >= 0 ? "+" : "-") + Math.floor(s/60) + "m" + (s%60) + "s";
}

function ClockFace({ hour, minute, second, size = 180 }) {
  const cx = size/2, cy = size/2, r = size/2 - 4;
  const pt = (deg, len) => ({
    x: cx + len * Math.sin(deg * Math.PI / 180),
    y: cy - len * Math.cos(deg * Math.PI / 180)
  });
  const secDeg  = second * 6;
  const minDeg  = minute * 6 + second * 0.1;
  const hourDeg = (hour % 12) * 30 + minute * 0.5;
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = pt(i*30, r); const b = pt(i*30, r*0.88);
    return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#333" strokeWidth="1.5" />;
  });
  const sec  = pt(secDeg,  r*0.88);
  const min  = pt(minDeg,  r*0.82);
  const hr   = pt(hourDeg, r*0.55);
  return (
    <svg width={size} height={size} style={{ display:"block" }}>
      <circle cx={cx} cy={cy} r={r} fill="#07070e" stroke="#1a1a28" strokeWidth="1" />
      {ticks}
      <line x1={cx} y1={cy} x2={hr.x}  y2={hr.y}  stroke="#c8a96e" strokeWidth="3" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={min.x} y2={min.y} stroke="#8ab4f8" strokeWidth="2" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={sec.x} y2={sec.y} stroke="#00e5a0" strokeWidth="1" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="3" fill="#e8e0d0" />
    </svg>
  );
}

function Spinner({ value, min, max, onChange, color, label }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"4px" }}>
      <div style={{ fontSize:"9px", letterSpacing:"3px", color:"#444" }}>{label}</div>
      <button onClick={() => onChange(value >= max ? min : value + 1)}
        style={{ width:"52px", height:"28px", background:"transparent", border:"1px solid #1e1e28",
          borderRadius:"4px 4px 0 0", color:"#555", fontSize:"14px", cursor:"pointer" }}>▲</button>
      <input type="number" value={value}
        onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= min && v <= max) onChange(v); }}
        onFocus={e => e.target.select()}
        style={{ width:"52px", height:"48px", background:"#0e0e1a", border:"1px solid #1e1e28",
          color, fontSize:"20px", textAlign:"center", outline:"none" }} />
      <button onClick={() => onChange(value <= min ? max : value - 1)}
        style={{ width:"52px", height:"28px", background:"transparent", border:"1px solid #1e1e28",
          borderRadius:"0 0 4px 4px", color:"#555", fontSize:"14px", cursor:"pointer" }}>▼</button>
    </div>
  );
}

export default function App() {
  const [preview,   setPreview]   = useState(null);
  const [photoDate, setPhotoDate] = useState(null);
  const [mH, setMH] = useState(12);
  const [mM, setMM] = useState(0);
  const [mS, setMS] = useState(0);
  const [hasResult, setHasResult] = useState(false);
  const [showCsv,   setShowCsv]   = useState(false);

  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = "* { box-sizing:border-box; } input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; } input[type=number] { -moz-appearance:textfield; }";
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);

  const loadFile = useCallback(e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ra = new FileReader();
    ra.onload = ev => {
      const date = parseExifDate(ev.target.result);
      if (date) { setPhotoDate(date); setMH(date.getHours()); setMM(date.getMinutes()); setMS(date.getSeconds()); }
    };
    ra.readAsArrayBuffer(file);
    const rb = new FileReader();
    rb.onload = ev => { setPreview(ev.target.result); setHasResult(true); };
    rb.readAsDataURL(file);
  }, []);

  const photoTime = photoDate
    ? `${photoDate.getFullYear()}/${pad(photoDate.getMonth()+1)}/${pad(photoDate.getDate())} ${pad(photoDate.getHours())}:${pad(photoDate.getMinutes())}:${pad(photoDate.getSeconds())}`
    : "";
  const clockSec = mH*3600 + mM*60 + mS;
  const photoSec = photoDate ? photoDate.getHours()*3600 + photoDate.getMinutes()*60 + photoDate.getSeconds() : null;
  const diffSec  = photoSec !== null ? Math.round(clockSec - photoSec) : null;
  const diffColor = diffSec === null ? "#555" : Math.abs(diffSec) <= 5 ? "#00e5a0" : Math.abs(diffSec) <= 60 ? "#f5a623" : "#e05555";
  const CRLF = "\r\n", TAB = "\t";
  const csvText = "画像撮影時刻(EXIF)" + TAB + "時計誤差(秒)" + CRLF + photoTime + TAB + (diffSec == null ? "" : diffSec) + CRLF;

  return (
    <div style={{ minHeight:"100vh", background:"#05050d", color:"#e8e0d0", fontFamily:"'Courier New',monospace", display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"16px 20px", borderBottom:"1px solid #0e0e1a", background:"#05050d", position:"sticky", top:0, zIndex:10, paddingTop:"env(safe-area-inset-top)" }}>
        <div style={{ fontSize:"11px", letterSpacing:"6px", color:"#c8a96e" }}>ANALOG CLOCK READER</div>
        <div style={{ fontSize:"9px", letterSpacing:"3px", color:"#333", marginTop:"3px" }}>手動入力モード</div>
      </div>

      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:"12px", padding:"16px", maxWidth:"480px", width:"100%", margin:"0 auto" }}>

        <div style={{ border:"1px solid #1a1a28", borderRadius:"8px", overflow:"hidden" }}>
          <div style={{ padding:"8px 12px", fontSize:"9px", letterSpacing:"4px", color:"#444", borderBottom:"1px solid #0e0e1a" }}>IMAGE</div>
          <div style={{ padding:"12px", display:"flex", gap:"10px" }}>
            <label style={{ flex:1, padding:"12px", border:"1px solid #c8a96e40", borderRadius:"6px", background:"rgba(200,169,110,0.06)", color:"#c8a96e", fontSize:"11px", letterSpacing:"2px", cursor:"pointer", textAlign:"center", display:"block" }}>
              📷 カメラ<input type="file" accept="image/*" capture="environment" onChange={loadFile} style={{ display:"none" }} />
            </label>
            <label style={{ flex:1, padding:"12px", border:"1px solid #c8a96e40", borderRadius:"6px", background:"rgba(200,169,110,0.06)", color:"#c8a96e", fontSize:"11px", letterSpacing:"2px", cursor:"pointer", textAlign:"center", display:"block" }}>
              🖼 ギャラリー<input type="file" accept="image/*" onChange={loadFile} style={{ display:"none" }} />
            </label>
          </div>
          {preview && (
            <div style={{ padding:"0 12px 12px" }}>
              <img src={preview} alt="preview" style={{ width:"100%", borderRadius:"6px", border:"1px solid #1a1a28" }} />
              {photoDate && <div style={{ marginTop:"8px", fontSize:"10px", color:"#888", letterSpacing:"2px", textAlign:"center" }}>📅 {photoTime}</div>}
            </div>
          )}
        </div>

        <div style={{ border:"1px solid #1a1a28", borderRadius:"8px", overflow:"hidden" }}>
          <div style={{ padding:"8px 12px", fontSize:"9px", letterSpacing:"4px", color:"#444", borderBottom:"1px solid #0e0e1a" }}>MANUAL INPUT</div>
          <div style={{ padding:"16px", display:"flex", flexDirection:"column", alignItems:"center", gap:"16px" }}>
            <ClockFace hour={mH} minute={mM} second={mS} size={180} />
            <div style={{ fontSize:"28px", letterSpacing:"4px", color:"#e8e0d0" }}>{pad(mH)}:{pad(mM)}:{pad(mS)}</div>
            <div style={{ display:"flex", gap:"16px" }}>
              <Spinner value={mH} min={0} max={23} onChange={setMH} color="#c8a96e" label="時" />
              <Spinner value={mM} min={0} max={59} onChange={setMM} color="#8ab4f8" label="分" />
              <Spinner value={mS} min={0} max={59} onChange={setMS} color="#00e5a0" label="秒" />
            </div>
          </div>
        </div>

        {hasResult && (
          <div style={{ border:`1px solid ${diffSec !== null ? diffColor+"40" : "#111120"}`, borderRadius:"8px", overflow:"hidden", background: diffSec !== null ? diffColor+"08" : "transparent" }}>
            <div style={{ padding:"8px 12px", borderBottom:`1px solid ${diffSec !== null ? diffColor+"20" : "#0e0e1a"}`, fontSize:"9px", letterSpacing:"4px", color: diffSec !== null ? diffColor+"99" : "#333" }}>TIME DIFFERENCE</div>
            <div style={{ padding:"12px" }}>
              {diffSec !== null ? (
                <>
                  <div style={{ display:"flex", alignItems:"baseline", gap:"8px" }}>
                    <span style={{ fontSize:"32px", color:diffColor, letterSpacing:"2px" }}>{fmtDiff(diffSec)}</span>
                    <span style={{ fontSize:"11px", color:diffColor+"99" }}>({diffSec >= 0 ? "+" : ""}{diffSec}秒)</span>
                  </div>
                  <div style={{ marginTop:"6px", fontSize:"10px", color:diffColor+"99" }}>
                    {Math.abs(diffSec) === 0 ? "✓ 完全一致" : diffSec > 0 ? `⚠ 時計が ${Math.abs(diffSec)}秒 進んでいます` : `⚠ 時計が ${Math.abs(diffSec)}秒 遅れています`}
                  </div>
                  <div style={{ marginTop:"8px", height:"2px", background:"#0e0e1a", borderRadius:"1px" }}>
                    <div style={{ height:"100%", borderRadius:"1px", background:diffColor, width: Math.min(100, Math.abs(diffSec)/120*100+2)+"%" }} />
                  </div>
                </>
              ) : (
                <div style={{ fontSize:"10px", color:"#333", lineHeight:1.8 }}>
                  撮影時刻 (EXIF) がないため計算できません<br />
                  <span style={{ fontSize:"9px", color:"#222" }}>カメラで撮影したJPEGを使用してください</span>
                </div>
              )}
            </div>
          </div>
        )}

        {hasResult && (
          <div style={{ border:"1px solid #c8a96e30", borderRadius:"6px", overflow:"hidden" }}>
            <button onClick={() => setShowCsv(v => !v)}
              style={{ width:"100%", padding:"12px", border:"none", background:"rgba(200,169,110,0.07)", color:"#c8a96e", fontSize:"11px", fontFamily:"'Courier New',monospace", letterSpacing:"3px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:"8px" }}>
              <span style={{ fontSize:"16px" }}>📊</span>
              {showCsv ? "▲ 閉じる" : "CSVデータを表示"}
            </button>
            {showCsv && (
              <div style={{ borderTop:"1px solid #c8a96e20", padding:"10px 12px", background:"#07070e" }}>
                <div style={{ fontSize:"9px", color:"#555", letterSpacing:"2px", marginBottom:"6px" }}>コピーして .csv に保存、またはExcelに直接貼り付け</div>
                <textarea readOnly value={csvText} onFocus={e => e.target.select()} onClick={e => e.target.select()}
                  style={{ width:"100%", height:"68px", background:"#0a0a14", border:"1px solid #8ab4f860", borderRadius:"4px", color:"#8ab4f8", fontFamily:"'Courier New',monospace", fontSize:"11px", padding:"8px", resize:"none", outline:"none", boxSizing:"border-box" }} />
                <div style={{ marginTop:"6px", padding:"7px 10px", background:"rgba(138,180,248,0.05)", border:"1px solid #8ab4f820", borderRadius:"4px", fontSize:"10px", color:"#555", lineHeight:1.8 }}>
                  ① テキストをタップ → 全選択される<br />
                  ② 長押し →「コピー」を選択<br />
                  ③ Excelのセルに貼り付け → <span style={{ color:"#8ab4f8" }}>タブ区切りで別セルに入ります</span>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
