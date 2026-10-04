let DOTPOINTS = [];
let STORAGE_KEY = '';
let currentSubject = null;

let state = { ratings:{} }; // ratings[code] = {status, notes, key}
let activeStatusFilters = new Set();
let activeTypeFilters = new Set();
let activeUnits = new Set([3,4]);
let searchQuery = '';
let saveTimer = null;

async function loadState(){
  try{
    const res = await storageGet(STORAGE_KEY);
    if(res && res.value){
      const parsed = JSON.parse(res.value);
      if(parsed && parsed.ratings) state = parsed;
      else state = {ratings:{}};
    } else {
      state = {ratings:{}};
    }
    setSaveIndicator('saved');
  }catch(e){ state = {ratings:{}}; /* no saved state yet */ }
  render();
}

function queueSave(){
  clearTimeout(saveTimer);
  setSaveIndicator('saving');
  saveTimer = setTimeout(async ()=>{
    try{
      await storageSet(STORAGE_KEY, JSON.stringify(state));
      setSaveIndicator('saved');
    }
    catch(e){ console.error('Save failed', e); setSaveIndicator('error'); }
  }, 450);
}

function getEntry(code){
  if(!state.ratings[code]) state.ratings[code] = {status:null, notes:'', key:''};
  return state.ratings[code];
}

// ---------- grouping helpers ----------
function groupBy(arr, keyFn){
  const m = new Map();
  arr.forEach(item=>{
    const k = keyFn(item);
    if(!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  });
  return m;
}

function matchesFilters(dp){
  if(!activeUnits.has(dp.unit)) return false;
  const st = getEntry(dp.code).status || 'none';
  if(activeStatusFilters.size && !activeStatusFilters.has(st)) return false;
  if(activeTypeFilters.size){
    const isExplain = dp.needsExplanation;
    if(activeTypeFilters.has('explain') && !activeTypeFilters.has('calc') && !isExplain) return false;
    if(activeTypeFilters.has('calc') && !activeTypeFilters.has('explain') && isExplain) return false;
  }
  if(searchQuery){
    const q = searchQuery.toLowerCase();
    if(!dp.code.toLowerCase().includes(q) && !dp.descriptor.toLowerCase().includes(q) && !dp.subtopic.toLowerCase().includes(q)) return false;
  }
  return true;
}

// ---------- sidebar unit tree ----------
function buildUnitTree(){
  const wrap = document.getElementById('unitTree');
  if(!wrap) return;
  const units = groupBy(DOTPOINTS, d=>d.unit);
  let html = '';
  [3,4].forEach(u=>{
    const items = units.get(u) || [];
    const done = items.filter(d=>getEntry(d.code).status==='P').length;
    html += `<label><input type="checkbox" class="unit-cb" data-unit="${u}" ${activeUnits.has(u)?'checked':''}>Unit ${u}<span class="count">${done}/${items.length}</span></label>`;
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll('.unit-cb').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const u = parseInt(cb.dataset.unit,10);
      if(cb.checked) activeUnits.add(u); else activeUnits.delete(u);
      renderPoints();
    });
  });
}

function subtopicKey(dp){ return `${dp.unit}|||${dp.topic}|||${dp.subtopic}`; }

function subtopicProgressHtml(group){
  const allInSub = DOTPOINTS.filter(d=>d.unit===group.unit && d.topic===group.topic && d.subtopic===group.subtopic);
  const counts = {P:0,K:0,D:0,none:0};
  allInSub.forEach(d=>{ const s = getEntry(d.code).status || 'none'; counts[s]++; });
  const total = allInSub.length;
  const pctP = Math.round(counts.P/total*100);
  return {counts, total, pctP};
}

function cardHtml(dp){
  const entry = getEntry(dp.code);
  const status = entry.status || 'none';
  return `
  <div class="card" data-code="${dp.code}" data-subtopic-key="${subtopicKey(dp)}">
    <div class="card-head" tabindex="0" role="button" aria-expanded="false">
      <div class="stamp">${dp.code}</div>
      <div class="desc">${dp.descriptor}${dp.graphical?'<span class="badge">Graphical</span>':''}${!dp.needsExplanation?'<span class="badge">Calc</span>':''}</div>
      <div class="status-pill ${status}">${status==='none' ? '—' : status}</div>
      <div class="chevron"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></div>
    </div>
    <div class="card-body">
      <div class="status-row">
        <button class="status-btn ${status==='P'?'sel-P':''}" data-set="P"><b>P</b><small>Perfectly</small></button>
        <button class="status-btn ${status==='K'?'sel-K':''}" data-set="K"><b>K</b><small>Kinda</small></button>
        <button class="status-btn ${status==='D'?'sel-D':''}" data-set="D"><b>D</b><small>Don't know</small></button>
      </div>
      <label class="field-label">My notes — recall this from memory first</label>
      <textarea data-field="notes" placeholder="Write your explanation here before checking any model answer…">${entry.notes||''}</textarea>
      <label class="field-label">Key equation / info</label>
      <textarea data-field="key" placeholder="${(KEY_HINTS[currentSubject && currentSubject.id]||'e.g. key formula or fact')}" style="min-height:38px;">${entry.key||''}</textarea>
      ${dp.needsExplanation ? `
        <button class="reveal-btn" data-reveal>Check my answer →</button>
        <div class="model-answer" style="display:none;">
          <h4>Self-check — key points</h4>
          <ul>${dp.modelAnswer.map(pt=>`<li>${pt}</li>`).join('')}</ul>
          <div class="foot">Self‑authored study aid written to the syllabus wording for ${dp.code} — not an official QCAA marking scheme (those are exam‑question‑specific and copyrighted). For exam‑standard marking, check <a href="${currentSubject.qcaaUrl}" target="_blank" rel="noopener">QCAA's ${currentSubject.qcaaLabel} past papers &amp; marking guides</a>.</div>
        </div>
      ` : `<div class="no-answer-tag">This dot point is a calculation, sketch or data‑interpretation skill — practise it with past‑paper questions rather than a written model answer.</div>`}
    </div>
  </div>`;
}

function tipBannerHtml(){
  if(state.dismissedTip) return '';
  return `<div class="tip-banner" id="tipBanner">
    <div><b>How to use this:</b> pick a dot point below, write your own answer in the notes box from memory first, <em>then</em> tap "Check my answer" to compare. Rate yourself P / K / D honestly — it only helps you if it's accurate. Your ratings save automatically on this device.</div>
    <button id="tipDismiss" aria-label="Dismiss tip">✕</button>
  </div>`;
}

function updateCardStatusUI(card){
  const code = card.dataset.code;
  const entry = getEntry(code);
  const status = entry.status || 'none';

  const pill = card.querySelector('.status-pill');
  pill.className = `status-pill ${status}`;
  pill.textContent = status==='none' ? '—' : status;

  card.querySelectorAll('.status-btn').forEach(b=>{
    b.className = 'status-btn' + (b.dataset.set===status ? ` sel-${status}` : '');
  });

  // recompute this dot point's subtopic progress bar + % without touching sibling cards
  const dp = DOTPOINTS.find(d=>d.code===code);
  const group = document.querySelector(`.subtopic-group[data-subtopic-key="${CSS.escape(subtopicKey(dp))}"]`);
  if(group){
    const {counts, total, pctP} = subtopicProgressHtml(dp);
    const bar = group.querySelector('.subtopic-head .bar');
    const spans = bar.querySelectorAll('span');
    spans[0].style.width = (counts.P/total*100)+'%';
    spans[1].style.width = (counts.K/total*100)+'%';
    spans[2].style.width = (counts.D/total*100)+'%';
    group.querySelector('.subtopic-head .pct').textContent = `${pctP}% mastered`;
  }
}

function renderPoints(){
  buildUnitTree();
  const container = document.getElementById('pointsView');
  if(!container) return;
  const filtered = DOTPOINTS.filter(matchesFilters);
  const tip = tipBannerHtml();
  if(!filtered.length){
    container.innerHTML = tip + `<div class="empty-state">No dot points match these filters.</div>`;
    updateMiniRing();
    const dismiss = document.getElementById('tipDismiss');
    if(dismiss) dismiss.addEventListener('click', ()=>{ state.dismissedTip = true; queueSave(); renderPoints(); });
    return;
  }
  // group by unit > topic > subtopic, preserve first-seen order
  const bySubtopic = new Map();
  filtered.forEach(dp=>{
    const key = `${dp.unit}|||${dp.topic}|||${dp.subtopic}`;
    if(!bySubtopic.has(key)) bySubtopic.set(key, {unit:dp.unit, topic:dp.topic, subtopic:dp.subtopic, items:[]});
    bySubtopic.get(key).items.push(dp);
  });

  let html = '';
  bySubtopic.forEach(group=>{
    const {counts, total, pctP} = subtopicProgressHtml(group);
    html += `<div class="subtopic-group" data-subtopic-key="${subtopicKey(group)}">
      <div class="subtopic-head">
        <span class="crumb">Unit ${group.unit} · ${group.topic.replace(/^T\d+\s*-\s*/,'')}</span>
        <h3>${group.subtopic.replace(/^S\d+\s*-\s*/,'')}</h3>
        <div class="bar">
          <span style="width:${counts.P/total*100}%; background:${STATUS_COLOR.P}"></span>
          <span style="width:${counts.K/total*100}%; background:${STATUS_COLOR.K}"></span>
          <span style="width:${counts.D/total*100}%; background:${STATUS_COLOR.D}"></span>
        </div>
        <span class="pct">${pctP}% mastered</span>
      </div>
      <div class="card-grid">${group.items.map(cardHtml).join('')}</div>
    </div>`;
  });
  container.innerHTML = tip + html;

  const tipDismissBtn = document.getElementById('tipDismiss');
  if(tipDismissBtn) tipDismissBtn.addEventListener('click', ()=>{ state.dismissedTip = true; queueSave(); renderPoints(); });

  container.querySelectorAll('.card-head').forEach(h=>{
    h.addEventListener('click', ()=>{
      const card = h.closest('.card');
      card.classList.toggle('open');
      h.setAttribute('aria-expanded', card.classList.contains('open'));
    });
    h.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); h.click(); } });
  });
  container.querySelectorAll('[data-set]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const card = btn.closest('.card');
      const code = card.dataset.code;
      const entry = getEntry(code);
      const val = btn.dataset.set;
      entry.status = (entry.status===val) ? null : val;
      queueSave();
      updateCardStatusUI(card);
      updateMiniRing();
      buildUnitTree();
    });
  });
  container.querySelectorAll('textarea').forEach(ta=>{
    ta.addEventListener('input', ()=>{
      const card = ta.closest('.card');
      const code = card.dataset.code;
      const entry = getEntry(code);
      entry[ta.dataset.field] = ta.value;
      queueSave();
    });
    ta.addEventListener('click', e=>e.stopPropagation());
  });
  container.querySelectorAll('[data-reveal]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const box = btn.nextElementSibling;
      const showing = box.style.display !== 'none';
      box.style.display = showing ? 'none' : 'block';
      btn.textContent = showing ? 'Check my answer →' : 'Hide model answer';
    });
  });

  updateMiniRing();
}

// ---------- dashboard ----------
function renderDash(){
  const el = document.getElementById('dashView');
  if(!el) return;
  const total = DOTPOINTS.length;
  const counts = {P:0,K:0,D:0,none:0};
  DOTPOINTS.forEach(d=>{ const s = getEntry(d.code).status || 'none'; counts[s]++; });

  let html = `<h2 class="section-title">Overview</h2>
  <div class="stat-row">
    <div class="stat-card P"><div class="num">${counts.P}</div><div class="lbl">Know perfectly</div></div>
    <div class="stat-card K"><div class="num">${counts.K}</div><div class="lbl">Kinda know</div></div>
    <div class="stat-card D"><div class="num">${counts.D}</div><div class="lbl">Need to learn</div></div>
    <div class="stat-card"><div class="num">${counts.none}</div><div class="lbl">Not reviewed yet</div></div>
  </div>

  <h2 class="section-title">Unit split</h2>
  <div class="unit-split">`;

  [3,4].forEach(u=>{
    const items = DOTPOINTS.filter(d=>d.unit===u);
    const c = {P:0,K:0,D:0,none:0};
    items.forEach(d=>{ const s = getEntry(d.code).status||'none'; c[s]++; });
    const t = items.length;
    html += `<div class="unit-card">
      <div class="uh"><b>Unit ${u}</b><span>${t} dot points</span></div>
      <div class="stackbar">
        <span style="width:${c.P/t*100}%;background:${STATUS_COLOR.P}"></span>
        <span style="width:${c.K/t*100}%;background:${STATUS_COLOR.K}"></span>
        <span style="width:${c.D/t*100}%;background:${STATUS_COLOR.D}"></span>
        <span style="width:${c.none/t*100}%;background:${STATUS_COLOR.none}"></span>
      </div>
      <div class="legend">
        <span><i style="background:${STATUS_COLOR.P}"></i>${c.P} perfect</span>
        <span><i style="background:${STATUS_COLOR.K}"></i>${c.K} kinda</span>
        <span><i style="background:${STATUS_COLOR.D}"></i>${c.D} learn</span>
      </div>
    </div>`;
  });
  html += `</div>`;

  html += `<h2 class="section-title">Topic &amp; sub-topic breakdown</h2>`;
  const byTopic = groupBy(DOTPOINTS, d=>`${d.unit}|||${d.topic}`);
  byTopic.forEach((items, key)=>{
    const [unit, topic] = key.split('|||');
    const bySub = groupBy(items, d=>d.subtopic);
    html += `<div class="topic-block"><div class="tname">Unit ${unit} · ${topic.replace(/^T\d+\s*-\s*/,'')}</div>`;
    bySub.forEach((subItems, subName)=>{
      const c = {P:0,K:0,D:0,none:0};
      subItems.forEach(d=>{ const s = getEntry(d.code).status||'none'; c[s]++; });
      const t = subItems.length;
      html += `<div class="sub-row">
        <div class="sname">${subName.replace(/^S\d+\s*-\s*/,'')}</div>
        <div class="bar">
          <span style="width:${c.P/t*100}%;background:${STATUS_COLOR.P}"></span>
          <span style="width:${c.K/t*100}%;background:${STATUS_COLOR.K}"></span>
          <span style="width:${c.D/t*100}%;background:${STATUS_COLOR.D}"></span>
          <span style="width:${c.none/t*100}%;background:${STATUS_COLOR.none}"></span>
        </div>
        <div class="cnt">${c.P}/${t} P</div>
      </div>`;
    });
    html += `</div>`;
  });

  html += `<h2 class="section-title">About the model answers</h2>
  <div class="qcaa-note">
    <b>These are study aids, not official QCAA material.</b> The checklist shown under "Check my answer" for
    each descriptive dot point was written to match the syllabus wording, to help you self‑check
    recall — it is not copied from, and is not a substitute for, an official QCAA Instrument‑Specific Marking Guide
    (ISMGs are tied to specific exam questions, not individual dot points, and are copyrighted). For genuine
    exam‑standard marking practice, work through official past papers and their marking schemes at
    <a href="${currentSubject.qcaaUrl}" target="_blank" rel="noopener">qcaa.qld.edu.au — ${currentSubject.qcaaLabel}</a>.
  </div>`;

  el.innerHTML = html;
}

function updateMiniRing(){
  const total = DOTPOINTS.length;
  const reviewed = DOTPOINTS.filter(d=>getEntry(d.code).status).length;
  const pct = total ? Math.round(reviewed/total*100) : 0;
  const circumference = 2*Math.PI*15.5;
  const ring = document.getElementById('miniRing');
  if(!ring) return;
  ring.setAttribute('stroke-dasharray', circumference.toFixed(1));
  ring.setAttribute('stroke-dashoffset', (circumference*(1-pct/100)).toFixed(1));
  document.getElementById('miniPct').textContent = pct+'%';
}

function render(){
  buildUnitTree();
  renderPoints();
  renderDash();
}

// =====================================================================
// ---------- Multi-subject navigation & views ----------
// =====================================================================

function setView(viewName){
  document.getElementById('landingView').style.display = viewName==='landing' ? 'block' : 'none';
  document.getElementById('trackerView').style.display = viewName==='tracker' ? 'block' : 'none';
  document.getElementById('overallView').style.display = viewName==='overall' ? 'block' : 'none';
  window.scrollTo(0,0);
}

async function computeSubjectProgress(subj){
  try{
    const res = await storageGet(subj.storageKey);
    let ratings = {};
    if(res && res.value){
      const parsed = JSON.parse(res.value);
      if(parsed && parsed.ratings) ratings = parsed.ratings;
    }
    const total = subj.dotpoints.length;
    const counts = {P:0,K:0,D:0,none:0};
    subj.dotpoints.forEach(d=>{
      const s = (ratings[d.code] && ratings[d.code].status) || 'none';
      counts[s]++;
    });
    const reviewed = counts.P + counts.K + counts.D;
    return {total, counts, reviewed, pct: total ? Math.round(reviewed/total*100) : 0};
  }catch(e){
    const total = subj.dotpoints.length;
    return {total, counts:{P:0,K:0,D:0,none:total}, reviewed:0, pct:0};
  }
}

async function renderLanding(){
  const grid = document.getElementById('subjectGrid');
  let html = '';
  const progressList = await Promise.all(SUBJECTS.map(s=>computeSubjectProgress(s)));
  SUBJECTS.forEach((s, i)=>{
    const p = progressList[i];
    html += `<div class="subject-card" data-enter="${s.id}" style="--card-accent:${s.accent}">
      <div class="sc-icon">${s.icon}</div>
      <div class="sc-name">${s.name}</div>
      <div class="sc-meta">${s.dotpoints.length} dot points · Units 3 &amp; 4</div>
      <div class="sc-bar"><span style="width:${p.pct}%"></span></div>
      <div class="sc-pct">${p.pct}% reviewed (${p.counts.P} mastered)</div>
    </div>`;
  });
  grid.innerHTML = html;
  grid.querySelectorAll('[data-enter]').forEach(card=>{
    card.addEventListener('click', ()=> enterSubject(card.dataset.enter));
  });
}

function enterSubject(id){
  const subj = SUBJECTS.find(s=>s.id===id);
  if(!subj) return;
  currentSubject = subj;
  DOTPOINTS = subj.dotpoints;
  STORAGE_KEY = subj.storageKey;
  activeStatusFilters = new Set();
  activeTypeFilters = new Set();
  activeUnits = new Set([3,4]);
  searchQuery = '';
  document.getElementById('searchInput').value = '';
  document.querySelectorAll('#statusChips .chip').forEach(c=>c.classList.remove('on'));
  document.querySelectorAll('#typeChips .chip').forEach(c=>c.classList.remove('on'));
  document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.remove('active'));
  document.querySelector('nav.tabs button[data-tab="points"]').classList.add('active');
  document.getElementById('pointsView').style.display = 'block';
  document.getElementById('dashView').style.display = 'none';

  document.body.dataset.subject = subj.id;
  document.querySelector('#trackerView .brand .tag').textContent = subj.tag;

  setView('tracker');
  loadState();
}

function showLanding(){
  currentSubject = null;
  document.body.dataset.subject = 'neutral';
  setView('landing');
  renderLanding();
}

async function showOverall(){
  document.body.dataset.subject = 'neutral';
  setView('overall');
  const el = document.getElementById('overallContent');
  el.innerHTML = `<div class="empty-state">Loading progress across all subjects…</div>`;

  const progressList = await Promise.all(SUBJECTS.map(s=>computeSubjectProgress(s)));
  const combined = {P:0,K:0,D:0,none:0};
  let combinedTotal = 0;
  progressList.forEach(p=>{
    combined.P += p.counts.P; combined.K += p.counts.K; combined.D += p.counts.D; combined.none += p.counts.none;
    combinedTotal += p.total;
  });

  let html = `<h2 class="section-title">Across all subjects</h2>
  <div class="stat-row">
    <div class="stat-card P"><div class="num">${combined.P}</div><div class="lbl">Know perfectly</div></div>
    <div class="stat-card K"><div class="num">${combined.K}</div><div class="lbl">Kinda know</div></div>
    <div class="stat-card D"><div class="num">${combined.D}</div><div class="lbl">Need to learn</div></div>
    <div class="stat-card"><div class="num">${combined.none}</div><div class="lbl">Not reviewed yet</div></div>
  </div>
  <div style="font-family:var(--mono); font-size:11.5px; color:#9FB4C6; margin:-10px 0 28px;">
    ${combinedTotal} dot points total across ${SUBJECTS.length} subjects &middot; ${Math.round((combined.P+combined.K+combined.D)/combinedTotal*100)}% reviewed overall
  </div>

  <h2 class="section-title">By subject</h2>
  <div class="subject-bars">`;

  SUBJECTS.forEach((s, i)=>{
    const p = progressList[i];
    const t = p.total;
    html += `<div class="subject-bar-row clickable" data-enter="${s.id}">
      <div class="sbr-head">
        <span class="sbr-icon">${s.icon}</span>
        <span class="sbr-name">${s.name}</span>
        <span class="sbr-pct">${p.counts.P}/${t} mastered · ${p.pct}% reviewed</span>
      </div>
      <div class="stackbar">
        <span style="width:${p.counts.P/t*100}%;background:${STATUS_COLOR.P}"></span>
        <span style="width:${p.counts.K/t*100}%;background:${STATUS_COLOR.K}"></span>
        <span style="width:${p.counts.D/t*100}%;background:${STATUS_COLOR.D}"></span>
        <span style="width:${p.counts.none/t*100}%;background:${STATUS_COLOR.none}"></span>
      </div>
      <div class="legend">
        <span><i style="background:${STATUS_COLOR.P}"></i>${p.counts.P} perfect</span>
        <span><i style="background:${STATUS_COLOR.K}"></i>${p.counts.K} kinda</span>
        <span><i style="background:${STATUS_COLOR.D}"></i>${p.counts.D} learn</span>
        <span><i style="background:${STATUS_COLOR.none}"></i>${p.counts.none} unreviewed</span>
      </div>
    </div>`;
  });
  html += `</div>`;

  el.innerHTML = html;
  el.querySelectorAll('[data-enter]').forEach(row=>{
    row.addEventListener('click', ()=> enterSubject(row.dataset.enter));
  });
}

// ---------- top-level controls ----------
document.querySelectorAll('nav.tabs button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('pointsView').style.display = tab==='points' ? 'block':'none';
    document.getElementById('dashView').style.display = tab==='dash' ? 'block':'none';
    if(tab==='dash') renderDash();
  });
});

document.getElementById('searchInput').addEventListener('input', (e)=>{
  searchQuery = e.target.value;
  renderPoints();
});

document.getElementById('statusChips').addEventListener('click', (e)=>{
  const chip = e.target.closest('.chip');
  if(!chip) return;
  const s = chip.dataset.status;
  if(activeStatusFilters.has(s)){ activeStatusFilters.delete(s); chip.classList.remove('on'); }
  else{ activeStatusFilters.add(s); chip.classList.add('on'); }
  renderPoints();
});

document.getElementById('typeChips').addEventListener('click', (e)=>{
  const chip = e.target.closest('.chip');
  if(!chip) return;
  const t = chip.dataset.type;
  if(activeTypeFilters.has(t)){ activeTypeFilters.delete(t); chip.classList.remove('on'); }
  else{ activeTypeFilters.add(t); chip.classList.add('on'); }
  renderPoints();
});

document.getElementById('exportBtn').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${currentSubject.id}-dotpoint-progress.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('importBtn').addEventListener('click', ()=>{
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  const statusEl = document.getElementById('importStatus');
  if(!file) return;
  try{
    const text = await file.text();
    const parsed = JSON.parse(text);
    if(!parsed || typeof parsed !== 'object' || !parsed.ratings || typeof parsed.ratings !== 'object'){
      throw new Error('This file does not look like a progress export from this tracker.');
    }
    const count = Object.keys(parsed.ratings).length;
    if(!confirm(`Import progress for ${count} dot point(s) into ${currentSubject.name}? This will overwrite your current saved ratings, notes and key info for this subject.`)){
      e.target.value = '';
      return;
    }
    state = parsed;
    queueSave();
    render();
    statusEl.textContent = `Imported ${count} entries.`;
  }catch(err){
    statusEl.textContent = 'Import failed: ' + err.message;
  }finally{
    e.target.value = '';
  }
});

document.getElementById('resetBtn').addEventListener('click', async ()=>{
  if(!confirm(`Reset ALL saved ratings, notes and key info for ${currentSubject.name}? This cannot be undone.`)) return;
  state = {ratings:{}};
  queueSave();
  render();
});

document.getElementById('menuBtn').addEventListener('click', ()=>{
  document.getElementById('filters').classList.toggle('open');
  document.getElementById('scrim').classList.toggle('on');
});
document.getElementById('scrim').addEventListener('click', ()=>{
  document.getElementById('filters').classList.remove('open');
  document.getElementById('scrim').classList.remove('on');
});

document.getElementById('backBtnTracker').addEventListener('click', showLanding);
document.getElementById('backBtnOverall').addEventListener('click', showLanding);
document.getElementById('overallEntry').addEventListener('click', showOverall);

// ---------- boot ----------
showLanding();
