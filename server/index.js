import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import routes from './routes.js';
import { fetchAllFeeds } from './feed-fetcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3347;
const HOST = process.env.HOST || '0.0.0.0';
const app = Fastify({ logger: true });

await app.register(fastifyCors);
await app.register(fastifyStatic, { root: join(__dirname, '..', 'public') });
await app.register(routes, { prefix: '/api' });

app.addHook('onSend', async (req, reply) => {
  if (req.url.startsWith('/api/')) {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
  }
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
  return reply.sendFile('index.html');
});

cron.schedule('*/30 * * * *', async () => {
  app.log.info('Cron: 全フィードを更新中');
  try { await fetchAllFeeds(); } catch (e) { app.log.error(e); }
});

await app.listen({ port: PORT, host: HOST });
console.log('selfrss running at http://' + HOST + ':' + PORT);
