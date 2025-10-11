// dashboard.js (sidebar + overview + single-bunker view) — fixed unique clipPath ids + reduced single view size
const API_BASE = window.location.origin + '/api';
const DEFAULT_COAL_COLORS = ["#f39c12","#3498db","#2ecc71","#ef4444","#8b5cf6","#14b8a6","#f97316","#06b6d4"];
// color mapping helpers (paste right after DEFAULT_COAL_COLORS)
const COAL_COLOR_STORAGE_KEY = 'coalColorMap_v1';
let COAL_COLOR_MAP = (function loadMap(){
  try{
    const j = localStorage.getItem(COAL_COLOR_STORAGE_KEY);
    if(j) return JSON.parse(j);
  }catch(e){ /* ignore */ }
  return {}; // key -> color
})();

let _paletteIndex = 0; // used if we must round-robin

function saveColorMapToStorage(){
  try{ localStorage.setItem(COAL_COLOR_STORAGE_KEY, JSON.stringify(COAL_COLOR_MAP)); }catch(e){ /* ignore */ }
}

/**
 * normalizeKey - normalize a coal identifier/name to a stable key
 * Accepts string or numeric id; returns lowercased trimmed string.
 */
function normalizeKey(coalNameOrId){
  if(coalNameOrId === null || typeof coalNameOrId === 'undefined') return '';
  return String(coalNameOrId).trim().toLowerCase();
}

/**
 * pre-populate map from coalDB entries that already have colours
 * call this once whenever you have the fetched coalDB
 */
function syncColorMapFromCoalDB(coalDB){
  try{
    if(!Array.isArray(coalDB)) return;
    for(const entry of coalDB){
      if(!entry) continue;
      // entry might have fields: coal (name), name, id, color or colour
      const possibleKey = (entry.coal || entry.name || entry.id || '').toString();
      const key = normalizeKey(possibleKey);
      const col = entry.color || entry.colour || null;
      if(key && col && !COAL_COLOR_MAP[key]){
        COAL_COLOR_MAP[key] = String(col);
      }
    }
    saveColorMapToStorage();
  }catch(e){ /* ignore */ }
}

/**
 * findCoalColor - returns a stable color for the given coal name/id.
 * Priority:
 *   1) explicit colour on coalDB entry (color / colour)
 *   2) persistent COAL_COLOR_MAP (localStorage)
 *   3) assign next unused from DEFAULT_COAL_COLORS (or round-robin)
 */
function findCoalColor(coalNameOrId, coalDB){
  try{
    if(!coalNameOrId) return null;
    const key = normalizeKey(coalNameOrId);

    // 1) if map already has it, return
    if(COAL_COLOR_MAP[key]) return COAL_COLOR_MAP[key];

    // 2) check coalDB for explicit color (match by name or by id)
    if(Array.isArray(coalDB)){
      const byExactName = coalDB.find(c => (c.coal || c.name || '').toString().trim().toLowerCase() === key);
      if(byExactName && (byExactName.color || byExactName.colour)){
        COAL_COLOR_MAP[key] = byExactName.color || byExactName.colour;
        saveColorMapToStorage();
        return COAL_COLOR_MAP[key];
      }
      // try to match by id if coalNameOrId is id-like
      const byId = coalDB.find(c => (typeof c.id !== 'undefined' && String(c.id) === String(coalNameOrId)));
      if(byId && (byId.color || byId.colour)){
        COAL_COLOR_MAP[key] = byId.color || byId.colour;
        saveColorMapToStorage();
        return COAL_COLOR_MAP[key];
      }
    }

    // 3) assign an unused color from palette if possible
    const used = new Set(Object.values(COAL_COLOR_MAP || {}));
    let color = DEFAULT_COAL_COLORS.find(c => !used.has(c));
    if(!color){
      // all used — fallback to round-robin stable assignment
      color = DEFAULT_COAL_COLORS[_paletteIndex % DEFAULT_COAL_COLORS.length];
      _paletteIndex++;
    }

    COAL_COLOR_MAP[key] = color;
    saveColorMapToStorage();
    return color;
  }catch(e){
    console.error('findCoalColor error', e);
    return null;
  }
}

/* ---------- fetch helpers ---------- */
async function fetchCoalDB(){
  try{ const res = await fetch(API_BASE + '/coal'); if(!res.ok) return []; return await res.json(); }
  catch(e){ console.error('coal fetch err', e); return []; }
}
async function fetchBlendLatest(){
  try{ const res = await fetch(API_BASE + '/blend/latest'); if(!res.ok) return null; return await res.json(); }
  catch(e){ console.error('blend fetch err', e); return null; }
}
function safeNum(v){ return (v === null || typeof v === 'undefined' || isNaN(Number(v))) ? null : Number(v); }
// function findCoalColor(coalNameOrId, coalDB){
//   if(!coalNameOrId) return null;
//   const byName = coalDB.find(c => (c.coal||'').toLowerCase() === String(coalNameOrId).toLowerCase());
//   if(byName && (byName.color || byName.colour)) return byName.color || byName.colour;
//   return null;
// }

/* ---------- Tooltip helpers (floating DOM tooltip) ---------- */
const coalTip = document.getElementById('coalTooltip');
function buildTooltipHtml({name, pct, gcv, cost, aft}){
  const lines = [];
  if(name) lines.push(`<strong>${name}</strong>`);
  if(typeof pct !== 'undefined') lines.push(`%: ${pct}`);
  if(typeof gcv !== 'undefined') lines.push(`GCV: ${gcv}`);
  if(typeof cost !== 'undefined') lines.push(`Cost: ${cost}`);
  if(typeof aft !== 'undefined' && aft !== null) lines.push(`AFT: ${aft}`);
  return lines.join('<br>');
}
function showCoalRectTooltip(ev, rowIndex, millIndex, layerData){
  try{
    coalTip.innerHTML = buildTooltipHtml({
      name: layerData.coal || layerData.name || 'No name',
      pct: layerData.percent != null ? layerData.percent : '--',
      gcv: layerData.gcv != null ? layerData.gcv : '--',
      cost: layerData.cost != null ? layerData.cost : '--',
      aft: (window.LATEST_BLEND && Array.isArray(window.LATEST_BLEND.aftPerMill)) ? (window.LATEST_BLEND.aftPerMill[millIndex] || '--') : '--'
    });
    coalTip.style.display = 'block';
    coalTip.setAttribute('aria-hidden','false');
    moveCoalRectTooltip(ev);
  }catch(e){ console.error('showCoalRectTooltip', e); }
}
function moveCoalRectTooltip(ev){
  if(!coalTip) return;
  const x = (ev.pageX + 12);
  const y = (ev.pageY + 12);
  coalTip.style.left = x + 'px';
  coalTip.style.top = y + 'px';
}
function hideCoalRectTooltip(){
  if(!coalTip) return;
  coalTip.style.display = 'none';
  coalTip.setAttribute('aria-hidden','true');
}

/* ---------- Render functions ---------- */
/* render a bunker into a given svg element (svg uses viewBox "0 0 100 150")
   IMPORTANT: assign a unique svg.id (if not present) and use that id for clipPath to avoid duplicate clipPath conflicts
*/
function renderBunkerIntoSVG(svg, bunkerData, coalDB, bunkerIndex = 0, strokeOpenTop = true, strokeWidth = 1.3){
  if(!svg) return;

  // ensure unique svg id
  if(!svg.id){
    svg.id = 'svg_' + Math.random().toString(36).slice(2);
  }
  const topY = 10, midY = 100, bottomY = 140;
  const usableH = bottomY - topY;

  // closed path for clip (so fills clip correctly)
  const clipPathClosed = `M10 ${topY} L10 ${midY} L45 ${bottomY} L55 ${bottomY} L90 ${midY} L90 ${topY} L10 ${topY}`;
  // stroke paths (left and right) to show open top if requested
  const leftStroke = `M10 ${topY} L10 ${midY} L45 ${bottomY}`;
  const rightStroke = `M90 ${topY} L90 ${midY} L55 ${bottomY}`;

  const clipId = `${svg.id}-clip`;

  // layers expected bottom->top
  const layers = Array.isArray(bunkerData && bunkerData.layers) ? bunkerData.layers.slice() : [];
  const filtered = layers.map(l => ({ coal: l.coal || '', percent: safeNum(l.percent) || 0, gcv: safeNum(l.gcv), cost: safeNum(l.cost), rowIndex: l.rowIndex || null })).filter(l => l.percent > 0);

  // --- reverse display order so the first layer in data renders last (top) ---
  filtered.reverse();

  // build svg: defs + strokes + rects
  let inner = `<defs><clipPath id="${clipId}"><path d="${clipPathClosed}" /></clipPath></defs>`;

  // outlines - if strokeOpenTop true, draw left & right only (open top)
  if(strokeOpenTop){
    inner += `<path d="${leftStroke}" stroke="#000" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
    inner += `<path d="${rightStroke}" stroke="#000" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
  } else {
    inner += `<path d="${clipPathClosed}" stroke="#000" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
  }

  // rects clipped
  let cum = 0;
  for(let i=0;i<filtered.length;i++){
    const pct = Math.max(0, Math.min(100, filtered[i].percent));
    const h = (pct / 100) * usableH;
    const y = bottomY - (cum + h);
    const color = findCoalColor(filtered[i].coal, coalDB) || DEFAULT_COAL_COLORS[i % DEFAULT_COAL_COLORS.length];

    // JSON-escape for attribute
    const layerJson = JSON.stringify(filtered[i]).replace(/"/g,'&quot;');

    inner += `<g clip-path="url(#${clipId})">` +
             `<rect x="10" y="${y}" width="80" height="${h}" fill="${color}" data-row="${filtered[i].rowIndex}" data-mill="${bunkerIndex}" data-pct="${filtered[i].percent}" ` +
             `onmouseenter="window.showCoalRectTooltip && window.showCoalRectTooltip(event, ${filtered[i].rowIndex || 0}, ${bunkerIndex}, ${layerJson})" ` +
             `onmousemove="window.moveCoalRectTooltip && window.moveCoalRectTooltip(event)" ` +
             `onmouseleave="window.hideCoalRectTooltip && window.hideCoalRectTooltip()" />` +
             `</g>`;
    cum += h;
  }

  svg.innerHTML = inner;
}

/* ---------- UI update helpers ---------- */
function populateStats(metrics){
  const setText = (id, v) => { const el = document.getElementById(id); if(el) el.innerText = (v === null || typeof v === 'undefined') ? '--' : String(v); };
  setText('GEN', metrics.generation !== undefined ? metrics.generation : '--');
  setText('TOTALFLOW', (metrics.totalFlow !== undefined) ? Number(metrics.totalFlow).toFixed(2) : '--');
  setText('AVGGCV', (metrics.avgGCV !== undefined) ? Number(metrics.avgGCV).toFixed(2) : '--');
  setText('AVGAFT', (metrics.avgAFT !== undefined && metrics.avgAFT !== null) ? Number(metrics.avgAFT).toFixed(2) : '--');
  setText('HEATRATE', (metrics.heatRate !== undefined && metrics.heatRate !== null) ? Number(metrics.heatRate).toFixed(2) : '--');
  setText('COSTRATE', (metrics.costRate !== undefined) ? Number(metrics.costRate).toFixed(2) : '--');
}

/* ---------- render overview (all bunkers) ---------- */
function renderOverview(blend, coalDB){
  // ensure we leave single-mode and restore multi-column layout
  try { document.body.classList.remove('single-mode'); } catch(e) { /* ignore */ }

  const bunkers = document.querySelectorAll('.bunker');
  bunkers.forEach((bEl, idx) => {
    const bdata = (Array.isArray(blend.bunkers) && blend.bunkers[idx]) ? blend.bunkers[idx] : { layers: [] };
    const svg = bEl.querySelector('svg');
    // ensure svg has unique id for its clip
    if(!svg.id) svg.id = `ov_svg_${idx}_${Math.random().toString(36).slice(2)}`;
    renderBunkerIntoSVG(svg, bdata, coalDB, idx, true, 1.3);
  });

  // show overview, hide single
  const ov = document.getElementById('overviewView');
  const single = document.getElementById('singleView');
  if(ov) ov.style.display = '';
  if(single) single.style.display = 'none';

  const topOverlay = document.getElementById('topOverlay');
  if(topOverlay) topOverlay.style.display = '';

  // show all arrows
  if(topOverlay){
    const arrows = topOverlay.querySelectorAll('.arrow');
    arrows.forEach(a => a.style.display = '');
    // remove any single arrow duplicates
    const singleArrow = topOverlay.querySelector('.arrow.single');
    if(singleArrow) singleArrow.style.display = 'none';
  }
}

/* ---------- render single bunker view ---------- */
function renderSingle(bunkerIndex, blend, coalDB){
  // ensure body enters single-mode so CSS expands the layout
  try { document.body.classList.add('single-mode'); } catch(e) { /* ignore */ }

  const singleSvg = document.getElementById('singleSvg');
  const singleLabel = document.getElementById('singleLabel');
  const bdata = (Array.isArray(blend.bunkers) && blend.bunkers[bunkerIndex]) ? blend.bunkers[bunkerIndex] : { layers: [] };

  // ensure svg has unique id
  if(!singleSvg.id) singleSvg.id = `single_svg_${bunkerIndex}_${Math.random().toString(36).slice(2)}`;

  // render to single svg with larger strokes and open top
  renderBunkerIntoSVG(singleSvg, bdata, coalDB, bunkerIndex, true, 1.6);

  singleLabel.textContent = `Bunker ${bunkerIndex + 1}`;

  // show single and hide overview
  const ov = document.getElementById('overviewView');
  const singleView = document.getElementById('singleView');
  if(ov) ov.style.display = 'none';
  if(singleView) singleView.style.display = '';

  // top overlay: hide all arrows and show one centered arrow
  const topOverlay = document.getElementById('topOverlay');
  if(topOverlay){
    topOverlay.style.display = '';
    const arrows = topOverlay.querySelectorAll('.arrow');
    arrows.forEach(a => a.style.display = 'none');
    let singleArrow = topOverlay.querySelector('.arrow.single');
    if(!singleArrow){
      singleArrow = document.createElement('div');
      singleArrow.className = 'arrow single';
      topOverlay.appendChild(singleArrow);
    }
    singleArrow.style.left = '50%';
    singleArrow.style.display = '';
  }
}


/* ---------- refresh main data and render according to active tab ---------- */
async function refreshAndRender(activeMode, activeIndex){
  const [coalDB, blend] = await Promise.all([ fetchCoalDB(), fetchBlendLatest() ]);
  window.COAL_DB = coalDB || [];
  try { syncColorMapFromCoalDB(window.COAL_DB); } catch(e){ /* ignore */ }
  window.LATEST_BLEND = blend || null;

  if(!blend){
    populateStats({});
    return;
  }
  populateStats({
    generation: blend.generation,
    totalFlow: blend.totalFlow,
    avgGCV: blend.avgGCV,
    avgAFT: blend.avgAFT,
    heatRate: blend.heatRate,
    costRate: blend.costRate
  });

  if(activeMode === 'overview'){
    renderOverview(blend, coalDB);
  } else {
    renderSingle(activeIndex, blend, coalDB);
  }
}

/* ---------- sidebar behaviour ---------- */
function setActiveTab(mode, index){
  document.querySelectorAll('.sidebar .item').forEach(it => it.classList.remove('active'));
  if(mode === 'overview'){
    document.getElementById('tab-overview').classList.add('active');
  } else {
    const sel = Array.from(document.querySelectorAll('.sidebar .item')).find(el => el.dataset.mode === 'bunker' && Number(el.dataset.index) === index);
    if(sel) sel.classList.add('active');
  }
}

/* ---------- init and wiring ---------- */
/* ---------- init and wiring ---------- */
document.addEventListener('DOMContentLoaded', () => {
  // expose tooltip functions for inline handlers
  window.showCoalRectTooltip = showCoalRectTooltip;
  window.moveCoalRectTooltip = moveCoalRectTooltip;
  window.hideCoalRectTooltip = hideCoalRectTooltip;

  // sidebar click handlers
  document.querySelectorAll('.sidebar .item').forEach(it => {
    it.addEventListener('click', async (e) => {
      const mode = it.dataset.mode;
      const idx = (typeof it.dataset.index !== 'undefined') ? Number(it.dataset.index) : null;
      setActiveTab(mode, idx);
      // render functions themselves toggle single-mode class, so just call refresh
      await refreshAndRender(mode, idx || 0);
    });
  });

  // refresh button reloads page
  const refreshBtn = document.getElementById('refreshBtn');
  if(refreshBtn) refreshBtn.addEventListener('click', () => location.reload());

  // ensure we start without single-mode
  try { document.body.classList.remove('single-mode'); } catch(e) {}

  // initial render: overview active by default
  setActiveTab('overview', null);
  refreshAndRender('overview', 0).catch(e => console.error(e));

  // optional periodic update to re-fetch (kept but can be removed)
  // setInterval(() => {
  //   const active = document.querySelector('.sidebar .item.active');
  //   const mode = active ? active.dataset.mode : 'overview';
  //   const idx = active && active.dataset.index ? Number(active.dataset.index) : 0;
  //   refreshAndRender(mode, idx).catch(e => console.error(e));
  // }, 12000);
});

