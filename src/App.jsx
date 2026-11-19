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

  // Topics & Inbox state
  const [topics, setTopics] = useState(["general"]);
  const [activeTopic, setActiveTopic] = useState("general");
  const [newTopicName, setNewTopicName] = useState("");
  const [showNewTopic, setShowNewTopic] = useState(false);
  const [inbox, setInbox] = useState([]);
  const [loading, setLoading] = useState(false);

  // Composer state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [sending, setSending] = useState(false);

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

  const loadHistory = async (topic = activeTopic, key = apiKey) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    localStorage.setItem("pingbox_key", trimmed);
    setLoading(true);
    try {
      const res = await fetch(`/api/history?topic=${encodeURIComponent(topic)}`, {
        headers: { "x-api-key": trimmed },
      });
      if (!res.ok) throw new Error("Unauthorized — verify your API_SECRET.");
      const data = await res.json();
      setTopics(data.topics || ["general"]);
      setInbox(data.messages || []);
      setStatus({ text: "", isError: false });
    } catch (err) {
      setStatus({ text: err.message, isError: true });
      setShowConfig(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (apiKey) loadHistory(activeTopic, apiKey);
  }, [activeTopic]);

  const createTopic = async (e) => {
    e.preventDefault();
    const clean = newTopicName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    if (!clean) return;
    try {
      const res = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey.trim() },
        body: JSON.stringify({ topic: clean }),
      });
      if (!res.ok) throw new Error("Failed to create channel.");
      setNewTopicName("");
      setShowNewTopic(false);
      setActiveTopic(clean);
      loadHistory(clean);
    } catch (err) {
      setStatus({ text: err.message, isError: true });
    }
  };

  const deleteMessage = async (id) => {
    setInbox((prev) => prev.filter((item) => (item.id || item.timestamp) !== id));
    await fetch("/api/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey.trim() },
      body: JSON.stringify({ topic: activeTopic, id }),
    });
  };

  const clearTopic = async () => {
    setInbox([]);
    await fetch("/api/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey.trim() },
      body: JSON.stringify({ topic: activeTopic, clearAll: true }),
    });
  };

  const deleteTopic = async () => {
    if (activeTopic === "general") return;
    await fetch("/api/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey.trim() },
      body: JSON.stringify({ topic: activeTopic, deleteTopic: true }),
    });
    setActiveTopic("general");
    loadHistory("general");
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
      loadHistory(activeTopic, trimmed);
    } catch (err) {
      setStatus({ text: err.message, isError: true });
    }
  };

  const sendCustomPing = async (e) => {
    if (e) e.preventDefault();
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setStatus({ text: "Enter your API_SECRET in Settings first.", isError: true });
      setShowConfig(true);
      return;
    }
    if (!title.trim() && !body.trim()) {
      setStatus({ text: "Type a title or message before sending.", isError: true });
      return;
    }

    setSending(true);
    setStatus({ text: "", isError: false });
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": trimmedKey },
        body: JSON.stringify({
          topic: activeTopic,
          title: title.trim() || "PingBox",
          body: body.trim(),
          url: url.trim() || "/",
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to send notification.");
      }
      const data = await res.json();
      setTitle("");
      setBody("");
      setUrl("");
      setStatus({ text: `Sent to #${activeTopic} (${data.sent}/${data.totalDevices} devices).`, isError: false });
      loadHistory(activeTopic, trimmedKey);
    } catch (err) {
      setStatus({ text: err.message, isError: true });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      sendCustomPing();
    }
  };

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
          </div>
        </section>
      )}

      {apiKey && (
        <>
          {/* Topics / Channels Bar */}
          <div className="topics-bar">
            {topics.map((t) => (
              <button
                key={t}
                className={`topic-pill ${activeTopic === t ? "active" : ""}`}
                onClick={() => setActiveTopic(t)}
              >
                #{t}
              </button>
            ))}

            {showNewTopic ? (
              <form className="new-topic-form" onSubmit={createTopic}>
                <input
                  type="text"
                  className="input new-topic-input"
                  placeholder="channel-name"
                  value={newTopicName}
                  onChange={(e) => setNewTopicName(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn btn-primary" style={{ padding: "5px 10px", fontSize: 12 }}>
                  Add
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "5px 8px", fontSize: 12 }}
                  onClick={() => setShowNewTopic(false)}
                >
                  ×
                </button>
              </form>
            ) : (
              <button className="topic-pill" onClick={() => setShowNewTopic(true)}>
                + New Chat
              </button>
            )}
          </div>

          {/* Composer */}
          <form className="composer" onSubmit={sendCustomPing}>
            <span className="panel-label" style={{ marginBottom: 0 }}>
              Send to #{activeTopic}
            </span>
            <div className="composer-row">
              <input
                type="text"
                className="input"
                placeholder="Title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <input
                type="url"
                className="input"
                placeholder="Link URL (optional)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <textarea
              className="textarea"
              placeholder={`Write a message to #${activeTopic}...`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="composer-actions">
              <span className="hint">Ctrl + Enter to send</span>
              <button type="submit" className="btn btn-primary" disabled={sending}>
                {sending ? "Sending..." : "Send Ping"}
              </button>
            </div>
          </form>
        </>
      )}

      {status.text && (
        <div className={`notice ${status.isError ? "error" : ""}`}>{status.text}</div>
      )}

      <div className="feed-header">
        <span className="feed-title">
          #{activeTopic} ({inbox.length})
        </span>
        <div className="feed-actions">
          {inbox.length > 0 && (
            <button className="btn-ghost-danger" onClick={clearTopic}>
              Clear chat
            </button>
          )}
          {activeTopic !== "general" && (
            <button className="btn-ghost-danger" onClick={deleteTopic}>
              Delete #{activeTopic}
            </button>
          )}
        </div>
      </div>

      {inbox.length === 0 ? (
        <div className="empty">No notifications in #{activeTopic} yet.</div>
      ) : (
        <div className="feed-list">
          {inbox.map((item, idx) => {
            const msgId = item.id || item.timestamp;
            return (
              <article key={`${msgId}-${idx}`} className="feed-item">
                <div className="item-top">
                  <span className="item-title">{item.title}</span>
                  <div className="item-meta-right">
                    <span className="item-time" title={new Date(item.timestamp).toLocaleString()}>
                      {formatRelativeTime(item.timestamp)}
                    </span>
                    <button
                      className="btn-ghost-danger"
                      onClick={() => deleteMessage(msgId)}
                      title="Delete message"
                    >
                      delete
                    </button>
                  </div>
                </div>
                {item.body && <p className="item-body">{item.body}</p>}
                {item.url && item.url !== "/" && (
                  <a className="item-link" href={item.url} target="_blank" rel="noreferrer">
                    {item.url.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}