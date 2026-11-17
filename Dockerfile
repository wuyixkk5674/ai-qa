# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# 单阶段构建：项目零运行时依赖、无构建步骤，直接跑源码即可
# ---------------------------------------------------------------------------
FROM node:24-alpine

# 便于在生产模式下运行（本应用不区分，保留为约定）
ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# 只复制运行必需的资源，并直接赋予 node 用户属主
# 注意：data 目录在运行时会写入问答记录，必须以 node 用户身份可写
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node data ./data

# 声明服务端口（仅文档作用，不实际发布）
EXPOSE 3000

# 切换到镜像内置的非 root 用户（uid 1000）
USER node

# 启动应用
CMD ["npm", "start"]
