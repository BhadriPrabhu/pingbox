import { useState, useEffect } from "react";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("pingbox_key") || "");
  const [status, setStatus] = useState("");
  const [inbox, setInbox] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadHistory = async (key = apiKey) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    localStorage.setItem("pingbox_key", trimmed);
    setLoading(true);
    try {
      const res = await fetch("/api/history", { headers: { "x-api-key": trimmed } });
      if (!res.ok) throw new Error("Unauthorized: check your API_SECRET.");
      const data = await res.json();
      setInbox(data);
      setStatus("");
    } catch (err) {
      setStatus(err.message);
    } finally {
      setLoading(false);
    }
  };

  const enablePush = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return setStatus("Enter your API_SECRET first.");
    localStorage.setItem("pingbox_key", trimmed);

    try {
      setStatus("Registering Service Worker...");
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
      setStatus("Push enabled! This device is now subscribed.");
      loadHistory(trimmed);
    } catch (err) {
      setStatus("Error: " + err.message);
    }
  };

  useEffect(() => {
    if (apiKey) loadHistory(apiKey);
  }, []);

  return (
    <div style={{ maxWidth: 540, margin: "0 auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h1>PingBox</h1>
      <p style={{ color: "#94a3b8" }}>Private VAPID Push Inbox</p>

      <input
        type="password"
        placeholder="Enter your API_SECRET"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        style={{ width: "100%", padding: 12, marginBottom: 10, boxSizing: "border-box" }}
      />

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button onClick={enablePush} style={{ flex: 1, padding: 12 }}>
          Enable Push
        </button>
        <button onClick={() => loadHistory()} disabled={loading} style={{ flex: 1, padding: 12 }}>
          {loading ? "Loading..." : "Refresh Inbox"}
        </button>
      </div>

      {status && <p style={{ color: "#38bdf8", fontSize: 14 }}>{status}</p>}

      <div>
        {inbox.length === 0 ? (
          <p style={{ color: "#64748b" }}>No notifications yet.</p>
        ) : (
          inbox.map((item, idx) => (
            <div key={idx} style={{ border: "1px solid #334155", borderRadius: 8, padding: 14, marginBottom: 10 }}>
              <strong>{item.title}</strong>
              <p style={{ margin: "6px 0", whiteSpace: "pre-line" }}>{item.body}</p>
              <div style={{ fontSize: 12, color: "#64748b", display: "flex", justifyContent: "space-between" }}>
                <span>{new Date(item.timestamp).toLocaleString()}</span>
                {item.url && item.url !== "/" && (
                  <a href={item.url} target="_blank" rel="noreferrer">Open Link →</a>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}