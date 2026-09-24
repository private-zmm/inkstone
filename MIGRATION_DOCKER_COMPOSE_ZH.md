# Inkstone Docker Compose 改造方案

## 1. 目标

将 Inkstone 部署为可运行在家庭 NAS 上的 Docker Compose 应用。

目标部署形态：

- Node.js 运行后端和 Hono API
- PostgreSQL 保存核心业务数据
- Redis 提供实时通知、任务队列、限流和分布式锁
- MinIO 通过 S3 兼容接口保存附件、头像和备份文件
- 独立 scheduler 容器执行定时任务
- 外部 Embedding API 提供语义搜索向量
- 前端仍保持 React、Vite、CodeMirror、IndexedDB 离线缓存和 outbox 同步机制

本方案面向个人使用和单台 NAS 部署，先保证数据可靠、结构清晰和可恢复，再考虑多实例扩展。

## 2. 目标架构

```text
NAS 反向代理 / HTTPS
          |
          v
      inkstone-app  <---->  Redis
          |                    |
          v                    v
      PostgreSQL          scheduler
          |
          v
        MinIO  <---- 外部备份或其他存储

外部 Embedding API 由 scheduler 调用
```

Compose 服务：

| 服务 | 责任 |
| --- | --- |
| `app` | Node.js + Hono API、静态资源、WebSocket、认证和业务请求 |
| `scheduler` | 备份、附件清理、FTS/Embedding 队列和过期数据维护 |
| `postgres` | 用户、笔记、版本、标签、同步记录、任务状态和向量 |
| `redis` | Pub/Sub、短期缓存、队列、限流和任务锁 |
| `minio` | 附件、头像和备份对象 |

`app` 和 `scheduler` 使用同一个应用镜像，仅启动命令不同。这样依赖、配置和数据库迁移保持一致。

## 3. 本地组件关系

| 应用能力 | 本地实现 |
| --- | --- |
| Web API | Node.js + `@hono/node-server` |
| 关系数据 | PostgreSQL 16 |
| 对象存储 | MinIO S3 API |
| MCP API Key | PostgreSQL 表；短期状态可使用 Redis |
| 实时通知 | Node WebSocket + Redis Pub/Sub |
| 敏感凭据 | 应用层加密后存 PostgreSQL，密钥由环境变量或 NAS Secret 管理 |
| 定时任务 | 独立 `scheduler` 容器中的调度循环 |
| 语义搜索 | 外部 OpenAI 兼容 Embedding API |
| 全文搜索 | PostgreSQL FTS/`pg_trgm` |

## 4. PostgreSQL 设计

### 4.1 迁移范围

以下表由 PostgreSQL schema 初始化：

- `users`
- `sessions`
- `folders`
- `notes`
- `note_versions`
- `tags`
- `note_tags`
- `links`
- `changes`
- `attachments`
- `shares`
- `backup_targets`
- `backup_runs`
- TOTP、MCP、任务队列和索引相关表

### 4.2 SQL 适配

需要处理以下 SQLite 到 PostgreSQL 的差异：

- 参数占位符从 `?1` 改为 `$1`
- `INSERT OR IGNORE` 改为 `ON CONFLICT DO NOTHING`
- 批量写入改为 PostgreSQL transaction
- SQLite 的 `json_each` 改为 PostgreSQL JSONB 查询
- 布尔值统一使用 PostgreSQL `boolean`
- 自增主键和时间字段按 PostgreSQL 类型重建
- 所有笔记写入继续使用 `rev` 和 `updated_at` 做乐观并发校验

建议第一阶段继续使用原生 SQL，只建立数据库连接和 transaction 封装，不同时引入大型 ORM。

### 4.3 向量

使用 `pgvector` 保存 Embedding：

- 每篇笔记最多保留一个当前向量
- 笔记正文或标题变更时重新加入索引队列
- 删除笔记时删除或标记对应向量
- Embedding 调用失败时保留任务并重试
- 语义搜索不可用时退回关键词搜索

## 5. MinIO 附件存储

### 5.1 Bucket

建议创建两个 bucket：

```text
inkstone-files
inkstone-backups
```

生产环境使用专用 MinIO 用户和最小权限策略。MinIO 控制台只在 NAS 内网开放，不直接暴露到公网。

### 5.2 Object Key

对象 Key 不使用用户提交的原始文件名：

```text
attachments/{userId}/{attachmentId}
avatars/{userId}/{avatarId}
backups/{userId}/{backupId}.zip
```

PostgreSQL 的 `attachments` 表保存：

- 文件 ID
- 用户 ID
- 关联笔记 ID
- 原始文件名
- MIME 类型
- 文件大小
- SHA-256
- MinIO bucket 和 object key
- 创建时间

### 5.3 上传和删除流程

1. 应用接收上传并限制大小、MIME 和用户配额。
2. 流式写入临时对象，同时计算 SHA-256。
3. 上传成功后写入 PostgreSQL 元数据。
4. 数据库写入失败时删除 MinIO 临时对象。
5. 删除附件时先删除或解绑数据库记录，再将对象加入清理队列。
6. scheduler 定期扫描并清理孤儿对象。

附件下载必须经过应用权限检查。短期预签名 URL 只用于确实需要直接下载的场景。

## 6. Redis 设计

Redis 不是核心数据源，丢失后可以从 PostgreSQL 重建。

用途：

- WebSocket 变更通知
- Embedding 和附件清理任务队列
- 登录和 MCP 请求限流
- 任务分布式锁
- 短期缓存

建议的频道和锁命名：

```text
inkstone:user:{userId}:changes
inkstone:job:embedding
inkstone:job:attachment-cleanup
inkstone:lock:scheduled:{jobName}
```

单实例部署时 WebSocket 可以暂时使用进程内连接管理；Redis Pub/Sub 仍作为统一接口保留，便于以后扩展。

## 7. Scheduler 和 Cron

`scheduler` 使用与 `app` 相同的镜像，启动独立的任务入口。

建议任务：

| 任务 | 建议频率 |
| --- | --- |
| Embedding 队列 | 持续轮询或每分钟 |
| FTS 索引队列 | 每分钟 |
| 附件孤儿清理 | 每小时 |
| 过期会话和授权数据 | 每小时 |
| 自动备份 | 按用户设置执行，默认每天 |
| 备份结果清理 | 每天 |
| 数据维护和索引修复 | 每天或手动触发 |

每个任务执行前使用 PostgreSQL advisory lock 或 Redis lock，避免重复执行。

## 8. 外部 Embedding API

配置项：

```text
EMBEDDING_BASE_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=
EMBEDDING_DIMENSIONS=
```

要求：

- 使用 OpenAI 兼容的 embeddings 接口，方便更换供应商
- 正文和标题合并后限制最大输入长度
- 仅 scheduler 调用外部服务，Web 请求不等待向量生成
- 保存模型名称和向量维度，模型变更时支持重建索引
- API 不可用时不影响笔记写入和关键词搜索

Embedding 任务应以笔记 ID、版本号和内容哈希作为输入。任务执行前检查版本号，避免旧内容覆盖新向量。

## 9. Docker Compose 数据卷

建议在 NAS 上为项目建立独立目录：

```text
/volume1/docker/inkstone/
├── compose.yml
├── .env
├── data/
│   ├── postgres/
│   ├── redis/
│   └── minio/
└── backups/
```

Compose 中需要持久化：

- PostgreSQL 数据目录
- Redis 数据目录
- MinIO 数据目录
- 应用生成的临时备份目录

不使用容器内部文件系统保存任何用户数据。

## 10. 环境变量

示例配置：

```text
APP_URL=https://notes.example.com
DATABASE_URL=postgres://inkstone:change-me@postgres:5432/inkstone
REDIS_URL=redis://redis:6379

S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=change-me
S3_SECRET_ACCESS_KEY=change-me
S3_FILES_BUCKET=inkstone-files
S3_BACKUPS_BUCKET=inkstone-backups

EMBEDDING_BASE_URL=https://embedding-provider.example/v1
EMBEDDING_API_KEY=change-me
EMBEDDING_MODEL=text-embedding-3-small

BACKUP_DIR=/var/lib/inkstone/backups
```

真实密码、API Key 和 MinIO 密钥只放在 NAS 的 `.env` 或 Secret 管理中，不提交到 Git。

## 11. 备份和恢复

备份至少包含：

1. PostgreSQL `pg_dump`。
2. MinIO `inkstone-files` bucket。
3. MinIO `inkstone-backups` bucket 的必要历史版本。
4. Compose 文件和环境变量模板，不包含真实密钥。

备份目标不能只位于 PostgreSQL 和 MinIO 所在的同一块磁盘。建议至少保留一份到外置硬盘、另一台 NAS 或远程 S3/WebDAV。

恢复顺序：

1. 启动 PostgreSQL、Redis 和 MinIO。
2. 恢复 PostgreSQL 数据。
3. 恢复 MinIO 对象。
4. 启动 scheduler，执行索引和附件一致性检查。
5. 启动 app 并验证登录、打开笔记、附件下载和搜索。

## 12. 实施阶段

### 阶段一：运行时抽象

- 新增 Node.js server 入口。
- 保留现有 Hono 路由路径。
- 抽象数据库、附件、定时任务接口。
- 保持前端 API 和 IndexedDB 协议不变。

### 阶段二：PostgreSQL

- 建立 PostgreSQL migration。
- 初始化 PostgreSQL schema 和数据。
- 使用 PostgreSQL 查询、批量写入和事务。
- 保留现有 `rev`、冲突响应和同步游标逻辑。

### 阶段三：MinIO

- 实现 S3 兼容附件适配器。
- 迁移附件上传、下载、删除和清理。
- 增加 bucket 初始化和健康检查。

### 阶段四：Redis 和 scheduler

- 实现 Redis Pub/Sub。
- 将旧实时通知实现统一为 WebSocket 服务。
- 新增 scheduler 入口和任务锁。
- 迁移备份、清理、索引和过期数据任务。

### 阶段五：外部 Embedding

- 抽象 OpenAI 兼容 Embedding 客户端。
- 将 AI 索引队列改为 scheduler 消费。
- PostgreSQL 启用 `pgvector`。
- 完成语义/混合搜索和失败重试。

### 阶段六：Compose 和 NAS

- 编写生产 Dockerfile。
- 编写 `compose.yml` 和 `.env.example`。
- 配置 NAS 持久化目录和反向代理。
- 完成首次导入、备份和恢复演练。

## 13. 验收标准

- `docker compose up -d` 可以启动全部服务。
- 可以注册、登录、启用 TOTP 并退出登录。
- 可以创建、编辑、删除、恢复和查看笔记版本。
- 浏览器离线编辑后，重新联网可以自动提交。
- 多标签页可以收到变更通知。
- 附件能够上传、预览、下载和删除。
- MinIO 对象和 PostgreSQL 元数据保持一致。
- 关键词搜索正常，Embedding 不可用时仍可使用关键词搜索。
- 定时备份可以执行并记录结果。
- 从 PostgreSQL dump 和 MinIO 备份可以恢复完整实例。
- 现有 API 单元测试和 E2E 测试可以在 Node/Compose 环境运行。

## 14. 当前建议

第一版按单实例 NAS 部署实现，不引入 Kubernetes，也不把 Redis 当作强一致存储。业务数据以 PostgreSQL 为准，附件以 MinIO 为准，Redis 和索引数据都设计成可重建。

前端离线缓存、outbox、同步游标和现有 API 结构尽量保持不变，降低迁移对用户体验和已有测试的影响。

## 15. 本次改造的实现边界

当前代码已经包含：

- `app` 和 `scheduler` 的 Node.js 入口及生产 Dockerfile。
- PostgreSQL 适配层、schema 初始化和迁移执行。
- Redis scheduler 分布式锁。
- MinIO 附件/头像 S3 适配器及 bucket 自动初始化。
- OpenAI 兼容 Embedding 客户端；未配置时自动退回关键词搜索。
- `.env.example`、`compose.yml` 和 NAS 持久化目录约定。

以下能力保留为后续阶段，当前部署时应按降级行为理解：

- Node 运行时使用 Redis Pub/Sub 和 WebSocket 实时同步，并保留前端轮询降级。
- PostgreSQL 版本暂不创建 FTS 索引，搜索使用 `LIKE/ILIKE`；向量保存在 `BYTEA` 并由应用计算相似度，后续可切换为 `pgvector` 索引。
- MCP 已改为本地 API Key 入口，不依赖外部授权服务。
- `inkstone-backups` bucket 已自动创建；现有备份任务仍通过应用中的 S3/WebDAV 备份目标配置，首次部署后应按需创建指向本地 MinIO 的 S3 目标。
