import { Redis } from "@upstash/redis";
import webpush from "web-push";

const redis = Redis.fromEnv();

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:admin@example.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (req.headers["x-api-key"] !== process.env.API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { title = "PingBox Alert", body = "", url = "/" } = req.body || {};
  const payload = { title, body, url, timestamp: new Date().toISOString() };

  await redis.lpush("pingbox:history", JSON.stringify(payload));
  await redis.ltrim("pingbox:history", 0, 49);

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

  res.status(200).json({ ok: true, sent, totalDevices: endpoints.length });
}