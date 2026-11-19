import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (req.headers["x-api-key"] !== process.env.API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "Invalid subscription" });
  }

  await redis.hset("pingbox:subs", {
    [subscription.endpoint]: JSON.stringify(subscription)
  });

  res.status(200).json({ ok: true });
}