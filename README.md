# 即码小店

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/MeLoser815/jima-shop?style=social)](https://github.com/MeLoser815/jima-shop/stargazers)

可自建部署的开源卡密商店。顾客在前台浏览商品并完成结算，扫码付款后自动获得卡密；商户在后台管理商品、分类、订单、卡密货源、收款方式与店铺风格。

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
- 结账时预占卡密，再按已开通的收款方式生成收款码，并轮询支付结果。支持支付宝当面付、可选的彩虹易支付（支付宝 / 微信 / QQ 钱包），以及店铺自己的多链 USDT 收款（TRC20、BEP20、ERC20、Polygon、Arbitrum、Optimism、Avalanche、欧易 X Layer）。多种方式都配置时，买家按管理员设定的名称自行选择。仅开通一种时，仍走原来的直接下单流程
- 可选视觉模板：草莓甜心、东方巨龙、神圣天使、次元集市
- 订单查询：未支付订单会自动轮询支付结果；仅已支付订单返回卡密，不返回买家账号等敏感字段

### 后台

- 首次启动时自行设置管理员账号与密码（bcrypt，密码至少 8 位）
- 仪表盘、商品与分类、订单、待补发（补货后自动发卡，也可手动补发）、操作日志
- 卡密货源导入（一行一条，或「卡号 + 卡密」）；库存按未用卡密计数
- 收款配置在后台填写：支付宝当面付三要素，可选的易支付网关、商户ID与密钥，以及可选的 USDT（总开关、汇率、有效期，并按链分别填写收款地址）。可为每种方式设置买家可见名称。密钥以 AES-GCM 加密入库，不会在后台回显明文
- 修改登录密码会使已有会话全部失效
- 管理员收银台（收款码 / 付款码）仅在后台提供，不在前台导航中展示入口

## 部署

将下列内容保存为 `docker-compose.yml`，在该文件所在目录执行 `docker compose up -d`。也可将同一段配置粘贴到 1Panel「容器 → 编排」，填写名称后启动。

```yaml
services:
  jima-shop:
    image: ghcr.io/meloser815/jima-shop:latest
    container_name: jima-shop
    restart: unless-stopped
    ports:
      - "8001:8001"
    environment:
      - TZ=Asia/Shanghai
      - NODE_ENV=production
      - HOST=0.0.0.0
    volumes:
      - jima-shop-data:/data

volumes:
  jima-shop-data:
```

启动后访问 `http://服务器地址:8001` 打开店铺，访问 `http://服务器地址:8001/admin` 创建管理员账号。随后在后台「账号安全」中修改后台访问路径（默认 `/admin` 较容易被扫描），并在「收款配置」中开通至少一种收款方式：支付宝当面付需填写 AppId、应用私钥（商户密钥）和支付宝公钥（商户 key）；易支付为可选项，需填写支付网关、商户ID、商户密钥并勾选开通渠道；USDT 为可选项：打开总开关，确认汇率，把钱包在对应链上的有效收款地址填进去并保存，即开通该链（不必再单独拨开链开关），由本店查询到账并发卡。站点通过 HTTPS 域名访问时，异步通知地址会按当前域名自动生成（当面付为 `https://你的域名/api/payment/notify`，易支付为 `https://你的域名/api/payment/epay/notify`），一般不必手动填写。收款与后台路径均可在后台完成，不必写入 Compose。不要把后台访问路径写到店铺前台文案里。

数据（含数据库，以及未手动指定时自动生成的会话密钥与加密密钥）保存在 Docker 数据卷 `jima-shop-data` 中，请将该数据卷纳入备份。同一数据卷只运行一个实例。

对外收款前，请为站点配置域名和 HTTPS。买家从该 HTTPS 地址下单时，系统会自动把回调地址告知支付渠道；若暂时只有 HTTP 访问，仍可发起收款；支付结果可由前台轮询确认，服务端也会定时向支付宝/易支付查单。

可选环境变量：`ADMIN_BASE_PATH`（若设置，将锁定后台路径且优先于后台中的修改；未设置时默认 `/admin`，可在后台「账号安全」中更改）、`SESSION_SECRET`、`SETTINGS_ENCRYPTION_KEY`（若自行指定，请使用足够长的随机串，且部署后不要更换加密密钥）、`WEB_ORIGIN`、`ALIPAY_NOTIFY_URL`（亦可在后台填写通知地址）、`TRUST_PROXY`。不要将占位示例值写入密钥变量。易支付网关、商户号和密钥只在后台填写，不要写入环境变量或前台文案。

关于 `TRUST_PROXY`：默认只信任上一跳位于本机回环或私网（例如 10/8、172.16/12、192.168/16）的反向代理转发头，以便 1Panel、本机 Nginx 等反代能正确识别 HTTPS 与访客 IP。若将 8001 直接暴露在公网、没有可信反代，客户端提交的 `X-Forwarded-Proto` / `X-Forwarded-Host` / `X-Forwarded-For` 不会被用来改写回调地址或绕过按 IP 限流。若反代不在私网（例如云上的公网负载均衡），请设置 `TRUST_PROXY=true`，并确保该反代覆盖客户端传入的转发头。`TRUST_PROXY=false` 表示完全不信任转发头。

若无法拉取镜像，可在本仓库根目录执行：

```bash
docker compose -f docker-compose.build.yml up --build -d
```

## 本地开发与非容器部署

需要 Node.js 22 或更高版本，以及 [pnpm](https://pnpm.io/)。

```bash
git clone https://github.com/MeLoser815/jima-shop.git
cd jima-shop
cp .env.example apps/api/.env
# 开发环境可先沿用示例密钥。使用 Docker 上线时，密钥可在数据目录自动生成，收款配置在后台填写。

pnpm install
pnpm dev
```

- 店铺前台：http://localhost:5173/
- 管理后台：http://localhost:5173/admin（默认路径；生产环境可在后台「账号安全」中修改，本地开发也可用 `ADMIN_BASE_PATH` 覆盖）
- API：http://localhost:8001

开发环境默认会写入示例分类、商品和 `DEMO-` 前缀演示卡密。若不需要演示数据，在环境变量中设置 `JIMA_SEED_DEMO=0` 后再以空的 `DATABASE_PATH` 启动。

### 非容器的生产启动

若不以 Docker 运行，仍须使用新的空数据库，设置强壮的 `SESSION_SECRET` 与 `SETTINGS_ENCRYPTION_KEY`，将 `ALIPAY_NOTIFY_URL` 设为公网 HTTPS，将 `WEB_ORIGIN` 设为站点的 https 源，并设置 `NODE_ENV=production`。在 HTTPS 反代后只运行一个 API 进程：

```bash
pnpm build
NODE_ENV=production pnpm start
# 或一次性：
NODE_ENV=production pnpm start:prod
```

生产模式下 API 会托管 `apps/web/dist`，将反代指到 API 端口即可。后台路径会在运行时注入页面；在后台修改后立即生效，无需重启。若使用环境变量 `ADMIN_BASE_PATH`，则以其为准，需重启后生效。

若使用 PM2，请使用 fork 模式且 `instances=1`，不要开启 cluster。

## 配置与首次使用

环境变量说明见仓库根目录的 [`.env.example`](./.env.example)（本地开发复制为 `apps/api/.env`），以及上文「部署」一节中的可选环境变量说明。前端开发服务器会读取同一份 `apps/api/.env`（或仓库根目录的 `.env`），`ADMIN_BASE_PATH` 只需配置一处。

后台路径的真实安全依赖管理员鉴权、会话作废和接口限流，而不是路径本身的隐蔽性。

首次打开后台会进入安装流程，自行设置管理员用户名和密码。登录后建议按以下顺序完成配置：

1. 在「风格模板」中选择前台皮肤
2. 在「商品分类」与「商品管理」中维护分类并上架商品
3. 在商品的「卡密货源」中导入卡密
4. 在「收款配置」中开通至少一种收款方式。支付宝当面付填写 AppId、应用私钥（商户密钥）和支付宝公钥（商户 key）；若使用易支付，打开启用开关并填写支付网关、商户ID、商户密钥，勾选要开通的渠道；若使用 USDT，打开独立的 USDT 页，确认汇率，填写各条链上你自己的有效收款地址并保存即可开通该链。易支付和 USDT 都不是必填项，不配置时不影响已开通的其他方式
5. 在「账号安全」中修改后台访问路径（默认 `/admin` 较容易被扫描）

生产镜像与 `NODE_ENV=production` 启动都不会自动写入示例商品或演示卡密。

### 收款方式

支付宝当面付、易支付与 USDT 均可选，至少配置一种即可对外收款。未启用的方式不会出现在结账页。管理员可为每种方式设置买家可见名称；官方当面付与易支付支付宝同时开通时，两个选项都会展示。

易支付需使用兼容彩虹易支付 V1 的网关：下单走 `mapi.php`，查单走 `api.php?act=order`，异步通知验签后在本地事务中发卡。支付网关必须是可公网访问的 `http` 或 `https` 地址，系统会拒绝内网、本机和元数据地址。支付宝当面付与易支付除异步通知和前台查单外，服务端也会定时向渠道查单并走同一套履约路径；查询失败不会关单或释放卡密。已支付订单不会被后续的关闭通知降级。

USDT 由店铺自己的地址收款：打开总开关并确认汇率后，填入该链有效地址并保存即开通，不必再单独打开链开关。按后台汇率把人民币换成 USDT，并为每笔待付订单在所选链上分配四位小数的唯一应付额。不同链（含同一 EVM 地址用于多条链）的金额占用互相隔离。到账由本店向该链官方接口查询已确认交易，金额必须完全一致才会发卡。BSC 上的 USDT 是 18 位小数，其他常见链多为 6 位，系统会按链换算后精确匹配。买家须先选择网络，页面会写清链名称，避免转错链。当前「欧易链」指 OKX X Layer 主网，不是 OKT Chain/OKC。买家页面只展示管理员设定的名称、网络、收款地址和应付金额，不会出现商户接口或密钥等术语。

### 履约说明

结账会先按购买数量预占卡密：一次买 10 份，付款成功后发 10 个卡密。预占默认保留 15 分钟。预占到期后，系统仍会再保留 20 分钟，以便迟到的支付通知或服务端查单完成履约；这 20 分钟过后再释放未付款订单占用的卡密。

若渠道或链上已确认付款，但对应卡密已被其他订单占用，该订单会进入「待补发」，已付款事实会保留。向该商品重新导入未用卡密后，系统会自动尝试补发，也可在「订单」中手动补发。

支付宝当面付和易支付优先使用支付渠道的异步通知，前台也会轮询查单，服务端每隔约 30 秒向渠道核对近期未支付订单。查询失败不会关单，也不会释放卡密。已支付订单不会因后续的关闭或失败通知而降级。站点暂时只有 HTTP 时，异步通知可能无法送达，此时依赖前台轮询和服务端定时查单。

USDT 到账由本店向各链官方接口查询已确认交易，不依赖外部收款网关。只接受一笔转入，且金额必须刚好等于该订单的应付额，不支持多笔凑齐，少付或多付也不会自动发卡。请填写你自己掌控的钱包地址，不要使用交易所充值地址。订单有效期默认 15 分钟，展示到期后系统再等待 20 分钟才关单；区块时间晚于展示到期时间的转入不会记入该订单。宽限结束后若已关单，即使随后扫到符合条件的交易也不会自动再发。关闭总开关或更换地址后，仍会继续扫描已经生成的待付订单。Optimism 同时识别经典 Tether 合约和较新的 USDT0。公共查询接口在交易量大时可能限流，可在该链「高级设置」中填写官方查询 Key。

### 主要路径

| 路径 | 说明 |
|------|------|
| `/` | 店铺首页 |
| `/p/:id` | 商品详情 |
| `/cart` | 购物车 |
| `/pay` | 确认订单 / 收款码 |
| `/order`、`/query` | 查单 |
| `/admin` | 仪表盘（默认后台路径，可在「账号安全」中修改） |
| `/admin/products` | 商品管理 / 卡密货源 |
| `/admin/categories` | 分类管理 |
| `/admin/orders` | 订单（含补发） |
| `/admin/cashier` | 管理员收银台 |
| `/admin/audit` | 操作日志 |
| `/admin/appearance` | 风格模板 |
| `/admin/settings` | 收款配置（支付宝当面付 / 可选易支付 / 可选 USDT） |
| `/admin/account` | 账号安全（含后台路径） |

买家支付轮询只走公开查单接口。`/api/payment/precreate`、`/api/payment/pay` 仅管理员可用。

## 备份

Docker 部署时，请备份数据卷 `jima-shop-data`，同时妥善保管 `SETTINGS_ENCRYPTION_KEY` 与 `SESSION_SECRET`。仅复制数据库文件而没有加密密钥，将无法解密卡密和收款配置。

进行一致性备份时，不要在服务运行中直接 `cp` 正在使用的数据库文件。可在容器内调用备份命令，将快照写入数据卷：

```bash
docker compose exec jima-shop node dist/scripts/backup.js /data/jima-backup.db
docker compose cp jima-shop:/data/jima-backup.db ./jima-backup.db
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
- 生产环境若将 `SESSION_SECRET` 或 `SETTINGS_ENCRYPTION_KEY` 设为示例占位值，进程会拒绝启动；未设置时将在数据目录自动生成并保存。若设置了 `ALIPAY_NOTIFY_URL`，必须是公网 HTTPS。上线对外收款前须在后台配置至少一种收款方式，不强制使用支付宝当面付。
- 同一 SQLite 文件只允许一个写入进程。
- USDT 请使用你自己的钱包地址收款，不要填写交易所充值地址；买家必须按页面显示的网络和精确金额一次转账。
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

## Star 趋势

[![Star History Chart](https://api.star-history.com/chart?repos=MeLoser815/jima-shop&type=Date)](https://www.star-history.com/#MeLoser815/jima-shop&Date)

## License

[MIT](./LICENSE) © 2026 jima-shop contributors
