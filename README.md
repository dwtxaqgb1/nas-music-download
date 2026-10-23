# NAS音乐

基于落雪音乐后端的NAS音乐下载系统，支持Docker一键部署。

## 功能

- 音乐搜索与下载
- 自定义音源
- 文件名格式：歌名 - 歌手
- Web管理界面
- 支持飞牛fnOS及通用Linux系统

## 一键安装

```bash
curl -sSL https://ghproxy.net/https://raw.githubusercontent.com/dwtxaqgb1/nas-music/main/install.sh -o install.sh && bash install.sh
```

## 安装向导

1. 安装方式：全新安装（清空数据）/ 更新安装（保留数据）
2. Web端口（默认5200）
3. 管理密码（默认admin123）
4. 数据目录（默认/opt/nas-music）
5. 音乐下载目录
6. 后端版本：v2.0.2稳定版 / 最新版
7. GitHub加速地址（默认ghproxy.net）

## 卸载

```bash
docker stop nas-music nas-music-lx nas-music-sidecar
docker rm nas-music nas-music-lx nas-music-sidecar
docker rmi xcq0607/lxserver nginx:alpine node:20-alpine
rm -rf /opt/nas-music
pkill -f lx_bridge.py
```

## 鸣谢

- [lxserver](https://github.com/XCQ0607/lxserver) - 落雪音乐后端
- [飞牛音乐链接](https://github.com/javycoder/fnos_music_ext) - fnOS音乐插件
