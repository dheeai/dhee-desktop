/**
 * Manual-testing scenario picker. Rendered when no scenario is loaded.
 * Clicking a scenario navigates to `?scenario=NAME` so the bridge picks
 * it up on reload (clean React state, no in-memory carryover).
 */
import { SCENARIO_CATALOG } from './scenarioCatalog';

export default function ScenarioPicker() {
  const entries = Object.entries(SCENARIO_CATALOG);

  const pick = (name: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('scenario', name);
    window.location.href = url.toString();
  };

  return (
    <div
      style={{
        background: '#0d0e10',
        color: '#e3e3e3',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: 32,
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>kshana-desktop test bridge</h1>
      <p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>
        No scenario loaded. Pick one — the page reloads with{' '}
        <code>?scenario=NAME</code> and the chat panel opens with that
        scenario's rules wired into the fake bridge.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
        {entries.map(([name, entry]) => (
          <button
            type="button"
            key={name}
            onClick={() => pick(name)}
            style={{
              textAlign: 'left',
              background: '#1a1c20',
              color: 'inherit',
              border: '1px solid #2a2c30',
              borderRadius: 8,
              padding: '12px 14px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
            }}
          >
            <div
              style={{
                fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
                color: '#7eb6ff',
                marginBottom: 6,
              }}
            >
              {name}
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ opacity: 0.55 }}>type, in order:</span>{' '}
              {entry.prompts.map((p, i) => (
                <span key={p}>
                  <code
                    style={{
                      background: '#0d0e10',
                      padding: '1px 6px',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    {p}
                  </code>
                  {i < entry.prompts.length - 1 ? '  →  ' : ''}
                </span>
              ))}
            </div>
            <div style={{ opacity: 0.7, fontSize: 12 }}>{entry.expect}</div>
          </button>
        ))}
      </div>

      <details style={{ marginTop: 32, opacity: 0.6, fontSize: 12 }}>
        <summary>Bridge API (devtools)</summary>
        <pre style={{ fontSize: 11 }}>
          {`window.__kshanaTest.listScenarios()
window.__kshanaTest.loadScenarioByName('edit-shot-1')
window.__kshanaTest.loadScenario({...})
window.__kshanaTest.emit('tool_call', {...})
window.__kshanaTest.getCalls()`}
        </pre>
      </details>
    </div>
  );
}
