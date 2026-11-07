# 数据字典

源：`server/utils/db.ts` 的 SQLite DDL。此项目使用 SQLite，技能自带检查器只识别 MySQL/Drizzle，因此使用 `node scripts/check-dictionary.mjs` 检查真实 SQLite 表覆盖。所有日期 TEXT 为 UTC ISO 8601，整数 expires_at 为 Unix 毫秒。未声明默认值的字段必须由服务写入。

## 1. migrations

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| version | INTEGER | 主键；当前结构版本 1 |

首次启动幂等创建 v1 表。后续结构升级须追加显式版本迁移，不能仅修改 CREATE IF NOT EXISTS。

## 2. accounts

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | TEXT | 主键；Telegram user ID 十进制字符串 |
| label | TEXT | NOT NULL；账号显示名称 |
| username | TEXT | NOT NULL，默认空字符串 |
| session | TEXT | NOT NULL；AES-256-GCM 加密的会话，包含随机 IV 和认证标签 |
| status | TEXT | NOT NULL，默认 connected；服务写入 connected / reauth_required |
| created_at | TEXT | NOT NULL |

单管理员管理全部账号。会话不得返回浏览器、进入日志或 Git。账号退出删除其任务，历史执行保留。

## 3. tasks

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | TEXT | 主键；UUID |
| name | TEXT | NOT NULL |
| account_id | TEXT | NOT NULL；外键 accounts.id，ON DELETE CASCADE |
| chat_id | TEXT | NOT NULL；Telegram marked peer ID |
| chat_title | TEXT | NOT NULL；目标标题快照 |
| peer | TEXT | NOT NULL；InputPeer JSON，accessHash / ID 使用十进制字符串 |
| text | TEXT | NOT NULL；纯文本，API 限制 1–4096 字符 |
| time | TEXT | NOT NULL；HH:mm |
| timezone | TEXT | NOT NULL；IANA 时区 |
| enabled | INTEGER | NOT NULL，默认 1，CHECK IN (0,1) |
| next_run | TEXT | NOT NULL；下一个 UTC 时间 |
| created_at | TEXT | NOT NULL |

索引 tasks_due(enabled,next_run)。服务校验聊天来自对应账号的聊天列表。peer 为内部寻址信息，不能由请求任意指定。

## 4. runs

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | TEXT | 主键；UUID，手动执行用作幂等请求标识 |
| task_id | TEXT | 可空；外键 tasks.id，ON DELETE SET NULL |
| task_name | TEXT | NOT NULL；快照 |
| account_id | TEXT | NOT NULL；快照，无外键，账号删除后保留 |
| chat_title | TEXT | NOT NULL；快照 |
| scheduled_at | TEXT | NOT NULL |
| started_at | TEXT | 可空 |
| finished_at | TEXT | 可空 |
| status | TEXT | NOT NULL；pending/running/success/failed/unknown/skipped，由服务约束 |
| error | TEXT | 可空；脱敏后的错误 |
| message_id | TEXT | 可空；Telegram 确认后的消息 ID |
| random_id | TEXT | NOT NULL UNIQUE；64 位整数十进制字符串 |
| kind | TEXT | NOT NULL，默认 scheduled；scheduled/manual |

唯一约束 (task_id,scheduled_at,kind)。索引 runs_history(scheduled_at DESC)。结果未知不自动重发。

## 5. admin_sessions

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| token_hash | TEXT | 主键；随机 Cookie 令牌的 SHA-256 摘要 |
| expires_at | INTEGER | NOT NULL；7 天有效期 |
| password_fingerprint | TEXT | NOT NULL；管理员密码指纹，密码变更使旧会话失效 |

Cookie 设置 HttpOnly / SameSite=Strict，HTTPS 时设置 Secure。认证数据只在服务器读取。
