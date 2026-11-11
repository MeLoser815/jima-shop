# 即码小店

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/MeLoser815/jima-shop?style=social)](https://github.com/MeLoser815/jima-shop/stargazers)

可自建部署的开源卡密商店。顾客在前台浏览商品并完成结算，通过支付宝当面付扫码付款后自动获得卡密；商户在后台管理商品、分类、订单、卡密货源与店铺风格。

数据存储使用 SQLite（better-sqlite3，WAL 模式）。标准部署只运行 **一个 API 进程**，由该进程同时提供接口和前端静态资源。请勿对同一数据库文件使用多进程写入，也不要启用 PM2 cluster。

本软件以 [MIT](./LICENSE) 许可证发布。

**上线前请使用新的空数据库。** 不要把开发环境中的示例商品或 `DEMO-` 前缀演示卡密用于对外销售；不要将 `.env`、数据库文件或密钥放入公开仓库或镜像。

## 界面预览

### 店铺前台

![店铺首页](docs/images/storefront-home.png)

![商品详情](docs/images/storefront-product.png)

![订单查询](docs/images/storefront-order-query.png)

### 管理后台

![仪表盘](docs/images/admin-dashboard.png)

![商品管理](docs/images/admin-products.png)

## 功能

### 前台

- 响应式店铺：分类筛选、商品详情、购物车与结算
- 结账时预占卡密，再调用支付宝当面付 `alipay.trade.precreate` 生成收款码并轮询支付结果
- 可选视觉模板：草莓甜心、东方巨龙、神圣天使、次元集市
- 订单查询：仅已支付订单返回卡密，不返回买家账号等敏感字段

### 后台

- 首次启动时自行设置管理员账号与密码（bcrypt，密码至少 8 位）
- 仪表盘、商品与分类、订单、待补发订单的补发、操作日志
- 卡密货源导入（一行一条，或「卡号 + 卡密」）；库存按未用卡密计数
- 支付宝收款三要素在后台填写，密钥以 AES-GCM 加密入库
- 修改登录密码会使已有会话全部失效
- 管理员收银台（收款码 / 付款码）仅在后台提供，不在前台导航中展示入口

## 部署（推荐 Docker）

推荐使用 Docker 部署，可直接粘贴到 1Panel 的「容器 → 编排」中启动。镜像发布于 GitHub Container Registry：[`ghcr.io/meloser815/jima-shop`](https://github.com/MeLoser815/jima-shop/pkgs/container/jima-shop)。

启动前请准备：

1. 已解析到服务器的域名，并能为站点启用 HTTPS。生产环境的支付宝异步通知地址必须是公网可访问的 HTTPS URL，否则进程会拒绝启动。
2. 两枚足够长的随机密钥，分别用于会话签名（`SESSION_SECRET`）和数据加密（`SETTINGS_ENCRYPTION_KEY`）。可用 `openssl rand -hex 32` 各生成一次。`SETTINGS_ENCRYPTION_KEY` 必须长期保管，丢失后将无法解密已存储的支付宝密钥与卡密。
3. 已签约支付宝「当面付」的应用。AppId、应用私钥、支付宝公钥在后台界面填写，不必写入 Compose。

### 1Panel 编排

1. 打开 1Panel「容器」→「编排」，新建编排并填写名称（例如 `jima-shop`）。
2. 将下面的 Compose 粘贴到编排内容中。
3. 在「环境变量」中填写 [环境变量](#环境变量) 一节列出的必填项，不要使用示例域名或空密钥。
4. 保存并启动。将网站反向代理到容器映射的端口（默认 `3001`），并启用 HTTPS。
5. 在浏览器访问 `https://你的域名/admin`（若修改了 `ADMIN_BASE_PATH`，则使用相应路径），完成首次管理员创建。随后在后台导入商品与卡密，并配置支付宝收款参数。

```yaml
version: "3.8"

services:
  jima-shop:
    image: ghcr.io/meloser815/jima-shop:latest
    container_name: jima-shop
    restart: unless-stopped
    ports:
      - "${JIMA_PORT:-3001}:3001"
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: "3001"
      DATABASE_PATH: /data/jima.db
      WEB_ORIGIN: ${WEB_ORIGIN}
      ALIPAY_NOTIFY_URL: ${ALIPAY_NOTIFY_URL}
      SESSION_SECRET: ${SESSION_SECRET}
      SETTINGS_ENCRYPTION_KEY: ${SETTINGS_ENCRYPTION_KEY}
      ADMIN_BASE_PATH: ${ADMIN_BASE_PATH:-/admin}
    volumes:
      - ./data:/data
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      start_period: 20s
      retries: 5
```

同一份文件位于仓库根目录的 [`docker-compose.yml`](./docker-compose.yml)。数据文件写入编排目录下的 `./data`，请将该目录纳入备份。请保持单个副本运行，不要对同一数据卷做多实例水平扩展。

若暂时无法拉取 GHCR 镜像，可改用仓库中的 [`docker-compose.build.yml`](./docker-compose.build.yml) 从源码构建。

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `WEB_ORIGIN` | 是 | 站点对外访问的源，须与浏览器地址栏一致，例如 `https://shop.example.com`。用于 CORS。 |
| `ALIPAY_NOTIFY_URL` | 是 | 支付宝异步通知完整 URL，必须是公网 HTTPS，例如 `https://shop.example.com/api/payment/notify`。不要使用 `localhost`、内网地址或 HTTP。 |
| `SESSION_SECRET` | 是 | 会话签名密钥。使用足够长的随机串，禁止沿用文档或示例中的占位值。 |
| `SETTINGS_ENCRYPTION_KEY` | 是 | 用于加密存储支付宝密钥与卡密。使用足够长的随机串，部署后不要更换；更换或丢失后将无法解密已有数据。 |
| `ADMIN_BASE_PATH` | 否 | 管理后台路径，默认 `/admin`。可改为自定义的单段路径（例如 `/my-admin`）。不要使用 `/api`、`/cart`、`/pay`、`/order`、`/query`、`/cashier` 等前台或接口保留路径。后台入口不会出现在前台导航中，需在浏览器中手动输入。 |
| `JIMA_PORT` | 否 | 主机映射端口，默认 `3001`。 |
| `NODE_ENV` | 已在 Compose 中设定 | 必须为 `production`。生产模式不会写入演示数据，并启用启动检查。 |
| `DATABASE_PATH` | 已在 Compose 中设定 | 容器内数据库路径，默认 `/data/jima.db`，对应主机上的 `./data/jima.db`。应指向新的空库，不要复用开发数据库。 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 否 | 仅当库中尚无管理员时，可用环境变量自动创建账号（密码至少 8 位）。更推荐首次打开后台时在网页中自行设置，创建后从环境变量中移除密码。 |

生成密钥：

```bash
openssl rand -hex 32
```

命令行使用 Compose 时，可将 [`compose.env.example`](./compose.env.example) 复制为 `.env` 后填写，再执行 `docker compose up -d`。填写后的 `.env` 含有密钥，不要提交到 Git。

### 从源码构建镜像

适用于需要修改代码，或不便拉取 GHCR 镜像的情况。在仓库根目录配置好与上一节相同的环境变量后执行：

```bash
git clone https://github.com/MeLoser815/jima-shop.git
cd jima-shop
cp compose.env.example .env
# 编辑 .env，填入域名与密钥
docker compose -f docker-compose.build.yml up --build -d
```

## 本地开发与非容器部署

需要 Node.js 22 或更高版本，以及 [pnpm](https://pnpm.io/)。

```bash
git clone https://github.com/MeLoser815/jima-shop.git
cd jima-shop
cp .env.example apps/api/.env
# 开发环境可先沿用示例密钥；上线前必须换成随机串，并按「生产部署」一节调整通知地址与 WEB_ORIGIN

pnpm install
pnpm dev
```

- 店铺前台：http://localhost:5173/
- 管理后台：http://localhost:5173/admin（默认路径，可用 `ADMIN_BASE_PATH` 修改）
- API：http://localhost:3001

开发环境默认会写入示例分类、商品和 `DEMO-` 前缀演示卡密。若不需要演示数据，在环境变量中设置 `JIMA_SEED_DEMO=0` 后再以空的 `DATABASE_PATH` 启动。

### 非容器的生产启动

若不以 Docker 运行，仍须使用新的空数据库，设置强壮的 `SESSION_SECRET` 与 `SETTINGS_ENCRYPTION_KEY`，将 `ALIPAY_NOTIFY_URL` 设为公网 HTTPS，将 `WEB_ORIGIN` 设为站点的 https 源，并设置 `NODE_ENV=production`。在 HTTPS 反代后只运行一个 API 进程：

```bash
pnpm build
NODE_ENV=production pnpm start
# 或一次性：
NODE_ENV=production pnpm start:prod
```

生产模式下 API 会托管 `apps/web/dist`，将反代指到 API 端口即可。`ADMIN_BASE_PATH` 会在运行时注入页面；更改路径后重新启动服务。

若使用 PM2，请使用 fork 模式且 `instances=1`，不要开启 cluster。

## 配置与首次使用

环境变量说明见仓库根目录的 [`.env.example`](./.env.example)（本地开发复制为 `apps/api/.env`）以及上文的 Compose 环境变量表。前端开发服务器会读取同一份 `apps/api/.env`（或仓库根目录的 `.env`），`ADMIN_BASE_PATH` 只需配置一处。

后台路径的真实安全依赖管理员鉴权、会话作废和接口限流，而不是路径本身的隐蔽性。

首次打开后台会进入安装流程，自行设置管理员用户名和密码。登录后建议按以下顺序完成配置：

1. 在「风格模板」中选择前台皮肤
2. 在「商品分类」与「商品管理」中维护分类并上架商品
3. 在商品的「卡密货源」中导入卡密
4. 在「支付宝收款」中填写 AppId、应用私钥和支付宝公钥

生产镜像与 `NODE_ENV=production` 启动都不会自动写入示例商品或演示卡密。

### 主要路径

| 路径 | 说明 |
|------|------|
| `/` | 店铺首页 |
| `/p/:id` | 商品详情 |
| `/cart` | 购物车 |
| `/pay` | 确认订单 / 收款码 |
| `/order`、`/query` | 查单 |
| `/admin` | 仪表盘（默认后台路径，可用 `ADMIN_BASE_PATH` 修改） |
| `/admin/products` | 商品管理 / 卡密货源 |
| `/admin/categories` | 分类管理 |
| `/admin/orders` | 订单（含补发） |
| `/admin/cashier` | 管理员收银台 |
| `/admin/audit` | 操作日志 |
| `/admin/appearance` | 风格模板 |
| `/admin/settings` | 支付宝配置 |
| `/admin/account` | 账号安全 |

买家支付轮询只走公开查单接口。`/api/payment/precreate`、`/api/payment/pay` 仅管理员可用。

## 备份

Docker 部署时，请备份主机上的 `./data` 目录，同时妥善保管 `SETTINGS_ENCRYPTION_KEY` 与 `SESSION_SECRET`。仅复制数据库文件而没有加密密钥，将无法解密卡密和支付宝配置。

进行一致性备份时，不要在服务运行中直接 `cp` 正在使用的数据库文件。可在容器内调用备份命令，将快照写入数据卷：

```bash
docker compose exec jima-shop node dist/scripts/backup.js /data/jima-backup.db
```

非容器部署使用：

```bash
pnpm backup
# 或指定路径：
pnpm --filter @jima/api backup /safe/path/jima-backup.db
```

备份包含加密后的密钥与卡密，应按机密保管，建议文件权限 `0600`。

## 生产环境注意事项

- 使用新的空数据库上线，不要直接沿用开发库。
- 生产环境若密钥为占位值，或 `ALIPAY_NOTIFY_URL` 不是公网 HTTPS，进程会拒绝启动。
- 同一 SQLite 文件只允许一个写入进程。
- 已售或已预占卡密的商品不可删除，请下架以保留发货记录。
- 不要将 `.env`、`*.db`（含 `-wal` / `-shm`）或备份提交到 Git。

## 技术栈与常用脚本

TypeScript、pnpm workspace、Node.js 22。后端为 Fastify、better-sqlite3、官方 `alipay-sdk` 与 bcryptjs；前端为 React、Vite 与 Ant Design。

```bash
pnpm dev          # 本地前后端同时启动
pnpm build
pnpm test
pnpm typecheck
pnpm start        # 需先 build
pnpm start:prod   # build 后启动（须配合 NODE_ENV=production 与生产环境变量）
pnpm backup       # 一致性备份
```

## Star History

[![Stargazers over time](https://starchart.cc/MeLoser815/jima-shop.svg)](https://starchart.cc/MeLoser815/jima-shop)

## License

[MIT](./LICENSE) © 2026 jima-shop contributors
