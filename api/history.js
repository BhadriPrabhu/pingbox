import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.headers["x-api-key"] !== process.env.API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const items = await redis.lrange("pingbox:history", 0, 29);
  const parsed = items.map((item) =>
    typeof item === "string" ? JSON.parse(item) : item
  );

  res.status(200).json(parsed);
}