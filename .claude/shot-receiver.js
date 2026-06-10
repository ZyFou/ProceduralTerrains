// Dev helper: receives base64 JPEG screenshots POSTed from the app page and
// writes them to disk so they can be inspected. Not part of the app.
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') { res.end('ok'); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const name = (req.url.replace(/[^a-z0-9-]/gi, '') || 'shot') + '.jpg';
    const file = path.join(__dirname, name);
    fs.writeFileSync(file, Buffer.from(body, 'base64'));
    console.log('saved', file, fs.statSync(file).size, 'bytes');
    res.end('saved');
  });
});
server.listen(5199, () => console.log('shot receiver on 5199'));
