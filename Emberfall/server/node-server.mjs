import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeRoomService, MemoryRoomStore } from './rooms.mjs';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

/** No process is started on import. Call listen() explicitly, close() after tests. */
export function createNodeServer({ service = makeRoomService({ store: new MemoryRoomStore() }), root = publicRoot } = {}) {
  const server = http.createServer(async (incoming, outgoing) => {
    const send = (status, body, contentType = 'application/json; charset=utf-8') => {
      outgoing.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      outgoing.end(body);
    };
    try {
      const url = new URL(incoming.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        let size = 0;
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > 4_096) {
            send(413, JSON.stringify({ error: 'body_too_large', message: 'Слишком большой запрос.' }));
            return;
          }
          chunks.push(chunk);
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        // The local adapter uses the actual peer address, never a forged proxy header.
        headers.set('cf-connecting-ip', incoming.socket.remoteAddress || 'local');
        const request = new Request(url, {
          method: incoming.method, headers,
          ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {})
        });
        const response = await service.fetch(request);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (!['GET', 'HEAD'].includes(incoming.method)) { send(405, 'Method not allowed', 'text/plain'); return; }
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { send(400, 'Bad path', 'text/plain'); return; }
      if (pathname.includes('\0') || pathname.includes('\\')) { send(400, 'Bad path', 'text/plain'); return; }
      const base = await realpath(root);
      const route = pathname === '/' ? '/index.html' : pathname === '/phone' || pathname === '/phone/' ? '/phone/index.html' : pathname;
      const candidate = path.resolve(base, `.${route}`);
      const relative = path.relative(base, candidate);
      if (relative.startsWith('..') || path.isAbsolute(relative)) { send(403, 'Forbidden', 'text/plain'); return; }
      const actual = await realpath(candidate);
      const actualRelative = path.relative(base, actual);
      if (actualRelative.startsWith('..') || path.isAbsolute(actualRelative)) { send(403, 'Forbidden', 'text/plain'); return; }
      const bytes = await readFile(actual);
      outgoing.writeHead(200, { 'Content-Type': MIME[path.extname(actual)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      outgoing.end(incoming.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!outgoing.headersSent) send(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500, JSON.stringify({ error: 'request_failed' }));
      else outgoing.end();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const value = process.argv[process.argv.indexOf('--port') + 1];
  const port = process.argv.includes('--port') ? Number(value) : 4173;
  const hostValue = process.argv[process.argv.indexOf('--host') + 1];
  const host = process.argv.includes('--host') ? hostValue : '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535');
  if (!host || !/^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[?::1\]?)$/.test(host)) throw new Error('Host must be localhost, an IPv4 address, or ::1');
  const server = createNodeServer();
  server.listen(port, host.replace(/^\[|\]$/g, ''), () => console.log(`Emberfall local multiplayer: http://${host.includes(':') ? '[::1]' : host}:${port}`));
}
