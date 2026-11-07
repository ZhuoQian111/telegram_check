# Telegram Daily

Nuxt 4 / TypeScript / SQLite / Docker 的个人 Telegram 定时发送管理台。一个管理员管理多个个人账号；支持已有私聊、机器人及群聊，每个任务每日发送一次纯文本，错过不补发。默认北京时间，可配置 IANA 时区。

## 准备

- Node.js 24.15 或更新的 24.x；Docker 部署不需要本机 Node。
- 从 https://my.telegram.org/apps 创建 Telegram 应用，获取 API ID / API Hash。多个账号共用这组应用凭据。
- 能从服务器连接 Telegram。浏览器只访问本服务，Telegram 客户端运行在服务器；当地网络受限时请使用可连接 Telegram 的部署区域。

## 本地运行

```sh
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

将生成结果填入 `.env` 的 `SESSION_ENCRYPTION_KEY`。设置至少 10 字符的 `ADMIN_PASSWORD`，填写 `TELEGRAM_API_ID`、`TELEGRAM_API_HASH`。本地通过 `http://localhost:3000` 访问时，`APP_ORIGIN` 可以留空；使用其他地址或端口时填写对应地址。密钥只保存在本地及部署平台的 Secrets 中。

```sh
nvm use # 如使用 nvm，可读取项目 .nvmrc
npm ci
npm run dev
```

访问 http://localhost:3000。连接账号后，用手机 Telegram「设置 → 设备 → 连接桌面设备」扫码；如启用两步验证，继续输入密码。到「每日任务」创建任务。聊天搜索针对已加载列表，找不到时点击「加载更多」，包含归档聊天。群组话题默认发送至常规话题。

`SCHEDULER_ENABLED=false` 为默认值。需要自动发送时在 `.env` 改为 `true` 并重启。开发环境请连接独立测试账号，不要复制生产账号会话。手动测试发送会弹出确认，并产生真实消息，独立于每日计划。

```sh
docker compose up -d --build
docker compose logs -f
```

Compose 只监听本机 3000，数据使用命名卷 `telegram_data`。`docker compose down` 保留数据；不要使用 `down -v`，它会删除卷。

## GitHub 与 InstaCloud 部署

1. 将工程推送到你的 GitHub 仓库。仓库应包含 `package-lock.json`、Dockerfile 和 compose.yaml；`.env`、数据库及会话已被忽略。
2. InstaCloud 控制台创建项目和 Compute 服务，连接 GitHub 仓库，选择 `main`、根目录及 Dockerfile，监听端口 **3000**。主分支推送会触发自动部署。
3. 给服务挂载 **1 GiB 持久化卷，路径 `/data`**，保持**单实例**；打开 **Always On**。没有持久化卷的数据在重启/重新部署后可能丢失；休眠会停止容器中的后台调度。
4. 在服务环境变量中设置以下值，随后部署或重启以应用变更：

| 环境变量 | 说明 |
| --- | --- |
| ADMIN_PASSWORD | 至少 10 字符的管理员密码，10 字符及以上均可 |
| SESSION_ENCRYPTION_KEY | 32 字节随机密钥的 Base64，首次生成后保持不变 |
| TELEGRAM_API_ID | Telegram 应用 API ID |
| TELEGRAM_API_HASH | Telegram 应用 API Hash |
| APP_ORIGIN | 首次部署可留空；取得网址后填写实际 HTTPS Origin，例如 `https://example.instacloud.app`，不要带路径 |
| DATABASE_PATH | `/data/app.sqlite` |
| SCHEDULER_ENABLED | 仅正式服务设置 `true` |

`APP_ORIGIN` 用于检查登录、创建任务等写入请求的来源，防止其他网站代发操作，并决定登录 Cookie 是否启用 HTTPS 的 Secure 属性。它不是启动时的必填项：未填写时默认为 `http://localhost:3000`。首次创建服务还没有公网域名时，可以先留空部署；取得平台分配的网址后，再更新该服务的 `APP_ORIGIN` 并重启，然后从该网址登录。不需要事先购买或绑定自定义域名。若从与此配置不同的地址登录或保存任务，会收到 `Origin rejected`。

5. 如果需要修复挂载卷权限，在平台 Console 执行 `chown node:node /data && chmod 700 /data`。镜像以 node 用户运行；先确认平台服务实际运行用户及卷所有者。
6. `/api/health` 可供健康检查；管理员登录后页面显示调度开关状态。完成一次收藏夹测试，再建正式每日任务。
7. PR 预览使用独立卷、独立加密密钥，`SCHEDULER_ENABLED=false`；不要复制生产会话或挂载生产卷。GitHub CI 执行类型检查、测试、生产构建和 Docker 构建。

官方文档：[Compute](https://www.instacloud.com/docs/compute/overview)、[Build & deploy](https://www.instacloud.com/docs/deploy/overview)。也可安装官方 CLI，在已登录并选定项目的目录运行 `insta deploy .`。本仓库不预置平台令牌，首次项目授权在平台完成。

## 时间与发送规则

- 每 10 秒检查一次；只在指定分钟内发起发送。精度为分钟级，受服务器及 Telegram 网络状态影响。
- 保存、修改、恢复任务后，计算严格晚于当前时间的下一次发送。
- 服务重启时跳过之前错过的任务；执行期间重启则标记结果未知，不自动重发。离线多天只记录该任务最近待执行时间的跳过记录，不逐日补建。
- 夏令时跳过不存在的本地时间，重复时刻仅选择第一次。
- 同一账号串行执行；同一计划执行记录唯一，Telegram random_id 也在请求前持久化。网络超时显示结果未知，可能已送达，请核对目标聊天。
- Telegram 限流或无权限显示失败，不延迟补发；账号授权失效显示需重新登录。重新扫码后，后续任务继续使用同一账号 ID。
- 暂停/删除阻止后续发送，但无法撤回已经交给 Telegram 的请求。修改任务不会改变正在发送的文字快照。
- 成功表示 Telegram 返回了消息 ID，并非对方已读。付费消息不授权花费 Stars。

## 备份与恢复

数据字典见 [api/DATABASE_DICTIONARY.md](api/DATABASE_DICTIONARY.md)。结构在首次启动时创建，未来升级应追加显式版本迁移，并在升级前备份。

SQLite 使用 WAL，不要直接在线复制单个数据库文件。用在线备份接口生成一致快照：

```sh
docker compose exec app node scripts/backup.mjs /data/backup.sqlite
docker compose cp app:/data/backup.sqlite ./backup.sqlite
```

InstaCloud 可在 Console 用同样的 `node scripts/backup.mjs /data/backup.sqlite` 生成，再通过平台 SSH / scp 下载。备份包含账号会话密文和任务文字，应保密保存。**另行保管原 SESSION_ENCRYPTION_KEY**；丢失密钥后无法恢复会话，必须重新授权。不要同时启动使用同一 Telegram 会话的两份服务。

恢复时停止应用，将快照放到持久化卷的 `/data/app.sqlite`，清除停机旧库的 `app.sqlite-wal` / `app.sqlite-shm`，调整为 node 用户可读写，使用原密钥重新启动。恢复时会跳过错过的计划。密码变更使旧管理员会话失效；Telegram 会话泄露应在手机设备列表撤销授权并重新扫码。

## 开发验证

```sh
npm run typecheck
npm test
npm run build
node scripts/check-dictionary.mjs
```

自动测试使用临时 SQLite 和模拟 Telegram，不向真实聊天发消息。真实扫码、两步验证和网络故障联调需要你授权测试账号；推荐只向收藏夹发测试消息。运行时密钥和账号授权均不会在构建阶段使用。

当前安装依赖的完整审计报告含 6 项低危和 6 项中危告警，来自 Nuxt/Nitro 的构建工具依赖链；未执行会强制降级框架的 `npm audit fix --force`。生产镜像仅复制 Nitro 跟踪后的运行产物。升级依赖时应重新审计并运行测试与构建。
