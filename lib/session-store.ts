// lib/session-store.ts
import { Redis } from 'ioredis';

const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

client.on('error', (err) => console.error('Redis Client Error', err));

export async function saveSession(sessionId: string, data: any) {
  console.log('💾 Saving session:', { sessionId, data });
  await client.set(`session:${sessionId}`, JSON.stringify(data), 'EX', 3600 * 24);
  console.log('✅ Session saved:', { sessionId });
}

export async function getSession(sessionId: string) {
  console.log('🔎 Retrieving session:', { sessionId });
  const data = await client.get(`session:${sessionId}`);
  const session = data ? JSON.parse(data) : null;
  console.log('✅ Session retrieved:', { sessionId, exists: !!session });
  return session;
}

export async function deleteSession(sessionId: string) {
  console.log('🗑️ Deleting session:', { sessionId });
  await client.del(`session:${sessionId}`);
}