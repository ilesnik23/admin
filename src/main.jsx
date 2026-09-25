import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const DEFAULT_API_URL = 'https://zavrsniapi-production.up.railway.app';

function App() {
  const [apiUrl, setApiUrl] = useState(sessionStorage.getItem('adminApiUrl') || DEFAULT_API_URL);
  const [adminKey, setAdminKey] = useState(sessionStorage.getItem('adminKey') || '');
  const [connected, setConnected] = useState(false);
  const [services, setServices] = useState([]);
  const [workflow, setWorkflow] = useState(null);
  const [runs, setRuns] = useState([]);
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

  useEffect(() => {
    if (adminKey) loadDashboard();
  }, []);

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
      await request(`/admin/workflows/${encodeURIComponent(workflow.id)}/steps`, {
        method: 'PUT',
        body: JSON.stringify({ steps: workflow.steps.map((step) => ({ serviceKey: step.service_key, enabled: asBoolean(step.enabled) })) }),
      });
      await loadDashboard();
      setNotice({ text: 'Redoslijed workflowa je spremljen.', success: true });
    } catch (error) { setNotice({ text: error.message, success: false }); }
  };

  const showLogs = async (runId) => {
    try {
      const logs = await request(`/admin/workflow-runs/${encodeURIComponent(runId)}/logs`);
      const text = logs.map((log) => `${log.step_order}. ${log.service_key}: ${log.status}${log.message ? ` - ${log.message}` : ''}`).join(' | ');
      setNotice({ text: text || 'Za izvršavanje nema logova.', success: true });
    } catch (error) { setNotice({ text: error.message, success: false }); }
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
        <section className="panel"><div className="section-heading compact"><div><h2>Redoslijed koraka</h2></div><button className="button primary" onClick={saveWorkflow}>Spremi workflow</button></div><div className="step-list">{workflow?.steps.map((step, index) => <div className="step-row" key={`${step.service_key}-${index}`}><div className="step-number">{index + 1}</div><div className="step-info"><div className="step-title">{serviceName(services, step.service_key)}</div><div className="step-key">{step.service_key}</div></div><div className="step-actions"><button className="icon-button" disabled={index === 0} onClick={() => moveStep(index, 'up')}>↑</button><button className="icon-button" disabled={index === workflow.steps.length - 1} onClick={() => moveStep(index, 'down')}>↓</button></div></div>)}</div></section>
        <section className="panel"><div className="section-heading compact"><div><h2>Izvršavanja</h2></div></div><div className="run-list">{runs.length ? runs.map((run) => <button className="run-row" key={run.id} onClick={() => showLogs(run.id)}><div className="run-top"><strong>{run.id}</strong><span className={`status ${run.status}`}>{run.status}</span></div><div className="run-meta">{run.started_at}</div></button>) : <div className="empty">Još nema workflow izvršavanja.</div>}</div></section>
      </div>
    </section>}
  </main>;
}

function asBoolean(value) { return value === true || value === 1 || value === '1' || value === 't' || value === 'true'; }
function serviceName(services, key) { return services.find((service) => service.service_key === key)?.display_name || key; }

createRoot(document.getElementById('root')).render(<App />);