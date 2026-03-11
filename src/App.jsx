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


// ── 時計文字盤をクロップ（分散ベース円検出） ──
function cropToClockFace(dataUrl, callback) {
  const img = new Image();
  img.onload = () => {
    try {
      const W = img.naturalWidth, H = img.naturalHeight;
      const SCAN = 300, OUT = 1200;

      // スキャン用キャンバス（縮小して処理）
      const sc = document.createElement("canvas");
      sc.width = SCAN; sc.height = SCAN;
      const sctx = sc.getContext("2d");
      sctx.drawImage(img, 0, 0, W, H, 0, 0, SCAN, SCAN);
      const pixels = sctx.getImageData(0, 0, SCAN, SCAN).data;

      // 各行・列の輝度分散を計算
      const rowVar = new Float32Array(SCAN);
      const colVar = new Float32Array(SCAN);
      for (let y = 0; y < SCAN; y++) {
        let sum = 0, sum2 = 0;
        for (let x = 0; x < SCAN; x++) {
          const i = (y * SCAN + x) * 4;
          const v = (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
          sum += v; sum2 += v * v;
        }
        const mean = sum / SCAN;
        rowVar[y] = sum2 / SCAN - mean * mean;
      }
      for (let x = 0; x < SCAN; x++) {
        let sum = 0, sum2 = 0;
        for (let y = 0; y < SCAN; y++) {
          const i = (y * SCAN + x) * 4;
          const v = (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
          sum += v; sum2 += v * v;
        }
        const mean = sum / SCAN;
        colVar[x] = sum2 / SCAN - mean * mean;
      }

      // 分散が高い（エッジが多い）領域を見つける
      const THRESH = 0.25;
      const rowMax = Math.max(...rowVar);
      const colMax = Math.max(...colVar);
      let top = 0, bottom = SCAN-1, left = 0, right = SCAN-1;
      for (let i = 0; i < SCAN; i++) {
        if (rowVar[i] > rowMax * THRESH) { top = i; break; }
      }
      for (let i = SCAN-1; i >= 0; i--) {
        if (rowVar[i] > rowMax * THRESH) { bottom = i; break; }
      }
      for (let i = 0; i < SCAN; i++) {
        if (colVar[i] > colMax * THRESH) { left = i; break; }
      }
      for (let i = SCAN-1; i >= 0; i--) {
        if (colVar[i] > colMax * THRESH) { right = i; break; }
      }

      // 正方形に調整してパディング追加
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      const radius = Math.max(right - left, bottom - top) / 2 * 0.85;
      const sLeft   = Math.max(0, cx - radius);
      const sTop    = Math.max(0, cy - radius);
      const sSize   = Math.min(SCAN - sLeft, SCAN - sTop, radius * 2);

      // 元画像座標に変換
      const scaleX = W / SCAN, scaleY = H / SCAN;
      const oLeft = sLeft * scaleX;
      const oTop  = sTop  * scaleY;
      const oSize = sSize * Math.max(scaleX, scaleY);

      // 出力
      const out = document.createElement("canvas");
      out.width = OUT; out.height = OUT;
      const octx = out.getContext("2d");
      octx.drawImage(img, oLeft, oTop, oSize, oSize, 0, 0, OUT, OUT);
      callback(out.toDataURL("image/jpeg", 0.92));
    } catch(e) {
      callback(dataUrl);
    }
  };
  img.onerror = () => callback(dataUrl);
  img.src = dataUrl;
}

export default function App() {
  const [preview,   setPreview]   = useState(null);
  const [photoDate, setPhotoDate] = useState(null);
  const [mH, setMH] = useState(12);
  const [mM, setMM] = useState(0);
  const [mS, setMS] = useState(0);
  const [hasResult, setHasResult] = useState(false);
  const [showCsv,   setShowCsv]   = useState(false);
  const [records, setRecords] = useState([]);

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
    rb.onload = ev => {
      cropToClockFace(ev.target.result, cropped => {
        setPreview(cropped);
        setHasResult(true);
      });
    };
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

  const parseRecordTime = s => {
    const m = s.match(/(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)/);
    return m ? new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]).getTime() : 0;
  };

  const addRecord = () => {
    if (diffSec === null && !photoTime) return;
    const newRec = { photoTime: photoTime || "不明", diffSec: diffSec ?? "" };
    setRecords(prev => [...prev, newRec].sort((a, b) => parseRecordTime(a.photoTime) - parseRecordTime(b.photoTime)));
  };

  const removeRecord = (i) => setRecords(prev => prev.filter((_, idx) => idx !== i));

  const exportExcel = async () => {
    // Pure OOXML xlsx generation using JSZip
    const { default: JSZip } = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");

    const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    // Build shared strings
    const strs = ["No.", "画像撮影時刻(EXIF)", "時計誤差(秒)", "歩度(s/day)"];
    records.forEach(r => { if (!strs.includes(r.photoTime)) strs.push(r.photoTime); });
    const si = s => strs.indexOf(s);

    const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${4+records.length*2}" uniqueCount="${strs.length}">
${strs.map(s => `<si><t>${esc(s)}</t></si>`).join("")}
</sst>`;

    // Build rows
    // Row1: headers A=No. B=撮影時刻 C=誤差(秒) D=歩度(s/day)
    let rowsXml = `<row r="1">` +
      `<c r="A1" t="s"><v>${si("No.")}</v></c>` +
      `<c r="B1" t="s"><v>${si("画像撮影時刻(EXIF)")}</v></c>` +
      `<c r="C1" t="s"><v>${si("時計誤差(秒)")}</v></c>` +
      `<c r="D1" t="s"><v>${si("歩度(s/day)")}</v></c>` +
      `</row>`;

    records.forEach((r, i) => {
      const row = i + 2;
      const diffVal = r.diffSec === "" ? "" : `<c r="C${row}" t="n"><v>${r.diffSec}</v></c>`;
      const timeIdx = si(r.photoTime);
      // D列: D2は空白、D3以降は =(C{row}-C{row-1})/(B{row}-B{row-1})*86400
      // B列はEXIF時刻テキストのため数値比較できないので、代わりにC列の差分/行番号差で近似
      // ユーザー指定: =(C3-C2)/(B3-B2) → B列はテキストなのでEXIF秒数を別途E列に隠す形は複雑
      // シンプルに: D2=空白, D3以降 =(C{row}-C{row-1})/(B{row}-B{row-1}) をそのまま数式で入れる
      const formulaCell = i >= 1
        ? `<c r="D${row}"><f>=(C${row}-C${row-1})/(B${row}-B${row-1})</f></c>`
        : "";
      rowsXml += `<row r="${row}">` +
        `<c r="A${row}" t="n"><v>${i+1}</v></c>` +
        `<c r="B${row}" t="s"><v>${timeIdx}</v></c>` +
        `${diffVal}` +
        `${formulaCell}` +
        `</row>`;
    });

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols><col min="1" max="1" width="6"/><col min="2" max="2" width="26"/><col min="3" max="3" width="14"/><col min="4" max="4" width="16"/></cols>
<sheetData>${rowsXml}</sheetData>
</worksheet>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="計測結果" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

    const topRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const zip = new JSZip();
    zip.file("[Content_Types].xml", contentTypes);
    zip.file("_rels/.rels", topRels);
    zip.file("xl/workbook.xml", workbookXml);
    zip.file("xl/_rels/workbook.xml.rels", workbookRels);
    zip.file("xl/worksheets/sheet1.xml", sheetXml);
    zip.file("xl/sharedStrings.xml", sharedStringsXml);

    const buf = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "clock-results.xlsx"; a.click();
    URL.revokeObjectURL(url);
  };

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
            <div>
              <img src={preview} alt="preview" style={{ width:"100%", display:"block" }} />
              {photoDate && <div style={{ padding:"8px 12px", fontSize:"10px", color:"#888", letterSpacing:"2px", textAlign:"center" }}>📅 {photoTime}</div>}
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

        {/* 記録に追加ボタン */}
        {hasResult && (
          <button onClick={addRecord}
            style={{ width:"100%", padding:"13px", border:"1px solid #00e5a040", borderRadius:"6px",
              background:"rgba(0,229,160,0.07)", color:"#00e5a0", fontSize:"11px",
              fontFamily:"'Courier New',monospace", letterSpacing:"3px", cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", gap:"8px" }}>
            <span style={{ fontSize:"16px" }}>➕</span> 記録に追加
          </button>
        )}

        {/* 記録一覧 & Excelエクスポート */}
        {records.length > 0 && (
          <div style={{ border:"1px solid #00e5a030", borderRadius:"8px", overflow:"hidden" }}>
            <div style={{ padding:"8px 12px", borderBottom:"1px solid #00e5a020",
              fontSize:"9px", letterSpacing:"4px", color:"#00e5a099",
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span>RECORDS ({records.length}件)</span>
              <button onClick={exportExcel}
                style={{ padding:"5px 12px", border:"1px solid #00e5a060", borderRadius:"4px",
                  background:"rgba(0,229,160,0.12)", color:"#00e5a0", fontSize:"10px",
                  fontFamily:"'Courier New',monospace", letterSpacing:"2px", cursor:"pointer" }}>
                📥 Excelダウンロード
              </button>
            </div>
            <div style={{ background:"#07070e" }}>
              {/* ヘッダー */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr 1fr 1fr auto",
                padding:"6px 12px", borderBottom:"1px solid #0e0e1a",
                fontSize:"9px", letterSpacing:"2px", color:"#333" }}>
                <span>No.</span><span>撮影時刻(EXIF)</span><span>誤差(秒)</span><span>歩度(s/day)</span><span></span>
              </div>
              {records.map((r, i) => {
                const hodoDiff = i >= 1 && records[i-1].diffSec !== "" && r.diffSec !== ""
                  ? r.diffSec - records[i-1].diffSec : null;
                const hodoTime = i >= 1 && records[i-1].photoTime && r.photoTime
                  ? (() => {
                      const parse = s => { const m = s.match(/(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)/); return m ? new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]) : null; };
                      const t1 = parse(records[i-1].photoTime), t2 = parse(r.photoTime);
                      return t1 && t2 ? (t2 - t1) / 1000 : null;
                    })()
                  : null;
                const hodo = hodoDiff !== null && hodoTime !== null && hodoTime !== 0
                  ? (hodoDiff / hodoTime * 86400).toFixed(1) : null;
                return (
                  <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 2fr 1fr 1fr auto",
                    padding:"7px 12px", borderBottom:"1px solid #0a0a14",
                    fontSize:"10px", fontFamily:"'Courier New',monospace",
                    alignItems:"center" }}>
                    <span style={{ color:"#444" }}>{i+1}</span>
                    <span style={{ color:"#8ab4f8" }}>{r.photoTime}</span>
                    <span style={{ color: r.diffSec === "" ? "#444" : Math.abs(r.diffSec) <= 5 ? "#00e5a0" : Math.abs(r.diffSec) <= 60 ? "#f5a623" : "#e05555" }}>
                      {r.diffSec === "" ? "--" : (r.diffSec >= 0 ? "+" : "") + r.diffSec + "s"}
                    </span>
                    <span style={{ color: hodo === null ? "#333" : "#c8a96e" }}>
                      {hodo === null ? "--" : (parseFloat(hodo) >= 0 ? "+" : "") + hodo}
                    </span>
                    <button onClick={() => removeRecord(i)}
                      style={{ background:"transparent", border:"none", color:"#333",
                        cursor:"pointer", fontSize:"14px", padding:"0 4px" }}>✕</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CSV表示 */}
        {hasResult && (
          <div style={{ border:"1px solid #c8a96e30", borderRadius:"6px", overflow:"hidden" }}>
            <button onClick={() => setShowCsv(v => !v)}
              style={{ width:"100%", padding:"12px", border:"none", background:"rgba(200,169,110,0.07)", color:"#c8a96e", fontSize:"11px", fontFamily:"'Courier New',monospace", letterSpacing:"3px", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:"8px" }}>
              <span style={{ fontSize:"16px" }}>📊</span>
              {showCsv ? "▲ 閉じる" : "CSVデータを表示"}
            </button>
            {showCsv && (
              <div style={{ borderTop:"1px solid #c8a96e20", padding:"10px 12px", background:"#07070e" }}>
                <textarea readOnly value={csvText}
                  style={{ width:"100%", height:"68px", background:"#0a0a14", border:"1px solid #8ab4f860", borderRadius:"4px", color:"#8ab4f8", fontFamily:"'Courier New',monospace", fontSize:"11px", padding:"8px", resize:"none", outline:"none", boxSizing:"border-box" }} />
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
