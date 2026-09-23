const http = require('http');
const fs = require('fs');

const CONFIG_PATH = '/data/config.js';
const COMPOSE_PATH = '/data/docker-compose.yml';
const PORT = 3001;
const DOCKER_SOCK = '/var/run/docker.sock';
const LX_CONTAINER = 'nas-music-download';

function dockerRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      socketPath: DOCKER_SOCK,
      path: path,
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function recreateContainer(newPassword) {
  // 1. 获取当前容器配置
  const infoRes = await dockerRequest('GET', `/containers/${LX_CONTAINER}/json`);
  const info = JSON.parse(infoRes.body);

  // 2. 修改环境变量中的 FRONTEND_PASSWORD
  const env = info.Config.Env.map(e => {
    if (e.startsWith('FRONTEND_PASSWORD=')) return `FRONTEND_PASSWORD=${newPassword}`;
    return e;
  });

  // 3. 停止并删除旧容器
  await dockerRequest('POST', `/containers/${LX_CONTAINER}/stop?t=5`);
  await dockerRequest('DELETE', `/containers/${LX_CONTAINER}`);

  // 4. 用新配置创建容器
  const createBody = {
    Image: info.Config.Image,
    Env: env,
    ExposedPorts: info.Config.ExposedPorts,
    NetworkingConfig: { EndpointsConfig: info.NetworkSettings.Networks },
    HostConfig: {
      Binds: info.HostConfig.Binds,
      RestartPolicy: info.HostConfig.RestartPolicy,
      PortBindings: {}
    }
  };

  const createRes = await dockerRequest('POST', '/containers/create?name=' + LX_CONTAINER, createBody);
  if (createRes.status >= 300) throw new Error('创建容器失败: ' + createRes.body);

  // 5. 启动
  await dockerRequest('POST', `/containers/${LX_CONTAINER}/start`);
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-frontend-auth');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/admin/password') {
    const auth = req.headers['x-frontend-auth'];
    let currentPassword = '';
    try {
      const content = fs.readFileSync(CONFIG_PATH, 'utf8');
      const match = content.match(/["']frontend\.password["']\s*:\s*"([^"]*)"/);
      if (match) currentPassword = match[1];
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '读取配置失败: ' + e.message }));
      return;
    }

    if (auth !== currentPassword) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '管理员密码不正确' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        if (!data.newPassword || data.newPassword.length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '密码至少3位' }));
          return;
        }

        // 1. 修改 config.js
        let configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
        configContent = configContent.replace(
          /(["']frontend\.password["']\s*:\s*)"[^"]*"/,
          `$1"${data.newPassword}"`
        );
        fs.writeFileSync(CONFIG_PATH, configContent, 'utf8');

        // 2. 修改 docker-compose.yml 里的 FRONTEND_PASSWORD
        try {
          let composeContent = fs.readFileSync(COMPOSE_PATH, 'utf8');
          composeContent = composeContent.replace(
            /FRONTEND_PASSWORD=.*/,
            `FRONTEND_PASSWORD=${data.newPassword}`
          );
          fs.writeFileSync(COMPOSE_PATH, composeContent, 'utf8');
        } catch (e) {
          console.error('修改compose失败:', e.message);
        }

        // 3. 先返回成功，后台重建容器
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));

        // 后台重建容器
        setTimeout(async () => {
          try {
            await recreateContainer(data.newPassword);
          } catch (e) {
            console.error('重建容器失败:', e.message);
          }
        }, 500);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 公开接口：获取访客密码配置（无需认证）
  if (req.method === 'GET' && req.url === '/api/guest-config') {
    try {
      const content = fs.readFileSync(CONFIG_PATH, 'utf8');
      const match = content.match(/["']serverName["']\s*:\s*"([^"]*)"/);
      const serverName = match ? match[1] : '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ serverName: serverName }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ serverName: '__guest_off__' }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Password sidecar running on port ${PORT}`);
});
