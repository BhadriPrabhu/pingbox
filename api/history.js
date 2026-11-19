import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.headers["x-api-key"] !== process.env.API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // GET: Fetch all topics + messages for the active topic
  if (req.method === "GET") {
    const topic = (req.query.topic || "general").toLowerCase();
    const rawTopics = (await redis.smembers("pingbox:topics")) || [];
    const topics = Array.from(new Set(["general", ...rawTopics])).sort();

    const items = (await redis.lrange(`pingbox:msg:${topic}`, 0, 49)) || [];
    const messages = items.map((item) =>
      typeof item === "string" ? JSON.parse(item) : item
    );

    return res.status(200).json({ topics, messages });
  }

  // POST: Create a new topic (chat)
  if (req.method === "POST") {
    const { topic } = req.body || {};
    const cleanTopic = (topic || "").trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    if (!cleanTopic) return res.status(400).json({ error: "Invalid topic name" });

    await redis.sadd("pingbox:topics", cleanTopic);
    return res.status(200).json({ ok: true, topic: cleanTopic });
  }

  // DELETE: Delete a single message, clear a topic, or delete a topic
  if (req.method === "DELETE") {
    const { topic = "general", id, clearAll, deleteTopic } = req.body || {};
    const key = `pingbox:msg:${topic}`;

    if (deleteTopic && topic !== "general") {
      await redis.del(key);
      await redis.srem("pingbox:topics", topic);
      return res.status(200).json({ ok: true });
    }

    if (clearAll) {
      await redis.del(key);
      return res.status(200).json({ ok: true });
    }

    if (id) {
      const items = (await redis.lrange(key, 0, -1)) || [];
      const target = items.find((item) => {
        const parsed = typeof item === "string" ? JSON.parse(item) : item;
        return parsed.id === id || parsed.timestamp === id;
      });
      if (target) {
        const raw = typeof target === "string" ? target : JSON.stringify(target);
        await redis.lrem(key, 1, raw);
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Nothing to delete" });
  }

  return res.status(405).end();
}