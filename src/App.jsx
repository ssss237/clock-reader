import { useState, useCallback } from "react";

// ── EXIF parser ──
function parseExifDate(buffer) {
  try {
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off < view.byteLength - 4) {
      const marker = view.getUint16(off); off += 2;
      if (marker === 0xFFE1) {
        const segLen = view.getUint16(off);
        const sig = String.fromCharCode(view.getUint8(off+2),view.getUint8(off+3),view.getUint8(off+4),view.getUint8(off+5));
        if (sig === "Exif") {
          const base = off + 8;
          const little = view.getUint16(base) === 0x4949;
          const u16 = o => view.getUint16(base+o, little);
          const u32 = o => view.getUint32(base+o, little);
          const ascii = (o, len) => { let s=""; for(let i=0;i<len-1;i++){const b=view.getUint8(base+o+i);if(!b)break;s+=String.fromCharCode(b);} return s.trim(); };
          const parseDs = s => { const m=s.match(/(\d{4})\D(\d{2})\D(\d{2}).(\d{2}):(\d{2}):(\d{2})/); return m?new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]):null; };
          const scanIFD = ifdOff => {
            const n = u16(ifdOff);
            for (let i=0;i<Math.min(n,200);i++) {
              const e=ifdOff+2+i*12; if(e+12>view.byteLength-base) break;
              const tag=u16(e),cnt=u32(e+4);
              if ([0x9003,0x9004,0x0132].includes(tag)) { const d=parseDs(ascii(cnt<=4?e+8:u32(e+8),cnt)); if(d) return d; }
              if (tag===0x8769) { const d=scanIFD(u32(e+8)); if(d) return d; }
            }
            return null;
          };
          const d = scanIFD(u32(4)); if(d) return d;
        }
        off += segLen;
      } else if ((marker&0xFF00)===0xFF00) { if(off+2>view.byteLength) break; off+=view.getUint16(off); } else break;
    }
  } catch(_) {}
  return null;
}

// ── Method D: Ask Claude for pixel coordinates of hand tips ──
async function analyzeWithCoordinates(base64, mediaType, hint) {
  // プロンプトはサーバー側(api/analyze.js)で管理

  // Vercel Function経由でAPIキーを隠す
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64, mediaType, hint }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  const coords = data.result;

  // Convert % coords → angle from 12 o'clock
  const cx = coords.center_x, cy = coords.center_y;
  const toAngle = (tx, ty) => {
    const dx = tx - cx, dy = ty - cy;
    let deg = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    return Math.round(deg * 10) / 10;
  };

  const minuteAngle = toAngle(coords.minute_tip_x, coords.minute_tip_y);
  const hourAngle   = toAngle(coords.hour_tip_x,   coords.hour_tip_y);
  const secondAngle = coords.has_second
    ? toAngle(coords.second_tip_x, coords.second_tip_y) : null;

  const minute = Math.round(minuteAngle / 6) % 60;
  const hour   = Math.floor(hourAngle   / 30) % 12;
  const second = secondAngle !== null ? Math.round(secondAngle / 6) % 60 : 0;

  return {
    hour, minute, second,
    hour_angle: hourAngle,
    minute_angle: minuteAngle,
    second_angle: secondAngle,
    coords,
    notes: coords.notes || "",
  };
}

// ── Helpers ──
const fmt2   = n => String(n).padStart(2, "0");
const toSec  = (h, m, s) => h*3600 + m*60 + s;
function fmtDiff(d) {
  const a=Math.abs(d), h=Math.floor(a/3600), m=Math.floor((a%3600)/60), s=a%60, sg=d>=0?"+":"−";
  return h>0 ? sg+h+"h"+m+"m"+s+"s" : m>0 ? sg+m+"m"+s+"s" : sg+s+"s";
}

// ── Analog clock SVG ──
function ClockFace({ hour, minute, second, size = 160 }) {
  const r = size / 2 - 4;
  const cx = size / 2, cy = size / 2;
  const pt = (deg, len) => ({
    x: cx + Math.cos((deg - 90) * Math.PI / 180) * len,
    y: cy + Math.sin((deg - 90) * Math.PI / 180) * len,
  });
  const hDeg = (hour % 12) * 30 + minute * 0.5 + second / 120;
  const mDeg = minute * 6 + second * 0.1;
  const sDeg = second * 6;
  const hp = pt(hDeg, r * 0.52);
  const mp = pt(mDeg, r * 0.76);
  const sp = pt(sDeg, r * 0.82);
  const st = pt(sDeg + 180, r * 0.2);

  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r+2} fill="none" stroke="#1a1a28" strokeWidth="1"/>
      <circle cx={cx} cy={cy} r={r} fill="#08080f"/>
      {/* Minute ticks */}
      {Array.from({length:60},(_,i)=>{
        const p1=pt(i*6,r-2), p2=pt(i*6,r-(i%5===0?8:4));
        return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
          stroke={i%5===0?"#444":"#222"} strokeWidth={i%5===0?1.5:0.8}/>;
      })}
      {/* Hour numerals */}
      {[12,3,6,9].map((n,i)=>{
        const p=pt(i*90, r*0.78);
        return <text key={n} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
          fontSize="10" fill="#333" fontFamily="'Courier New',monospace">{n}</text>;
      })}
      {/* Hour hand */}
      <line x1={cx} y1={cy} x2={hp.x} y2={hp.y} stroke="#d4c9a8" strokeWidth="4" strokeLinecap="round"/>
      {/* Minute hand */}
      <line x1={cx} y1={cy} x2={mp.x} y2={mp.y} stroke="#d4c9a8" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Second hand */}
      <line x1={st.x} y1={st.y} x2={sp.x} y2={sp.y} stroke="#c8a96e" strokeWidth="1.2" strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r={3.5} fill="#c8a96e"/>
      <circle cx={cx} cy={cy} r={1.5} fill="#08080f"/>
    </svg>
  );
}

// ── Drum-roll style number picker ──
function Spinner({ value, min, max, onChange, color, label }) {
  const clamp = v => Math.max(min, Math.min(max, v));
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"4px" }}>
      <div style={{ fontSize:"9px", letterSpacing:"3px", color:"#444", textTransform:"uppercase" }}>{label}</div>
      <button onClick={() => onChange(clamp(value+1))}
        style={{ width:"52px", height:"28px", background:"transparent", border:"1px solid #1e1e28", borderRadius:"4px 4px 0 0", color:"#555", fontSize:"14px", cursor:"pointer", lineHeight:1 }}>
        ▲
      </button>
      <input
        type="number" min={min} max={max} value={value}
        onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) onChange(clamp(v)); }}
        onFocus={e => e.target.select()}
        style={{ width:"52px", height:"48px", background:"#0e0e1a",
          border:"1px solid "+color+"60", borderTop:"none", borderBottom:"none",
          color, fontSize:"22px", fontWeight:"300", fontFamily:"'Courier New',monospace",
          letterSpacing:"1px", textAlign:"center", outline:"none",
          appearance:"textfield", MozAppearance:"textfield" }}
      />
      <button onClick={() => onChange(clamp(value-1))}
        style={{ width:"52px", height:"28px", background:"transparent", border:"1px solid #1e1e28", borderRadius:"0 0 4px 4px", color:"#555", fontSize:"14px", cursor:"pointer", lineHeight:1 }}>
        ▼
      </button>
    </div>
  );
}

// ── Main ──

// ── Crop image to clock face for preview ──
function cropToClockFace(imgEl) {
  const sw = imgEl.width, sh = imgEl.height;

  // Step 1: find clock center by looking for the most "circular" dense region
  // Use a coarse grid search: for each candidate center, count edge pixels on a circle
  const SCAN = document.createElement("canvas");
  const SC = 300; // work at 300px for speed
  const scale = SC / Math.max(sw, sh);
  SCAN.width  = Math.round(sw * scale);
  SCAN.height = Math.round(sh * scale);
  const sctx = SCAN.getContext("2d");
  sctx.drawImage(imgEl, 0, 0, SCAN.width, SCAN.height);
  const pix = sctx.getImageData(0, 0, SCAN.width, SCAN.height).data;
  const W = SCAN.width, H = SCAN.height;

  const brightness = (x, y) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return 128;
    const i = (y * W + x) * 4;
    return (pix[i] + pix[i+1] + pix[i+2]) / 3;
  };

  // Try candidate centers around the image center
  let bestCx = W/2, bestCy = H/2, bestR = Math.min(W,H)*0.35, bestScore = -1;

  for (let cy = Math.round(H*0.25); cy <= Math.round(H*0.75); cy += 8) {
    for (let cx = Math.round(W*0.25); cx <= Math.round(W*0.75); cx += 8) {
      // Try a radius = ~35-45% of min dimension
      for (const rFrac of [0.30, 0.35, 0.40, 0.43]) {
        const r = Math.round(Math.min(W,H) * rFrac);
        // Sample brightness variance on the ring → high variance = edge of clock bezel
        let samples = [], sum = 0;
        const N = 48;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * 2 * Math.PI;
          const b = brightness(Math.round(cx + Math.cos(a)*r), Math.round(cy + Math.sin(a)*r));
          samples.push(b); sum += b;
        }
        const mean = sum / N;
        const variance = samples.reduce((s,v) => s + (v-mean)**2, 0) / N;
        // Also reward: interior should be brighter/flatter than edge
        let innerSum = 0, innerN = 0;
        for (let i = 0; i < 16; i++) {
          const a = (i/16)*2*Math.PI;
          for (const rf of [0.3,0.5,0.7]) {
            innerSum += brightness(Math.round(cx+Math.cos(a)*r*rf), Math.round(cy+Math.sin(a)*r*rf));
            innerN++;
          }
        }
        const innerMean = innerSum / innerN;
        const score = variance * 0.5 + Math.abs(innerMean - 128) * 0.2;
        if (score > bestScore) { bestScore = score; bestCx = cx; bestCy = cy; bestR = r; }
      }
    }
  }

  // Scale back to original image coordinates
  const origCx = bestCx / scale;
  const origCy = bestCy / scale;
  const origR  = bestR  / scale;

  // Crop with 15% padding around detected radius
  const pad  = origR * 1.18;
  const left = Math.max(0, origCx - pad);
  const top  = Math.max(0, origCy - pad);
  const size = Math.min(sw - left, sh - top, pad * 2, origCx + pad, origCy + pad);

  // Output cropped square canvas
  const OUT = 420;
  const out = document.createElement("canvas");
  out.width = OUT; out.height = OUT;
  const octx = out.getContext("2d");
  octx.drawImage(imgEl, left, top, size, size, 0, 0, OUT, OUT);
  return out.toDataURL("image/jpeg", 0.92);
}


// ── Build TSV string (タブ区切り → Excelに貼り付けで別セル認識) ──
function buildCsv(row) {
  const CRLF = "\r\n";
  const TAB  = "\t";
  return "画像撮影時刻(EXIF)" + TAB + "時計誤差(秒)" + CRLF
    + (row.photoTime || "") + TAB + (row.diffSec == null ? "" : row.diffSec) + CRLF;
}



export default function ClockReaderV2() {
  const [image,     setImage]     = useState(null);
  const [preview,   setPreview]   = useState(null); // cropped clock face
  const [base64,    setBase64]    = useState(null);
  const [mediaType, setMediaType] = useState(null);
  const [photoDate, setPhotoDate] = useState(null);

  const [status,    setStatus]    = useState("idle"); // idle | analyzing | done | error
  const [aiResult,  setAiResult]  = useState(null);
  const [error,     setError]     = useState(null);
  const [hint,      setHint]      = useState("");
  const [showHint,  setShowHint]  = useState(false);
  const [showCoords,setShowCoords]= useState(false);
  const [exportRows, setExportRows] = useState([]);
  const [csvText, setCsvText] = useState(null);

  // Manual time
  const [mH, setMH] = useState(0);
  const [mM, setMM] = useState(0);
  const [mS, setMS] = useState(0);
  const [mode, setMode] = useState("ai"); // "ai" | "manual"

  const loadFile = useCallback((file) => {
    if (!file?.type.startsWith("image/")) return;
    setStatus("idle"); setAiResult(null); setError(null); setMode("ai"); setPreview(null);

    // 1) Read EXIF from ArrayBuffer
    const r2 = new FileReader();
    r2.onload = e => { try { setPhotoDate(parseExifDate(e.target.result)); } catch(_){} };
    r2.readAsArrayBuffer(file);

    // 2) Read as DataURL — everything else happens inside onload
    const r1 = new FileReader();
    r1.onload = e => {
      const originalUrl = e.target.result;

      const img = new Image();
      img.onload = () => {
        // Show preview immediately (original)
        setImage(originalUrl);

        // 3) Compress for API (max 1600px, under 5MB)
        const MAX = 1600;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          const sc = Math.min(MAX/w, MAX/h);
          w = Math.round(w*sc); h = Math.round(h*sc);
        }
        const c1 = document.createElement("canvas");
        c1.width = w; c1.height = h;
        c1.getContext("2d").drawImage(img, 0, 0, w, h);
        let quality = 0.85;
        let dataUrl = c1.toDataURL("image/jpeg", quality);
        while (dataUrl.length > 6_500_000 && quality > 0.4) {
          quality -= 0.1;
          dataUrl = c1.toDataURL("image/jpeg", quality);
        }
        setBase64(dataUrl.split(",")[1]);
        setMediaType("image/jpeg");

        // 4) Generate cropped clock-face preview
        try {
          setPreview(cropToClockFace(img));
        } catch(_) {
          setPreview(null);
        }
      };
      img.onerror = () => setImage(originalUrl); // fallback
      img.src = originalUrl;
    };
    r1.readAsDataURL(file);
  }, []);

  const analyze = async () => {
    if (!base64) return;
    setStatus("analyzing"); setError(null);
    try {
      const result = await analyzeWithCoordinates(base64, mediaType, hint);
      setAiResult(result);
      setMH(result.hour); setMM(result.minute); setMS(result.second);
      setStatus("done"); setMode("ai");
      // Pre-save the AI row (will be updated on export)
      setExportRows(prev => [...prev, { _id: Date.now(), result }]);
    } catch(e) {
      setError(e.message); setStatus("error");
    }
  };

  const dispH = mode === "manual" ? mH : (aiResult?.hour   ?? 0);
  const dispM = mode === "manual" ? mM : (aiResult?.minute ?? 0);
  const dispS = mode === "manual" ? mS : (aiResult?.second ?? 0);
  const timeStr = fmt2(dispH) + ":" + fmt2(dispM) + ":" + fmt2(dispS);

  let diffSec = null, photoStr = null;
  if ((status==="done"||mode==="manual") && photoDate) {
    const cS = toSec(dispH, dispM, dispS);
    const pS = toSec(photoDate.getHours(), photoDate.getMinutes(), photoDate.getSeconds());
    diffSec = cS - pS;
    if (diffSec > 43200) diffSec -= 86400;
    if (diffSec < -43200) diffSec += 86400;
    photoStr = fmt2(photoDate.getHours())+":"+fmt2(photoDate.getMinutes())+":"+fmt2(photoDate.getSeconds());
  }

  const diffColor = diffSec === null ? "#444"
    : Math.abs(diffSec) <= 5  ? "#00e5a0"
    : Math.abs(diffSec) <= 30 ? "#7ecf8e"
    : Math.abs(diffSec) <= 60 ? "#f0c040"
    : "#ff7055";

  const isAnalyzing = status === "analyzing";
  const hasDone = status === "done";

  return (
    <div style={{ minHeight:"100vh", background:"#05050d", color:"#d4cfc7",
      fontFamily:"'Courier New', Courier, monospace", padding:"0" }}>

      {/* Subtle noise texture overlay */}
      <div style={{ position:"fixed", inset:0, opacity:0.025, pointerEvents:"none",
        backgroundImage:"radial-gradient(circle at 20% 50%, #c8a96e22 0%, transparent 60%), radial-gradient(circle at 80% 20%, #8ab4f822 0%, transparent 50%)" }}/>

      {/* Header bar */}
      <div style={{ borderBottom:"1px solid #0f0f1a", padding:"14px 20px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        background:"#05050d", position:"sticky", top:0, zIndex:10, paddingTop:"env(safe-area-inset-top)" }}>
        <div>
          <div style={{ fontSize:"9px", letterSpacing:"6px", color:"#333" }}>HOROLOGICAL INSTRUMENT</div>
          <div style={{ fontSize:"16px", fontWeight:"300", letterSpacing:"2px", color:"#d4cfc7", marginTop:"2px" }}>
            時計読み取り<span style={{ color:"#c8a96e" }}>精密システム</span>
          </div>
        </div>
        <div style={{ fontSize:"9px", color:"#222", letterSpacing:"2px", textAlign:"right" }}>
          METHOD D<br/>座標指定方式
        </div>
      </div>

      <div style={{ maxWidth:"820px", margin:"0 auto", padding:"20px 14px",
        display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px" }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>

          {/* Upload */}
          <div style={{ border:"1px solid #111120", borderRadius:"6px", overflow:"hidden" }}>
            <div style={{ padding:"8px 12px", borderBottom:"1px solid #0e0e1a",
              fontSize:"9px", letterSpacing:"4px", color:"#333" }}>IMAGE INPUT</div>
            {(preview || image) && (
              <div style={{ position:"relative", background:"#030308" }}>
                <img src={preview || image} alt="clock"
                  style={{ width:"100%", maxHeight:"320px", objectFit:"contain", display:"block" }}/>
                {preview && (
                  <div style={{ position:"absolute", bottom:"6px", right:"8px",
                    fontSize:"8px", letterSpacing:"2px", color:"#333",
                    background:"rgba(0,0,0,0.6)", padding:"2px 6px", borderRadius:"2px" }}>
                    AUTO CROP
                  </div>
                )}
              </div>
            )}
            <div style={{ display:"flex", borderTop: image ? "1px solid #0e0e1a" : "none" }}>
              <label style={{ flex:1, padding:"12px 8px", cursor:"pointer",
                background:"rgba(200,169,110,0.06)", borderRight:"1px solid #0e0e1a",
                display:"flex", flexDirection:"column", alignItems:"center", gap:"4px",
                color:"#c8a96e", fontSize:"11px", letterSpacing:"1px" }}>
                <span style={{ fontSize:"20px" }}>📷</span>
                <span>カメラ</span>
                <input type="file" accept="image/*" capture="environment"
                  onChange={e => { if(e.target.files[0]) loadFile(e.target.files[0]); }}
                  style={{ display:"none" }}/>
              </label>
              <label style={{ flex:1, padding:"12px 8px", cursor:"pointer",
                background:"rgba(255,255,255,0.02)",
                display:"flex", flexDirection:"column", alignItems:"center", gap:"4px",
                color:"#666", fontSize:"11px", letterSpacing:"1px" }}>
                <span style={{ fontSize:"20px" }}>🖼️</span>
                <span>ギャラリー</span>
                <input type="file" accept="image/*"
                  onChange={e => { if(e.target.files[0]) loadFile(e.target.files[0]); }}
                  style={{ display:"none" }}/>
              </label>
            </div>
          </div>

          {/* EXIF */}
          {image && (
            <div style={{ padding:"10px 12px", border:"1px solid #111120", borderRadius:"6px",
              fontSize:"10px", display:"flex", alignItems:"center", gap:"8px" }}>
              <div style={{ width:"5px", height:"5px", borderRadius:"50%",
                background: photoDate ? "#00e5a0" : "#222", flexShrink:0 }}/>
              <span style={{ color:"#333", letterSpacing:"1px" }}>EXIF</span>
              {photoDate
                ? <span style={{ color:"#8ab4f8" }}>
                    {photoDate.getFullYear()}/{fmt2(photoDate.getMonth()+1)}/{fmt2(photoDate.getDate())}
                    {" "}{fmt2(photoDate.getHours())}:{fmt2(photoDate.getMinutes())}:{fmt2(photoDate.getSeconds())}
                  </span>
                : <span style={{ color:"#1e1e2a" }}>撮影情報なし</span>
              }
            </div>
          )}

          {/* Analyze button */}
          {image && (
            <button onClick={analyze} disabled={isAnalyzing}
              style={{ padding:"14px", border:"none", borderRadius:"6px", cursor: isAnalyzing?"not-allowed":"pointer",
                background: isAnalyzing ? "#0e0e1a" : "linear-gradient(135deg, #c8a96e 0%, #9a7a45 100%)",
                color: isAnalyzing ? "#333" : "#05050d",
                fontSize:"11px", fontFamily:"'Courier New',monospace", letterSpacing:"4px",
                fontWeight:"700", textTransform:"uppercase", transition:"all 0.2s" }}>
              {isAnalyzing ? "座標を解析中..." : hasDone ? "▶ 再解析" : "▶ 時刻を読み取る"}
            </button>
          )}

          {/* Hint */}
          {image && (
            <div style={{ border:"1px solid #111120", borderRadius:"6px", overflow:"hidden" }}>
              <button onClick={() => setShowHint(v=>!v)}
                style={{ width:"100%", padding:"9px 12px", background:"transparent", border:"none",
                  color:"#444", fontSize:"9px", letterSpacing:"3px", cursor:"pointer",
                  display:"flex", justifyContent:"space-between", fontFamily:"'Courier New',monospace" }}>
                <span>💬 AIへのヒント</span><span>{showHint?"▲":"▼"}</span>
              </button>
              {showHint && (
                <div style={{ padding:"10px 12px", borderTop:"1px solid #0e0e1a" }}>
                  <textarea value={hint} onChange={e=>setHint(e.target.value)}
                    placeholder='例: "秒針は青い" "時針は7時付近" "分針は44分"'
                    style={{ width:"100%", background:"#08080f", border:"1px solid #1e1e28",
                      borderRadius:"4px", color:"#888", fontFamily:"'Courier New',monospace",
                      fontSize:"10px", padding:"8px", resize:"vertical", minHeight:"52px",
                      outline:"none", boxSizing:"border-box" }}/>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding:"10px 12px", border:"1px solid #ff705540",
              borderRadius:"6px", background:"rgba(255,112,85,0.06)",
              fontSize:"10px", color:"#ff7055", lineHeight:1.7 }}>{error}</div>
          )}

          {/* Coordinate debug */}
          {hasDone && aiResult?.coords && (
            <div style={{ border:"1px solid #111120", borderRadius:"6px", overflow:"hidden" }}>
              <button onClick={() => setShowCoords(v=>!v)}
                style={{ width:"100%", padding:"9px 12px", background:"transparent", border:"none",
                  color:"#333", fontSize:"9px", letterSpacing:"3px", cursor:"pointer",
                  display:"flex", justifyContent:"space-between", fontFamily:"'Courier New',monospace" }}>
                <span>📍 AIが検出した座標</span><span>{showCoords?"▲":"▼"}</span>
              </button>
              {showCoords && (
                <div style={{ padding:"10px 12px", borderTop:"1px solid #0e0e1a" }}>
                  {[
                    ["中心",   aiResult.coords.center_x,    aiResult.coords.center_y,    "#888"],
                    ["分針先端", aiResult.coords.minute_tip_x, aiResult.coords.minute_tip_y, "#8ab4f8"],
                    ["時針先端", aiResult.coords.hour_tip_x,   aiResult.coords.hour_tip_y,   "#c8a96e"],
                    aiResult.coords.has_second
                      ? ["秒針先端", aiResult.coords.second_tip_x, aiResult.coords.second_tip_y, "#00e5a0"]
                      : null,
                  ].filter(Boolean).map(([label, x, y, color]) => (
                    <div key={label} style={{ display:"flex", gap:"8px", fontSize:"10px",
                      marginBottom:"4px", alignItems:"center" }}>
                      <div style={{ width:"5px", height:"5px", borderRadius:"50%", background:color, flexShrink:0 }}/>
                      <span style={{ color:"#444", width:"60px" }}>{label}</span>
                      <span style={{ color }}>x={x}% y={y}%</span>
                    </div>
                  ))}
                  {aiResult.coords.has_second === false && (
                    <div style={{ fontSize:"10px", color:"#333", marginTop:"4px" }}>秒針: 未検出</div>
                  )}
                  {aiResult.notes && (
                    <div style={{ marginTop:"8px", fontSize:"9px", color:"#333", lineHeight:1.7,
                      borderTop:"1px solid #0e0e1a", paddingTop:"6px" }}>
                      {aiResult.notes}
                    </div>
                  )}
                  <div style={{ marginTop:"8px", fontSize:"9px", color:"#2a2a38",
                    borderTop:"1px solid #0e0e1a", paddingTop:"6px" }}>
                    算出角度 — 分:{aiResult.minute_angle}° 時:{aiResult.hour_angle}°
                    {aiResult.second_angle !== null ? " 秒:"+aiResult.second_angle+"°" : ""}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>

          {/* Clock face + time display */}
          <div style={{ border:"1px solid #111120", borderRadius:"6px",
            background:"#07070e", overflow:"hidden" }}>
            <div style={{ padding:"8px 12px", borderBottom:"1px solid #0e0e1a",
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontSize:"9px", letterSpacing:"4px", color:"#333" }}>
                {mode==="manual" ? "MANUAL CORRECTION" : "AI READING"}
              </div>
              {hasDone && (
                <div style={{ display:"flex", gap:"6px" }}>
                  {["ai","manual"].map(m => (
                    <button key={m} onClick={() => setMode(m)}
                      style={{ padding:"3px 10px", fontSize:"8px", letterSpacing:"2px",
                        fontFamily:"'Courier New',monospace", cursor:"pointer", borderRadius:"20px",
                        border:"1px solid "+(mode===m?"#c8a96e":"#1e1e28"),
                        background: mode===m?"#c8a96e":"transparent",
                        color: mode===m?"#05050d":"#444" }}>
                      {m==="ai"?"AI":"手動"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding:"20px", display:"flex", flexDirection:"column", alignItems:"center", gap:"16px" }}>
              <ClockFace hour={dispH} minute={dispM} second={dispS} size={150}/>

              {/* Big time readout */}
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:"42px", fontWeight:"200", letterSpacing:"4px",
                  color: mode==="manual" ? "#8ab4f8" : "#c8a96e", lineHeight:1,
                  fontVariantNumeric:"tabular-nums" }}>
                  {status==="idle" ? "--:--:--" : timeStr}
                </div>
                {(hasDone || mode==="manual") && (
                  <div style={{ fontSize:"11px", color:"#333", marginTop:"6px", letterSpacing:"1px" }}>
                    {dispH>=12?"午後":"午前"}{fmt2(dispH>12?dispH-12:dispH||12)}時{fmt2(dispM)}分{fmt2(dispS)}秒
                  </div>
                )}
              </div>

              {/* Analyzing indicator */}
              {isAnalyzing && (
                <div style={{ fontSize:"10px", color:"#555", letterSpacing:"3px",
                  animation:"pulse 1.4s ease-in-out infinite" }}>
                  COORDINATE ANALYSIS...
                </div>
              )}
            </div>
          </div>

          {/* Manual correction spinners */}
          {hasDone && (
            <div style={{ border:"1px solid "+(mode==="manual"?"#8ab4f840":"#111120"),
              borderRadius:"6px", overflow:"hidden", transition:"border-color 0.3s" }}>
              <div style={{ padding:"8px 12px", borderBottom:"1px solid #0e0e1a",
                fontSize:"9px", letterSpacing:"4px", color: mode==="manual"?"#8ab4f8":"#333" }}>
                MANUAL CORRECTION
              </div>
              <div style={{ padding:"16px 20px" }}>
                <div style={{ display:"flex", gap:"12px", justifyContent:"center",
                  alignItems:"center", marginBottom:"14px" }}>
                  <Spinner label="時" value={mH} min={0} max={23} onChange={v=>{setMH(v);setMode("manual");}} color="#c8a96e"/>
                  <div style={{ color:"#333", fontSize:"28px", fontWeight:"100", paddingBottom:"18px" }}>:</div>
                  <Spinner label="分" value={mM} min={0} max={59} onChange={v=>{setMM(v);setMode("manual");}} color="#8ab4f8"/>
                  <div style={{ color:"#333", fontSize:"28px", fontWeight:"100", paddingBottom:"18px" }}>:</div>
                  <Spinner label="秒" value={mS} min={0} max={59} onChange={v=>{setMS(v);setMode("manual");}} color="#00e5a0"/>
                </div>
                <div style={{ display:"flex", gap:"8px" }}>
                  <button onClick={() => { setMH(aiResult.hour); setMM(aiResult.minute); setMS(aiResult.second); setMode("ai"); }}
                    style={{ flex:1, padding:"7px", background:"transparent",
                      border:"1px solid #1e1e28", borderRadius:"4px", color:"#444",
                      fontSize:"9px", letterSpacing:"2px", cursor:"pointer",
                      fontFamily:"'Courier New',monospace" }}>
                    ← AI値に戻す
                  </button>
                  <button onClick={() => setMode("manual")}
                    style={{ flex:1, padding:"7px",
                      background: mode==="manual"?"rgba(138,180,248,0.1)":"transparent",
                      border:"1px solid "+(mode==="manual"?"#8ab4f850":"#1e1e28"),
                      borderRadius:"4px", color: mode==="manual"?"#8ab4f8":"#444",
                      fontSize:"9px", letterSpacing:"2px", cursor:"pointer",
                      fontFamily:"'Courier New',monospace" }}>
                    補正値を採用
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Diff display */}
          {(hasDone || mode==="manual") && (
            <div style={{ border:"1px solid "+(diffSec!==null?diffColor+"40":"#111120"),
              borderRadius:"6px", overflow:"hidden",
              background: diffSec!==null ? diffColor+"08" : "transparent",
              transition:"all 0.4s" }}>
              <div style={{ padding:"8px 12px", borderBottom:"1px solid "+(diffSec!==null?diffColor+"20":"#0e0e1a"),
                fontSize:"9px", letterSpacing:"4px", color: diffSec!==null?diffColor+"99":"#333" }}>
                TIME DIFFERENCE
              </div>
              <div style={{ padding:"14px 16px" }}>
                {diffSec !== null ? (
                  <>
                    <div style={{ display:"flex", alignItems:"baseline", gap:"10px", marginBottom:"8px" }}>
                      <div style={{ fontSize:"36px", fontWeight:"200", color:diffColor,
                        letterSpacing:"2px", lineHeight:1 }}>
                        {fmtDiff(diffSec)}
                      </div>
                      <div style={{ fontSize:"11px", color:"#333" }}>
                        ({diffSec>=0?"+":""}{diffSec}秒)
                      </div>
                    </div>
                    <div style={{ fontSize:"10px", lineHeight:2, color:"#444" }}>
                      <span style={{ color: mode==="manual"?"#8ab4f8":"#c8a96e" }}>
                        🕐 {mode==="manual"?"手動":"AI"}: {timeStr}
                      </span>
                      {"　"}
                      <span style={{ color:"#8ab4f8" }}>📷 撮影: {photoStr}</span>
                    </div>
                    <div style={{ marginTop:"8px", fontSize:"11px", color:diffColor }}>
                      {Math.abs(diffSec)===0 ? "✓ 完全一致"
                        : diffSec>0 ? "⚠ 時計が "+Math.abs(diffSec)+"秒 進んでいます"
                        : "⚠ 時計が "+Math.abs(diffSec)+"秒 遅れています"}
                    </div>
                    {/* Bar */}
                    <div style={{ marginTop:"10px", height:"2px", background:"#0e0e1a", borderRadius:"1px" }}>
                      <div style={{ height:"100%", borderRadius:"1px", background:diffColor, transition:"width 0.6s",
                        width: Math.min(100, Math.abs(diffSec)/120*100+2)+"%" }}/>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize:"10px", color:"#222", lineHeight:1.8 }}>
                    撮影時刻 (EXIF) がないため計算できません<br/>
                    <span style={{ fontSize:"9px", color:"#191922" }}>カメラで撮影したJPEGを使用してください</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── CSV表示 ── */}
          {hasDone && (
            <div style={{ border:"1px solid #c8a96e30", borderRadius:"6px", overflow:"hidden" }}>
              <button
                onClick={() => {
                  const pad = n => String(n).padStart(2,"0");
                  const photoTime = photoDate
                    ? `${photoDate.getFullYear()}/${pad(photoDate.getMonth()+1)}/${pad(photoDate.getDate())} ${pad(photoDate.getHours())}:${pad(photoDate.getMinutes())}:${pad(photoDate.getSeconds())}`
                    : "";
                  const csv = buildCsv({ photoTime, diffSec });
                  setCsvText(v => v === null ? csv : null);
                }}
                style={{ width:"100%", padding:"12px", border:"none",
                  background:"rgba(200,169,110,0.07)", color:"#c8a96e",
                  fontSize:"11px", fontFamily:"'Courier New',monospace",
                  letterSpacing:"3px", cursor:"pointer",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:"8px" }}>
                <span style={{ fontSize:"16px" }}>📊</span>
                {csvText !== null ? "▲ 閉じる" : "CSVデータを表示"}
              </button>
              {csvText !== null && (
                <div style={{ borderTop:"1px solid #c8a96e20", padding:"10px 12px", background:"#07070e" }}>
                  <div style={{ fontSize:"9px", color:"#555", letterSpacing:"2px", marginBottom:"6px" }}>
                    コピーして .csv に保存、またはExcelに直接貼り付け
                  </div>
                  <textarea
                    readOnly
                    value={csvText}
                    onFocus={e => e.target.select()}
                    onClick={e => e.target.select()}
                    style={{ width:"100%", height:"68px", background:"#0a0a14",
                      border:"1px solid #8ab4f860", borderRadius:"4px",
                      color:"#8ab4f8", fontFamily:"'Courier New',monospace",
                      fontSize:"11px", padding:"8px", resize:"none",
                      outline:"none", boxSizing:"border-box" }}
                  />
                  <div style={{ marginTop:"6px", padding:"7px 10px",
                    background:"rgba(138,180,248,0.05)", border:"1px solid #8ab4f820",
                    borderRadius:"4px", fontSize:"10px", color:"#555", lineHeight:1.8 }}>
                    ① テキストをタップ → 全選択される<br/>
                    ② 長押し →「コピー」を選択<br/>
                    ③ Excelのセルに貼り付け → <span style={{color:"#8ab4f8"}}>タブ区切りで別セルに入ります</span>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
        * { -webkit-tap-highlight-color: transparent; }
        input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
        input[type=file] { font-size:11px; }
      `}</style>
    </div>
  );
}
