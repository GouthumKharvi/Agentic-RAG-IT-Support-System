const $ = (id) => document.getElementById(id);
const chat = $('chat'), form = $('chatForm'), question = $('question'), sendBtn = $('sendBtn');
const traceEl = $('trace'), sourceUsed = $('sourceUsed'), sourceChip = $('sourceChip');
const sourcesPanel = $('sourcesPanel'), flow = $('flow');

const SOURCE_LABEL = {
  private_kb: 'Private knowledge base',
  web_search: 'Web search',
  direct: 'Direct reply',
  insufficient_evidence: 'Insufficient evidence',
};

marked.setOptions({ gfm: true, breaks: true });

const esc = (s = '') => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const renderMd = (t) => DOMPurify.sanitize(marked.parse(t || ''), { ADD_ATTR: ['target'] });

/* ---------- theme + mobile panels ---------- */
const root = document.documentElement;
try { const t = localStorage.getItem('theme'); if (t) root.dataset.theme = t; } catch (e) {}
$('themeBtn').onclick = () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
};
$('menuBtn').onclick = () => $('side').classList.toggle('open');
$('traceBtn').onclick = () => $('tracePanel').classList.toggle('open');

/* ---------- workflow graph ---------- */
const NODE_ORDER = ['route', 'retrieve', 'grade', 'web', 'rewrite', 'answer'];
function nodeFor(line) {
  const l = line.toLowerCase();
  if (l.startsWith('router')) return 'route';
  if (l.startsWith('private kb')) return 'retrieve';
  if (l.startsWith('kb evidence') || l.startsWith('web evidence')) return 'grade';
  if (l.startsWith('web fallback')) return 'web';
  if (l.startsWith('query rewrite')) return 'rewrite';
  return 'answer';
}
function resetFlow() { flow.querySelectorAll('li').forEach(li => li.className = ''); }
function setFlow(states) {
  flow.querySelectorAll('li').forEach(li => { li.className = states[li.dataset.node] || ''; });
}
let waitTimer;
function animateWaiting() {
  resetFlow();
  const seq = ['route', 'retrieve', 'grade', 'web', 'answer'];
  let i = 0;
  const step = () => {
    const st = {};
    seq.slice(0, i).forEach(n => st[n] = 'done');
    if (i < seq.length) st[seq[i]] = 'active';
    setFlow(st);
    i = Math.min(i + 1, seq.length - 1);
  };
  step();
  waitTimer = setInterval(step, 1400);
}
function applyTraceToFlow(trace) {
  clearInterval(waitTimer);
  const st = {};
  trace.forEach(t => st[nodeFor(t)] = 'done');
  NODE_ORDER.forEach(n => { if (!st[n]) st[n] = 'skipped'; });
  setFlow(st);
}

/* ---------- trace + sources panels ---------- */
function renderTrace(items = []) {
  if (!items.length) { traceEl.innerHTML = '<div class="empty">No trace.</div>'; return; }
  traceEl.innerHTML = '';
  items.forEach((x, i) => {
    const l = x.toLowerCase();
    const cls = l.includes('weak') || l.includes('rewrite') ? 'warn'
      : l.includes('stopped') ? 'bad'
      : l.includes('web') ? 'web' : '';
    const d = document.createElement('div');
    d.className = `t-item ${cls}`;
    d.style.animationDelay = `${i * 90}ms`;
    d.innerHTML = `<span class="t-dot"></span><div class="t-body">${esc(x)}</div>`;
    traceEl.appendChild(d);
  });
}
function renderSources(cites = []) {
  if (!cites.length) { sourcesPanel.innerHTML = '<div class="empty">No external citations for this answer.</div>'; return; }
  sourcesPanel.innerHTML = cites.map(c => {
    const tag = `<span class="src-tag ${c.type === 'web' ? 'web' : ''}">${c.type === 'web' ? 'Web' : 'KB'}</span>`;
    return c.url
      ? `<a class="src-card" href="${esc(c.url)}" target="_blank" rel="noopener">${tag}${esc(c.title)}</a>`
      : `<div class="src-card">${tag}${esc(c.title)}</div>`;
  }).join('');
}
function setSource(key) {
  sourceUsed.textContent = SOURCE_LABEL[key] || key || '—';
  sourceChip.textContent = SOURCE_LABEL[key] || key || 'Idle';
  sourceChip.className = `chip ${key || ''}`;
}

/* ---------- messages ---------- */
function scrollDown() { chat.scrollTop = chat.scrollHeight; }
function hideWelcome() { const w = $('welcome'); if (w) w.remove(); }

function addUser(text) {
  hideWelcome();
  const d = document.createElement('div');
  d.className = 'msg user';
  d.innerHTML = `<div class="bubble">${esc(text).replace(/\n/g, '<br>')}</div>`;
  chat.appendChild(d); scrollDown();
}
function addThinking() {
  const d = document.createElement('div');
  d.className = 'msg bot';
  d.innerHTML = `<div class="avatar">AI</div><div class="bubble"><div class="thinking"><div class="dots"><i></i><i></i><i></i></div><span>Searching knowledge base…</span></div></div>`;
  chat.appendChild(d); scrollDown();
  return d;
}

function enhanceCode(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.copy-code')) return;
    const b = document.createElement('button');
    b.className = 'copy-code'; b.textContent = 'Copy';
    b.onclick = () => { navigator.clipboard.writeText(pre.innerText.replace(/Copy$/, '').trim()); b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy', 1200); };
    pre.appendChild(b);
  });
  container.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
}

function finishBotMessage(node, data) {
  const bubble = node.querySelector('.bubble');
  const md = bubble.querySelector('.md');
  md.classList.remove('caret');
  md.innerHTML = renderMd(data.answer);
  enhanceCode(md);

  const key = data.source_used || '';
  const chips = (data.citations || []).map(c =>
    c.url ? `<a class="src-chip" href="${esc(c.url)}" target="_blank" rel="noopener" title="${esc(c.title)}">🔗 ${esc(c.title)}</a>`
          : `<span class="src-chip" title="${esc(c.title)}">📄 ${esc(c.title)}</span>`).join('');
  const row = document.createElement('div');
  row.className = 'badge-row';
  row.innerHTML = `<span class="badge ${key}">${esc(SOURCE_LABEL[key] || key)}</span>${chips}
    <div class="actions"><button class="act" data-copy>Copy</button></div>`;
  row.querySelector('[data-copy]').onclick = (e) => {
    navigator.clipboard.writeText(data.answer); e.target.textContent = 'Copied';
    setTimeout(() => e.target.textContent = 'Copy', 1200);
  };
  bubble.appendChild(row);
  scrollDown();
}

/* progressive reveal so the answer "streams" in */
function revealAnswer(node, data) {
  const bubble = node.querySelector('.bubble');
  bubble.innerHTML = '<div class="md caret"></div>';
  const md = bubble.firstChild;
  const full = data.answer || '';
  let i = 0;
  const stepSize = Math.max(6, Math.ceil(full.length / 120));
  return new Promise(resolve => {
    const tick = () => {
      i = Math.min(full.length, i + stepSize);
      md.innerHTML = renderMd(full.slice(0, i));
      scrollDown();
      if (i < full.length) requestAnimationFrame(tick);
      else { finishBotMessage(node, data); resolve(); }
    };
    tick();
  });
}

/* ---------- ask ---------- */
async function askAgent(q) {
  addUser(q);
  question.value = ''; autosize();
  sendBtn.disabled = true;
  renderTrace(['Running LangGraph workflow…']);
  renderSources([]);
  setSource('running'); sourceChip.textContent = 'Running'; sourceUsed.textContent = 'Running…';
  animateWaiting();
  const node = addThinking();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Request failed');
    applyTraceToFlow(data.trace || []);
    renderTrace(data.trace || []);
    renderSources(data.citations || []);
    setSource(data.source_used);
    await revealAnswer(node, data);
  } catch (e) {
    clearInterval(waitTimer); resetFlow();
    node.querySelector('.bubble').innerHTML = `<div class="md"><p><strong>Something went wrong.</strong></p><p>${esc(e.message)}</p></div>`;
    renderTrace(['Request failed']); setSource('insufficient_evidence'); sourceUsed.textContent = 'Error';
  } finally {
    sendBtn.disabled = false; question.focus();
  }
}

/* ---------- composer ---------- */
function autosize() { question.style.height = 'auto'; question.style.height = Math.min(question.scrollHeight, 180) + 'px'; }
question.addEventListener('input', autosize);
question.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = question.value.trim();
  if (q && !sendBtn.disabled) askAgent(q);
});
document.querySelectorAll('.example').forEach(b =>
  b.addEventListener('click', () => askAgent(b.querySelector('span').textContent.trim())));

$('newChat').onclick = () => location.reload();

/* ---------- upload modal ---------- */
const modal = $('uploadModal');
$('openUpload').onclick = () => modal.classList.remove('hidden');
$('closeUpload').onclick = () => modal.classList.add('hidden');
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
$('uploadBtn').onclick = async () => {
  const file = $('fileInput').files[0], key = $('adminKey').value, status = $('uploadStatus');
  if (!file) { status.textContent = 'Choose a file first.'; return; }
  status.textContent = 'Indexing document…';
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await fetch('/api/ingest', { method: 'POST', headers: { 'X-Admin-Key': key }, body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'Upload failed');
    status.textContent = `Indexed ${d.file}: ${d.chunks} chunks.`;
  } catch (e) { status.textContent = `Error: ${e.message}`; }
};