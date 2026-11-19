'use strict';

function buildChecklist(report) {
  const results = report.results || [];
  const summary = report.summary || {};
  const missing = results.filter((row) => row.status !== 'ok');
  const nextSteps = [];
  if (!summary.requiredOk) {
    nextSteps.push('Install the required runtime tools that are marked missing or warning (Git, shell, Node.js, npm, Python).');
  }
  const server = results.find((row) => row.id === 'server');
  if (server && server.status !== 'ok') {
    nextSteps.push('Start the LoopForge local service, then re-run the first-run checklist.');
  }
  if (!summary.anyAgent) {
    nextSteps.push('Optionally install one coding agent CLI from the list (Claude Code, Codex, Cursor, …) and sign in.');
  }
  if (nextSteps.length === 0) {
    nextSteps.push('Required tools look good. Create or open a Loop and run your first SOP.');
  }
  return {
    title: 'LoopForge first-run checklist',
    generatedAt: summary.checkedAt || new Date().toISOString(),
    summary: {
      requiredOk: !!summary.requiredOk,
      anyAgent: !!summary.anyAgent,
      ok: results.filter((row) => row.status === 'ok').length,
      total: results.length,
    },
    results,
    nextSteps,
  };
}

function renderChecklistPage(checklist) {
  const rows = (checklist.results || [])
    .map((row) => `<li><strong>${escapeHtml(row.name || row.id)}</strong> — ${escapeHtml(row.status)}${row.detail ? ': ' + escapeHtml(row.detail) : ''}</li>`)
    .join('\n');
  const steps = (checklist.nextSteps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(checklist.title)}</title>
  <style>
    body{font:16px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:720px;color:#111827}
    .ok{color:#047857}.warn{color:#b45309}
    :focus-visible{outline:2px solid #2563eb;outline-offset:2px}
  </style>
</head>
<body>
  <h1>${escapeHtml(checklist.title)}</h1>
  <p>Required tools: ${checklist.summary.requiredOk ? '<span class="ok">ready</span>' : '<span class="warn">action needed</span>'} · ${checklist.summary.ok}/${checklist.summary.total} checks ok</p>
  <h2>Environment</h2>
  <ul>${rows}</ul>
  <h2>Next steps</h2>
  <ol>${steps}</ol>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { buildChecklist, renderChecklistPage };
