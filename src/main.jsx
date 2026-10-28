import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const DEFAULT_API_URL = 'https://zavrsniapi-production.up.railway.app';
const RUN_POLL_MS = 10000;

function App() {
  const [apiUrl, setApiUrl] = useState(sessionStorage.getItem('adminApiUrl') || DEFAULT_API_URL);
  const [adminKey, setAdminKey] = useState(sessionStorage.getItem('adminKey') || '');
  const [connected, setConnected] = useState(false);
  const [services, setServices] = useState([]);
  const [workflow, setWorkflow] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [logs, setLogs] = useState([]);
  const [testImage, setTestImage] = useState(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [notice, setNotice] = useState({ text: '', success: false });

  const request = async (path, options = {}) => {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminKey,
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `API greška (${response.status})`);
    return body;
  };

  const loadDashboard = async () => {
    try {
      const [serviceData, workflowData, runData] = await Promise.all([
        request('/admin/services'), request('/admin/workflows'), request('/admin/workflow-runs'),
      ]);
      setServices(serviceData);
      setWorkflow(workflowData[0] || null);
      setRuns(runData);
      setConnected(true);
      setNotice({ text: 'Admin panel je povezan.', success: true });
    } catch (error) {
      setConnected(false);
      setNotice({ text: error.message, success: false });
    }
  };

  const loadRuns = async () => {
    try { setRuns(await request('/admin/workflow-runs')); } catch (error) { setNotice({ text: error.message, success: false }); }
  };

  useEffect(() => {
    if (adminKey) loadDashboard();
  }, []);

  useEffect(() => {
    if (!connected) return undefined;
    const timer = setInterval(loadRuns, RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [connected, apiUrl, adminKey]);

  const connect = async (event) => {
    event.preventDefault();
    sessionStorage.setItem('adminApiUrl', apiUrl);
    sessionStorage.setItem('adminKey', adminKey);
    await loadDashboard();
  };

  const toggleService = async (service) => {
    try {
      await request(`/admin/services/${encodeURIComponent(service.service_key)}`, {
        method: 'PUT', body: JSON.stringify({ enabled: !asBoolean(service.enabled) }),
      });
      await loadDashboard();
    } catch (error) { setNotice({ text: error.message, success: false }); }
  };

  const moveStep = (index, direction) => {
    if (!workflow) return;
    const steps = [...workflow.steps];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    setWorkflow({ ...workflow, steps });
  };

  const saveWorkflow = async () => {
    if (!workflow) return;
    try {
      await request(`/admin/workflows/${encodeURIComponent(workflow.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ mode: workflow.mode, goal: workflow.goal || '', maxAgentSteps: Number(workflow.max_agent_steps) }),
      });
      await request(`/admin/workflows/${encodeURIComponent(workflow.id)}/steps`, {
        method: 'PUT',
        body: JSON.stringify({ steps: workflow.steps.map((step) => ({ serviceKey: step.service_key, enabled: asBoolean(step.enabled), configuration: step.configuration || {} })) }),
      });
      await loadDashboard();
      setNotice({ text: 'Workflow je spremljen.', success: true });
    } catch (error) { setNotice({ text: error.message, success: false }); }
  };

  const showLogs = async (runId) => {
    try {
      setSelectedRun(runId);
      setLogs(await request(`/admin/workflow-runs/${encodeURIComponent(runId)}/logs`));
    } catch (error) { setNotice({ text: error.message, success: false }); }
  };

  const startRun = async (event) => {
    event.preventDefault();
    if (!testImage) return;
    setRunning(true);
    setRunResult(null);
    try {
      const imageBase64 = await readAsBase64(testImage);
      const result = await request('/admin/workflow-runs', {
        method: 'POST', body: JSON.stringify({ imageBase64, mimeType: testImage.type || 'image/jpeg', imageUri: testImage.name }),
      });
      setRunResult({ success: true, result });
      await loadRuns();
      if (result.workflowRunId) await showLogs(result.workflowRunId);
    } catch (error) {
      setRunResult({ success: false, error: error.message });
      await loadRuns();
    } finally { setRunning(false); }
  };

  return <main className="shell">
    <header className="topbar">
      <div><h1>Orkestracija servisa</h1></div>
      <div className={`connection-state ${connected ? 'online' : ''}`}>{connected ? 'Povezano' : 'Nije povezano'}</div>
    </header>
    <section className="setup-panel">
      <form className="setup-form" onSubmit={connect}>
        <label>API URL<input type="url" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} required /></label>
        <label>Admin ključ<input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} placeholder="X-Admin-Key" required /></label>
        <button className="button primary" type="submit">Poveži admin panel</button>
      </form>
    </section>
    <div className={`notice ${notice.success ? 'success' : ''}`}>{notice.text}</div>
    {connected && <section>
      <div className="section-heading"><div><h2>Dostupni servisi</h2></div><button className="button ghost" onClick={loadDashboard}>Osvježi podatke</button></div>
      <div className="service-grid">{services.map((service) => <article className="service-card" key={service.service_key}><div><div className="service-name">{service.display_name}</div><div className="service-key">{service.service_key}</div></div><label className="switch"><input type="checkbox" checked={asBoolean(service.enabled)} onChange={() => toggleService(service)} /><span className="slider" /></label></article>)}</div>
      <div className="workflow-layout">
        <section className="panel">
          <div className="section-heading compact"><div><h2>Workflow</h2></div><button className="button primary" onClick={saveWorkflow} disabled={!workflow}>Spremi workflow</button></div>
          {workflow && <div className="workflow-settings">
            <label>Način rada<select value={workflow.mode || 'static'} onChange={(event) => setWorkflow({ ...workflow, mode: event.target.value })}>
              <option value="static">Statički (redoslijed koraka)</option>
              <option value="agent">AI agent (Gemini bira servise)</option>
            </select></label>
            {workflow.mode === 'agent' && <>
              <label>Cilj agenta<textarea rows={4} value={workflow.goal || ''} placeholder="Prazno = zadani cilj (niska pouzdanost → nova fotografija, štetnici → hitan zadatak)" onChange={(event) => setWorkflow({ ...workflow, goal: event.target.value })} /></label>
              <label>Najviše koraka agenta<input type="number" min={1} max={20} value={workflow.max_agent_steps ?? 8} onChange={(event) => setWorkflow({ ...workflow, max_agent_steps: event.target.value })} /></label>
            </>}
          </div>}
          <h3>{workflow?.mode === 'agent' ? 'Dostupni alati agenta' : 'Redoslijed koraka'}</h3>
          <div className="step-list">{workflow?.steps.map((step, index) => <div className={`step-row ${isServiceEnabled(services, step.service_key) ? '' : 'disabled'}`} key={`${step.service_key}-${index}`}><div className="step-number">{index + 1}</div><div className="step-info"><div className="step-title">{serviceName(services, step.service_key)}</div><div className="step-key">{step.service_key}{isServiceEnabled(services, step.service_key) ? '' : ' · isključen'}</div></div><div className="step-actions"><button className="icon-button" disabled={index === 0} onClick={() => moveStep(index, 'up')}>↑</button><button className="icon-button" disabled={index === workflow.steps.length - 1} onClick={() => moveStep(index, 'down')}>↓</button></div></div>)}</div>
        </section>
        <section className="panel">
          <div className="section-heading compact"><div><h2>Ručno pokretanje</h2></div></div>
          <form className="run-form" onSubmit={startRun}>
            <label>Testna fotografija biljke<input type="file" accept="image/*" onChange={(event) => setTestImage(event.target.files?.[0] || null)} /></label>
            <button className="button primary" type="submit" disabled={!testImage || running}>{running ? 'Izvršava se…' : 'Pokreni workflow'}</button>
          </form>
          {runResult && <div className={`run-result ${runResult.success ? 'success' : 'failed'}`}>{runResult.success ? describeResult(runResult.result) : runResult.error}</div>}
          <div className="section-heading compact spaced"><div><h2>Izvršavanja</h2></div><button className="button ghost" onClick={loadRuns}>Osvježi</button></div>
          <div className="run-list">{runs.length ? runs.map((run) => <button className={`run-row ${selectedRun === run.id ? 'selected' : ''}`} key={run.id} onClick={() => showLogs(run.id)}><div className="run-top"><strong>{run.id}</strong><span className={`status ${run.status}`}>{run.status}</span></div><div className="run-meta">{formatDate(run.started_at)} · {run.mode || 'static'} · {run.trigger_source || 'mobile'}{run.outcome ? ` · ${run.outcome}` : ''}</div>{run.error_message && <div className="run-error">{run.error_message}</div>}</button>) : <div className="empty">Još nema workflow izvršavanja.</div>}</div>
        </section>
      </div>
      {selectedRun && <section className="panel log-panel">
        <div className="section-heading compact"><div><h2>Log izvršavanja</h2><div className="run-meta">{selectedRun}</div></div><button className="button ghost" onClick={() => showLogs(selectedRun)}>Osvježi log</button></div>
        {logs.length ? <table className="log-table"><thead><tr><th>#</th><th>Servis / alat</th><th>Status</th><th>Obrazloženje agenta</th><th>Rezultat</th><th>Trajanje</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{log.step_order}</td><td>{serviceName(services, log.service_key)}<div className="step-key">{log.service_key}</div></td><td><span className={`status ${log.status}`}>{log.status}</span></td><td>{log.reasoning || '—'}</td><td>{log.message || '—'}</td><td>{duration(log.started_at, log.finished_at)}</td></tr>)}</tbody></table> : <div className="empty">Za izvršavanje nema logova.</div>}
      </section>}
    </section>}
  </main>;
}

function asBoolean(value) { return value === true || value === 1 || value === '1' || value === 't' || value === 'true'; }
const AGENT_TOOL_NAMES = { add_urgent_task: 'Hitan zadatak', request_new_photo: 'Zahtjev za novu fotografiju', finish: 'Završetak', agent: 'Agent' };
function serviceName(services, key) { return services.find((service) => service.service_key === key)?.display_name || AGENT_TOOL_NAMES[key] || key; }
function isServiceEnabled(services, key) { const service = services.find((item) => item.service_key === key); return !service || asBoolean(service.enabled); }
function formatDate(value) { return value ? new Date(value).toLocaleString('hr-HR') : ''; }
function duration(start, end) { if (!start || !end) return '—'; const ms = new Date(end) - new Date(start); return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`; }
function describeResult(result) {
  if (result.workflowOutcome === 'needs_new_photo') return `Agent traži novu fotografiju: ${result.message}`;
  return `${result.plantName} (${Math.round((result.confidence || 0) * 100)}%) · ${result.tasks?.length || 0} zadataka · ${result.workflowMode} · ${result.workflowOutcome}`;
}
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Fotografiju nije moguće pročitati.'));
    reader.readAsDataURL(file);
  });
}

createRoot(document.getElementById('root')).render(<App />);
