# NAS歌曲下载

基于 lxserver 的 NAS 音乐下载 Web 应用，支持 5 大平台音乐搜索、排行榜、歌单管理、在线播放、下载到 NAS。

## 功能特性

- **5 大平台音乐源**：搜索、排行榜、歌单，自由切换
- **在线播放**：内置播放器，支持音质切换
- **下载到 NAS**：多线程下载，自动保存到指定目录
- **歌单管理**：我的歌单、上传歌单、保存到歌单
- **音源管理**：支持上传自定义音源，启用/禁用/删除
- **访客模式**：管理员可设置多个访客密码，访客只能听歌不能下载
- **多用户**：管理员密码登录，访客密码受限模式

## 快速安装

```bash
git clone https://github.dwtxaqgb.eu.org/https://github.com/dwtxaqgb1/nas-music-download.git
cd nas-music-download/docker
docker-compose up -d
```

访问 `http://NAS_IP:5200`，默认密码 `123456`。

## 自定义配置

修改 `docker/docker-compose.yml`：

- `FRONTEND_PASSWORD`：管理员密码
- `5200:80`：端口映射
- `./music:/server/music`：音乐下载目录

## 飞牛 fpk 安装

下载 fpk 安装包，飞牛应用中心上传安装，安装向导设置管理员密码、端口、下载目录。

## 使用说明

- 管理员：输入管理员密码登录，完整功能
- 访客：点"访客听歌"，输入访客密码进入受限模式
- 音源选择：顶部下拉框切换平台音源
- 下载：选中歌曲 → 点"下载到NAS"
- 歌单：选中歌曲 → 点"保存到歌单"

## 技术栈

- 后端：Node.js (lxserver)
- 前端：HTML/CSS/JavaScript
- 部署：Docker / 飞牛 fpk
