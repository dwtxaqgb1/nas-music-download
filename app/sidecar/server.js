const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = '/data/config.js';
const PORT = 3001;

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-frontend-auth');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/admin/password') {
    // 验证管理员密码
    const auth = req.headers['x-frontend-auth'];
    let config = {};
    try {
      const content = fs.readFileSync(CONFIG_PATH, 'utf8');
      const match = content.match(/module\.exports\s*=\s*([\s\S]*);?\s*$/);
      if (match) {
        config = eval('(' + match[1] + ')');
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '读取配置失败: ' + e.message }));
      return;
    }

    const currentPassword = config['frontend.password'];
    if (auth !== currentPassword) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '管理员密码不正确' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.newPassword || data.newPassword.length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '密码至少3位' }));
          return;
        }

        // 读取原始配置内容，替换密码
        let content = fs.readFileSync(CONFIG_PATH, 'utf8');
        // 替换 frontend.password
        content = content.replace(
          /('frontend\.password'\s*:\s*)"[^"]*"/,
          `$1"${data.newPassword}"`
        );
        fs.writeFileSync(CONFIG_PATH, content, 'utf8');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Password sidecar running on port ${PORT}`);
});
