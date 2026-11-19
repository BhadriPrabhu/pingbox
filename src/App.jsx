import { useState, useEffect } from "react";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function formatRelativeTime(iso) {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("pingbox_key") || "");
  const [showConfig, setShowConfig] = useState(() => !localStorage.getItem("pingbox_key"));
  const [pushActive, setPushActive] = useState(false);
  const [status, setStatus] = useState({ text: "", isError: false });
  const [inbox, setInbox] = useState([]);
  const [loading, setLoading] = useState(false);

  // Check if this device already has an active push subscription
  useEffect(() => {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.getRegistration("/sw.js").then(async (reg) => {
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub && Notification.permission === "granted") {
            setPushActive(true);
          }
        }
      });
    }
  }, []);

  const loadHistory = async (key = apiKey) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    localStorage.setItem("pingbox_key", trimmed);
    setLoading(true);
    try {
      const res = await fetch("/api/history", { headers: { "x-api-key": trimmed } });
      if (!res.ok) throw new Error("Unauthorized — verify your API_SECRET.");
      const data = await res.json();
      setInbox(data);
      setStatus({ text: "", isError: false });
    } catch (err) {
      setStatus({ text: err.message, isError: true });
      setShowConfig(true);
    } finally {
      setLoading(false);
    }
  };

  const enablePush = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setStatus({ text: "Enter your API_SECRET first.", isError: true });
      return;
    }
    localStorage.setItem("pingbox_key", trimmed);

    try {
      setStatus({ text: "Registering service worker...", isError: false });
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notification permission denied.");

      const { publicKey } = await (await fetch("/api/vapid-key")).json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": trimmed },
        body: JSON.stringify(sub),
      });

      if (!res.ok) throw new Error("Invalid API_SECRET or server error.");
      setPushActive(true);
      setShowConfig(false);
      setStatus({ text: "Device subscribed to push notifications.", isError: false });
      loadHistory(trimmed);
    } catch (err) {
      setStatus({ text: err.message, isError: true });
    }
  };

  const sendTestPing = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setStatus({ text: "Sending test notification...", isError: false });
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": trimmed },
        body: JSON.stringify({
          title: "PingBox Test",
          body: "End-to-end VAPID push is working.",
          url: window.location.origin,
        }),
      });
      if (!res.ok) throw new Error("Failed to send test ping.");
      const data = await res.json();
      setStatus({ text: `Sent to ${data.sent}/${data.totalDevices} device(s).`, isError: false });
      loadHistory(trimmed);
    } catch (err) {
      setStatus({ text: err.message, isError: true });
    }
  };

  useEffect(() => {
    if (apiKey) loadHistory(apiKey);
  }, []);

  return (
    <div className="shell">
      <header className="header">
        <div className="brand">
          <h1>PingBox</h1>
          <span className="badge">
            <span className={`dot ${pushActive ? "active" : ""}`} />
            {pushActive ? "push active" : "not subscribed"}
          </span>
        </div>

        <div className="header-actions">
          <button className="btn" onClick={() => loadHistory()} disabled={loading || !apiKey}>
            {loading ? "Syncing..." : "Refresh"}
          </button>
          <button className="btn" onClick={() => setShowConfig((v) => !v)}>
            {showConfig ? "Close" : "Settings"}
          </button>
        </div>
      </header>

      {showConfig && (
        <section className="panel">
          <label className="panel-label" htmlFor="api-key">
            API Secret
          </label>
          <div className="input-row">
            <input
              id="api-key"
              type="password"
              className="input"
              placeholder="Enter API_SECRET"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button className="btn" onClick={() => loadHistory()}>
              Connect
            </button>
          </div>
          <div className="panel-footer">
            <button className="btn btn-primary" onClick={enablePush}>
              {pushActive ? "Re-sync Push Subscription" : "Enable Push on This Device"}
            </button>
            <button className="btn" onClick={sendTestPing} disabled={!apiKey}>
              Send Test Ping
            </button>
          </div>
        </section>
      )}

      {status.text && (
        <div className={`notice ${status.isError ? "error" : ""}`}>{status.text}</div>
      )}

      <div className="feed-header">
        <span className="feed-title">Inbox ({inbox.length})</span>
      </div>

      {inbox.length === 0 ? (
        <div className="empty">No notifications received yet.</div>
      ) : (
        <div className="feed-list">
          {inbox.map((item, idx) => (
            <article key={`${item.timestamp}-${idx}`} className="feed-item">
              <div className="item-top">
                <span className="item-title">{item.title}</span>
                <span className="item-time" title={new Date(item.timestamp).toLocaleString()}>
                  {formatRelativeTime(item.timestamp)}
                </span>
              </div>
              {item.body && <p className="item-body">{item.body}</p>}
              {item.url && item.url !== "/" && (
                <a className="item-link" href={item.url} target="_blank" rel="noreferrer">
                  {item.url.replace(/^https?:\/\//, "")}
                </a>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}