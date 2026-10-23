# 🎵 NAS-MUSIC 完整版 (洛雪音乐私有化部署)

本项目基于 **洛雪音乐 (LX Music)** 底层构建，采用多容器架构（Nginx + 洛雪服务端 + Python 桥接），为你打造一个界面精美、功能强大的 NAS 专属音乐库。

## 💡 核心特点
- **私有化部署**：音乐文件与数据全存本地 NAS，安全可控。
- **云端极速构建**：利用 GitHub Actions 预先打包镜像，NAS 端免编译，秒级拉取启动。
- **交互式向导**：自动引导配置端口、密码及音乐路径，一键完成环境搭建。
- **高度定制化**：支持挂载本地前端文件，方便随时修改界面。

---

## ⚡ 一键安装命令

在 NAS 终端中直接执行以下命令：

```bash
curl -sL https://github.com/dwtxaqgb1/nas-music-download/archive/refs/heads/main.tar.gz | tar -xz && cd nas-music-download-main && chmod +x install.sh && ./install.sh
```

## 鸣谢

- [lxserver](https://github.com/XCQ0607/lxserver) - 落雪音乐后端
