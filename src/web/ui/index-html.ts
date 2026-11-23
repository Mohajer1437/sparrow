/**
 * The Sparrow Operator Console UI (UI-2).
 *
 * Self-contained local operator interface for executing tasks, inspecting pipeline
 * evidence, monitoring live SSE event streams, managing confirmations & test credentials,
 * viewing exact correlated pipeline logs, and inspecting reliability metrics.
 */
export function renderIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sparrow Operator Console</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <div class="logo">
    <h1>Sparrow <span class="badge-operator">operator console</span></h1>
  </div>
  <div id="workspace" class="muted mono"></div>
  <div class="header-actions">
    <button id="btn-execute-task" class="btn-primary" type="button">+ Execute Task</button>
    <button id="dashboard-toggle" class="btn-nav active" type="button">Dashboard</button>
    <button id="reliability-toggle" class="btn-nav" type="button">Reliability</button>
    <button id="capabilities-toggle" class="btn-nav" type="button">Capabilities</button>
    <div id="connection" class="badge">connecting</div>
  </div>
</header>

<!-- Execute Task Modal / Console -->
<div id="modal-execute" class="modal hidden">
  <div class="modal-content">
    <div class="modal-header">
      <h2>Execute Task (Local Operator)</h2>
      <button id="btn-close-modal" class="btn-close" type="button">&times;</button>
    </div>
    <form id="form-execute">
      <div class="form-group">
        <label for="input-task-prompt">Task Prompt <span class="muted">(starts full Sparrow pipeline)</span></label>
        <textarea id="input-task-prompt" rows="4" placeholder="e.g. Inspect app/page.tsx and explain its current structure. Do not modify files." required></textarea>
      </div>
      <div class="form-group">
        <label for="select-execution-mode">Execution Mode</label>
        <select id="select-execution-mode">
          <option value="STANDARD" selected>STANDARD — Full pipeline (governed mutations & verification)</option>
          <option value="READ_ONLY">READ_ONLY — Inspection only (mutation tools & DB writes forbidden)</option>
        </select>
        <div id="mode-desc" class="mode-help muted">STANDARD mode allows plan-driven mutations subject to workspace integrity & mutation safety guards.</div>
      </div>
      <div class="modal-footer">
        <button id="btn-cancel-execute" class="btn-secondary" type="button">Cancel</button>
        <button id="btn-submit-execute" class="btn-primary" type="submit">Start Execution</button>
      </div>
    </form>
  </div>
</div>

<!-- Active Execution Banner -->
<div id="active-banner" class="active-banner hidden">
  <div class="active-banner-info">
    <span class="spinner"></span>
    <span><strong>Active Run:</strong> <span id="active-task-id" class="mono"></span> · <span id="active-run-id" class="mono"></span></span>
    <span id="active-status" class="status PLANNING">PLANNING</span>
    <span id="active-mode" class="badge">STANDARD</span>
    <span id="active-timer" class="mono muted">00:00</span>
  </div>
  <div class="active-banner-actions">
    <button id="btn-view-active" class="btn-sm" type="button">View Run</button>
    <button id="btn-cancel-active" class="btn-sm btn-danger" type="button">Cancel Run</button>
  </div>
</div>

<main>
  <aside>
    <div class="aside-header">
      <div class="panel-title">Recorded Tasks</div>
      <input type="text" id="task-filter" placeholder="Filter tasks..." />
    </div>
    <ul id="task-list"></ul>
  </aside>
  <section id="detail">
    <p class="muted placeholder-text">Select a task or click <strong>+ Execute Task</strong> to start a new run.</p>
  </section>
</main>

<!-- Context Content Viewer Modal -->
<div id="modal-context" class="modal hidden">
  <div class="modal-content large">
    <div class="modal-header">
      <h2 id="modal-context-title">Context Item</h2>
      <button id="btn-close-context-modal" class="btn-close" type="button">&times;</button>
    </div>
    <div id="modal-context-body">
      <pre id="modal-context-content"></pre>
    </div>
  </div>
</div>

<!-- Reliability Drilldown Modal -->
<div id="modal-metric" class="modal hidden">
  <div class="modal-content">
    <div class="modal-header">
      <h2 id="modal-metric-title">Metric Drilldown</h2>
      <button id="btn-close-metric-modal" class="btn-close" type="button">&times;</button>
    </div>
    <div id="modal-metric-body"></div>
  </div>
</div>

<script>${SCRIPT}</script>
</body>
</html>`;
}

const STYLES = `
:root {
  color-scheme: dark;
  --bg: #0d1117;
  --panel: #161b22;
  --panel-hover: #1f242c;
  --line: #30363d;
  --text: #e6edf3;
  --muted: #8b949e;
  --ok: #3fb950;
  --fail: #f85149;
  --warn: #d29922;
  --info: #58a6ff;
  --primary: #238636;
  --primary-hover: #2ea043;
  --danger: #da3633;
  --danger-hover: #f85149;
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:13px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:10px 18px; border-bottom:1px solid var(--line); background:var(--panel); position:sticky; top:0; z-index:10; }
.logo { display:flex; align-items:center; gap:8px; }
header h1 { font-size:15px; margin:0; font-weight:600; display:flex; align-items:center; gap:8px; }
.badge-operator { font-size:10px; font-weight:500; text-transform:uppercase; letter-spacing:0.05em; background:rgba(88,166,255,0.15); color:var(--info); border:1px solid rgba(88,166,255,0.4); padding:2px 6px; border-radius:4px; }
.header-actions { display:flex; align-items:center; gap:8px; }
main { display:grid; grid-template-columns:360px 1fr; min-height:calc(100vh - 53px); }
aside { border-right:1px solid var(--line); padding:12px; overflow-y:auto; max-height:calc(100vh - 53px); background:var(--panel); }
.aside-header { margin-bottom:12px; }
.aside-header input { width:100%; padding:6px 10px; background:#0d1117; border:1px solid var(--line); border-radius:6px; color:var(--text); font-size:12px; }
section#detail { padding:18px 24px; overflow-y:auto; max-height:calc(100vh - 53px); }
.panel-title { text-transform:uppercase; letter-spacing:.08em; font-size:11px; color:var(--muted); margin:4px 0 8px; font-weight:600; }
ul { list-style:none; margin:0; padding:0; }
#task-list li { padding:10px; border:1px solid var(--line); border-radius:6px; margin-bottom:8px; cursor:pointer; background:#0d1117; transition:border-color .15s, background-color .15s; }
#task-list li:hover { border-color:var(--info); background:var(--panel-hover); }
#task-list li.active { border-color:var(--info); background:rgba(88,166,255,0.08); box-shadow:0 0 0 1px var(--info) inset; }
.task-text { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; margin-bottom:6px; }
.task-meta { display:flex; align-items:center; justify-content:space-between; gap:6px; font-size:11px; }
.muted { color:var(--muted); }
.mono { font-family:ui-monospace, SFMono-Regular, Consolas, monospace; font-size:12px; }
.badge { font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); color:var(--muted); }
.status { font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--line); font-weight:600; }
.status.COMPLETED, .status.SUCCEEDED, .status.PASS, .status.APPROVED, .status.ALLOW { color:var(--ok); border-color:var(--ok); background:rgba(63,185,80,0.1); }
.status.FAILED, .status.FAIL, .status.BLOCKED, .status.REJECTED, .status.BLOCK { color:var(--fail); border-color:var(--fail); background:rgba(248,81,73,0.1); }
.status.REPAIR, .status.VERIFICATION, .status.UNKNOWN, .status.PENDING, .status.REQUIRES_TEST_CREDENTIAL { color:var(--warn); border-color:var(--warn); background:rgba(210,153,34,0.1); }
.status.PLANNING, .status.CONTEXT, .status.EXECUTION { color:var(--info); border-color:var(--info); background:rgba(88,166,255,0.1); }

/* Buttons */
button { font-family:inherit; cursor:pointer; }
.btn-primary { background:var(--primary); color:#fff; border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:6px 14px; font-weight:500; transition:background .15s; }
.btn-primary:hover { background:var(--primary-hover); }
.btn-primary:disabled { opacity:0.5; cursor:not-allowed; }
.btn-secondary { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:6px 14px; }
.btn-secondary:hover { background:var(--panel-hover); }
.btn-danger { background:var(--danger); color:#fff; border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:6px 12px; font-weight:500; }
.btn-danger:hover { background:var(--danger-hover); }
.btn-sm { padding:3px 8px; font-size:11px; border-radius:4px; border:1px solid var(--line); background:var(--panel); color:var(--text); }
.btn-sm:hover { background:var(--panel-hover); border-color:var(--info); }
.btn-nav { background:none; border:1px solid var(--line); border-radius:6px; color:var(--text); padding:5px 10px; font-size:12px; }
.btn-nav.active { border-color:var(--info); color:var(--info); background:rgba(88,166,255,0.1); }
.btn-close { background:none; border:none; font-size:20px; color:var(--muted); line-height:1; }
.btn-close:hover { color:var(--text); }
.btn-action { font-size:12px; padding:4px 10px; border-radius:4px; border:1px solid var(--line); margin-right:6px; }

/* Tabs */
nav.tabs { display:flex; gap:6px; flex-wrap:wrap; margin:16px 0; border-bottom:1px solid var(--line); padding-bottom:8px; }
nav.tabs button { background:none; color:var(--muted); border:1px solid transparent; border-radius:6px; padding:5px 11px; font-size:12px; font-weight:500; }
nav.tabs button:hover { color:var(--text); background:var(--panel); }
nav.tabs button.active { border-color:var(--line); color:var(--info); background:var(--panel); border-bottom-color:var(--info); }

/* Run detail header */
.run-header { border:1px solid var(--line); border-radius:8px; padding:16px; margin-bottom:16px; background:var(--panel); }
.run-header-top { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:12px; }
.run-header-title { font-size:16px; font-weight:600; margin:0 0 6px; }
.run-identifiers { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:8px 16px; font-size:12px; background:#0d1117; padding:12px; border-radius:6px; border:1px solid var(--line); margin-bottom:12px; }
.id-item { display:flex; flex-direction:column; gap:2px; }
.id-label { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.04em; }
.id-value { font-weight:500; }

/* Log File Evidence Box */
.log-evidence-box { background:rgba(88,166,255,0.06); border:1px solid rgba(88,166,255,0.3); border-radius:6px; padding:10px 14px; margin-top:10px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; }
.log-evidence-info { display:flex; align-items:center; gap:8px; font-size:12px; }
.log-evidence-actions { display:flex; gap:6px; }

/* Runs Bar */
.runs-bar { display:flex; align-items:center; gap:8px; margin-bottom:14px; background:var(--panel); padding:8px 12px; border-radius:6px; border:1px solid var(--line); overflow-x:auto; }
.run-chip { padding:4px 10px; border-radius:4px; border:1px solid var(--line); background:#0d1117; cursor:pointer; font-size:11px; display:flex; align-items:center; gap:6px; }
.run-chip.active { border-color:var(--info); background:rgba(88,166,255,0.12); color:var(--info); }

/* Tables & Cards */
table { width:100%; border-collapse:collapse; margin-bottom:16px; background:#0d1117; border-radius:6px; overflow:hidden; border:1px solid var(--line); }
th, td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--line); vertical-align:top; font-size:12px; }
th { background:var(--panel); color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
tr:last-child td { border-bottom:none; }
.card { border:1px solid var(--line); border-radius:6px; padding:14px; margin-bottom:12px; background:var(--panel); }
.card-header { font-weight:600; font-size:13px; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; }
.card-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; }
pre { background:#080a0d; border:1px solid var(--line); border-radius:6px; padding:12px; overflow-x:auto; max-height:450px; font-size:12px; font-family:ui-monospace, SFMono-Regular, Consolas, monospace; line-height:1.4; color:#c9d1d9; }
.notice { border-left:3px solid var(--warn); padding:8px 12px; background:rgba(210,153,34,0.08); margin-bottom:12px; border-radius:0 4px 4px 0; }
.error { border-left:3px solid var(--fail); padding:8px 12px; background:rgba(248,81,73,0.08); margin-bottom:12px; border-radius:0 4px 4px 0; }
.success-banner { border-left:3px solid var(--ok); padding:8px 12px; background:rgba(63,185,80,0.08); margin-bottom:12px; border-radius:0 4px 4px 0; }

/* Modals */
.modal { position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:100; backdrop-filter:blur(2px); }
.modal.hidden { display:none; }
.modal-content { background:var(--panel); border:1px solid var(--line); border-radius:8px; width:520px; max-width:90vw; padding:20px; box-shadow:0 8px 24px rgba(0,0,0,0.5); max-height:85vh; overflow-y:auto; }
.modal-content.large { width:800px; }
.modal-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; border-bottom:1px solid var(--line); padding-bottom:10px; }
.modal-header h2 { font-size:16px; margin:0; }
.modal-footer { display:flex; justify-content:flex-end; gap:8px; margin-top:20px; padding-top:12px; border-top:1px solid var(--line); }
.form-group { margin-bottom:14px; }
.form-group label { display:block; font-weight:500; font-size:12px; margin-bottom:6px; }
.form-group textarea, .form-group select, .form-group input { width:100%; padding:8px 10px; background:#0d1117; border:1px solid var(--line); border-radius:6px; color:var(--text); font-size:13px; font-family:inherit; }
.form-group textarea:focus, .form-group select:focus, .form-group input:focus { outline:none; border-color:var(--info); }
.mode-help { font-size:11px; margin-top:4px; }

/* Active Banner */
.active-banner { background:#1f2a3c; border-bottom:1px solid var(--info); padding:8px 18px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:49px; z-index:9; }
.active-banner.hidden { display:none; }
.active-banner-info { display:flex; align-items:center; gap:12px; font-size:12px; }
.active-banner-actions { display:flex; gap:8px; }
.spinner { display:inline-block; width:12px; height:12px; border:2px solid rgba(88,166,255,0.3); border-top-color:var(--info); border-radius:50%; animation:spin 1s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }

/* Outcome Card (UX-OUTCOME.14) */
.outcome-card { border-radius:6px; padding:14px 16px; margin-bottom:14px; border:1px solid var(--line); background:#0d1117; }
.outcome-card.status-SUCCESS, .outcome-card.status-SUCCESS_AFTER_REPAIR { border-color:var(--ok); background:rgba(63,185,80,0.06); }
.outcome-card.status-FAILED { border-color:var(--fail); background:rgba(248,81,73,0.06); }
.outcome-card.status-BLOCKED { border-color:var(--warn); background:rgba(210,153,34,0.06); }
.outcome-card.status-PAUSED { border-color:var(--info); background:rgba(88,166,255,0.06); }
.outcome-card.status-REJECTED, .outcome-card.status-CANCELLED { border-color:var(--muted); background:rgba(139,148,158,0.06); }
.outcome-card-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.outcome-card-title { font-size:14px; font-weight:600; display:flex; align-items:center; gap:8px; }
.outcome-card-body { font-size:13px; line-height:1.5; color:var(--text); }
.outcome-card-body ul { margin:6px 0 0 18px; padding:0; }
.outcome-card-body li { margin-bottom:3px; }

/* Stage Timeline */
.stage-timeline { display:flex; flex-direction:column; gap:8px; margin-bottom:20px; }
.stage-card { display:grid; grid-template-columns:160px 120px 1fr; gap:12px; padding:10px 14px; border:1px solid var(--line); border-radius:6px; background:#0d1117; align-items:center; font-size:12px; }
.stage-number { font-weight:700; color:var(--info); margin-right:6px; }

/* Event Items */
.event-item { padding:8px 12px; border-bottom:1px solid var(--line); font-size:12px; display:grid; grid-template-columns:60px 140px 140px 1fr 40px; gap:8px; align-items:center; }
.event-item:hover { background:var(--panel-hover); }
`;

const SCRIPT = `
const state = {
  taskId: null,
  runId: null,
  tab: 'timeline',
  tasks: [],
  view: 'dashboard',
  reliabilityWindow: 'all',
  reliabilityPopulation: 'ALL_RUNS',
  metric: null,
  activeRun: null,
  timerInterval: null,
  eventSource: null,
  lastSeq: 0,
};

const TABS = [
  'timeline','task','planner','skills','context','version','plan','execution',
  'mutation','workspace','verification','backend','database','failure','repair',
  'confirmations','reliability','impact','regression','capabilities','events','logs'
];

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function statusChip(value) {
  return '<span class="status ' + esc(value) + '">' + esc(value) + '</span>';
}

function list(values) {
  return (values && values.length) ? values.map(esc).join(', ') : '<span class="muted">(none)</span>';
}

async function api(path, options) {
  const res = await fetch('/api/v1' + path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return body;
}

async function postApi(path, data) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data || {}),
  });
}

// Copy helper with feedback
function copyToClipboard(text, btnElement) {
  navigator.clipboard.writeText(text).then(() => {
    if (btnElement) {
      const orig = btnElement.textContent;
      btnElement.textContent = 'Copied!';
      setTimeout(() => { btnElement.textContent = orig; }, 1500);
    }
  });
}

// Workspace init
async function loadWorkspace() {
  try {
    const info = await api('/workspace');
    document.getElementById('workspace').textContent = 'Workspace: ' + info.workspaceRoot + ' (local loopback operator)';
  } catch {
    document.getElementById('workspace').textContent = 'Workspace: unavailable';
  }
}

// Tasks list loader
async function loadTasks() {
  try {
    const res = await api('/tasks?limit=50');
    state.tasks = res.tasks || [];
    renderTaskList();
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
}

function renderTaskList() {
  const el = document.getElementById('task-list');
  const filter = (document.getElementById('task-filter').value || '').toLowerCase();
  const filtered = state.tasks.filter(t => !filter || t.task.toLowerCase().includes(filter) || t.taskId.toLowerCase().includes(filter));

  if (!filtered.length) {
    el.innerHTML = '<li class="muted">No recorded runs found.</li>';
    return;
  }

  el.innerHTML = filtered.map(t => {
    const isActive = t.taskId === state.taskId;
    return '<li data-id="' + esc(t.taskId) + '" class="' + (isActive ? 'active' : '') + '">'
      + '<span class="task-text">' + esc(t.task) + '</span>'
      + '<div class="task-meta">'
      + '<span>' + statusChip(t.phase || t.status) + ' ' + (t.executionMode ? '<span class="badge">' + esc(t.executionMode) + '</span>' : '') + '</span>'
      + '<span class="muted">' + esc(t.startedAt ? t.startedAt.substring(11, 19) : '') + '</span>'
      + '</div>'
      + '</li>';
  }).join('');

  el.querySelectorAll('li[data-id]').forEach(item => {
    item.addEventListener('click', () => {
      selectTask(item.getAttribute('data-id'));
    });
  });
}

async function selectTask(taskId, runId) {
  state.taskId = taskId;
  state.runId = runId || null;
  state.view = 'task';
  renderTaskList();
  await loadTaskDetail();
}

async function loadTaskDetail() {
  const container = document.getElementById('detail');
  if (!state.taskId) {
    container.innerHTML = '<p class="muted">Select a task to inspect its pipeline.</p>';
    return;
  }

  try {
    const [task, runsRes, logInfo, outcome] = await Promise.all([
      api('/tasks/' + encodeURIComponent(state.taskId)),
      api('/tasks/' + encodeURIComponent(state.taskId) + '/runs'),
      api('/tasks/' + encodeURIComponent(state.taskId) + (state.runId ? '/runs/' + encodeURIComponent(state.runId) : '') + '/logs').catch(() => null),
      api('/tasks/' + encodeURIComponent(state.taskId) + (state.runId ? '/runs/' + encodeURIComponent(state.runId) : '') + '/outcome').catch(() => null),
    ]);

    const runs = runsRes.runs || [];
    const activeRun = (state.runId && runs.find(r => r.runId === state.runId)) || runs[0] || task;
    state.runId = activeRun.runId || task.runId;

    let html = '<div class="run-header">';
    html += '<div class="run-header-top">';
    html += '<div>';
    html += '<h2 class="run-header-title">' + esc(task.task) + '</h2>';
    html += '<div class="muted">Original Prompt</div>';
    html += '</div>';
    html += '<div>' + statusChip(activeRun.phase || activeRun.status || task.liveStatus || task.status) + ' ' + (task.executionMode ? '<span class="badge">' + esc(task.executionMode) + '</span>' : '') + '</div>';
    html += '</div>';

    // Concise Outcome Summary Card (UX-OUTCOME.14)
    const effectiveOutcome = outcome || activeRun.outcomeSummary || task.outcomeSummary;
    if (effectiveOutcome) {
      const isSuccess = effectiveOutcome.status === 'SUCCESS' || effectiveOutcome.status === 'SUCCESS_AFTER_REPAIR';
      const isPaused = effectiveOutcome.status === 'PAUSED';
      const isBlocked = effectiveOutcome.status === 'BLOCKED';
      const icon = isSuccess ? '✓' : isPaused ? '⏸' : isBlocked ? '⊘' : '✗';
      html += '<div class="outcome-card status-' + esc(effectiveOutcome.status) + '">';
      html += '<div class="outcome-card-header">';
      html += '<div class="outcome-card-title"><span>' + icon + '</span> <strong>' + esc(effectiveOutcome.outcome) + '</strong></div>';
      html += '<span class="badge">' + esc(effectiveOutcome.reasonCode) + '</span>';
      html += '</div>';
      html += '<div class="outcome-card-body">';
      if (isSuccess) {
        if (effectiveOutcome.changedFiles && effectiveOutcome.changedFiles.length > 0) {
          html += '<div><strong>Changed files (' + effectiveOutcome.changedFiles.length + '):</strong><ul>';
          effectiveOutcome.changedFiles.forEach(f => {
            html += '<li><code>' + esc(f) + '</code></li>';
          });
          html += '</ul></div>';
        } else {
          html += '<div class="muted">No files were changed.</div>';
        }
      } else {
        html += '<div><strong>Reason:</strong> ' + esc(effectiveOutcome.reason) + '</div>';
        if (effectiveOutcome.expectedWorkspace && effectiveOutcome.activeWorkspace) {
          html += '<div class="mono" style="margin-top:6px;font-size:11px;background:#080a0d;padding:6px 10px;border-radius:4px;border:1px solid var(--line);">';
          html += 'Expected: ' + esc(effectiveOutcome.expectedWorkspace) + '<br/>Active:   ' + esc(effectiveOutcome.activeWorkspace);
          html += '</div>';
        }
        if (effectiveOutcome.failurePrimaryCheck) {
          html += '<div style="margin-top:4px;"><strong>Primary check:</strong> <code>' + esc(effectiveOutcome.failurePrimaryCheck) + '</code></div>';
        }
        if (effectiveOutcome.nextAction) {
          html += '<div class="muted" style="margin-top:4px;"><strong>Next:</strong> ' + esc(effectiveOutcome.nextAction) + '</div>';
        }
      }
      html += '</div>';
      html += '</div>';
    }

    // Identifiers Grid
    html += '<div class="run-identifiers">';
    html += '<div class="id-item"><span class="id-label">Task ID</span><span class="id-value mono">' + esc(task.taskId) + '</span></div>';
    html += '<div class="id-item"><span class="id-label">Run ID</span><span class="id-value mono">' + esc(activeRun.runId || task.runId || '-') + '</span></div>';
    html += '<div class="id-item"><span class="id-label">Session ID</span><span class="id-value mono">' + esc(task.sessionId || activeRun.sessionId || '-') + '</span></div>';
    html += '<div class="id-item"><span class="id-label">Attempt</span><span class="id-value mono">' + (activeRun.attemptCount ? 'attempt-' + activeRun.attemptCount : (task.attemptCount ? 'attempt-' + task.attemptCount : 'attempt-1')) + '</span></div>';
    html += '<div class="id-item"><span class="id-label">Execution Mode</span><span class="id-value mono">' + esc(task.executionMode || 'STANDARD') + '</span></div>';
    html += '<div class="id-item"><span class="id-label">Fingerprint</span><span class="id-value mono">' + esc((activeRun.fingerprint || task.fingerprint || '-').substring(0, 16)) + '...</span></div>';
    html += '</div>';

    // Mandatory Log File Evidence Box (UI-2.11)
    if (logInfo && logInfo.status === 'FOUND') {
      html += '<div class="log-evidence-box">';
      html += '<div class="log-evidence-info">';
      html += '<strong>Pipeline Log:</strong> <span class="mono" id="log-file-name">' + esc(logInfo.fileName) + '</span>';
      html += '<span class="muted">(' + esc(logInfo.directory) + ' · ' + (logInfo.eventCount || 0) + ' events)</span>';
      html += '</div>';
      html += '<div class="log-evidence-actions">';
      html += '<button class="btn-sm" id="btn-copy-logfile" type="button">Copy Filename</button>';
      html += '<button class="btn-sm" id="btn-copy-logpath" type="button">Copy Path</button>';
      html += '<button class="btn-sm" id="btn-view-rawlogs" type="button">View Raw Logs</button>';
      html += '</div>';
      html += '</div>';
    } else {
      html += '<div class="log-evidence-box" style="border-color:var(--line);">';
      html += '<div class="log-evidence-info muted">';
      html += '<strong>Pipeline Log:</strong> NOT_CREATED (' + esc(logInfo?.reason || 'no log file associated') + ')';
      html += '</div>';
      html += '</div>';
    }

    html += '</div>';

    // Runs Bar if multiple runs exist (UI-2.5)
    if (runs.length > 1) {
      html += '<div class="runs-bar">';
      html += '<span class="muted" style="font-size:11px;font-weight:600;">RUNS (' + runs.length + '):</span>';
      runs.forEach((r, idx) => {
        const isCur = r.runId === state.runId;
        html += '<div class="run-chip ' + (isCur ? 'active' : '') + '" data-run-id="' + esc(r.runId) + '">';
        html += '<span>#' + (idx + 1) + ' ' + esc(r.runId.substring(0, 14)) + '</span>';
        html += statusChip(r.status);
        html += '</div>';
      });
      html += '</div>';
    }

    // Navigation Tabs
    html += '<nav class="tabs">';
    TABS.forEach(tab => {
      const isActive = state.tab === tab;
      html += '<button type="button" class="' + (isActive ? 'active' : '') + '" data-tab="' + tab + '">' + tab.toUpperCase() + '</button>';
    });
    html += '</nav>';

    // Tab Content Container
    html += '<div id="tab-content">Loading tab...</div>';

    container.innerHTML = html;

    // Attach Log Button Handlers
    if (logInfo && logInfo.status === 'FOUND') {
      document.getElementById('btn-copy-logfile')?.addEventListener('click', function () {
        copyToClipboard(logInfo.fileName, this);
      });
      document.getElementById('btn-copy-logpath')?.addEventListener('click', function () {
        copyToClipboard(logInfo.relativePath || logInfo.absolutePath, this);
      });
      document.getElementById('btn-view-rawlogs')?.addEventListener('click', () => {
        switchTab('logs');
      });
    }

    // Attach Run Chip Click Handlers
    container.querySelectorAll('.run-chip[data-run-id]').forEach(chip => {
      chip.addEventListener('click', () => {
        selectTask(state.taskId, chip.getAttribute('data-run-id'));
      });
    });

    // Attach Tab Handlers
    container.querySelectorAll('nav.tabs button[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.getAttribute('data-tab'));
      });
    });

    await renderActiveTab(task);
  } catch (err) {
    container.innerHTML = '<div class="error">Failed to load task: ' + esc(err.message) + '</div>';
  }
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('nav.tabs button').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tab);
  });
  renderActiveTab();
}

async function renderActiveTab(taskSnapshot) {
  const content = document.getElementById('tab-content');
  if (!content) return;
  content.innerHTML = '<span class="muted">Loading ' + esc(state.tab) + '...</span>';

  const taskId = state.taskId;
  const runId = state.runId;
  const pathPrefix = '/tasks/' + encodeURIComponent(taskId) + (runId ? '/runs/' + encodeURIComponent(runId) : '');

  try {
    switch (state.tab) {
      case 'timeline': {
        const timeline = await api(pathPrefix + '/timeline');
        let html = '<div class="stage-timeline">';
        timeline.stages.forEach((st, idx) => {
          html += '<div class="stage-card">';
          html += '<div><span class="stage-number">[' + (idx + 1) + ']</span><strong>' + esc(st.stage) + '</strong></div>';
          html += '<div>' + statusChip(st.status) + '</div>';
          html += '<div class="muted">' + esc(st.detail) + (st.at ? ' <span class="mono">(' + st.at.substring(11, 19) + ')</span>' : '') + '</div>';
          html += '</div>';
        });
        html += '</div>';
        content.innerHTML = html;
        break;
      }
      case 'task': {
        const task = taskSnapshot || await api('/tasks/' + encodeURIComponent(taskId));
        let html = '<div class="card-grid">';
        html += '<div class="card"><div class="card-header">Task Overview</div>';
        html += '<p><strong>Prompt:</strong> ' + esc(task.task) + '</p>';
        html += '<p><strong>Role:</strong> ' + esc(task.roleId || 'coder') + '</p>';
        html += '<p><strong>Started:</strong> ' + esc(task.startedAt || '-') + '</p>';
        html += '<p><strong>Completed:</strong> ' + esc(task.completedAt || '-') + '</p>';
        html += '</div>';
        if (task.project) {
          html += '<div class="card"><div class="card-header">Project Profile</div>';
          html += '<p><strong>Type:</strong> ' + esc(task.project.projectType) + '</p>';
          html += '<p><strong>Frameworks:</strong> ' + list(task.project.detectedFrameworks) + '</p>';
          html += '<p><strong>Languages:</strong> ' + list(task.project.languages) + '</p>';
          html += '<p><strong>Testing Tools:</strong> ' + list(task.project.availableTestingTools) + '</p>';
          html += '</div>';
        }
        html += '</div>';
        content.innerHTML = html;
        break;
      }
      case 'planner': {
        const context = await api(pathPrefix + '/context');
        let html = '<div class="card"><div class="card-header">Planner Context Summary</div>';
        html += '<p>' + esc(context.plannerContextSummary || 'PlannerContext was assembled from selected sources.') + '</p>';
        if (context.strategy) {
          html += '<h4>Context Strategy</h4>';
          html += '<p><strong>Selected Sources:</strong> ' + list(context.strategy.selectedSources) + '</p>';
          html += '<p><strong>Required:</strong> ' + list(context.strategy.requiredSources) + '</p>';
          html += '<p><strong>Missing Required:</strong> ' + list(context.strategy.missingRequired) + '</p>';
          html += '<p><strong>Repair Mode:</strong> ' + (context.strategy.repairMode ? 'YES' : 'NO') + '</p>';
        }
        html += '</div>';
        content.innerHTML = html;
        break;
      }
      case 'skills': {
        const skillsData = await api(pathPrefix + '/skills');
        let html = '<table><thead><tr><th>Skill ID</th><th>Domain</th><th>Frameworks</th><th>Resolution Source</th><th>Required Checks</th></tr></thead><tbody>';
        if (!skillsData.skills || !skillsData.skills.length) {
          html += '<tr><td colspan="5" class="muted">No skills resolved for this run.</td></tr>';
        } else {
          skillsData.skills.forEach(s => {
            html += '<tr><td class="mono"><strong>' + esc(s.id) + '</strong></td><td>' + esc(s.domain) + '</td><td>' + list(s.frameworks) + '</td><td>' + esc(s.resolutionSource || 'rules') + '</td><td>' + list(s.requiredChecks) + '</td></tr>';
          });
        }
        html += '</tbody></table>';
        content.innerHTML = html;
        break;
      }
      case 'context': {
        const ctx = await api(pathPrefix + '/context');
        let html = '<div class="card-header">Gathered Context Items (' + (ctx.items?.length || 0) + ')</div>';
        html += '<table><thead><tr><th>#</th><th>Source</th><th>Reference</th><th>Status</th><th>Size</th><th>Method</th><th>Action</th></tr></thead><tbody>';
        (ctx.items || []).forEach(item => {
          html += '<tr>'
            + '<td>' + item.index + '</td>'
            + '<td>' + esc(item.source) + '</td>'
            + '<td class="mono">' + esc(item.reference) + '</td>'
            + '<td>' + statusChip(item.status) + '</td>'
            + '<td>' + item.sizeBytes + ' B' + (item.truncated ? ' (truncated)' : '') + '</td>'
            + '<td>' + esc(item.collectionMethod) + '</td>'
            + '<td><button class="btn-sm" onclick="viewContextItem(' + item.index + ')">View</button></td>'
            + '</tr>';
        });
        html += '</tbody></table>';
        content.innerHTML = html;
        break;
      }
      case 'version': {
        const ver = await api(pathPrefix + '/version');
        let html = '<div class="card"><div class="card-header">Version Intelligence</div><p>' + esc(ver.versionIntelligence?.summary || 'No version intelligence recorded.') + '</p></div>';
        if (ver.versionIntelligence?.items?.length) {
          html += '<table><thead><tr><th>Technology</th><th>Declared</th><th>Resolved</th><th>Source</th><th>Status</th><th>Provenance</th></tr></thead><tbody>';
          ver.versionIntelligence.items.forEach(it => {
            html += '<tr><td><strong>' + esc(it.technology) + '</strong></td><td class="mono">' + esc(it.declaredVersion || '-') + '</td><td class="mono">' + esc(it.resolvedVersion || '-') + '</td><td>' + esc(it.versionSource) + '</td><td>' + statusChip(it.status) + '</td><td>' + esc(it.provenance) + '</td></tr>';
          });
          html += '</tbody></table>';
        }
        content.innerHTML = html;
        break;
      }
      case 'plan': {
        const plan = await api(pathPrefix + '/todos');
        let html = '<div class="card"><div class="card-header">TodoPlan Goal</div><p>' + esc(plan.todoPlan?.goal || 'No TodoPlan recorded.') + '</p></div>';
        if (plan.todoPlan?.todos?.length) {
          html += '<table><thead><tr><th>ID</th><th>Title</th><th>Dependencies</th><th>Execution</th><th>V&V Verdict</th><th>Risk</th></tr></thead><tbody>';
          plan.todoPlan.todos.forEach(todo => {
            const statusInfo = (plan.todoStatuses || []).find(s => s.todoId === todo.id);
            html += '<tr>'
              + '<td class="mono"><strong>' + esc(todo.id) + '</strong></td>'
              + '<td>' + esc(todo.title) + '<br><span class="muted">' + esc(todo.description) + '</span></td>'
              + '<td class="mono">' + list(todo.dependencies) + '</td>'
              + '<td>' + statusChip(statusInfo?.executionStatus || 'PENDING') + '</td>'
              + '<td>' + statusChip(statusInfo?.verificationVerdict || 'UNKNOWN') + ' <span class="muted">(' + esc(statusInfo?.verificationScope || 'WHOLE_RUN') + ')</span></td>'
              + '<td><span class="badge">' + esc(todo.risk || 'LOW') + '</span></td>'
              + '</tr>';
          });
          html += '</tbody></table>';
        }
        content.innerHTML = html;
        break;
      }
      case 'execution': {
        const exec = await api(pathPrefix + '/execution');
        let html = '<table><thead><tr><th>Step</th><th>Todo</th><th>Tool</th><th>Status</th><th>Completed</th><th>Files</th></tr></thead><tbody>';
        if (!exec.steps || !exec.steps.length) {
          html += '<tr><td colspan="6" class="muted">No execution steps recorded.</td></tr>';
        } else {
          exec.steps.forEach(st => {
            html += '<tr><td class="mono">' + esc(st.stepId) + '</td><td class="mono">' + esc(st.sourceTodoId || '-') + '</td><td>' + list(st.requiredTools) + '</td><td>' + statusChip(st.status) + '</td><td>' + (st.completedAt ? st.completedAt.substring(11,19) : '-') + '</td><td>' + list(st.files) + '</td></tr>';
          });
        }
        html += '</tbody></table>';
        content.innerHTML = html;
        break;
      }
      case 'mutation': {
        const ws = await api(pathPrefix + '/workspace');
        const mut = ws.mutationSafety;
        let html = '';
        if (!mut) {
          html = '<div class="notice">No mutation safety ledger recorded for this run.</div>';
        } else {
          html += '<div class="card"><div class="card-header">Mutation Accounting</div>';
          html += '<p>Attempts: <strong>' + mut.mutationAttempts + '</strong> · Applied: <strong style="color:var(--ok);">' + mut.successfulMutations + '</strong> · Rejected: <strong>' + mut.rejectedMutations + '</strong> · Blocked: <strong>' + mut.blockedMutations + '</strong> · Rolled Back: <strong>' + mut.rolledBackMutations + '</strong></p></div>';
          html += '<table><thead><tr><th>Path</th><th>Operation</th><th>Tool</th><th>Status</th><th>Decision</th><th>Diff</th><th>Rollback</th></tr></thead><tbody>';
          (mut.mutations || []).forEach(m => {
            html += '<tr><td class="mono">' + esc(m.path) + '</td><td>' + esc(m.operation) + '</td><td>' + esc(m.toolName) + '</td><td>' + statusChip(m.status) + '</td><td>' + statusChip(m.decision) + '</td><td>+' + m.linesAdded + '/-' + m.linesRemoved + '</td><td>' + (m.rolledBack ? (m.rollbackVerified ? 'VERIFIED' : 'FAILED') : '-') + '</td></tr>';
          });
          html += '</tbody></table>';
        }
        content.innerHTML = html;
        break;
      }
      case 'workspace': {
        const ws = await api(pathPrefix + '/workspace');
        let html = '<div class="card-grid">';
        if (ws.workspaceComparison) {
          html += '<div class="card"><div class="card-header">Workspace Comparison</div>';
          html += '<p><strong>State:</strong> ' + statusChip(ws.workspaceComparison.state) + '</p>';
          html += '<p><strong>Intended Changed:</strong> ' + list(ws.workspaceComparison.intendedChangedFiles) + '</p>';
          html += '<p><strong>Actual Changed:</strong> ' + list(ws.workspaceComparison.actualChangedFiles) + '</p>';
          html += '<p><strong>Unintended:</strong> ' + list(ws.workspaceComparison.unintendedChangedFiles) + '</p>';
          html += '<p><strong>Wrong File Modification:</strong> ' + statusChip(ws.workspaceComparison.wrongFileModification) + '</p>';
          html += '</div>';
        }
        if (ws.workspaceIntegrity) {
          html += '<div class="card"><div class="card-header">Workspace Integrity</div>';
          html += '<p><strong>Modified:</strong> ' + list(ws.workspaceIntegrity.filesModified) + '</p>';
          html += '<p><strong>Created:</strong> ' + list(ws.workspaceIntegrity.filesCreated) + '</p>';
          html += '<p><strong>Deleted:</strong> ' + list(ws.workspaceIntegrity.filesDeleted) + '</p>';
          html += '<p><strong>Unexpected:</strong> ' + list(ws.workspaceIntegrity.unexpectedChanges) + '</p>';
          html += '</div>';
        }
        html += '</div>';
        content.innerHTML = html;
        break;
      }
      case 'verification': {
        const v = await api(pathPrefix + '/verification');
        let html = '<div class="card"><div class="card-header">Verification Report</div><p>Passed: ' + statusChip(v.verification?.passed ? 'PASS' : 'FAIL') + ' · Scope: <strong>' + esc(v.verification?.scope || 'WHOLE_RUN') + '</strong></p></div>';
        if (v.verification?.checks?.length) {
          html += '<table><thead><tr><th>Check ID</th><th>Name</th><th>Category</th><th>Severity</th><th>Verdict</th><th>Evidence</th></tr></thead><tbody>';
          v.verification.checks.forEach(c => {
            html += '<tr><td class="mono">' + esc(c.id) + '</td><td>' + esc(c.name) + '</td><td>' + esc(c.category) + '</td><td>' + esc(c.severity) + '</td><td>' + statusChip(c.passed ? 'PASS' : 'FAIL') + '</td><td>' + esc(c.evidence) + '</td></tr>';
          });
          html += '</tbody></table>';
        }
        content.innerHTML = html;
        break;
      }
      case 'backend': {
        const b = await api(pathPrefix + '/backend');
        let html = '<div class="card"><div class="card-header">Backend Verification & Endpoints</div>';
        html += '<p>Status: ' + statusChip(b.status) + ' · Test Credential Required: <strong>' + (b.requiresTestCredential ? 'YES' : 'NO') + '</strong></p></div>';
        if (b.checks?.length) {
          html += '<table><thead><tr><th>Check</th><th>Category</th><th>Verdict</th><th>Evidence</th></tr></thead><tbody>';
          b.checks.forEach(c => {
            html += '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.category) + '</td><td>' + statusChip(c.passed ? 'PASS' : 'FAIL') + '</td><td>' + esc(c.evidence) + '</td></tr>';
          });
          html += '</tbody></table>';
        }
        content.innerHTML = html;
        break;
      }
      case 'database': {
        const d = await api(pathPrefix + '/database');
        let html = '<div class="card"><div class="card-header">Database Verification</div>';
        html += '<p>Status: ' + statusChip(d.status) + ' · Read-Only Mode: <strong>' + (d.readOnly ? 'YES' : 'NO') + '</strong></p></div>';
        if (d.checks?.length) {
          html += '<table><thead><tr><th>Check</th><th>Verdict</th><th>Evidence</th></tr></thead><tbody>';
          d.checks.forEach(c => {
            html += '<tr><td>' + esc(c.name) + '</td><td>' + statusChip(c.passed ? 'PASS' : 'FAIL') + '</td><td>' + esc(c.evidence) + '</td></tr>';
          });
          html += '</tbody></table>';
        }
        content.innerHTML = html;
        break;
      }
      case 'failure': {
        const f = await api(pathPrefix + '/failure');
        if (!f.failure) {
          content.innerHTML = '<div class="success-banner">No failure contract recorded for this run.</div>';
        } else {
          let html = '<div class="error"><div class="card-header">Failure Contract: ' + esc(f.failure.id) + '</div>';
          html += '<p><strong>Summary:</strong> ' + esc(f.failure.summary) + '</p>';
          html += '<p><strong>Primary Failure:</strong> ' + esc(f.failure.primary?.name || '-') + '</p>';
          html += '<p><strong>Expected:</strong> ' + esc(f.failure.expected || '-') + '</p>';
          html += '<p><strong>Actual:</strong> ' + esc(f.failure.actual || '-') + '</p>';
          html += '<p><strong>Implicated Files:</strong> ' + list(f.failure.implicatedFiles) + '</p>';
          html += '</div>';
          content.innerHTML = html;
        }
        break;
      }
      case 'repair': {
        const rep = await api(pathPrefix + '/repair');
        if (!rep.repair) {
          content.innerHTML = '<div class="notice">No repair history recorded for this run.</div>';
        } else {
          let html = '<div class="card"><div class="card-header">Repair Intelligence</div>';
          html += '<p>Outcome: ' + statusChip(rep.repair.outcome || 'UNKNOWN') + ' · Attempts: <strong>' + (rep.repair.attempts?.length || 0) + '</strong></p></div>';
          if (rep.repair.target) {
            html += '<div class="card"><div class="card-header">Repair Target & Intent</div>';
            html += '<p><strong>Original Intent:</strong> ' + esc(rep.repair.target.intent) + ' (' + esc(rep.repair.target.intentConfidence) + ')</p>';
            html += '<p><strong>Allowed Files:</strong> ' + list(rep.repair.target.allowedFiles) + '</p>';
            html += '<p><strong>Decision:</strong> ' + statusChip(rep.repair.target.decision) + '</p>';
            html += '</div>';
          }
          content.innerHTML = html;
        }
        break;
      }
      case 'confirmations': {
        const confRes = await api('/confirmations?taskId=' + encodeURIComponent(taskId));
        const list = confRes.confirmations || [];
        if (!list.length) {
          content.innerHTML = '<div class="notice">No confirmation requests recorded for this task.</div>';
        } else {
          let html = '';
          list.forEach(c => {
            const isPending = c.status === 'PENDING';
            html += '<div class="card" style="border-left:4px solid ' + (isPending ? 'var(--warn)' : 'var(--line)') + ';">';
            html += '<div class="card-header"><span>Confirmation: <span class="mono">' + esc(c.id) + '</span></span>' + statusChip(c.status) + '</div>';
            html += '<p><strong>Type:</strong> ' + esc(c.type) + ' · <strong>Risk:</strong> ' + esc(c.risk) + '</p>';
            html += '<p><strong>Reason:</strong> ' + esc(c.reason) + '</p>';
            html += '<p><strong>Requested Action:</strong> ' + esc(c.requestedAction) + '</p>';
            html += '<p><strong>Affected Files:</strong> ' + list(c.affectedFiles) + '</p>';
            html += '<p class="mono muted">Fingerprint: ' + esc(c.fingerprint) + '</p>';

            if (isPending) {
              if (c.type === 'REQUIRES_TEST_CREDENTIAL') {
                html += '<div class="form-group" style="margin-top:10px;">';
                html += '<label>Provide Test Credential <span class="muted">(ephemeral runtime only, never saved)</span></label>';
                html += '<input type="password" id="cred-input-' + esc(c.id) + '" autocomplete="off" placeholder="Enter test token..." style="max-width:320px;" />';
                html += '<button class="btn-primary btn-action" onclick="submitCredential(\\'' + esc(c.id) + '\\', \\'' + esc(c.fingerprint) + '\\')">Submit Credential</button>';
                html += '</div>';
              } else {
                html += '<div style="margin-top:12px;">';
                html += '<button class="btn-primary btn-action" onclick="approveConfirmation(\\'' + esc(c.id) + '\\', \\'' + esc(c.fingerprint) + '\\')">Approve</button>';
                html += '<button class="btn-danger btn-action" onclick="rejectConfirmation(\\'' + esc(c.id) + '\\', \\'' + esc(c.fingerprint) + '\\')">Reject</button>';
                html += '</div>';
              }
            }
            html += '</div>';
          });
          content.innerHTML = html;
        }
        break;
      }
      case 'reliability': {
        const rel = await api('/reliability?window=' + encodeURIComponent(state.reliabilityWindow) + '&population=' + encodeURIComponent(state.reliabilityPopulation));
        let html = '<div class="card"><div class="card-header">Reliability Summary (' + esc(state.reliabilityWindow) + ')</div>';
        html += '<p>Sample Size: <strong>' + rel.sampleSize + '</strong> · First-Pass Success: <strong>' + (rel.firstPassSuccessRate ? rel.firstPassSuccessRate.ratePercent + '%' : 'N/A') + '</strong> · Final Success: <strong>' + (rel.finalSuccessRate ? rel.finalSuccessRate.ratePercent + '%' : 'N/A') + '</strong></p></div>';
        content.innerHTML = html;
        break;
      }
      case 'impact': {
        const imp = await api(pathPrefix + '/impact');
        let html = '<div class="card"><div class="card-header">Impact Analysis</div><p>' + esc(imp.impactAnalysis?.summary || 'No impact analysis recorded.') + '</p></div>';
        content.innerHTML = html;
        break;
      }
      case 'regression': {
        const reg = await api(pathPrefix + '/regression');
        let html = '<div class="card"><div class="card-header">Regression Plan</div>';
        html += '<p><strong>Policy:</strong> ' + esc(reg.regressionPlan?.policy || '-') + ' · <strong>Risk:</strong> ' + esc(reg.regressionPlan?.risk || '-') + '</p>';
        html += '<p><strong>Selected Checks:</strong> ' + list(reg.regressionPlan?.selectedChecks) + '</p>';
        html += '</div>';
        content.innerHTML = html;
        break;
      }
      case 'capabilities': {
        const caps = await api('/capabilities');
        let html = '<div class="card"><div class="card-header">Platform Capability Parity Matrix</div><p class="muted">Single authoritative application capability catalog across CLI, REPL, Web, and API.</p></div>';
        html += '<table><thead><tr><th>Capability</th><th>Type</th><th>CLI</th><th>REPL</th><th>API</th><th>Web UI</th></tr></thead><tbody>';
        caps.capabilities.forEach(c => {
          html += '<tr>'
            + '<td><strong>' + esc(c.title) + '</strong><br><span class="mono muted">' + esc(c.id) + '</span></td>'
            + '<td><span class="badge">' + esc(c.kind) + '</span></td>'
            + '<td>' + statusChip(c.cli.support) + '</td>'
            + '<td>' + statusChip(c.repl.support) + '</td>'
            + '<td>' + statusChip(c.api.support) + '</td>'
            + '<td>' + statusChip(c.ui.support) + '</td>'
            + '</tr>';
        });
        html += '</tbody></table>';
        content.innerHTML = html;
        break;
      }
      case 'events': {
        const evData = await api(pathPrefix + '/events');
        let html = '<div>';
        (evData.events || []).forEach(ev => {
          html += '<div class="event-item">';
          html += '<span class="mono muted">#' + ev.seq + '</span>';
          html += '<span class="mono muted">' + esc(ev.ts ? ev.ts.substring(11,19) : '-') + '</span>';
          html += '<span><span class="badge">' + esc(ev.phase) + '</span></span>';
          html += '<span>' + esc(ev.message) + '</span>';
          html += '</div>';
        });
        html += '</div>';
        content.innerHTML = html;
        break;
      }
      case 'logs': {
        const logsData = await api(pathPrefix + '/logs/raw?limit=300').catch(() => null);
        if (!logsData || !logsData.lines || !logsData.lines.length) {
          content.innerHTML = '<div class="notice">No raw log lines available for this run.</div>';
        } else {
          let html = '<div class="card"><div class="card-header"><span>Log File: <span class="mono">' + esc(logsData.fileName) + '</span></span><span>' + logsData.lineCount + ' lines</span></div>';
          html += '<pre>' + logsData.lines.map(esc).join('\\n') + '</pre>';
          html += '</div>';
          content.innerHTML = html;
        }
        break;
      }
      default:
        content.innerHTML = '<div class="muted">Unknown tab.</div>';
    }
  } catch (err) {
    content.innerHTML = '<div class="error">Failed to load ' + esc(state.tab) + ': ' + esc(err.message) + '</div>';
  }
}

// Global window actions for confirmations
window.approveConfirmation = async function (id, fingerprint) {
  try {
    await postApi('/confirmations/' + encodeURIComponent(id) + '/approve', {
      actor: 'web-operator',
      fingerprint,
    });
    await loadTaskDetail();
  } catch (err) {
    alert('Approve failed: ' + err.message);
  }
};

window.rejectConfirmation = async function (id, fingerprint) {
  try {
    await postApi('/confirmations/' + encodeURIComponent(id) + '/reject', {
      actor: 'web-operator',
      fingerprint,
    });
    await loadTaskDetail();
  } catch (err) {
    alert('Reject failed: ' + err.message);
  }
};

window.submitCredential = async function (id, fingerprint) {
  const input = document.getElementById('cred-input-' + id);
  if (!input || !input.value.trim()) {
    alert('Please enter a credential token');
    return;
  }
  const token = input.value.trim();
  input.value = ''; // Immediately clear from DOM
  try {
    await postApi('/confirmations/' + encodeURIComponent(id) + '/provide-credential', {
      token,
      actor: 'web-operator',
      fingerprint,
    });
    await loadTaskDetail();
  } catch (err) {
    alert('Credential submission failed: ' + err.message);
  }
};

window.viewContextItem = async function (index) {
  try {
    const res = await api('/tasks/' + encodeURIComponent(state.taskId) + '/context/' + index);
    document.getElementById('modal-context-title').textContent = 'Context Item #' + index + ': ' + res.item.reference;
    document.getElementById('modal-context-content').textContent = res.content || '(no content stored)';
    document.getElementById('modal-context').classList.remove('hidden');
  } catch (err) {
    alert('Failed to load context content: ' + err.message);
  }
};

// SSE Live Stream Connection (UI-2.8, UI-2.9)
function setupEventStream() {
  if (state.eventSource) {
    state.eventSource.close();
  }

  const queryParams = new URLSearchParams();
  if (state.runId) queryParams.set('runId', state.runId);
  else if (state.taskId) queryParams.set('taskId', state.taskId);
  if (state.lastSeq > 0) queryParams.set('sinceSeq', String(state.lastSeq));

  const url = '/api/v1/stream?' + queryParams.toString();
  const es = new EventSource(url);
  state.eventSource = es;

  const connBadge = document.getElementById('connection');

  es.onopen = () => {
    connBadge.textContent = 'Live SSE';
    connBadge.style.color = 'var(--ok)';
    connBadge.style.borderColor = 'var(--ok)';
  };

  es.onerror = () => {
    connBadge.textContent = 'Reconnecting';
    connBadge.style.color = 'var(--warn)';
    connBadge.style.borderColor = 'var(--warn)';
  };

  es.addEventListener('change', async (e) => {
    try {
      const data = JSON.parse(e.data);
      state.tasks = data.tasks || state.tasks;
      renderTaskList();
    } catch {}
  });

  es.addEventListener('task', async (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.events && data.events.length) {
        state.lastSeq = Math.max(state.lastSeq, ...data.events.map(ev => ev.seq));
      }
      if (state.taskId === data.taskId) {
        if (state.tab === 'events' || state.tab === 'timeline') {
          renderActiveTab();
        }
      }
    } catch {}
  });

  es.addEventListener('run', async (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.events && data.events.length) {
        state.lastSeq = Math.max(state.lastSeq, ...data.events.map(ev => ev.seq));
      }
      if (state.runId === data.runId || state.taskId === data.taskId) {
        if (state.tab === 'events' || state.tab === 'timeline' || state.tab === 'execution') {
          renderActiveTab();
        }
      }
    } catch {}
  });
}

// Modal & Form Execution Handlers
function setupUIHandlers() {
  const modal = document.getElementById('modal-execute');
  const btnOpen = document.getElementById('btn-execute-task');
  const btnClose = document.getElementById('btn-close-modal');
  const btnCancel = document.getElementById('btn-cancel-execute');
  const form = document.getElementById('form-execute');
  const taskFilter = document.getElementById('task-filter');

  btnOpen.addEventListener('click', () => { modal.classList.remove('hidden'); });
  btnClose.addEventListener('click', () => { modal.classList.add('hidden'); });
  btnCancel.addEventListener('click', () => { modal.classList.add('hidden'); });

  document.getElementById('btn-close-context-modal')?.addEventListener('click', () => {
    document.getElementById('modal-context').classList.add('hidden');
  });

  document.getElementById('btn-close-metric-modal')?.addEventListener('click', () => {
    document.getElementById('modal-metric').classList.add('hidden');
  });

  taskFilter.addEventListener('input', () => { renderTaskList(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskPrompt = document.getElementById('input-task-prompt').value.trim();
    const executionMode = document.getElementById('select-execution-mode').value;
    const submitBtn = document.getElementById('btn-submit-execute');

    if (!taskPrompt) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
      const started = await postApi('/tasks/execute', {
        task: taskPrompt,
        executionMode,
      });

      modal.classList.add('hidden');
      form.reset();
      submitBtn.disabled = false;
      submitBtn.textContent = 'Start Execution';

      // Show active banner
      showActiveBanner(started);

      // Reload tasks and select started task
      await loadTasks();
      await selectTask(started.taskId, started.runId);
      setupEventStream();
    } catch (err) {
      alert('Failed to start task execution: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Start Execution';
    }
  });

  // Top view toggles
  document.getElementById('dashboard-toggle')?.addEventListener('click', () => {
    state.view = 'dashboard';
    document.querySelectorAll('.btn-nav').forEach(b => b.classList.remove('active'));
    document.getElementById('dashboard-toggle').classList.add('active');
    loadTasks();
  });

  document.getElementById('reliability-toggle')?.addEventListener('click', () => {
    state.view = 'reliability';
    document.querySelectorAll('.btn-nav').forEach(b => b.classList.remove('active'));
    document.getElementById('reliability-toggle').classList.add('active');
    state.tab = 'reliability';
    renderActiveTab();
  });

  document.getElementById('capabilities-toggle')?.addEventListener('click', () => {
    state.view = 'capabilities';
    document.querySelectorAll('.btn-nav').forEach(b => b.classList.remove('active'));
    document.getElementById('capabilities-toggle').classList.add('active');
    state.tab = 'capabilities';
    renderActiveTab();
  });
}

function showActiveBanner(runInfo) {
  const banner = document.getElementById('active-banner');
  if (!banner) return;
  banner.classList.remove('hidden');
  document.getElementById('active-task-id').textContent = runInfo.taskId;
  document.getElementById('active-run-id').textContent = runInfo.runId;
  document.getElementById('active-status').textContent = runInfo.status || 'PLANNING';
  document.getElementById('active-mode').textContent = runInfo.executionMode || 'STANDARD';

  document.getElementById('btn-view-active').onclick = () => {
    selectTask(runInfo.taskId, runInfo.runId);
  };

  document.getElementById('btn-cancel-active').onclick = async () => {
    if (!confirm('Cancel active execution?')) return;
    try {
      await postApi('/tasks/' + encodeURIComponent(runInfo.taskId) + '/cancel', {});
      banner.classList.add('hidden');
      await loadTaskDetail();
    } catch (err) {
      alert('Cancel failed: ' + err.message);
    }
  };
}

// Initial Boot
window.addEventListener('DOMContentLoaded', async () => {
  setupUIHandlers();
  await loadWorkspace();
  await loadTasks();
  setupEventStream();
});
`;
