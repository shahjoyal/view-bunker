// dashboard.js (sidebar + overview + single-bunker view) — fixed unique clipPath ids + reduced single view size
const API_BASE = window.location.origin + '/api';
const DEFAULT_COAL_COLORS = ["#f39c12","#3498db","#2ecc71","#ef4444","#8b5cf6","#14b8a6","#f97316","#06b6d4"];

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
function findCoalColor(coalNameOrId, coalDB){
  if(!coalNameOrId) return null;
  const byName = coalDB.find(c => (c.coal||'').toLowerCase() === String(coalNameOrId).toLowerCase());
  if(byName && (byName.color || byName.colour)) return byName.color || byName.colour;
  return null;
}

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

/* ---------- render overview (all 6 bunkers) ---------- */
function renderOverview(blend, coalDB){
  const bunkers = document.querySelectorAll('.bunker');
  bunkers.forEach((bEl, idx) => {
    const bdata = (Array.isArray(blend.bunkers) && blend.bunkers[idx]) ? blend.bunkers[idx] : { layers: [] };
    const svg = bEl.querySelector('svg');
    // ensure svg has unique id for its clip
    if(!svg.id) svg.id = `ov_svg_${idx}_${Math.random().toString(36).slice(2)}`;
    renderBunkerIntoSVG(svg, bdata, coalDB, idx, true, 1.3);
  });

  // show overview, hide single
  document.getElementById('overviewView').style.display = '';
  document.getElementById('singleView').style.display = 'none';
  const topOverlay = document.getElementById('topOverlay');
  topOverlay.style.display = '';
  // show all arrows
  const arrows = topOverlay.querySelectorAll('.arrow');
  arrows.forEach(a => a.style.display = '');
  // remove any single arrow duplicates
  const single = topOverlay.querySelector('.arrow.single');
  if(single) single.style.display = 'none';
}

/* ---------- render single bunker view ---------- */
function renderSingle(bunkerIndex, blend, coalDB){
  const singleSvg = document.getElementById('singleSvg');
  const singleLabel = document.getElementById('singleLabel');
  const bdata = (Array.isArray(blend.bunkers) && blend.bunkers[bunkerIndex]) ? blend.bunkers[bunkerIndex] : { layers: [] };

  // ensure svg has unique id
  if(!singleSvg.id) singleSvg.id = `single_svg_${bunkerIndex}_${Math.random().toString(36).slice(2)}`;

  // render to single svg with larger strokes and open top
  renderBunkerIntoSVG(singleSvg, bdata, coalDB, bunkerIndex, true, 1.6);

  singleLabel.textContent = `Bunker ${bunkerIndex + 1}`;

  // show single and hide overview
  document.getElementById('overviewView').style.display = 'none';
  document.getElementById('singleView').style.display = '';

  // top overlay: hide all arrows and show one centered arrow
  const topOverlay = document.getElementById('topOverlay');
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

/* ---------- refresh main data and render according to active tab ---------- */
async function refreshAndRender(activeMode, activeIndex){
  const [coalDB, blend] = await Promise.all([ fetchCoalDB(), fetchBlendLatest() ]);
  window.COAL_DB = coalDB || [];
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
      await refreshAndRender(mode, idx || 0);
    });
  });

  // refresh button reloads page
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.addEventListener('click', () => location.reload());

  // initial render: overview active by default
  setActiveTab('overview', null);
  refreshAndRender('overview', 0).catch(e => console.error(e));

  // optional periodic update to re-fetch (kept but can be removed)
  setInterval(() => {
    const active = document.querySelector('.sidebar .item.active');
    const mode = active ? active.dataset.mode : 'overview';
    const idx = active && active.dataset.index ? Number(active.dataset.index) : 0;
    refreshAndRender(mode, idx).catch(e => console.error(e));
  }, 12000);
});
