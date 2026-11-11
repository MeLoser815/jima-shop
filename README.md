# 即码小店（jima-shop）

可自建部署的开源卡密小店：前台浏览商品、购物车结算，对接 **支付宝当面付** 扫码收款并自动发卡；后台管理商品、分类、订单、卡密货源与风格模板。

数据存储使用 **SQLite**（better-sqlite3，WAL 模式）。典型中小规模自建店只需运行 **单个 API 进程**，不要用 PM2 cluster 或多个进程同时写同一个数据库文件。

本项目以 [MIT](./LICENSE) 许可证开源。

> **重要：** 不要把开发库里的示例商品和 `DEMO-` 演示卡密拿到生产环境去卖，也不要公开发布或部署时附带真实的 `.env`、数据库文件或密钥。上线请使用一份**新的空数据库**，自行创建管理员并导入真实卡密。

## 技术栈

- TypeScript + **pnpm** workspace
- Node.js **22+**
- 后端：Fastify + better-sqlite3 + 官方 `alipay-sdk` + bcryptjs
- 前端：React + Vite + Ant Design

## 功能

### 前台

1. 响应式商城（手机底部导航 / 自适应商品栅格）
2. 商品分类筛选、详情、加购、购物车
3. 结账时预占卡密，再调用支付宝当面付 `alipay.trade.precreate` 出收款码并轮询
4. 多套视觉模板（草莓甜心 / 东方巨龙 / 神圣天使 / 次元集市）
5. 查单：仅已支付订单返回卡密，不含买家账号等敏感字段

### 后台

1. 首次安装自设管理员账号密码（bcrypt，密码至少 8 位）
2. 仪表盘、商品 CRUD、分类管理、订单、**补发**、操作日志
3. 风格模板切换（立即作用于前台）
4. 支付宝收款三要素（密钥 AES 加密入库）
5. 修改登录密码（会使已有登录全部失效）
6. 管理员收银台（收款码 / 付款码），**不在前台导航暴露入口**

## 快速开始（本地开发）

需要 Node.js 22+ 与 [pnpm](https://pnpm.io/)。

```bash
git clone https://github.com/<your-account>/jima-shop.git
cd jima-shop
cp .env.example apps/api/.env
# 开发环境可先沿用示例密钥；上线前必须换成随机串

pnpm install
pnpm dev
```

- 店铺前台：http://localhost:5173/
- 管理后台：http://localhost:5173/admin（默认路径，可用 `ADMIN_BASE_PATH` 修改）
- API：http://localhost:3001

后台入口**不会**出现在前台导航里，需要手动在浏览器输入地址。真实安全依赖管理员鉴权、会话作废和接口限流，而不是路径本身。

首次打开后台会进入「首次安装」，自行设置管理员用户名和密码。登录后：

1. 「风格模板」选一套前台皮肤
2. 「商品分类」维护分类，「商品管理」上架商品
3. 在商品的「卡密货源」中导入卡密（一行一条；也可「卡号+卡密」）
4. 「支付宝收款」填写 AppId、应用私钥、支付宝公钥

开发环境默认会写入示例分类、商品和 `DEMO-` 前缀演示卡密。若不想要演示数据，在 `.env` 中设置 `JIMA_SEED_DEMO=0` 后再用空的 `DATABASE_PATH` 启动。

## 配置后台路径

在 `apps/api/.env`（或仓库根目录 `.env`）中设置：

```bash
ADMIN_BASE_PATH=/admin
```

也可以改成自定义的单段路径（例如 `/my-admin`）。不要使用 `/api`、`/cart`、`/pay`、`/order`、`/query`、`/cashier` 等前台或接口保留路径。前端开发服务器会读取同一份环境文件，无需再单独配置。生产环境下 API 托管前端时会把该路径注入页面，因此更改后重新启动即可（不必为改路径单独重建，但常规上线流程仍建议先 `pnpm build`）。

## 生产部署

上线前请务必做到：

1. 使用 **新的空数据库文件**（不要直接拿开发库上线，里面可能有演示商品和 DEMO 卡密）。
2. 设置强壮的 `SESSION_SECRET` 与 `SETTINGS_ENCRYPTION_KEY`（禁止使用 `.env.example` 中的占位值；可用足够长的随机串）。
3. 将 `ALIPAY_NOTIFY_URL` 设为公网可访问的 **HTTPS** 地址（例如 `https://your-domain.com/api/payment/notify`）。localhost 或 HTTP 在生产环境会拒绝启动。
4. 设置 `WEB_ORIGIN` 为站点的 https 源；生产环境不会再额外放行 localhost。
5. 按需设置 `ADMIN_BASE_PATH`（默认 `/admin`）。
6. 设置 `NODE_ENV=production`，在 HTTPS 反代后面**只运行一个** API 进程：

```bash
# 先准备好 apps/api/.env（或导出等价环境变量）
pnpm build
NODE_ENV=production pnpm start
# 或一次性：
NODE_ENV=production pnpm start:prod
```

生产模式下 API 会托管 `apps/web/dist`，只需把反代指到 API 端口。`pnpm dev` 仍用于本地前后端分离开发。

生产环境 **不会** 自动写入示例商品或演示卡密。首次启动后通过「首次安装」创建管理员，再自行上架商品、导入真实卡密。

请只运行 **一个** API 进程访问同一 SQLite 文件。若使用 PM2，请用 fork 模式且 `instances=1`，不要开 cluster。

**不要**将 `.env`、数据库文件（`*.db`、`*-wal`、`*-shm`）或备份提交到 Git，也不要在公开仓库中放置真实卡密或支付宝密钥。

## 备份

```bash
pnpm backup
# 或指定路径：
pnpm --filter @jima/api backup /safe/path/jima-backup.db
```

请使用上述一致性备份（VACUUM / backup API），**不要**在服务运行时直接 `cp` 正在使用的数据库文件。备份包含加密后的密钥和卡密，请按机密保管，建议文件权限 `0600`。

## 脚本

```bash
pnpm dev          # 本地前后端同时启动
pnpm build
pnpm test
pnpm typecheck
pnpm start        # 需先 build；开发配置下不托管前端
pnpm start:prod   # build 后启动（请配合 NODE_ENV=production 与生产环境变量）
pnpm backup       # 一致性备份
```

## 主要页面

| 路径 | 说明 |
|------|------|
| `/` | 店铺首页（分类筛选 + 主题皮肤） |
| `/p/:id` | 商品详情 |
| `/cart` | 购物车 |
| `/pay` | 确认订单 / 收款码 |
| `/order`、`/query` | 查单 |
| `/admin` | 仪表盘（默认后台路径，可用 `ADMIN_BASE_PATH` 修改；前台不展示入口） |
| `/admin/products` | 商品管理 / 卡密货源 |
| `/admin/categories` | 分类管理 |
| `/admin/orders` | 订单（含补发） |
| `/admin/cashier` | 管理员收银台 |
| `/admin/audit` | 操作日志 |
| `/admin/appearance` | 风格模板 |
| `/admin/settings` | 支付宝配置 |
| `/admin/account` | 账号安全 |

## 切换主题

后台 → **风格模板** → 点选「草莓甜心 / 东方巨龙 / 神圣天使 / 次元集市」→ 前台通过 `/api/store/theme` 拉取并应用 CSS 变量与主题专属布局。

## API 增量

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/categories` | 启用中的分类 |
| GET | `/api/products?categoryId=` | 按分类筛选上架商品 |
| GET/POST/PUT/DELETE | `/api/admin/categories` | 分类管理 |
| GET | `/api/store/theme` | 当前主题 + 模板列表 |
| GET/PUT | `/api/admin/theme` | 后台读写当前主题 |
| POST | `/api/checkout` | 买家结账（预占卡密后预下单） |
| GET | `/api/orders/query/:outTradeNo` | 买家查单（仅公开视图） |
| POST | `/api/admin/orders/:outTradeNo/fulfill` | 待补发订单补发 |
| GET | `/api/admin/audit` | 操作日志 |

买家支付轮询只走公开查单接口。`/api/payment/precreate`、`/api/payment/pay` 仅管理员可用。

## 说明

- 开发环境首次启动会写入示例分类与商品；主题默认「草莓甜心」。生产环境不会写入演示数据。
- 正式收款需签约「当面付」，并将 `ALIPAY_NOTIFY_URL` 配到公网 HTTPS。
- 密钥与卡密使用 `SETTINGS_ENCRYPTION_KEY` AES-GCM 加密；会话用 `SESSION_SECRET` 签名，并绑定服务端会话（改密 / 退出即作废）。
- 已售或预占卡密的商品不可删除，请下架以保留发货记录。
- 生产启动检查会拒绝占位密钥，以及非公网 HTTPS 的通知地址。

## License

[MIT](./LICENSE) © 2026 jima-shop contributors
