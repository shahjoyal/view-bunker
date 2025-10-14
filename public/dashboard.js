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

// ------------------- BEGIN: derived metrics helpers (ADD HERE) -------------------

/**
 * getBunkerFlow - robustly read a bunker flow value from blend object
 */
function getBunkerFlow(blend, idx){
  try{
    // common places: blend.flows array or blend.bunkers[idx].flow
    if(Array.isArray(blend && blend.flows) && typeof blend.flows[idx] !== 'undefined') {
      const v = safeNum(blend.flows[idx]);
      if(v !== null) return v;
    }
    if(Array.isArray(blend && blend.bunkers) && blend.bunkers[idx] && typeof blend.bunkers[idx].flow !== 'undefined'){
      const v = safeNum(blend.bunkers[idx].flow);
      if(v !== null) return v;
    }
  }catch(e){}
  return null;
}

/**
 * getBottomGcvForBunker - pick the bottom-most draining layer GCV for a bunker
 * Strategy:
 *  1) Prefer bunker.layers (iterate bottom->top, first layer with percent>0).
 *  2) Fallback: scan blend.rows from bottom->top for a row that maps to this bunker
 *     (percentages[b] > 0, or row.percent used as legacy for bunker 0).
 *  3) If row maps to a coal id/name, look up in coalDB for gcv.
 */
function getBottomGcvForBunker(blend, coalDB, bunkerIndex){
  try{
    // 1) from bunker.layers
    if(Array.isArray(blend && blend.bunkers) && blend.bunkers[bunkerIndex] && Array.isArray(blend.bunkers[bunkerIndex].layers)){
      const layers = blend.bunkers[bunkerIndex].layers;
      for(let li = layers.length - 1; li >= 0; li--){
        const L = layers[li];
        if(!L) continue;
        // handle percent vs percentages
        const rawPct = (L.percent === undefined || L.percent === null) ? (L.percentages ? L.percentages : 0) : L.percent;
        let pctVal = null;
        if(Array.isArray(rawPct) && rawPct.length) pctVal = safeNum(rawPct[0]);
        else pctVal = safeNum(rawPct);
        if(pctVal && pctVal > 0){
          const g = safeNum(L.gcv);
          if(g !== null) return g;
          // try lookup in coalDB by name/id
          if(L.coal){
            const keyLower = String(L.coal || '').trim().toLowerCase();
            const found = (Array.isArray(coalDB) ? coalDB.find(c => {
              if(!c) return false;
              if(c.coal && String(c.coal).trim().toLowerCase() === keyLower) return true;
              if(c.name && String(c.name).trim().toLowerCase() === keyLower) return true;
              if((c._id || c.id) && String(c._id || c.id) === String(L.coal)) return true;
              return false;
            }) : null);
            if(found && (found.gcv !== undefined && found.gcv !== null)) return safeNum(found.gcv);
          }
        }
      }
    }

    // 2) fallback: scan blend.rows bottom->top to find a row that maps to this bunker
    if(Array.isArray(blend && blend.rows)){
      for(let r = blend.rows.length - 1; r >= 0; r--){
        const row = blend.rows[r];
        if(!row) continue;
        let p = null;
        if(Array.isArray(row.percentages) && row.percentages.length > bunkerIndex){
          p = safeNum(row.percentages[bunkerIndex]);
        } else if(typeof row.percent === 'number' && bunkerIndex === 0){
          p = safeNum(row.percent);
        } else if(row.percent){
          p = safeNum(row.percent);
        }
        if(p === null || p === 0) continue;

        // candidate row found — try row.gcv first
        if(row.gcv !== undefined && row.gcv !== null){
          const g = safeNum(row.gcv);
          if(g !== null) return g;
        }

        // else see if row has per-mill coal mapping row.coal[bunkerIndex]
        if(row.coal && typeof row.coal === 'object' && (row.coal[String(bunkerIndex)] || row.coal[bunkerIndex] )){
          const ref = row.coal[String(bunkerIndex)] || row.coal[bunkerIndex];
          const keyLower = String(ref || '').trim().toLowerCase();
          const found = (Array.isArray(coalDB) ? coalDB.find(c => {
            if(!c) return false;
            if(c.coal && String(c.coal).trim().toLowerCase() === keyLower) return true;
            if(c.name && String(c.name).trim().toLowerCase() === keyLower) return true;
            if((c._id || c.id) && String(c._id || c.id) === String(ref)) return true;
            return false;
          }) : null);
          if(found && (found.gcv !== undefined && found.gcv !== null)) return safeNum(found.gcv);
        }

        // last fallback: if row.coal is a simple name/guid and matches coalDB
        if(row.coal && typeof row.coal === 'string'){
          const keyLower = String(row.coal).trim().toLowerCase();
          const found = (Array.isArray(coalDB) ? coalDB.find(c => {
            if(!c) return false;
            if(c.coal && String(c.coal).trim().toLowerCase() === keyLower) return true;
            if(c.name && String(c.name).trim().toLowerCase() === keyLower) return true;
            if((c._id || c.id) && String(c._id || c.id) === String(row.coal)) return true;
            return false;
          }) : null);
          if(found && (found.gcv !== undefined && found.gcv !== null)) return safeNum(found.gcv);
        }
      }
    }
  }catch(e){
    console.error('getBottomGcvForBunker error', e);
  }
  return null;
}

/**
 * computeDerivedMetrics - computes avgGCV & heatRate using bottom-coal gcv * flow logic
 * returns { avgGCV: number|null, heatRate: number|null, totalFlow: number|null }
 */
function computeDerivedMetrics(blend, coalDB){
  try{
    if(!blend) return { avgGCV: null, heatRate: null, totalFlow: null };

    // totalFlow preference: blend.totalFlow if valid else sum of available flows
    const bf = safeNum(blend.totalFlow);
    let totalFlow = (bf !== null) ? bf : null;

    let sumNumerator = 0;
    let sumFlowsForNumerator = 0;

    const bunkerCount = (Array.isArray(blend.bunkers) ? blend.bunkers.length : 8);
    for(let b = 0; b < bunkerCount; b++){
      const flowVal = getBunkerFlow(blend, b);
      const bottomGcv = getBottomGcvForBunker(blend, coalDB, b);
      if(flowVal !== null && bottomGcv !== null){
        sumNumerator += (Number(bottomGcv) * Number(flowVal));
        sumFlowsForNumerator += Number(flowVal);
      }
    }

    if(totalFlow === null){
      // fallback to sumFlowsForNumerator if server totalFlow not present
      totalFlow = (sumFlowsForNumerator > 0) ? sumFlowsForNumerator : null;
    }

    const avgGCV = (totalFlow && totalFlow > 0) ? (sumNumerator / totalFlow) : null;

    // generation fallback
    const generation = safeNum(blend.generation);
    let heatRate = null;
    if(avgGCV !== null && totalFlow !== null && generation !== null && generation > 0){
      heatRate = (avgGCV * Number(totalFlow)) / Number(generation);
    }

    return { avgGCV: (avgGCV === null ? null : Number(avgGCV)), heatRate: (heatRate === null ? null : Number(heatRate)), totalFlow: (totalFlow === null ? null : Number(totalFlow)) };
  }catch(e){
    console.error('computeDerivedMetrics error', e);
    return { avgGCV: null, heatRate: null, totalFlow: null };
  }
}

/**
 * recomputeAndPopulate - reuses window.LATEST_BLEND & window.COAL_DB to recompute summary metrics
 */
function recomputeAndPopulate(){
  try{
    const blend = window.LATEST_BLEND || null;
    const coalDB = window.COAL_DB || [];
    if(!blend) return;
    const derived = computeDerivedMetrics(blend, coalDB);

    // preserve other metrics that server may provide
    const metrics = {
      generation: (blend.generation !== undefined ? blend.generation : null),
      totalFlow: (derived.totalFlow !== null ? derived.totalFlow : (blend.totalFlow !== undefined ? blend.totalFlow : null)),
      avgGCV: (derived.avgGCV !== null ? derived.avgGCV : (blend.avgGCV !== undefined ? blend.avgGCV : null)),
      avgAFT: (blend.avgAFT !== undefined ? blend.avgAFT : null),
      heatRate: (derived.heatRate !== null ? derived.heatRate : (blend.heatRate !== undefined ? blend.heatRate : null)),
      costRate: (blend.costRate !== undefined ? blend.costRate : null)
    };
    populateStats(metrics);
  }catch(e){ console.error('recomputeAndPopulate err', e); }
}

// ------------------- END: derived metrics helpers -------------------


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
// patched: propagate color from layer if present
const filtered = layers
  .map(l => ({
    coal: l.coal || '',
    percent: safeNum(l.percent) || 0,
    gcv: safeNum(l.gcv),
    cost: safeNum(l.cost),
    rowIndex: (typeof l.rowIndex !== 'undefined' && l.rowIndex !== null) ? l.rowIndex : null,
    color: (typeof l.color !== 'undefined' && l.color !== null) ? String(l.color) : null  // <- NEW
  }))
  .filter(l => l.percent > 0);


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
    // patched: prefer layer.color, then DB color, then default palette
const color = filtered[i].color || findCoalColor(filtered[i].coal, coalDB) || DEFAULT_COAL_COLORS[i % DEFAULT_COAL_COLORS.length];


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
  // compute derived avgGCV & heatRate client-side (prefer bottom-coal * flow approach)
  try{
    // keep server-provided COAL_DB already loaded above
    const derived = computeDerivedMetrics(blend, window.COAL_DB || []);
    const metrics = {
      generation: (blend.generation !== undefined ? blend.generation : null),
      totalFlow: (derived.totalFlow !== null ? derived.totalFlow : (blend.totalFlow !== undefined ? blend.totalFlow : null)),
      avgGCV: (derived.avgGCV !== null ? derived.avgGCV : (blend.avgGCV !== undefined ? blend.avgGCV : null)),
      avgAFT: (blend.avgAFT !== undefined ? blend.avgAFT : null),
      heatRate: (derived.heatRate !== null ? derived.heatRate : (blend.heatRate !== undefined ? blend.heatRate : null)),
      costRate: (blend.costRate !== undefined ? blend.costRate : null)
    };
    populateStats(metrics);
  }catch(e){
    // fallback to server-provided values if anything goes wrong
    populateStats({
      generation: blend.generation,
      totalFlow: blend.totalFlow,
      avgGCV: blend.avgGCV,
      avgAFT: blend.avgAFT,
      heatRate: blend.heatRate,
      costRate: blend.costRate
    });
  }


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

    // keep summary updated when flows or blends or next-blend timers change
  window.addEventListener('flows:update', function(){ recomputeAndPopulate(); }, false);
  window.addEventListener('blend:updated', function(){ 
    // ensure we refresh stored LATEST_BLEND if other code updates it, then recompute
    try{ if(typeof refreshAndRender === 'function') { /* avoid refetch */ window.LATEST_BLEND = window.LATEST_BLEND || window.LATEST_BLEND; } }catch(e){}
    recomputeAndPopulate();
  }, false);

  // periodic short tick to catch internal binder state changes (e.g. nextBlendBinder idx advancement)
  // optional: 1000ms gives smooth update of Avg GCV/Heat Rate as bottom coal changes
  window.__derivedMetrics_recompute_timer = setInterval(recomputeAndPopulate, 1000);


  // optional periodic update to re-fetch (kept but can be removed)
  // setInterval(() => {
  //   const active = document.querySelector('.sidebar .item.active');
  //   const mode = active ? active.dataset.mode : 'overview';
  //   const idx = active && active.dataset.index ? Number(active.dataset.index) : 0;
  //   refreshAndRender(mode, idx).catch(e => console.error(e));
  // }, 12000);
});
