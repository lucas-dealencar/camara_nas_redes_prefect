const fmtInt = new Intl.NumberFormat('pt-BR');
const fmtCompact = new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1});
let rawPayload = null;
let report = null;
let selectedProposal = 0;
let activeMethod = 'gerais';
let selectedWeek = 0;
let showMedian = true;
let activeWeekId = null;
let proposalSearchQuery = '';
let forceProposalIdx = null;

function esc(value='') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatNumber(value,compact=false) { return value == null ? '—' : (compact ? fmtCompact.format(value) : fmtInt.format(value)); }
function percentage(value) { return `${Number(value).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`; }
function showToast(message) { const node=document.getElementById('toast'); node.textContent=message; node.classList.add('show'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>node.classList.remove('show'),2800); }

const normText = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

async function fetchDashboardData() {
  const resp = await fetch(`dados/dados_dashboard.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!resp.ok) throw new Error('Não foi possível carregar os dados do painel.');
  return resp.json();
}

async function loadReport() {
  try {
    rawPayload = await fetchDashboardData();
    weekOptions = weekOptionsFromPayload();
    const wanted = new URLSearchParams(location.search).get('semana');
    const fallback = isMultiWeek() ? String(rawPayload.semana_padrao) : 'padrao';
    activeWeekId = weekOptions.some(o => o.id === wanted) ? wanted : fallback;
    initSlicer();
    initProposalSearch();
    renderCurrentWeek();
    syncUrl();
  } catch (error) {
    showToast(error.message);
  }
}

/* ===== Busca de Texto Global ===== */
function initProposalSearch() {
  const wrapper = document.getElementById('proposta-busca-wrapper');
  const input = document.getElementById('busca-proposta-global');
  const clearBtn = document.getElementById('limpar-busca-proposta');
  const list = document.getElementById('lista-sugestoes-proposta');
  if (!wrapper || !input) return;

  input.addEventListener('focus', () => {
    renderProposalSuggestions(input.value);
    wrapper.classList.add('aberto');
  });

  input.addEventListener('input', () => {
    proposalSearchQuery = input.value;
    clearBtn.classList.toggle('visivel', Boolean(proposalSearchQuery.trim()));
    renderProposalSuggestions(proposalSearchQuery);
    wrapper.classList.add('aberto');
    renderCards();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    proposalSearchQuery = '';
    clearBtn.classList.remove('visivel');
    renderProposalSuggestions('');
    renderCards();
    input.focus();
  });

  list.addEventListener('click', e => {
    const item = e.target.closest('.proposta-sugestao-item');
    if (!item) return;
    
    const idx = Number(item.dataset.index);
    const weekId = item.dataset.week;
    
    input.value = '';
    proposalSearchQuery = '';
    clearBtn.classList.remove('visivel');
    wrapper.classList.remove('aberto');
    
    if (activeWeekId !== weekId) {
      activeWeekId = weekId;
      forceProposalIdx = idx;
      renderCurrentWeek();
      syncUrl();
    } else {
      forceProposalIdx = idx;
      renderCurrentWeek();
    }
    
    navigateToPage('propostas');
  });

  document.addEventListener('pointerdown', e => {
    if (!wrapper.contains(e.target)) wrapper.classList.remove('aberto');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') wrapper.classList.remove('aberto');
  });
}

function renderProposalSuggestions(query = '') {
  const list = document.getElementById('lista-sugestoes-proposta');
  if (!list || !rawPayload || !rawPayload.dados_semanas) return;
  
  const q = normText(query).trim();
  const allProposals = [];
  
  Object.entries(rawPayload.dados_semanas).forEach(([weekId, weekData]) => {
    if(weekData.proposals) {
       weekData.proposals.forEach((p, index) => {
         allProposals.push({ 
           p, 
           index, 
           weekId, 
           weekLabel: weekData.edition || `${weekId}ª semana`,
           weekPeriod: weekData.period || ''
         });
       });
    }
  });

  const matches = allProposals.filter(({ p, weekLabel, weekPeriod }) =>
    !q || normText(`${p.id} ${p.description} ${p.status || ''} ${weekLabel} ${weekPeriod}`).includes(q)
  );

  if (!matches.length) {
    list.innerHTML = '<li class="proposta-sugestao-vazio">Nenhuma proposta encontrada</li>';
    return;
  }

  list.innerHTML = matches.slice(0, 50).map(({ p, index, weekId, weekLabel }) => `
    <li class="proposta-sugestao-item" role="option" data-index="${index}" data-week="${weekId}">
      <div class="proposta-sugestao-info">
        <b>${esc(p.id)}</b>
        <small>${esc(p.description || '')}</small>
        <small class="week-badge">${esc(weekLabel)}</small>
      </div>
    </li>
  `).join('');
}

let weekOptions = [];
let slicerItems = [];
let slicerActive = 0;
let lastPointer = { x: -1, y: -1 };

function isMultiWeek() { return !!(rawPayload && rawPayload.dados_semanas && rawPayload.opcoes_semanas); }
function getWeekReport(id) { return isMultiWeek() ? rawPayload.dados_semanas[id] : rawPayload; }

function weekOptionsFromPayload() {
  const lastLabel = r => { const h = r?.history; return h && h.length ? (h[h.length - 1].label || '') : ''; };
  if (isMultiWeek()) {
    return rawPayload.opcoes_semanas.map(o => {
      const r = rawPayload.dados_semanas[o.id] || {};
      return { id: String(o.id), title: `${o.id}ª semana`, range: r.period || o.rotulo, short: lastLabel(r) };
    });
  }
  return [{ id: 'padrao', title: String(rawPayload.edition || 'Relatório').split(' · ')[0], range: rawPayload.period || '', short: lastLabel(rawPayload) }];
}

function syncUrl() {
  if (!isMultiWeek()) return;
  try {
    const url = new URL(location.href);
    if (activeWeekId === String(rawPayload.semana_padrao)) url.searchParams.delete('semana');
    else url.searchParams.set('semana', activeWeekId);
    history.replaceState(history.state, '', url);
  } catch (_) {}
}

function initSlicer() {
  const root = document.getElementById('filtro-semana');
  if (!root) return;
  const btn = document.getElementById('btn-semana-atual');
  const search = document.getElementById('busca-semana');
  const list = document.getElementById('lista-semanas');
  const panel = document.getElementById('painel-semana');
  const reset = document.getElementById('limpar-semana');

  const single = weekOptions.length < 2;
  btn.disabled = single;
  search.closest('.periodo-busca').hidden = weekOptions.length < 8;
  list.tabIndex = 0;

  btn.addEventListener('click', () => root.classList.contains('aberto') ? closeSlicer(true) : openSlicer());
  btn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openSlicer(); } });
  search.addEventListener('input', () => renderSlicerList(search.value));
  panel.addEventListener('keydown', onSlicerKey);
  list.addEventListener('click', e => { const li = e.target.closest('.periodo-item'); if (li) selectWeek(li.dataset.id); });
  list.addEventListener('pointermove', e => {
    if (e.clientX === lastPointer.x && e.clientY === lastPointer.y) return;
    lastPointer = { x: e.clientX, y: e.clientY };
    const li = e.target.closest('.periodo-item');
    if (li) setSlicerActive(Number(li.dataset.idx), false);
  });
  reset.addEventListener('click', () => selectWeek(weekOptions[0].id));
  document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) closeSlicer(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && root.classList.contains('aberto')) closeSlicer(true); });
  renderSlicerList('');
}

function openSlicer() {
  const root = document.getElementById('filtro-semana');
  if (!root || weekOptions.length < 2) return;
  const search = document.getElementById('busca-semana');
  search.value = '';
  root.classList.add('aberto');
  document.getElementById('btn-semana-atual').setAttribute('aria-expanded', 'true');
  renderSlicerList('');
  (search.closest('.periodo-busca').hidden ? document.getElementById('lista-semanas') : search).focus({ preventScroll: true });
  setSlicerActive(Math.max(0, slicerItems.findIndex(o => o.id === activeWeekId)), true);
}

function closeSlicer(returnFocus) {
  const root = document.getElementById('filtro-semana');
  if (!root || !root.classList.contains('aberto')) return;
  root.classList.remove('aberto');
  const btn = document.getElementById('btn-semana-atual');
  btn.setAttribute('aria-expanded', 'false');
  if (returnFocus) btn.focus({ preventScroll: true });
}

function renderSlicerList(query = '') {
  const q = normText(query).trim();
  const list = document.getElementById('lista-semanas');
  slicerItems = weekOptions.filter(o => !q || normText(`${o.title} ${o.range}`).includes(q));
  const latest = weekOptions[0] && weekOptions[0].id;
  if (!slicerItems.length) {
    list.innerHTML = '<li class="periodo-vazio" role="presentation">Nenhuma semana encontrada</li>';
  } else {
    list.innerHTML = slicerItems.map((o, i) => {
      const selected = o.id === activeWeekId;
      return `<li class="periodo-item${selected ? ' selecionado' : ''}" role="option" id="semana-opt-${esc(o.id)}" data-id="${esc(o.id)}" data-idx="${i}" aria-selected="${selected}"><span class="periodo-check" aria-hidden="true"></span><span class="periodo-item-texto"><b>${esc(o.title)}</b><small>${esc(o.range)}</small></span>${o.id === latest && weekOptions.length > 1 ? '<span class="periodo-tag">Mais recente</span>' : ''}</li>`;
    }).join('');
    const sel = slicerItems.findIndex(o => o.id === activeWeekId);
    setSlicerActive(sel >= 0 ? sel : 0, true);
  }
  document.getElementById('contagem-semanas').textContent = slicerItems.length === weekOptions.length
    ? `${weekOptions.length} ${weekOptions.length === 1 ? 'semana' : 'semanas'}`
    : `${slicerItems.length} de ${weekOptions.length} semanas`;
}

function setSlicerActive(idx, scroll = true) {
  const list = document.getElementById('lista-semanas');
  const items = [...list.querySelectorAll('.periodo-item')];
  const search = document.getElementById('busca-semana');
  if (!items.length) { search.removeAttribute('aria-activedescendant'); list.removeAttribute('aria-activedescendant'); return; }
  slicerActive = Math.max(0, Math.min(items.length - 1, idx));
  items.forEach((el, i) => el.classList.toggle('ativo', i === slicerActive));
  const el = items[slicerActive];
  search.setAttribute('aria-activedescendant', el.id);
  list.setAttribute('aria-activedescendant', el.id);
  if (scroll) {
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 4;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
  }
}

function onSlicerKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); setSlicerActive(slicerActive + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setSlicerActive(slicerActive - 1); }
  else if (e.key === 'PageDown') { e.preventDefault(); setSlicerActive(slicerActive + 5); }
  else if (e.key === 'PageUp') { e.preventDefault(); setSlicerActive(slicerActive - 5); }
  else if (e.key === 'Enter') { e.preventDefault(); const o = slicerItems[slicerActive]; if (o) selectWeek(o.id); }
}

function selectWeek(id, { closeMenu = true } = {}) {
  if (id !== activeWeekId) {
    const previous = activeWeekId;
    activeWeekId = id;
    if (!renderCurrentWeek()) activeWeekId = previous;
    syncUrl();
  }
  if (closeMenu) closeSlicer(true);
}

function updateSlicerUI() {
  const opt = weekOptions.find(o => o.id === activeWeekId) || weekOptions[0];
  if (!opt) return;
  document.getElementById('texto-semana-ativa').textContent = opt.short ? `${opt.title} · ${opt.short}` : opt.title;
  document.getElementById('btn-semana-atual').title = `${opt.title} · ${opt.range}`;
  document.getElementById('limpar-semana').disabled = weekOptions.length < 2 || activeWeekId === weekOptions[0].id;
  renderSlicerList(document.getElementById('busca-semana').value);
}

function renderCurrentWeek() {
  const candidate = getWeekReport(activeWeekId);
  if (!candidate?.proposals?.length || !candidate?.kpis?.length) {
    showToast('A semana selecionada não possui dados completos.');
    return false;
  }
  
  const previousProposalId = report?.proposals?.[selectedProposal]?.id;
  report = candidate;

  document.getElementById('edition-label').textContent = report.edition || 'Relatório semanal';
  document.getElementById('period-label').textContent = report.period || '';
  
  // --- SUBTÍTULO DINÂMICO ---
  let dynSummary = report.summary || '';
  if (report.history && report.history.length > 0 && report.proposals && report.proposals.length > 0) {
    const vals = report.history;
    const curr = vals[vals.length - 1];
    const prev = vals.length > 1 ? vals[vals.length - 2] : null;
    
    // Variação em relação à semana anterior
    const repChange = report.kpis?.[0]?.change;
    let changeVal = repChange != null ? repChange : (prev && prev.value ? ((curr.value - prev.value) / prev.value) * 100 : null);
    let changeText = changeVal != null ? `${changeVal >= 0 ? 'aumentou' : 'caiu'} ${percentage(Math.abs(changeVal))}` : 'teve variação desconhecida';
    
    // Variação em relação à mediana
    let medianDelta = report.median ? ((curr.value - report.median) / report.median) * 100 : null;
    let medianText = medianDelta != null ? `ficou ${percentage(Math.abs(medianDelta))} ${medianDelta >= 0 ? 'acima' : 'abaixo'} da mediana do ano` : 'sem dados de mediana do ano';
    
    // Proposta destaque
    const topP = report.proposals[0];
    const topPName = topP.id;
    const topPShare = percentage(topP.share || 0);
    
    dynSummary = `O engajamento ${changeText} em relação à semana anterior e ${medianText}. O destaque fica para ${topPName}, que concentrou ${topPShare} dos pontos de engajamento da semana.`;
  }
  document.getElementById('cover-summary').textContent = dynSummary;
  // -------------------------

  document.title = `Câmara nas Redes — ${String(report.edition || 'Relatório semanal').split(' · ')[0]}`;

  const headlineKpis = ['ENGAJAMENTO GERAL', 'POSTAGENS', 'POSTAGEM', 'ALCANCE ESTIMADO'];
  renderKpis(report.kpis.filter(k => headlineKpis.includes(String(k.label).toUpperCase())), 'kpi-grid');
  renderKpis(report.kpis, 'analytic-kpis');

  if (forceProposalIdx !== null) {
    selectedProposal = forceProposalIdx;
    forceProposalIdx = null;
  } else {
    const foundIdx = report.proposals.findIndex(p => p.id === previousProposalId);
    selectedProposal = foundIdx >= 0 ? foundIdx : 0;
  }
  
  selectedWeek = Math.max(0, (report.history?.length || 1) - 1);

  renderTrend();
  renderCards();
  renderProposalSuggestions(proposalSearchQuery);
  renderChannelChart();
  renderShareChart();
  renderTopics();
  renderProposalTabs();
  renderProposalDetail();
  renderMethod();
  updateSlicerUI();
  return true;
}

function renderKpis(items,target) {
  const node=document.getElementById(target);
  node.innerHTML=items.map(k=>{
    const isUp = Number(k.change) >= 0;
    const isPostsOrReach = ['POSTAGENS', 'POSTAGEM', 'ALCANCE ESTIMADO'].includes(String(k.label).toUpperCase());
    const showBadge = k.change != null && !(target === 'kpi-grid' && isPostsOrReach);
    const changeBadge = showBadge
      ? `<span class="kpi-change ${isUp ? 'up' : 'down'}">${isUp ? '↑' : '↓'} ${percentage(Math.abs(k.change))}</span>`
      : '';
    return `<article class="kpi-card"><span class="kpi-label">${esc(k.label)}</span><strong class="kpi-value">${formatNumber(k.value,k.format==='compact')}</strong><div class="kpi-foot">${changeBadge}<span>${esc(k.foot||'')}</span></div></article>`;
  }).join('');
}

function svgWrap(viewBox,content,label) { return `<svg viewBox="0 0 ${viewBox}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">${content}</svg>`; }

/* ===== Gráfico de Evolução (Colunas) ===== */
function renderTrend() {
  const chartNode=document.getElementById('trend-chart');
  if(!chartNode) return;
  const W=Math.max(320,Math.round(chartNode.clientWidth||900)), H=260, left=56, right=20, top=32, bottom=46;
  const values=report.history||[];
  if(!values.length){chartNode.innerHTML='<div class="empty-state">Ainda não há histórico semanal na base.</div>';return;}
  selectedWeek=Math.min(selectedWeek,values.length-1);
  
  const rawMax = Math.max(...values.map(x=>x.value||0), report.median||0);
  const order = Math.pow(10, Math.floor(Math.log10(rawMax || 1)));
  let ceilMax = Math.ceil(rawMax / order) * order;
  if (ceilMax === rawMax) ceilMax += order; 
  
  let stepVal = ceilMax / 4;
  if (String(stepVal).charAt(0) === '2' && String(stepVal).includes('.5')) {
      ceilMax = Math.ceil(rawMax / (order/2)) * (order/2);
  }
  
  const y = v => top + (H - bottom - top) * (1 - (v / ceilMax));
  const plotW = W - left - right;
  const colStep = plotW / values.length;
  const barW = Math.min(64, colStep * 0.55);
  const x = i => left + colStep * i + (colStep / 2);
  
  let parts='';
  
  [0, 0.25, 0.5, 0.75, 1].forEach(p => {
    const yy = top + (H - bottom - top) * p;
    const val = ceilMax * (1 - p);
    parts += `<text class="axis-label" x="${left-12}" y="${yy+4}" text-anchor="end" fill="#000">${formatNumber(val, true)}</text>`;
  });
  
  values.forEach((d,i) => {
    const selected = i === selectedWeek;
    const yy = y(d.value);
    const bh = (H - bottom) - yy;
    const xx = x(i) - barW/2;
    
    parts += `<g class="trend-point ${selected?'selected':''}" data-index="${i}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="Semana ${d.week}, ${esc(d.display||formatNumber(d.value,true))} pontos">
      <rect class="bar-trend" style="fill: #134e5e !important; cursor: pointer;" x="${xx}" y="${yy}" width="${barW}" height="${Math.max(0, bh)}" rx="4"/>
      <title>Semana ${d.week}: ${esc(d.display||formatNumber(d.value))}</title>
    </g>
    <text class="value-label" x="${x(i)}" y="${yy-8}" text-anchor="middle" fill="#000">${esc(d.display||formatNumber(d.value,true))}</text>
    <text class="axis-label" x="${x(i)}" y="${H-24}" text-anchor="middle" font-weight="700" fill="#000">${esc(d.label)}</text>
    <text class="axis-label" x="${x(i)}" y="${H-10}" text-anchor="middle" fill="#000">Semana ${d.week}</text>`;
  });

  if (report.median) {
    const yy = y(report.median);
    parts += `<line class="median" x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}" style="${showMedian?'':'display:none'}"/>
              <text class="axis-label median-label" x="${W-right}" y="${yy-7}" text-anchor="end" fill="#000" style="${showMedian?'':'display:none'}">Mediana: ${formatNumber(report.median,true)}</text>`;
  }
  
  chartNode.innerHTML=svgWrap(`${W} ${H}`,parts,'Evolução semanal do engajamento.');
  wireTrendInteractions(values,{W,H,x,y});
  renderTrendDetail(values,selectedWeek);
  
  const toggle=document.getElementById('median-toggle');
  toggle.setAttribute('aria-pressed',String(showMedian));
  toggle.querySelector('.median-toggle-state').textContent=showMedian?'Visível':'Oculta';
  toggle.onclick=()=>{showMedian=!showMedian;document.querySelectorAll('.median,.median-label').forEach(n=>n.style.display=showMedian?'':'none');toggle.setAttribute('aria-pressed',String(showMedian));toggle.querySelector('.median-toggle-state').textContent=showMedian?'Visível':'Oculta';};
}

function getWeekRangeLabel(d){ return d?.range || d?.label || ''; }

function renderTrendDetail(values,index){
  const d=values[index];if(!d)return;
  const previous=values[index-1];
  const reportedChange=index===values.length-1?report.kpis?.[0]?.change:null;
  const change=reportedChange!=null?reportedChange:(previous?.value?((d.value-previous.value)/previous.value)*100:null);
  const medianDelta=report.median?((d.value-report.median)/report.median)*100:null;
  
  const compareBadge = change==null 
    ? `<span class="comparison-change">Sem base anterior</span>` 
    : `<span class="comparison-change ${change<0?'down':'up'}">${change<0?'↓':'↑'} ${percentage(Math.abs(change))} vs. semana anterior</span>`;
    
  const medianText = medianDelta==null
    ? ''
    : `<span class="comparison-median">${medianDelta>=0?'Acima':'Abaixo'} da mediana anual em ${percentage(Math.abs(medianDelta))}</span>`;
    
  document.getElementById('trend-detail').innerHTML=`
    <div class="trend-detail-left">
      <div class="trend-detail-period">
        <span class="trend-detail-index">Semana ${d.week}</span>
        <span>${esc(getWeekRangeLabel(d))}</span>
      </div>
      <div class="trend-detail-value">
        <strong>${esc(d.display||formatNumber(d.value,true))}</strong>
        <span>Pontos de Engajamento</span>
      </div>
    </div>
    <div class="trend-detail-comparison">
      ${compareBadge}
      ${medianText}
    </div>
    <div class="trend-steps">
      <button type="button" data-step="-1" ${index===0?'disabled':''} aria-label="Semana anterior">←</button>
      <span>${index+1} de ${values.length}</span>
      <button type="button" data-step="1" ${index===values.length-1?'disabled':''} aria-label="Próxima semana">→</button>
    </div>
  `;
  document.querySelectorAll('.trend-steps button').forEach(button=>button.addEventListener('click',()=>selectTrendWeek(Math.max(0,Math.min(values.length-1,index+Number(button.dataset.step))))));
}

function selectTrendWeek(index){
  selectedWeek=index;
  document.querySelectorAll('.trend-point').forEach(point=>{const selected=Number(point.dataset.index)===index;point.classList.toggle('selected',selected);point.setAttribute('aria-pressed',String(selected));});
  renderTrendDetail(report.history,index);
}

function wireTrendInteractions(values,geometry){
  const points=[...document.querySelectorAll('.trend-point')];
  points.forEach(point=>{
    const index=Number(point.dataset.index);
    point.addEventListener('click',()=>selectTrendWeek(index));
    point.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();selectTrendWeek(index);}
      if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const next=Math.max(0,Math.min(values.length-1,index+(event.key==='ArrowRight'?1:-1)));points[next].focus();selectTrendWeek(next);}
    });
  });
}

function buildFallbackSummary(p) {
  if (p.summary) return p.summary;
  const parts = [];
  if (p.posts != null && p.authors != null) {
    parts.push(`Reuniu ${formatNumber(p.posts)} publicações de ${formatNumber(p.authors)} autores únicos na semana`);
  } else if (p.posts != null) {
    parts.push(`Reuniu ${formatNumber(p.posts)} publicações monitoradas na semana`);
  }
  if (p.reach != null) {
    parts.push(`com alcance estimado de ${formatNumber(p.reach, true)}`);
  }
  const sentence1 = parts.length ? parts.join(', ') + '.' : '';
  const sentence2 = p.status ? `Situação atual: ${p.status}.` : '';
  return [sentence1, sentence2].filter(Boolean).join(' ') || 'Consulte os dados disponíveis para esta proposta no detalhamento.';
}

function renderCards() {
  const container = document.getElementById('highlight-cards');
  if (!container || !report?.proposals) return;

  const q = normText(proposalSearchQuery).trim();
  const indexedProposals = report.proposals.map((p, idx) => ({ p, idx }));

  const filtered = q
    ? indexedProposals.filter(({ p }) =>
        normText(`${p.id} ${p.description} ${p.status || ''} ${buildFallbackSummary(p)}`).includes(q)
      )
    : indexedProposals.slice(0, 5);

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">Nenhuma proposta encontrada para "<strong>${esc(proposalSearchQuery)}</strong>".</div>`;
    return;
  }

  container.innerHTML = filtered.map(({ p, idx }) => `
    <article class="proposal-card" data-open="${idx}" tabindex="0" role="button" aria-label="Ver detalhes de ${esc(p.id)}">
      <div class="proposal-card-left">
        <div class="proposal-title-row">
          <span class="rank-badge">${idx + 1}º</span>
          <h3>${esc(p.id)}</h3>
        </div>
        <div class="card-metrics">
          <div class="metric-mini">
            <label>ENGAJAMENTO</label>
            <b>${formatNumber(p.engagement)}</b>
          </div>
          <div class="metric-mini">
            <label>(%) DO TOTAL</label>
            <b>${percentage(p.share || 0)}</b>
          </div>
        </div>
      </div>
      <div class="proposal-card-right">
        <div class="proposal-summary">${esc(p.description)}</div>
        <p class="card-copy">${esc(buildFallbackSummary(p))}</p>
      </div>
    </article>
  `).join('');

  container.querySelectorAll('[data-open]').forEach(n => {
    n.addEventListener('click', e => {
      e.stopPropagation();
      openProposal(Number(n.dataset.open));
    });
    n.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openProposal(Number(n.dataset.open));
      }
    });
  });
}

function chartLabelLines(value,maxChars){
  const words=String(value).split(/\s+/),lines=[];let line='';
  words.forEach(word=>{const next=line?`${line} ${word}`:word;if(line&&next.length>maxChars){lines.push(line);line=word}else line=next;});
  if(line)lines.push(line);return lines;
}

function renderBarChart(target, data, {max=null, labels=true, compact=true, colorMap=null}={}) {
  const node=document.getElementById(target);
  if(!node) return;
  if(!data.length){node.innerHTML='<div class="empty-state">Ainda não há dados suficientes para este gráfico.</div>';return;}
  const W=Math.max(320,Math.round(node.clientWidth||420)),top=12,bottom=30,topic=target==='topic-chart',left=topic?Math.max(145,Math.min(176,Math.round(W*.39))):(labels?Math.max(96,Math.min(122,Math.round(W*.29))):34),right=62,rowHeight=topic?44:48,H=Math.max(215,data.length*rowHeight+top+bottom),maxVal=max||Math.max(...data.map(d=>d.value||0))*1.18||1,row=(H-top-bottom)/Math.max(data.length,1),barH=Math.min(19,row*.42),plotW=W-left-right;let out='';
  (W<380?[0,.5,1]:[0,.25,.5,.75,1]).forEach(p=>{const xx=left+plotW*p;out+=`<line class="gridline" x1="${xx}" y1="${top}" x2="${xx}" y2="${H-bottom}"/><text class="axis-label" x="${xx}" y="${H-7}" text-anchor="middle">${formatNumber(maxVal*p,compact)}</text>`;});
  
  data.forEach((d,i)=>{
    const yy = top + row*i + (row-barH)/2;
    const bw = plotW * Math.max(d.value||0,0) / maxVal;
    const lines = chartLabelLines(d.name,topic ? Math.max(16,Math.floor((left-18)/5.4)) : 24);
    const labelY = yy + barH/2 - ((lines.length-1)*5.5);
    const label = lines.map((line,j)=>`<tspan x="${left-8}" dy="${j?11:0}">${esc(line)}</tspan>`).join('');
    
    // Injeção de cor via colorMap
    const fillAttr = (colorMap && colorMap[d.name]) ? `style="fill: ${colorMap[d.name]} !important;"` : '';
    
    out+=`<text class="axis-label chart-category" x="${left-8}" y="${labelY}" text-anchor="end">${label}</text>
          <rect class="bar ${i%2?'bar-secondary':''}" x="${left}" y="${yy}" width="${Math.max(bw,1.5)}" height="${barH}" rx="4" ${fillAttr}><title>${esc(d.name)}: ${esc(d.display||formatNumber(d.value))}</title></rect>
          <text class="value-label" x="${Math.min(W-right+2,left+bw+6)}" y="${yy+barH*.78}">${esc(d.display||formatNumber(d.value,compact))}</text>`;
  });
  
  node.innerHTML=svgWrap(`${W} ${H}`,out,'Gráfico de barras em pontos de engajamento: '+data.map(d=>`${d.name}, ${d.display||formatNumber(d.value)}`).join('; '));
}

function renderChannelChart(){
  const sortedChannels = [...(report.channels || [])].sort((a, b) => b.value - a.value);
  
  renderBarChart('channel-chart', sortedChannels, {
    labels: true, 
    compact: true,
    colorMap: {
      'Instagram': '#C13584',
      'X (Twitter)': '#101010',
      'Facebook': '#1877F2',
      'Bluesky': '#1185FE'
    }
  });
}
function renderTopics(){renderBarChart('topic-chart',report.topics||[],{labels:true,compact:true});}

function renderShareChart() {
  const node=document.getElementById('share-chart'),data=report.proposals.slice(0,5);
  if(!node) return;
  if(!data.length){node.innerHTML='<div class="empty-state">Ainda não há propostas para comparar.</div>';return;}
  const W=Math.max(320,Math.round(node.clientWidth||420)),H=260,left=Math.max(98,Math.min(132,Math.round(W*.31))),right=48,top=12,bottom=30,row=(H-top-bottom)/data.length,plotW=W-left-right;let out='';
  (W<380?[0,.5,1]:[0,.25,.5,.75,1]).forEach(p=>{const xx=left+plotW*p;out+=`<line class="gridline" x1="${xx}" y1="${top}" x2="${xx}" y2="${H-bottom}"/><text class="axis-label" x="${xx}" y="${H-7}" text-anchor="middle">${percentage(p*100)}</text>`;});
  data.forEach((d,i)=>{const yy=top+row*i+(row-18)/2,bw=plotW*Math.min(Math.max(d.share||0,0),100)/100;out+=`<text class="axis-label chart-category" x="${left-8}" y="${yy+12}" text-anchor="end">${esc(d.id)}</text><rect class="bar ${i%2?'bar-secondary':''}" x="${left}" y="${yy}" width="${Math.max(bw,1.5)}" height="18" rx="4"><title>${esc(d.id)} · ${percentage(d.share||0)} do engajamento</title></rect><text class="value-label" x="${Math.min(W-right+2,left+bw+6)}" y="${yy+12}">${percentage(d.share||0)}</text>`;});
  node.innerHTML=svgWrap(`${W} ${H}`,out,'Participação percentual das cinco propostas no engajamento total');
}

function renderProposalTabs() {
  const limit = Math.max(5, selectedProposal + 1);
  const list = report.proposals.slice(0, limit);
  document.getElementById('proposals-range-note').textContent = `01 — 0${list.length}`;
  document.getElementById('proposal-tabs').innerHTML=list.map((p,i)=>`<button class="proposal-tab ${i===selectedProposal?'active':''}" role="tab" aria-selected="${i===selectedProposal}" data-index="${i}"><span class="proposal-tab-rank">${String(i+1).padStart(2,'0')}</span><span>${esc(p.id)}</span></button>`).join('');
  document.querySelectorAll('.proposal-tab').forEach(n=>n.addEventListener('click',()=>{selectedProposal=Number(n.dataset.index);renderProposalTabs();renderProposalDetail();}));
}

function renderProposalDetail() {
  const p=report.proposals[selectedProposal];if(!p){document.getElementById('proposal-detail').innerHTML='<div class="empty-state">Selecione uma proposta para ver o detalhamento.</div>';return;}
  const isUp = Number(p.change) >= 0;
  const kpis=[
    ['Engajamento',formatNumber(p.engagement),p.change!=null?{text:`${isUp?'↑':'↓'} ${percentage(Math.abs(p.change))} vs. semana anterior`,up:isUp}:null],
    ['Postagens',formatNumber(p.posts),null],
    ['Autores',formatNumber(p.authors),null],
    ['Alcance estimado',formatNumber(p.reach),null]
  ];
  const maxChannel=Math.max(...(p.channels||[]).map(c=>c.value||0),1);
  const channels=(p.channels||[]).map(c=>`<div><div class="channel-row-top"><span class="channel-name">${esc(c.name)}</span><span class="channel-value">${esc(c.display||formatNumber(c.value))}</span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.max(2,c.value/maxChannel*100)}%"></div></div></div>`).join('')||'<p class="detail-subtitle">Dados de canal por proposta indisponíveis na base.</p>';
  const args=(p.arguments||[]).map((a,i)=>`<div class="argument-item"><div class="argument-top"><span class="argument-name">${i+1}. ${esc(a.name)}</span><span class="argument-value">${esc(a.count)} · ${percentage(a.share)}</span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(a.share,100)}%"></div></div><p class="argument-description">${esc(a.description)}</p></div>`).join('')||'<p class="detail-subtitle">Análise qualitativa indisponível.</p>';
  document.getElementById('proposal-detail').innerHTML=`<div class="detail-heading"><div><span class="detail-rank">PROPOSTA ${selectedProposal+1} DE ${report.proposals.length}</span><h3>${esc(p.id)}</h3><p class="detail-description">${esc(p.description||'')}</p></div>${p.status?`<span class="status-pill">${esc(p.status)}</span>`:''}</div><div class="detail-kpis">${kpis.map(k=>`<div class="detail-kpi"><small>${k[0]}</small><b>${k[1]}</b>${k[2]?`<span class="${k[2].up?'up':'down'}">${k[2].text}</span>`:''}</div>`).join('')}</div><div class="detail-grid"><article class="detail-panel"><h4>Engajamento por canal</h4><p class="detail-subtitle">Pontos registrados nesta semana</p><div class="channel-list">${channels}</div></article><article class="detail-panel"><h4>O que dizem</h4><p class="detail-subtitle">Argumentos mais frequentes · toque para expandir</p><div class="argument-list">${args}</div></article></div><div class="detail-story"><article class="detail-panel"><h4>O que mobilizou</h4>${esc(p.mobilization||p.summary||'Síntese qualitativa não informada na base para esta proposta.')}</article><article class="detail-panel"><h4>Publicação representativa</h4>${esc(p.sample||'Exemplo não informado na base.')}</article></div>`;
  document.querySelectorAll('.argument-item').forEach(n=>n.addEventListener('click',()=>n.classList.toggle('open')));
}

function openProposal(index){selectedProposal=index;renderProposalTabs();renderProposalDetail();navigateToPage('propostas');}

function renderMethod() {
  const items=(report.methodology||rawPayload?.methodology)?.[activeMethod]||[];
  document.getElementById('method-content').innerHTML=items.map(m=>`<article class="method-card"><h3>${esc(m.title)}</h3><p>${esc(m.text)}</p></article>`).join('');
}

document.querySelectorAll('.method-tab').forEach(b=>b.addEventListener('click',()=>{activeMethod=b.dataset.method;document.querySelectorAll('.method-tab').forEach(x=>x.classList.toggle('active',x===b));renderMethod();}));
const pageIds=['destaques','analitico','propostas','metodologia'];

function renderVisibleCharts(page){
  if(!report)return;
  if(page==='destaques')renderTrend();
  if(page==='analitico'){renderChannelChart();renderShareChart();renderTopics();}
}

function navigateToPage(page,updateHistory=true) {
  if(!pageIds.includes(page))page='destaques';
  document.querySelectorAll('main .section').forEach(section=>section.classList.toggle('active',section.id===page));
  document.querySelectorAll('.nav-link[data-section]').forEach(link=>{const selected=link.dataset.section===page;link.classList.toggle('active',selected);if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  document.body.classList.toggle('page-cover',page==='destaques');
  if(updateHistory&&location.hash!==`#${page}`)history.pushState({page},'',`#${page}`);
  requestAnimationFrame(()=>renderVisibleCharts(page));
  
  const navTop = document.querySelector('.main-nav').offsetTop;
  if (window.scrollY > navTop) {
      window.scrollTo({top: navTop, behavior:'smooth'});
  }
}

document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',event=>{const page=link.getAttribute('href').slice(1);if(pageIds.includes(page)){event.preventDefault();navigateToPage(page);}}));
window.addEventListener('popstate',()=>navigateToPage(location.hash.slice(1),false));
let chartResizeFrame=0;
window.addEventListener('resize',()=>{if(chartResizeFrame)return;chartResizeFrame=requestAnimationFrame(()=>{chartResizeFrame=0;renderVisibleCharts(document.querySelector('main .section.active')?.id);});});

const navEl=document.querySelector('.main-nav');
const setNavH=()=>document.documentElement.style.setProperty('--nav-h',`${navEl.offsetHeight}px`);
setNavH();
if(window.ResizeObserver)new ResizeObserver(setNavH).observe(navEl);else window.addEventListener('resize',setNavH);

loadReport();
navigateToPage(location.hash.slice(1)||'destaques',false);