# 独立 CLI

Python CLI 与 Electron 分别运行、分别保存登录态，不需要启动桌面端

## 开发运行

```sh
uv sync
uv run mediacrawler install-browser
uv run mediacrawler doctor
uv run mediacrawler --help
uv run mediacrawler auth login --platform xhs --qr image
uv run mediacrawler collect --platform xhs --query 猫 --limit 5
uv run mediacrawler collect --platform bili --url https://www.bilibili.com/video/BV... --non-interactive
```

支持 xhs / bili / dy / zhihu / wb / tieba / ks，数量 1–100。`--comments` 采集评论，`--replies` 配合评论采集回复

- 默认终端二维码；`--login-mode image` 把二维码存成 `{平台}-login.png`（如 `bilibili-login.png`）并在 stderr 输出路径，不弹窗口，文件权限 0600，退出清理
- `--login-mode terminal|image|browser` 选择登录方式，默认 terminal；terminal/image 始终无头，失败只报错，不自动打开浏览器
- browser 仅在缺少登录态时打开临时扫码窗口，登录完成关闭窗口，采集回到无头模式；已有登录态不显示窗口
- 所有浏览器始终静音，不提供取消静音参数；已移除 `--headed`，`--qr` 保留为登录方式参数的兼容别名
- 登录默认最多等待 300 秒，采集任务默认最多 900 秒，可用 `--login-timeout` / `--timeout` 调整
- `--non-interactive` 缺登录返回 AUTH_REQUIRED，不等待扫码；平台风控仍可能阻止采集
- `auth status` 在线检查已有登录；`auth logout` 先在平台页面执行退出并核查登录状态，再关闭浏览器、删除指定 CLI profile，其他账号和 Electron 不受影响
- stdout 仅输出结果，默认 JSONL；`--format json` 输出数组。stderr 输出进度、二维码及错误

## 关键词分页（当前支持 dy、bili、xhs）

```sh
uv run mediacrawler search --query 罗翔
uv run mediacrawler search --cursor <上次的 next_cursor> --limit 50
```

`--limit` 是本次要多少条，默认一页 20 条；`--cursor` 是从哪继续，两者独立。输出格式和 `creator posts` 相同，末行给出 `next_cursor`，`has_more=false` 表示已到末尾。只想一次取固定条数时用 `collect`，它的输出不变

## 博主（`posts` 支持 dy、xhs、bili、zhihu，`search` 支持 dy、bili）

```sh
uv run mediacrawler creator search --query 罗翔 --limit 10
uv run mediacrawler creator posts --creator https://www.douyin.com/user/MS4w... --limit 50
uv run mediacrawler creator posts --cursor <上次的 next_cursor> --limit 50
uv run mediacrawler creator posts --platform bili --creator https://space.bilibili.com/163637592 --limit 20
```

- `--creator` 接受主页链接、`v.douyin.com` 分享短链、App 整段分享文案、sec_uid 或名称。名称必须在搜索首页唯一且完全匹配昵称或抖音号，否则返回 `CREATOR_AMBIGUOUS` / `CREATOR_NOT_FOUND` 和 `candidates`
- stdout 每行一条结果，末行固定为 `{"type":"page","next_cursor":...,"has_more":...,"count":...,"complete":...}`，posts 首页还带 `creator`；`--format json` 输出 `{items, page}`。`has_more=false` 才表示已到末尾；还没拿到分页信息就失败时是 `null`，同时 `complete=false`，要按错误码重试，不能当作没有更多
- 游标不透明，精确到页内位置，换 `--limit` 继续也不漏条，绑定关键词或博主，不匹配返回 `INVALID_CURSOR`。失败或风控时也会输出最近的游标，可稍后继续；跨次搜索可能出现重复候选，按 `id` 去重
- 小红书（`--platform xhs`）支持 `creator search`，结果带可直接采集的主页链接
- B站（`--platform bili`）支持 `creator search`、`creator posts` 和 `search`，`--creator` 接受 `space.bilibili.com` 主页链接、`b23.tv` 短链、UID 或完全匹配的昵称
- search 的 `source=user` 是博主卡片，`source=video` 是相关视频作者，字段较少。抖音这条接口只返回混排结果，不等于平台完整的用户搜索
- 敏感接口经统一节流，见下方“访问节奏”；posts 单次最多 100 条
- 主页按平台顺序返回，通常从新到旧，置顶作品可能排在最前。需要从早到晚学习时，翻完后按 `publishedAt` 排序

## 访问节奏

所有平台请求按接口分组节流，平台之间互不影响，CLI 与桌面端跨进程共享同一节奏。每组有两个桶：小桶管短时间节奏（空闲时可连发“爆发”次，用完后按间隔恢复），大桶管 10 分钟内的总量。打开博主页、打开详情算一次动作，内部请求不互相等。

| 平台 | 分组 | 爆发 | 间隔 | 10 分钟上限 |
| --- | --- | --- | --- | --- |
| 抖音 | 新搜索 / 搜索翻页 | 1 | 10–15 秒 / 12–20 秒 | 搜索和推荐流合计 30 次 |
| 抖音 | 推荐流首屏 / 翻页 | 1 | 4–8 秒 / 6–10 秒 | 同上 |
| 抖音 | 打开博主 / 主页翻页 | 3 / 1 | 8–12 秒 / 2–4 秒 | 12 个 / 40 页 |
| 抖音 | 详情、评论 | 4 / 1 | 1.5–3 秒 | 合计 60 次 |
| 小红书 | 新搜索 / 搜索翻页 | 1 | 8–12 秒 / 4–7 秒 | 新搜索和推荐首屏合计 20 次，翻页合计 60 页 |
| 小红书 | 推荐流首屏 / 翻页 | 1 | 4–8 秒 / 4–7 秒 | 同上 |
| 小红书 | 打开博主 / 主页翻页 | 2 / 1 | 8–12 秒 / 3–6 秒 | 10 个 / 40 页 |
| 小红书 | 详情、评论 | 3 / 1 | 2–3.5 秒 | 合计 40 次 |
| B站 | 新搜索、推荐首屏 / 翻页 | 2 / 1 | 4–7 秒 / 3–6 秒 | 合计 30 次 / 合计 80 页 |
| B站 | 打开博主 / 主页翻页 | 3 / 1 | 5–8 秒 / 3–6 秒 | 20 个 / 60 页 |
| B站 | 详情、评论 | 4 / 1 | 1–2.5 秒 | 合计 80 次 |
| 三个平台 | 其他请求 | 1 | 抖音 1.5–3 秒，小红书 2–3.5 秒，B站 1–2.5 秒 | 无 |
| 知乎、微博、贴吧、快手 | 其他请求 | 1 | 2–4 秒 | 无 |

- 桌面端、CLI 和体检共用同一份节奏和冷却，都由 `desktop/pacing.py` 统一放行；不经过这里的只有内嵌窗口的普通页面加载和媒体文件下载
- `--max-wait`（默认 3，上限 600）是单次最多排队的秒数，包括等 10 分钟额度恢复，要小于 `--timeout`。任务开始前超过时立刻返回 `RATE_WAIT_EXCEEDED` 和 `retry_after`，不会闷头卡住；可以按 `retry_after` 重试，或调大 `--max-wait`
- 任务开始后的翻页和详情按上表间隔自动等待，单次等待超过 30 秒（或 `--max-wait`，取较大值）时返回 `RATE_LIMITED`。10 分钟额度用满时，恢复时间不超过 `--max-wait` 就继续等，否则返回 `RATE_LIMITED`，默认的 3 秒基本等于不等
- `--no-throttle` 跳过本地间隔、上限和冷却直接请求，只在排查时手动传。这些请求仍会计入节奏，平台返回验证时同样进入冷却，之后不带这个参数的调用要等冷却结束
- 任何接口返回验证要求时返回 `SEARCH_VERIFICATION_REQUIRED`，整个平台进入冷却（抖音、小红书 30 分钟，B站 15 分钟，24 小时内再次触发翻倍，最长 6 小时），期间本地直接返回 `RATE_COOLDOWN`，不再请求平台。这些错误都带 `retry_after`（秒）
- 频率只改 `desktop/pacing.py` 的 `PLATFORMS` 一张表：`groups` 定义两个桶，`methods` 和 `paths` 把接口归到组

### 一次命令用多少额度

搜索本身只占 1 次新搜索额度，真正消耗大的是按条补详情，它和评论共用“详情、评论”这个额度。批量前先看余量：

```sh
uv run mediacrawler rate status --platform bili
```

只读本地状态，不发请求。`quotas` 里 `detail` 是详情和评论，`remaining` 是 10 分钟内还剩多少次，`retry_after` 是用满时多少秒后恢复，`cooldown_seconds` 大于 0 表示平台在冷却

| 操作 | B站 | 小红书 | 抖音 |
| --- | --- | --- | --- |
| `search` 每条作品，默认 | 2 次 | 1 次 | 0 次 |
| `search` 每条作品，`--no-media` | 1 次 | 1 次 | 0 次 |
| 10 分钟内默认最多补多少条 | 40 条 | 40 条 | 不受此额度限制 |

补全一条作品算一次访问，和桌面端打开详情一致。B站的 2 次是搜索时取视频信息 1 次，补播放地址和字幕 1 次，实际发出的请求是 3 个

以上按每平台 3 条实测（2026-11-11）。`comments` 每次先取作品信息再取一页评论，小红书和抖音实测共 2 次；`transcribe --source` 抖音实测 1 次，这两项 B站没有单独测过

做多关键词调研时，B站先用 `--no-media` 粗筛，选中的作品再用 `collect --url` 补字幕，粗筛时每条能省一半额度。`--no-media` 不返回时长和字幕，B站部分作品也没有正文

## 评论

```bash
mediacrawler comments --source '作品链接'
mediacrawler comments --source '作品链接' --cursor '上一页的 next_cursor'
mediacrawler comments --source '作品链接' --parent 主评论ID
```

支持 B 站、抖音、小红书，一次取一页，要批量就循环调用。`collect --comments` 仍可随采集带上有界评论（每篇最多 20 条主评论）。

## 视频转文字

依赖本机 `stt` 语音转写服务的 HTTP 接口（`127.0.0.1:29556`），本工具不安装也不管理 `stt`。没有服务时返回 `stt_unavailable`；后台空闲退出时，有 `stt` 命令就自动叫醒。

```bash
mediacrawler transcribe --check
mediacrawler transcribe --file ./video.mp4
mediacrawler transcribe --source '作品链接'
mediacrawler transcribe --input results.json
```

有平台字幕时直接用字幕，否则下载最低画质的视频转写，完成后删除临时文件。结果含 `text`、`segments[{start,end,text}]`、`source`（`subtitle` 或 `stt`）。`stt` 正忙时返回 `stt_busy` 和 `retry_after`，不排队。

## 图片转文字

图文帖的干货常写在图里，正文只有一句“见图”，这时用 OCR 把图里的字提出来。在项目环境里直接调用 `rapidocr` 库（`ocr` 依赖组，`uv sync` 默认安装），模型每次运行只加载一次，同一次命令里的所有图片和作品共用。打包版（CLI 和桌面端后端）都带上了 rapidocr、onnxruntime 和模型，各增加约 136MB，离线可用，不会首次联网下载模型。

```bash
mediacrawler ocr --check
mediacrawler ocr --file ./note.jpg
mediacrawler ocr --source '作品链接'
mediacrawler ocr --input results.json --auto
```

下载作品全部图片后逐张识别，完成后删除临时文件。结果在 `ocr` 里，含合并后的 `text` 和逐张的 `images[{index,text}]`，`source` 为 `ocr`；置信度低于 0.5 的行丢弃。视频返回 `video`（请用 `transcribe`），没有图片返回 `no_images`，识别不到文字返回 `no_text`。

`--auto` 只处理正文不到 100 字、至少两张图的图文帖，跳过多少条输出到 stderr。做调研时先 `search` 存下结果，再对它跑 `ocr --input --auto`，不用逐条判断。图片走 CDN 下载，不占平台接口额度；`--source` 会先打开作品页，算一次详情。

## 数据目录与并行

默认 macOS `~/Library/Application Support/mediacrawler`，Linux `~/.local/share/mediacrawler`（遵循 XDG），Windows `%LOCALAPPDATA%/mediacrawler`

`--data-dir` 优先于 `MEDIACRAWLER_DATA_DIR`，默认 profile 为 `default`，可用 `--profile work` 切换

```
profiles/{platform}/{profile}/  浏览器持久化数据
locks/                        原生文件锁与进程身份
runs/{platform}/{profile}/{run_id}/  任务状态、临时二维码
```

同 profile 只能一个命令，其他 profile/平台可并行。`--lock-timeout` 默认 0，立即返回 PROFILE_BUSY，最多允许等待 300 秒

首次初始化给予最多 180 秒宽限（仍受总任务期限约束），避免原生库首次加载慢被误判；初始化后 supervisor 监控 10 秒心跳及总任务期限；失联 60 秒后清理本任务进程，正常终止等待 5 秒，再强制终止并等待 5 秒。以 PID 和创建时间防止误杀复用 PID。心跳过期不会直接允许共写，worker 还持有独立原生锁；Chromium 自身锁不删除

进程死亡后原生锁自动释放。遗留的锁文件不是占用依据，无需删除。恢复命令：

```sh
uv run mediacrawler session recover --platform xhs --profile default
```

只清理已记录且身份吻合的本 CLI 进程，仍活跃的 supervisor 不被抢占；无法安全回收返回错误，不无限等待

## 结果

默认不创建结果文件，供 agent 读取 stdout。`--save` 保存到 `~/Downloads/MediaCrawler/{run_id}`；`--output-dir ./results` 在该目录下创建独立 run_id 子目录，避免覆盖

每次保存包含 `results.jsonl` 与 `run.json`。失败保留已采集内容，标记 `complete: false` 并以非零状态退出。JSONL 是任务结束后输出最终内容，包含评论更新，不是实时事件流。保存正文不会隐式下载全部媒体

退出码：2 参数错误、3 需要登录、4 profile 占用、5 平台/运行错误、6 总任务超时、130 取消。错误包含 code、message、retryable、run_id

## 巡检与测试

```sh
uv run mediacrawler check --platform tieba
uv run mediacrawler check --all
npm run test:cli
npm run test:python
```

线上 check 使用临时未登录 profile，串行检查首页登录入口和实际二维码 PNG 提取，不扫码、不修改已有账号。失败表示当前环境未通过，可能是页面改版、风控或网络，需要人工复核，不直接判定为网站改版

离线测试覆盖参数、持久化、锁、故障回收、部分输出、二维码编码，以及本地模拟登录入口。浏览器测试需要先安装 Chromium，不访问平台

## 构建

```sh
npm run build:cli               # 仅构建独立 CLI
npm run build:desktop           # 宽松：有完整 CLI 产物就带上，没有也可构建
npm run build:desktop:strict    # 先构建 CLI，再构建桌面，任一步失败即停止
npm run build:all               # 全量，等同严格模式
npm run build:desktop -- --without-cli  # 明确不携带 CLI
```

- CLI：`dist/cli/mediacrawler/mediacrawler`（Windows 为 `.exe`），整个目录一起分发，内含 Python、依赖和 Node 签名运行时
- 桌面内部 Python：`dist/runtime/studio-python/studio-python`，有独立入口，仅执行采集与下载 worker，不包含 `mediacrawler_cli`；`npm run build:runtime` 可单独生成
- 两个入口共用 Python 业务源码与打包配置，各自包含运行依赖；桌面不依赖独立 CLI，接受同时携带时的包体冗余
- 每次桌面构建都会生成内部 Python 与前端；宽松模式不重新生成 CLI，严格/全量模式只生成一次 CLI，确保使用本次源码
- 首次运行分发版：`mediacrawler install-browser` 下载对应 Chromium；缺失时可使用已安装的 Chrome 程序（独立 profile），或用 `MEDIACRAWLER_BROWSER_EXECUTABLE` 指定程序路径；`mediacrawler doctor` 本地验证运行时
- Electron：`dist/desktop/`，包含前端、`Resources/studio-python` 和可选的 `Resources/mediacrawler`，桌面使用 Electron 自带 Chromium；附带 CLI 仍使用自己的浏览器/profile
- macOS 设置提供可选「安装命令 / 移除命令」，使用 `/usr/local/bin/mediacrawler` 软链接指向当前应用内 CLI，成功或失败均有通知；开发模式禁用、无 CLI 发布版隐藏，其他系统暂不支持。不会自动修改 shell 配置、提权或覆盖同名命令，移除保留 CLI 本体与登录数据
- `build/`、`dist/` 均忽略提交，开发仍用 `npm run dev` 热更新
- 当前构建本机系统和架构，不进行跨平台构建；macOS 分发签名/公证尚未配置
- 本机观察到新生成冻结包首次原生依赖加载较慢（约 1–2 分钟），后续检查约 2–4 秒；首次使用可先运行 doctor，源码版扫码调试不受这次冻结包冷启动耗时影响

打包依据：[Playwright PyInstaller](https://playwright.dev/python/docs/library#pyinstaller)、[Electron Packager](https://electron.github.io/packager/main/interfaces/Options.html)


### 退出结果

CLI 与桌面共用 `desktop/logout.py`：尝试可见的退出按钮/账号菜单，处理退出确认框，重新打开首页并同时核查登录检查与可见登录入口；只清理当前会话，不承诺撤销账号全部设备会话

- `remote: confirmed`：已执行平台退出，当前页面恢复未登录状态
- `remote: already_signed_out`：登录检查与页面均显示未登录
- `remote: not_confirmed`：未找到入口、平台异常或超时；仍清理本地 profile，但 CLI 返回 `REMOTE_LOGOUT_UNCONFIRMED`（退出码 5），stdout 中 `localCleared: true` 明确清理结果

桌面对应显示“仅清除了本地登录态，未能确认平台登出”，设置中批量清理会汇总未确认结果。平台退出入口目前经隔离页面模拟测试，未替用户真实退出七个平台账号；站点改版可能需要更新菜单定位


## 工作缓存清理

`profile` 是登录缓存名称，默认 `default`；同平台、同 profile 的任务互斥，不同 profile 可并行，不代表浏览器常驻

```sh
mediacrawler clean
mediacrawler clean --platform xhs
mediacrawler clean --platform xhs --profile work
```

- 正常结束、失败或取消后删除二维码、请求及心跳，只保留每个 profile 最近 50 份简短 `run.json`
- 每次任务启动自动回收空闲 profile 的异常残留并执行上述保留上限；强杀进程留下的文件在后续运行或 `clean` 时回收，无需常驻清理服务
- `clean` 删除所选范围的全部空闲任务目录，输出 `deleted` 和 `skipped` 数量；指定 profile 必须同时指定平台
- 清理持有对应原生锁，跳过活跃 supervisor、worker 和已记录的残留浏览器；不抢锁、不终止进程。需恢复占用时使用 `session recover`
- 不删除登录 profile、锁文件、Downloads 或显式导出的结果；浏览器自身的持久化缓存不属于本命令范围
- 旧版扁平任务目录仅全量清理时回收，无法确认进程状态时跳过；符号链接目录不跟随

## 完整作品与媒体输出

```sh
mediacrawler collect --platform bili --query Claude --limit 5 --quality worst --format json
mediacrawler collect --platform bili --query Claude --quality 720p --include-source
mediacrawler collect --platform xhs --query 猫 --no-media --verbose
mediacrawler collect --help
mediacrawler auth login --help
```

默认输出 `schemaVersion: 3`，兼容原有标题、正文、作者、图片、来源等字段，并增加：

| 字段 | 含义 |
| --- | --- |
| `publishedAt` | 可解析的发布时间，UTC ISO 格式；未知为 null |
| `durationSeconds` | 视频时长（秒），未知为 null |
| `contentType` | 上游内容类型；解析出视频后为 video，无法判断为 unknown |
| `creatorHash` | 上游已有的匿名作者标识；昵称是平台公开数据，原样返回 |
| `statistics` | 点赞、播放、评论、分享、收藏，以及 B站投币/弹幕；未知为 null，不伪造零 |
| `media.variants` | 当前接口返回且可提取的全部候选，不因为画质选择而丢弃其他候选 |
| `media.selection` | 推荐视频/音频 ID、选择结果及是否需要合流；只是推荐，不下载 |
| `media.resolvedAt` | 本次地址解析时间 |
| `media.availabilityVerified` | 当前固定 false：返回地址不代表 CDN 已允许下载，未逐一探测权限 |
| `source` | 仅 `--include-source` 时输出上游已标准化作品记录，剔除独立 token/Cookie 字段；不是完整 HTTP 响应 |

候选含 `kind`（video/audio）、平台标签、宽高、码率（平台提供时）、文件大小、编码、帧率、语言、媒体类型、平台档位 ID、是否含声音、主/备用 URL、必要 Referer 和已知过期时间。未知属性为 null；地址中仅对明确的 `deadline` 提取过期时间，不推测 TTL。不输出账号 Cookie，媒体 URL 自带的资源签名仍保留用于访问，避免公开分享整个结果文件

- `--quality best` 默认：在已知分辨率候选中推荐最高档；同分辨率选较高码率
- `--quality worst`：在已知分辨率候选中推荐最低档；同分辨率选较低码率
- `--quality 720p` 等：匹配视频短边，适用于横屏及竖屏；没有对应档位返回 unavailable，不静默降级
- 未提供尺寸的候选仍保留，但不伪称其最高或最低；`unrankedVideoCount` 标明数量，全部未知时 selection.status=quality_unknown
- 分轨视频的推荐结果另给出音频 ID；缺失音频时 selection.status=audio_unavailable。未解析多语言音轨，不能保证列出所有音轨
- `media.status` 区分 available / not_provided / failed / not_requested。媒体失败不会丢弃正文，成功退出不代表所有附加信息都完整，调用方必须检查此状态
- 默认补查支持的平台能力；顶层 `subtitles` 包含字幕语言、来源、地址与 `segments`（start/end/text，时间单位秒）。兼容保留 `media.subtitles` 与 `media.subtitleStatus`
- 默认逐作品补查：详情最多 45 秒，B站播放器信息最多 15 秒，字幕正文合计最多 30 秒；仍受整体任务超时约束。局部失败保留其余结果，`--no-media` 跳过这一步，消耗见“一次命令用多少额度”，不新增平台专用过滤选项
- `--verbose` / `-v` 仅增加脱敏阶段日志至 stderr，不改变 stdout JSON，不打开上游可能含凭据的原始调试日志

### 统一能力结构

桌面与 CLI 使用同一份 Python 映射，默认返回以下字段，不需要逐个平台启用：

| 字段 | 内容 |
| --- | --- |
| `subtitles` | 字幕列表及每种语言的文字、时间段；不包含自行语音识别 |
| `chapters` | 章节标题、起止秒数、章节图片（平台提供时） |
| `audioResources` | 视频独立音轨或平台配乐/原声；用 role 区分，配乐不保证等于完整视频音频 |
| `storyboards` | 进度预览拼图地址、帧数、间隔、网格与单帧尺寸 |
| `imageVariants` | 图片规格、封面类型、尺寸与地址 |
| `parts` / `collections` | 分 P 列表、所属合集信息 |
| `extra.<platform>` | 平台特有内容信息，如画质权限、标签、HDR、配乐属性 |

这些能力统一为 `{status, items}`。`available` 表示有结果；`not_provided` 表示本次接口未返回；`not_requested` 表示该查询未实现或被关闭；`login_required` 表示字幕接口要求登录；`failed` 表示失败并附脱敏错误码。字幕部分语言失败为 `partial`，每条轨道还有自身状态，不能把空列表等同于平台不支持

B站接入字幕正文、章节、分 P、合集摘要及 Dolby/FLAC 音频候选；抖音接入条件字幕、章节、预览拼图、配乐/原声与封面；小红书补齐时长、流规格、图片规格和标签。小红书及其余平台尚未实现的字幕/章节查询明确保持 `not_requested`，不冒充没有字幕。能力字段不会自动下载音视频或拼图二进制；不做 ASR/OCR，不返回账号凭据或整包内部网络响应

### 平台边界

B站请求 DASH 候选，即使未安装 FFmpeg 也能获取列表；最终下载合流才需要 FFmpeg。抖音读取码率档与播放地址；小红书读取全部已返回流及源文件 key；快手读取各编码描述；微博读取已知清晰度地址；知乎仅视频作品、贴吧从详情提取。各平台未必返回全部档位、尺寸或大小，当前不保证候选列表等同平台全部格式，不支持通过 CLI 绕过账号权限

## 下载（桌面与 CLI 共用）

```sh
# 作品页面：识别平台，复用登录态获取候选，然后下载
mediacrawler download --source 'https://www.bilibili.com/video/BV...' --quality worst

# 已有采集结果：不启动浏览器、不重新采集，直接选择现有候选
mediacrawler download --input results.json --quality 720p
mediacrawler download --input results.json --variant-id video-2
cat results.json | mediacrawler download --input -

# 已选定的媒体直链，画质固定
mediacrawler download --media-url 'https://cdn.example/video.mp4'
mediacrawler download --media-url 'https://cdn.example/video.m4s' --audio-url 'https://cdn.example/audio.m4s'

# 点播 M3U8：多档主清单可以选择画质，系统需安装 FFmpeg
mediacrawler download --media-url 'https://cdn.example/master.m3u8' --quality worst
mediacrawler download --help
```

三个输入互斥：`--source` 是作品页面，`--input` 是采集结果 JSON 数组/单对象/JSONL（同平台最多 100 条、20 MB），`--media-url` 是具体媒体直链。`--referer` 可供直链模式填写防盗链来源；不接收任意 Cookie。`--kind auto/video/images`：自动按媒体信息区分视频与图集，images 下载采集结果中的图片（视频作品一般是封面）

默认保存到 `~/Downloads/MediaCrawler/<运行ID>/<序号>/`；`--output-dir` 指定父目录，仍创建独立运行目录，不覆盖已有结果。进度输出 stderr，JSON 结果输出 stdout，同时保存 results.jsonl 和运行记录。 输出目录不可写时返回 OUTPUT_ERROR，工作缓存写入失败返回 STORAGE_ERROR；已采结果仍输出到 stdout，文件保存错误不会覆盖原任务错误。结果包含文件路径、保存数量、错误码、请求画质和 fallback；提供现成候选时 mediaUrl 表示所用候选的主地址，实际网络可能使用备用 CDN，不代表对最终编码进行了再次探测

- 图片和普通视频文件直接通过现有 HTTP 下载器下载，支持备用地址、重试及当前任务内续传
- 分轨合流需要 FFmpeg；作品模式使用默认 best 且未固定版本时，可尝试现有平台单文件/其他候选兜底，结果 fallback=true；worst、指定清晰度或指定版本不自动改画质
- 已有采集结果模式不自动登录或重新获取地址；地址过期时重新 collect 或改用 source。缺音轨、画质不匹配、缺 FFmpeg 均明确报错
- HLS 使用轻量 m3u8 清单解析库，支持普通点播、主清单选择、独立音轨、初始化片段和字节范围；由受 URL 校验的 HTTP 客户端下载所有需要的资源，再让 FFmpeg 只读本地文件合并。不会安装或捆绑 FFmpeg
- 缺 FFmpeg 返回 ffmpeg_required；直播、加密/DRM HLS 返回 hls_unsupported，合并失败为 hls_failed，超时为 timeout。字幕不额外下载
- 部分失败仍输出已完成文件路径，并非零退出（PARTIAL_RESULT）；取消保留已完成文件，正常取消/错误会清理该任务临时分片。操作系统强杀无法保证 finally 执行
- 桌面仍调用同一个 download_media 服务，已有媒体候选可以跳过浏览器准备；没有候选时沿用平台解析流程。CLI 的作品模式复用已建立的浏览器及登录上下文


### 登录方式示例

```sh
mediacrawler auth login --platform dy --login-mode terminal
mediacrawler auth login --platform xhs --login-mode image
mediacrawler auth login --platform xhs --login-mode browser
mediacrawler collect --platform xhs --query 桌面整理 --login-mode image
```

登录方式只决定需要登录时如何展示扫码，不决定采集是否有界面。图片模式仅调用系统预览显示 PNG，不显示浏览器；浏览器模式不再额外打开图片。`--non-interactive` 优先，登录态缺失直接报错，不展示任何扫码界面。后台加载失败不会自动改为可见浏览器

## 登录巡检与网络诊断

```sh
mediacrawler check --help
mediacrawler check --defaults
mediacrawler check --platform bili
mediacrawler check --all --no-speed
mediacrawler check --platform dy --no-network --qr-timeout 20
```

`--help` 按命令分流；`auth --help`、`collect --help`、`download --help`、`check --help` 和 `doctor --help` 分别说明各自功能

`check` 默认先输出一条 `type=network` 的 JSONL，再按平台输出 `type=platform` 报告；`--all` 只执行一次网络诊断。网络/测速失败不阻断平台检查，平台失败后继续后续平台。退出码 0 表示所有平台取图检查通过，5 表示至少一个平台失败；网络结果需要读取自己的 status，不以总体退出码代替。stderr 保留运行错误，stdout 保留结构化报告

网络报告包括本机非回环活动接口、IPv4 路由可用性、参考网站和目标平台 DNS/HTTP 状态、耗时及参考下载速度。活动接口不等于互联网可达；收到 HTTP 响应只证明对应目标可达，403/429 仍单独返回访问限制。DNS 使用系统解析器，HTTP 使用 Python HTTPX 和环境代理，平台页面使用浏览器路径，各自明确标识，不能将其中一个的失败直接推断为其他路径也失败

测速只作参考：默认尝试南京大学公开 CLI 节点配置与 Cloudflare 下载节点，各节点独立采样，保留成功数、均值、中位数和失败原因。南大 HTTPS 配置不可用时明确记录，不降级跳过证书检查；仅一个可用样本标记 limited。当前不是覆盖全国的测速服务，也不代表国内运营商宽带极限。测速预算 10 秒 / 20 MiB，网络阶段总预算 20 秒；样本太少返回 null，不把不可用当作 0 Mbps。`--no-speed` 禁用带宽采样，`--no-network` 跳过整个主动网络诊断

平台检查使用临时独立 profile，无头、静音，不扫码，不修改现有登录态。检查流程为页面导航 → 登录入口 → 验证码检测 → 二维码实际 PNG 提取，不只检查元素出现。报告不输出二维码、Cookie、请求凭据和页面正文。`verification.status` 为 detected / not_detected / unknown，not_detected 不保证没有其他未适配的验证方式

`error` 包含 code、stage、retryable，可附 status_code、timed_out 或 worker cause。枚举以 `check --defaults` 为准，包括 NETWORK_OFFLINE、DNS_FAILED、CONNECTION_FAILED、TLS_FAILED、HTTP_ERROR、ACCESS_RESTRICTED、VERIFICATION_REQUIRED、LOGIN_ENTRY_NOT_FOUND、QR_NOT_FOUND、QR_IMAGE_FAILED、TIMEOUT、UNKNOWN。失败是观察结果，不直接宣判平台改版

共用策略来自 `desktop/health-policy.json`，`check --defaults` 无网络输出这些配置与枚举。取码默认 30 秒，导航上限 15 秒；浏览器启动/进程预算另计。`--qr-timeout` 仅覆盖本次 CLI 检查，报告 policy 返回实际值，不能当作等待用户扫码的超时。`doctor` 仍只负责本机运行环境检查
