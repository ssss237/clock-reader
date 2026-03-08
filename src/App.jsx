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

export default function ClockReaderApp() {
  const [image,     setImage]    = useState(null);
  const [preview,   setPreview]  = useState(null);
  const [photoDate, setPhotoDate]= useState(null);
  const [mH, setMH] = useState(12);
  const [mM, setMM] = useState(0);
  const [mS, setMS] = useState(0);
  const [hasResult, setHasResult]= useState(false);
  const [csvText,   setCsvText]  = useState(null);

  const dispH = mH, dispM = mM, dispS = mS;

  const photoSec = photoDate
    ? photoDate.getHours()*3600 + photoDate.getMinutes()*60 + photoDate.getSeconds()
    : null;
  const clockSec = dispH*3600 + dispM*60 + dispS;
  const diffSec  = photoSec !== null ? Math.round(clockSec - photoSec) : null;
  const fmt2b = n => String(n).padStart(2,"0");
  const photoTimeStr = photoDate
    ? `${photoDate.getFullYear()}/${fmt2b(photoDate.getMonth()+1)}/${fmt2b(photoDate.getDate())} ${fmt2b(photoDate.getHours())}:${fmt2b(photoDate.getMinutes())}:${fmt2b(photoDate.getSeconds())}`
    : "";
  const csvText = buildCsv({ photoTime: photoTimeStr, diffSec });
  const diffColor = diffSec === null ? "#555"
    : Math.abs(diffSec) <= 5  ? "#00e5a0"
    : Math.abs(diffSec) <= 60 ? "#f5a623"
    : "#e05555";

  const loadFile = useCallback(e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const buf = ev.target.result;
      const date = parseExifDate(buf);
      if (date) {
        setPhotoDate(date);
        setMH(date.getHours());
        setMM(date.getMinutes());
        setMS(date.getSeconds());
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        setImage(url);
        const cropped = cropToClockFace(img);
        setPreview(cropped);
        setHasResult(true);
      };
      img.src = url;
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const fmt2 = n => String(n).padStart(2,"0");

  return (
    <div style={{ minHeight:"100vh", background:"#05050d", color:"#e8e0d0",
      fontFamily:"'Courier New',monospace", display:"flex", flexDirection:"column" }}>

      {/* Header */}
      <div style={{ padding:"16px 20px", borderBottom:"1px solid #0e0e1a",
        background:"#05050d", position:"sticky", top:0, zIndex:10,
        paddingTop:"env(safe-area-inset-top)" }}>
        <div style={{ fontSize:"11px", letterSpacing:"6px", color:"#c8a96e" }}>
          ANALOG CLOCK READER
        </div>
        <div style={{ fontSize:"9px", letterSpacing:"3px", color:"#333", marginTop:"3px" }}>
          手動入力モード
        </div>
      </div>

      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:"12px",
        padding:"16px", maxWidth:"480px", width:"100%", margin:"0 auto", boxSizing:"border-box" }}>

        {/* Upload */}
        <div style={{ border:"1px solid #1a1a28", borderRadius:"8px", overflow:"hidden" }}>
          <div style={{ padding:"8px 12px", fontSize:"9px", letterSpacing:"4px",
            color:"#444", borderBottom:"1px solid #0e0e1a" }}>IMAGE</div>
          <div style={{ padding:"12px", display:"flex", gap:"10px" }}>
            <label style={{ flex:1, padding:"12px", border:"1px solid #c8a96e40",
              borderRadius:"6px", background:"rgba(200,169,110,0.06)", color:"#c8a96e",
              fontSize:"11px", letterSpacing:"2px", cursor:"pointer", textAlign:"center",
              display:"block" }}>
              📷 カメラ
              <input type="file" accept="image/*" capture="environment"
                onChange={loadFile} style={{ display:"none" }} />
            </label>
            <label style={{ flex:1, padding:"12px", border:"1px solid #c8a96e40",
              borderRadius:"6px", background:"rgba(200,169,110,0.06)", color:"#c8a96e",
              fontSize:"11px", letterSpacing:"2px", cursor:"pointer", textAlign:"center",
              display:"block" }}>
              🖼 ギャラリー
              <input type="file" accept="image/*"
                onChange={loadFile} style={{ display:"none" }} />
            </label>
          </div>
          {preview && (
            <div style={{ padding:"0 12px 12px" }}>
              <img src={preview} alt="preview"
                style={{ width:"100%", borderRadius:"6px", border:"1px solid #1a1a28" }} />
              {photoDate && (
                <div style={{ marginTop:"8px", fontSize:"10px", color:"#888",
                  letterSpacing:"2px", textAlign:"center" }}>
                  📅 {photoDate.getFullYear()}/{fmt2(photoDate.getMonth()+1)}/{fmt2(photoDate.getDate())} {fmt2(photoDate.getHours())}:{fmt2(photoDate.getMinutes())}:{fmt2(photoDate.getSeconds())}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Clock face + manual input */}
        <div style={{ border:"1px solid #1a1a28", borderRadius:"8px", overflow:"hidden" }}>
          <div style={{ padding:"8px 12px", fontSize:"9px", letterSpacing:"4px",
            color:"#444", borderBottom:"1px solid #0e0e1a" }}>MANUAL INPUT</div>
          <div style={{ padding:"16px", display:"flex", flexDirection:"column",
            alignItems:"center", gap:"16px" }}>
            <ClockFace hour={dispH} minute={dispM} second={dispS} size={180} />
            <div style={{ fontSize:"28px", letterSpacing:"4px", color:"#e8e0d0",
              fontVariantNumeric:"tabular-nums" }}>
              {fmt2(dispH)}:{fmt2(dispM)}:{fmt2(dispS)}
            </div>
            <div style={{ display:"flex", gap:"16px", justifyContent:"center" }}>
              <Spinner value={mH} min={0} max={23} onChange={setMH} color="#c8a96e" label="時" />
              <Spinner value={mM} min={0} max={59} onChange={setMM} color="#8ab4f8" label="分" />
              <Spinner value={mS} min={0} max={59} onChange={setMS} color="#00e5a0" label="秒" />
            </div>
          </div>
        </div>

        {/* Time difference */}
        {hasResult && (
          <div style={{ border:"1px solid "+(diffSec!==null ? diffColor+"40" : "#111120"),
            borderRadius:"8px", overflow:"hidden",
            background: diffSec!==null ? diffColor+"08" : "transparent" }}>
            <div style={{ padding:"8px 12px", borderBottom:"1px solid "+(diffSec!==null?diffColor+"20":"#0e0e1a"),
              fontSize:"9px", letterSpacing:"4px", color: diffSec!==null?diffColor+"99":"#333" }}>
              TIME DIFFERENCE
            </div>
            <div style={{ padding:"12px" }}>
              {diffSec !== null ? (
                <>
                  <div style={{ display:"flex", alignItems:"baseline", gap:"8px" }}>
                    <span style={{ fontSize:"32px", color: diffColor, letterSpacing:"2px",
                      fontVariantNumeric:"tabular-nums" }}>{fmtDiff(diffSec)}</span>
                    <span style={{ fontSize:"11px", color: diffColor+"99" }}>
                      ({diffSec>=0?"+":""}{diffSec}秒)
                    </span>
                  </div>
                  <div style={{ marginTop:"6px", fontSize:"10px", color: diffColor+"99" }}>
                    {Math.abs(diffSec)===0 ? "✓ 完全一致"
                      : diffSec>0 ? "⚠ 時計が "+Math.abs(diffSec)+"秒 進んでいます"
                      : "⚠ 時計が "+Math.abs(diffSec)+"秒 遅れています"}
                  </div>
                  <div style={{ marginTop:"8px", height:"2px", background:"#0e0e1a", borderRadius:"1px" }}>
                    <div style={{ height:"100%", borderRadius:"1px", background: diffColor,
                      width: Math.min(100, Math.abs(diffSec)/120*100+2)+"%" }}/>
                  </div>
                </>
              ) : (
                <div style={{ fontSize:"10px", color:"#333", lineHeight:1.8 }}>
                  撮影時刻 (EXIF) がないため計算できません<br/>
                  <span style={{ fontSize:"9px", color:"#222" }}>カメラで撮影したJPEGを使用してください</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* CSV export */}
        {hasResult && (
          <div style={{ border:"1px solid #c8a96e30", borderRadius:"6px", overflow:"hidden" }}>
            <button
              onClick={() => { setShowCsv(v => !v); }}
              style={{ width:"100%", padding:"12px", border:"none",
                background:"rgba(200,169,110,0.07)", color:"#c8a96e",
                fontSize:"11px", fontFamily:"'Courier New',monospace",
                letterSpacing:"3px", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:"8px" }}>
              <span style={{ fontSize:"16px" }}>📊</span>
              {showCsv ? "▲ 閉じる" : "CSVデータを表示"}
            </button>
            {showCsv && (
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

      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
        input[type=file] { font-size:11px; }
      `}</style>
    </div>
  );
}
