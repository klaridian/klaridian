// Mock upstream API — asserts the proxied request shape, on port 3900.
import { createServer } from 'node:http';
const log = [];
createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const entry = { method: req.method, url: req.url, auth: req.headers['authorization'] || null,
      apiKeyHdr: req.headers['api_key'] || null, contentType: req.headers['content-type'] || null, body };
    log.push(entry);
    console.error('UPSTREAM GOT: ' + JSON.stringify(entry));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, echoed: entry }));
  });
}).listen(3900, '127.0.0.1', () => console.error('mock upstream on 3900'));
