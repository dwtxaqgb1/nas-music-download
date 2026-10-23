# 接收底层镜像参数，默认使用 v2.1.2
ARG BASE_IMAGE=xcq0607/lxserver:v2.1.2
FROM ${BASE_IMAGE}

# 将定制的前端代码覆盖进镜像的静态目录
COPY app/web/ /server/public/
