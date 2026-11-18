const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.wasm': 'application/wasm',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // Enable CORS and disable cache during development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');

    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/' || reqPath === '') {
        reqPath = '/index.html';
    }

    const filePath = path.join(PUBLIC_DIR, reqPath);

    // Prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('403 Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stats.size
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`C++ WebAssembly App running at http://localhost:${PORT}`);
    console.log(`Also accessible at http://127.0.0.1:${PORT}`);
});
