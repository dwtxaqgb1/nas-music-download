# Docker 安装

## 快速开始

```bash
git clone https://github.com/dwtxaqgb1/nas-music-download.git
cd nas-music-download/docker
docker-compose up -d
```

## 访问

- 地址：http://NAS_IP:5200
- 默认密码：123456

## 自定义

修改 `docker-compose.yml`：
- `FRONTEND_PASSWORD`：管理员密码
- `5200:80`：端口映射
- `./music:/server/music`：音乐目录
