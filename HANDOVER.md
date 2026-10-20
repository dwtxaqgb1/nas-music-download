# NAS-music-download 项目交接文档

> 最后更新：2026-10-20

## 一、项目概述

基于**落雪音乐 lxserver** 二次开发的 NAS 音乐下载站。前端是一个单页应用（app.js + index.html），后端是 lxserver（Node.js），通过 nginx 反向代理对外提供服务。

**核心功能**：搜索5大平台（酷我/网易/QQ/酷狗/咪咕）音乐，下载到 NAS，支持歌单、排行榜、下载管理、用户系统、音源管理。

## 二、访问方式

- **前端地址**：http://www.qinyin.eu.org:5200/
- **NAS SSH**：`ssh qin@www.qinyin.eu.org -p 22`，密码 `Dwt645830@`
- **提权方式**：`echo 'Dwt645830@' | sudo -S bash -c '...'`

## 三、目录结构

```
/vol1/1000/nas-music-download-main/
├── app/web/                    # 前端源码
│   ├── app.js                  # 主逻辑（~2500行，已被瘦身）
│   ├── index.html              # 页面结构
│   └── style.css               # 样式
├── data/
│   ├── config.js               # 后端配置（frontend.password, users, 音源设置）
│   ├── users.json              # 用户列表（当前为空 []）
│   ├── runtime/
│   │   └── server-download-queue.json  # 下载队列
│   └── logs/
│       └── app.log             # 日志
├── music/                      # 下载的音乐文件
└── 备份目录：/vol1/1000/我的文件/备份/nas-music-20261020_165405/
    ├── source/app/web/app.js   # 原始完整版（17239行，未瘦身）
    └── container_public/       # 容器内原始文件备份
```

## 四、Docker 容器

| 容器名 | 端口 | 作用 |
|---|---|---|
| `nas-music-backend` | 9527 | lxserver 主服务（后端API + 静态文件） |
| `nas-music-bridge` | 8773 | 桥接服务 |
| `nas-music-gateway` | 5200→80 | nginx 反向代理 |

**前端文件在容器内路径**：`/server/public/`（app.js, index.html, style.css）
**后端源码在容器内路径**：`/server/server/server/`（server.js, userApi.js, fileCache.js, serverDownloadQueue.js）

## 五、关键配置（data/config.js）

```js
frontend: {
  password: "admin123"   // 管理员密码（任意用户名 + 此密码 = 管理员）
},
user: {
  enablePublicFavorites: true,        // 公开歌单
  enablePublicNonAdminAccess: true,   // 非管理员可访问
}
```

**用户系统机制**：
- 管理员 = 任意用户名 + `frontend.password`（admin123）
- 普通用户走 `/api/user/login`（当前 users=[]，无普通用户）
- 管理员登录后 localStorage 存 `nas_music_admin`

## 六、已完成的修改与修复

### 6.1 用户系统
- ✅ 管理员 Web 端改名/改密（动态鉴权 `isAdminFlag`，不再硬编码 admin）
- ✅ 删除用户时连数据目录一起删除（`deleteData:true`）
- ✅ 歌单 401 修复（`enablePublicFavorites=true`）

### 6.2 排行榜
- ✅ 点酷我不弹榜单 → 恢复事件委托弹窗逻辑（`.platform-btn` 点击捕获）
- ✅ "当前榜单显示区"恢复（`#currentBoardDisplay`，显示平台名+榜单名+数量）

### 6.3 下载管理
- ✅ 失败判定：`<100KB 判失败`（之前是 0字节才判失败，导致 39字节坏文件误显示完成）
- ✅ 一键重试无反应 → `_lastQueueData` 未定义修复（`renderQueueUI` 开头赋值 `window._lastQueueData`）
- ✅ **重试逻辑（方案B）**：重试时不再沿用原 songInfo（固定原平台），而是改为 `{name, singer, source:'auto'}`，强制后端按"歌名+歌手"搜索5大平台挨个试
- ✅ **换源顺序改为酷我优先**：`AUTO_SOURCE_ORDER = ['kw','wy','tx','kg','mg']`（原先是网易优先）
- ✅ 下载线程下拉框（1-5）放在"取消任务"按钮右侧，调 `/api/music/cache/queue/concurrency`

### 6.4 后端换源逻辑（resolveServerSong）
- 原平台试 → 失败后 `findServerSourceMatches`（歌名+歌手搜其余平台，按匹配度打分）→ 换源再试 → 降音质再试 → 成功即停
- 方案A：`probeAudioSize` 探测 URL 资源大小，<100KB 判坏源抛错触发换源（保留作为双保险）


### 6.5 音源列表跨浏览器可见（2026-10-20）
- **问题**：设置→音源管理中导入的音源，在当前浏览器（已登录管理员）显示，换浏览器（未登录）不显示
- **根因**：`/api/custom-source/list` 的 GET 鉴权检查 `user.enablePublicRestriction`（当前为 true），未登录请求返回 403
- **修复**：移除 `/api/custom-source/list` 的登录鉴权，音源列表公开可读；上传/删除/启用等 POST 操作仍需管理员鉴权（`server.js` 约6628行）
- **备份**：容器内 `/server/server/server/server.js.bak_list_auth`
- **验证**：不带 auth 调 list API 返回2个音源；upload API 仍返回 403；搜索+播放链接正常（全豆要聚合音源V4.1）


### 6.6 下载管理手机端优化（2026-10-20）
- **状态标签一屏显示**：手机端 `.queue-tabs` 改为 `grid-template-columns: repeat(4, 1fr)`，全部/下载中/已完成/错误 4个标签平分宽度，不再横向溢出
- **每首歌播放按钮**：所有下载任务右侧均显示 ▶ 播放按钮；已完成播本地文件，未完成/失败在线播放
- **点击弹出功能菜单**：点击歌曲项弹出底部操作菜单（播放/重试下载/复制直链/删除任务），checkbox 保留批量勾选，播放按钮独立点击
- **新增函数**：`showQueueActionMenu`、`closeQueueActionMenu`、`deleteQueueTask`、`copyQueueDirectLink`；`playQueueSong` 增强支持在线播放
- **新增模态框**：`#queueActionModal`（index.html），样式 `.queue-action-item`（style.css）
- **备份**：容器内 `app.js.bak_dl_opt`、`index.html.bak_dl_opt`、`style.css.bak_dl_opt`

## 七、常用操作流程

### 7.1 修改前端（app.js / index.html）
```bash
# 1. 从容器拉取当前版本
docker exec nas-music-backend cat /server/public/app.js > /tmp/app.js

# 2. 本地修改

# 3. 部署到容器
docker cp /tmp/app.js nas-music-backend:/server/public/app.js

# 4. 同步到宿主机源码目录
cp /tmp/app.js /vol1/1000/nas-music-download-main/app/web/app.js

# 5. 重启后端
docker restart nas-music-backend
```

### 7.2 修改后端（server.js）
```bash
# 1. 从容器拉取
docker exec nas-music-backend cat /server/server/server/server.js > /tmp/server.js

# 2. 本地修改

# 3. 部署
docker cp /tmp/server.js nas-music-backend:/server/server/server/server.js
docker restart nas-music-backend
```

### 7.3 修改配置（data/config.js）
```bash
# 直接编辑宿主机文件，然后重启
vi /vol1/1000/nas-music-download-main/data/config.js
docker restart nas-music-backend
```

## 八、已知问题与待办

1. **翻唱歌曲搜不到**：某些翻唱/小众歌曲在5大平台都搜不到匹配，会显示"下载失败"（正常现象）
2. **音源管理首次加载**：PC端实测正常显示2个音源；手机端可能需要强刷缓存
3. **备份文件**：app.js 有多个备份（.bak_modal, .bak_disp, .bak_retry, .bak_B, .bak_conc 等），可回滚

## 九、关键 API 接口

| 接口 | 方法 | 作用 |
|---|---|---|
| `/api/custom-source/list?username=open` | GET | 音源列表 |
| `/api/music/cache/queue` | GET | 下载队列 |
| `/api/music/cache/queue` | POST | 添加下载任务 |
| `/api/music/cache/queue/remove` | POST | 移除任务 |
| `/api/music/cache/queue/concurrency` | POST | 设置并发数（1-5） |
| `/api/music/search?name=xxx&source=kw` | GET | 搜索歌曲 |

## 十、调试技巧

1. **前端调试**：浏览器 F12 → Console，看 `[方案A探测]` `[方案A试源]` 日志（如果加了的话）
2. **后端日志**：`docker exec nas-music-backend tail -f /server/data/logs/app.log`
3. **下载队列实时状态**：`python3 -c "import json; d=json.load(open('/vol1/1000/nas-music-download-main/data/runtime/server-download-queue.json')); [print(t['songInfo']['name'], t['status'], t['total']) for t in d['tasks']]"`
4. **文件大小验证**：`ls -la /vol1/1000/nas-music-download-main/music/`
