import { Redis } from "@upstash/redis";
import * as webpushPkg from "web-push";

const webpush = webpushPkg.default || webpushPkg;
const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (req.headers["x-api-key"] !== process.env.API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:admin@example.com";
    const pubKey = process.env.VAPID_PUBLIC_KEY?.trim();
    const privKey = process.env.VAPID_PRIVATE_KEY?.trim();

    if (!pubKey || !privKey) {
      return res.status(500).json({ error: "Missing VAPID keys in Vercel env" });
    }

    webpush.setVapidDetails(subject, pubKey, privKey);

    const { title = "PingBox Alert", body = "", url = "/" } = req.body || {};
    const payload = { title, body, url, timestamp: new Date().toISOString() };

    // 1. Save to inbox history (keep latest 50)
    await redis.lpush("pingbox:history", JSON.stringify(payload));
    await redis.ltrim("pingbox:history", 0, 49);

    // 2. Push to all subscribed devices
    const subs = (await redis.hgetall("pingbox:subs")) || {};
    const endpoints = Object.keys(subs);

    let sent = 0;
    for (const endpoint of endpoints) {
      const sub = typeof subs[endpoint] === "string"
        ? JSON.parse(subs[endpoint])
        : subs[endpoint];

      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await redis.hdel("pingbox:subs", endpoint);
        }
      }
    }

    return res.status(200).json({ ok: true, sent, totalDevices: endpoints.length });
  } catch (err) {
    console.error("Notify error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}