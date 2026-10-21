#!/bin/bash
echo "======================================"
echo "      NAS-MUSIC 完整版一键安装向导"
echo "======================================"

# 1. 选择后端版本
echo "请选择要安装的洛雪底层版本："
echo "1) v2.1.2 稳定版 (推荐)"
echo "2) 最新版 (latest)"
echo "3) 自定义镜像"
read -p "请输入选项数字 (默认 1): " input_ver
VERSION_OPT=${input_ver:-1}

case $VERSION_OPT in
    1) LX_IMAGE="xcq0607/lxserver:v2.1.2" ;;
    2) LX_IMAGE="xcq0607/lxserver:latest" ;;
    3) read -p "请输入完整的镜像名称 (如 xxx/yyy:tag): " custom_img; LX_IMAGE=${custom_img} ;;
    *) LX_IMAGE="xcq0607/lxserver:v2.1.2" ;;
esac

# 2. 设置端口、密码、音乐目录
read -p "请输入 Web 访问端口 (默认 5200): " input_port
PORT=${input_port:-5200}

read -p "请设置管理员密码 (默认 admin123): " input_pwd
PWD_VAL=${input_pwd:-admin123}

read -p "请输入音乐保存的绝对路径 (默认当前目录下 ./music): " input_music
MUSIC_DIR=${input_music:-./music}

mkdir -p "$MUSIC_DIR" 2>/dev/null
mkdir -p data

# 3. 自动生成环境变量文件
cat > .env << EOL
LXSERVER_IMAGE=$LX_IMAGE
WEB_PORT=$PORT
FRONTEND_PASSWORD=$PWD_VAL
MUSIC_DIR=$MUSIC_DIR
EOL

echo "⏳ 配置文件已生成，正在构建镜像并启动服务 (这可能需要几分钟)..."
docker compose up -d --build
CID=$(docker ps -q -f "name=lxserver" | head -n 1)
if [ -n "$CID" ]; then
  docker restart $CID >/dev/null 2>&1
fi

echo "======================================"
echo "✅ 安装完成！"
echo "🌐 请访问: http://你的IP:${PORT}"
echo "🔐 登录密码: ${PWD_VAL}"
echo "🎵 音乐目录: ${MUSIC_DIR}"
echo "⚙️ 当前底层: ${LX_IMAGE}"
echo "======================================"
