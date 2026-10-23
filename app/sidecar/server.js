/**
 * sidecar: 管理 lxserver 前端密码 + 自动开放公开访问权限
 * 通过 docker.sock 重建容器以应用新密码。
 */
const http = require('http');
const fs = require('fs');

const CONFIG_PATH = '/data/config.js';
const COMPOSE_PATH = '/data/docker-compose.yml';
const PORT = 3001;
const DOCKER_SOCK = '/var/run/docker.sock';
const LX_CONTAINER = 'nas-music-download';
// 允许的 CORS 来源：默认仅同源（空数组），可通过环境变量追加
const ALLOWED_ORIGINS = (process.env.SIDECAR_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

/**
 * 转义用于 JS 正则替换字符串中的特殊字符（$ & 等），
 * 并转义双引号，防止密码含 " 时破坏 config.js 结构。
 */
function escapeReplacement(s) {
  return s.replace(/\$/g, '$$$$').replace(/"/g, '\\"');
}

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
  if (infoRes.status >= 300) throw new Error('获取容器配置失败: ' + infoRes.body);
  const info = JSON.parse(infoRes.body);

  // 2. 修改环境变量中的 FRONTEND_PASSWORD
  const env = info.Config.Env.map(e => {
    if (e.startsWith('FRONTEND_PASSWORD=')) return `FRONTEND_PASSWORD=${newPassword}`;
    return e;
  });

  // 3. 停止并删除旧容器
  await dockerRequest('POST', `/containers/${LX_CONTAINER}/stop?t=5`);
  await dockerRequest('DELETE', `/containers/${LX_CONTAINER}`);

  // 4. 用新配置创建容器（保留原镜像、卷、网络、重启策略）
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

/**
 * 校验来源：仅允许同源或白名单内的 Origin。
 * 返回 true 表示允许，false 表示应拒绝。
 */
function isOriginAllowed(origin) {
  if (!origin) return true; // 非浏览器请求（无 Origin 头）放行
  return ALLOWED_ORIGINS.includes(origin);
}

const server = http.createServer((req, res) => {
  // CORS：仅白名单来源，不再回显任意 Origin
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-frontend-auth');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/admin/password') {
    // 来源校验
    if (!isOriginAllowed(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '来源不被允许' }));
      return;
    }

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
        if (data.newPassword.length > 128) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '密码过长（>128位）' }));
          return;
        }

        const safePwd = escapeReplacement(data.newPassword);

        // 1. 修改 config.js
        let configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
        configContent = configContent.replace(
          /(["']frontend\.password["']\s*:\s*)"[^"]*"/,
          `$1"${safePwd}"`
        );
        fs.writeFileSync(CONFIG_PATH, configContent, 'utf8');

        // 2. 修改 docker-compose.yml 里的 FRONTEND_PASSWORD
        try {
          let composeContent = fs.readFileSync(COMPOSE_PATH, 'utf8');
          // compose 中密码不含引号，直接替换等号后内容（转义 $ 防 sed 风格问题）
          composeContent = composeContent.replace(
            /FRONTEND_PASSWORD=.*/,
            `FRONTEND_PASSWORD=${data.newPassword.replace(/\$/g, '$$$$')}`
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

  res.writeHead(404);
  res.end('Not Found');
});

// 启动时自动配置公开访问权限
function initPublicAccess() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      console.log('config.js不存在，等待lxserver初始化...');
      setTimeout(initPublicAccess, 2000);
      return;
    }
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    let config;
    try {
      config = JSON.parse(content.replace('module.exports = ', ''));
    } catch (e) {
      console.log('config.js还未初始化完成，重试...');
      setTimeout(initPublicAccess, 2000);
      return;
    }
    // 自动开启所有公开访问权限
    const toggles = {
      'user.enablePublicRestriction': false,
      'user.enablePublicNonAdminAccess': true,
      'user.enablePublicNonAdminLocalMusic': true,
      'user.enablePublicNonAdminBrowserDownload': true,
      'user.enablePublicNonAdminServerCache': true,
      'user.enablePublicFavorites': true,
    };
    let modified = false;
    for (const [key, value] of Object.entries(toggles)) {
      if (config[key] !== value) {
        config[key] = value;
        modified = true;
      }
    }
    if (modified) {
      fs.writeFileSync(CONFIG_PATH, 'module.exports = ' + JSON.stringify(config, null, 2) + ';');
      console.log('已自动配置公开访问权限');
    } else {
      console.log('公开访问权限已配置完成');
    }
  } catch (e) {
    console.log('初始化公开配置失败，重试:', e.message);
    setTimeout(initPublicAccess, 2000);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Password sidecar running on port ${PORT}`);
  initPublicAccess();
});
//（注：内容由AI生成）
