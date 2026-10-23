document.addEventListener('DOMContentLoaded', () => {
  // 检查是否已经初始化
  if (localStorage.getItem('nas_music_initialized')) return;

  // 防止原页面登录框显示
  const loginPage = document.getElementById('loginPage');
  const appPage = document.getElementById('app');
  if (loginPage) loginPage.classList.add('hidden');
  if (appPage) appPage.classList.add('hidden');

  // 动态创建悬浮设置窗口
  const html = `
  <div id="extSetup" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(13,17,23,0.95);z-index:99999;display:flex;align-items:center;justify-content:center;">
    <div style="background:#161b22;border:1px solid #30363d;border-radius:16px;padding:30px;width:320px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
      <div style="font-size:40px;margin-bottom:10px;">🎵</div>
      <h2 style="color:#e6edf3;margin-bottom:10px;font-size:18px;">欢迎使用 NAS 音乐</h2>
      <p style="color:#8b949e;font-size:13px;margin-bottom:20px;">首次运行，请设置管理员密码</p>
      <input type="password" id="extPwd" placeholder="请输入新密码 (至少3位)" style="width:100%;padding:12px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#fff;margin-bottom:15px;outline:none;text-align:center;">
      <button id="extBtn" style="width:100%;padding:12px;background:#1f6feb;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;font-weight:bold;">开始探索</button>
      <p id="extMsg" style="color:#da3633;font-size:12px;margin-top:10px;min-height:18px;"></p>
    </div>
  </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  document.getElementById('extBtn').onclick = async () => {
    const pwd = document.getElementById('extPwd').value.trim();
    const msg = document.getElementById('extMsg');
    const btn = document.getElementById('extBtn');
    
    if (pwd.length < 3) {
      msg.textContent = '密码至少需要3位字符';
      return;
    }

    btn.disabled = true;
    btn.textContent = '正在应用...';
    msg.textContent = '';

    try {
      // 发送请求修改密码（Nginx 会自动带上默认密码验证）
      const res = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-frontend-auth': '123456' },
        body: JSON.stringify({ newPassword: pwd })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '修改失败');

      // 写入本地缓存，代表初始化完成
      localStorage.setItem('nas_music_initialized', 'true');
      localStorage.setItem('nas_music_pwd', pwd);
      
      let count = 8;
      btn.textContent = `服务重启中 (${count}s)`;
      const timer = setInterval(() => {
        count--;
        btn.textContent = `服务重启中 (${count}s)`;
        if (count <= 0) {
          clearInterval(timer);
          location.reload();
        }
      }, 1000);

    } catch (err) {
      msg.textContent = '设置失败: ' + err.message;
      btn.disabled = false;
      btn.textContent = '开始探索';
    }
  };
});
