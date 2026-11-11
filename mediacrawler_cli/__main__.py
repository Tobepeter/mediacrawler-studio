import json
import sys
import tempfile
from pathlib import Path
from typing import Optional

import typer
from mediacrawler_cli.runtime import CLIError, run, recover
from mediacrawler_cli.state import PLATFORMS
from desktop.health import POLICY

app = typer.Typer(help='独立采集 CLI，结果输出 stdout，登录提示输出 stderr', no_args_is_help=True)
auth = typer.Typer(no_args_is_help=True)
session = typer.Typer(no_args_is_help=True)
app.add_typer(auth, name='auth')
app.add_typer(session, name='session')
creator = typer.Typer(no_args_is_help=True, help='搜索博主并翻页采集其主页作品；posts 支持 dy、bili、xhs、zhihu，search 支持 dy、bili')
app.add_typer(creator, name='creator')
rate = typer.Typer(no_args_is_help=True, help='查看访问额度')
app.add_typer(rate, name='rate')


@rate.command('status')
def rate_status(platform: Optional[str] = typer.Option(None, help='不传时列出所有平台')):
    """各平台 10 分钟额度的已用和剩余，以及冷却秒数；只读本地状态，不发请求、不占额度"""
    from desktop.pacing import quota
    if platform and platform not in PLATFORMS:
        raise typer.BadParameter('平台：' + ', '.join(PLATFORMS))
    for name in [platform] if platform else PLATFORMS:
        typer.echo(json.dumps(quota(name), ensure_ascii=False))


def skill_path():
    """技能文档只在 docs/ 维护一份，打包时作为数据文件带进去，源码和打包版都从资源根目录读"""
    root = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
    return root / 'docs' / 'skill.md'


@app.command('skill')
def skill_command(output: Optional[str] = typer.Option(None, '--output', help='写到这个文件，比如 ~/.claude/skills/mediacrawler/SKILL.md；不传就输出到 stdout')):
    """输出配套的 Agent 技能文档（SKILL.md 格式），讲怎么用这套命令做多平台专题调研

    skill > SKILL.md

    skill --output ~/.claude/skills/mediacrawler/SKILL.md
    """
    source = skill_path()
    if not source.is_file():
        typer.echo(json.dumps({'code': 'SKILL_MISSING', 'message': '找不到技能文档，请从源码仓库或打包版运行', 'retryable': False}, ensure_ascii=False), err=True)
        raise typer.Exit(1)
    text = source.read_text(encoding='utf-8')
    if not output:
        typer.echo(text, nl=False)
        return
    target = Path(output).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8')
    typer.echo(str(target), err=True)


# 排队太久宁可立刻报错，调用方按 retry_after 决定等不等，比闷头卡住好
DEFAULT_MAX_WAIT = 3
MAX_WAIT = typer.Option(DEFAULT_MAX_WAIT, '--max-wait', min=0, max=600,
                        help='单次最多排队多少秒，包括等 10 分钟额度恢复。开始前超过返回 RATE_WAIT_EXCEEDED，开始后额度用满且超过返回 RATE_LIMITED，都带 retry_after；要小于 --timeout')
NO_THROTTLE = typer.Option(False, '--no-throttle', help='跳过本地节流直接请求，可能触发平台验证，只在排查时手动使用')


def profile_busy_message(platform, profile):
    return f'{platform}/{profile} 正在使用中，可稍后重试或用 --profile 选择其他配置'


def invoke(action, platform, profile='default', data_dir=None, **options):
    if platform not in PLATFORMS and not (action == 'download' and platform == 'direct'):
        raise typer.BadParameter('平台：' + ', '.join(PLATFORMS))
    request = dict(action=action, platform=platform, profile=profile, data_dir=data_dir,
                   mode='search', query='', limit=5, comments=False, replies=False,
                   qr='terminal', login_timeout=300, timeout=900,
                   non_interactive=False, lock_timeout=0, format='jsonl',
                   max_wait=DEFAULT_MAX_WAIT, no_throttle=False)
    request.update(options)
    if request['max_wait'] > DEFAULT_MAX_WAIT and request['max_wait'] >= request['timeout']:
        raise typer.BadParameter('--timeout 要大于 --max-wait，否则排队途中任务就超时了')
    if request['no_throttle']:
        typer.echo('已跳过本地节流，这次请求可能触发平台验证', err=True)
    if request['qr'] not in ('terminal', 'image', 'browser') or request['format'] not in ('json', 'jsonl'):
        raise typer.BadParameter('login-mode 必须是 terminal/image/browser；format 必须是 json/jsonl')
    try:
        return run(request)
    except CLIError as error:
        if action == 'check' and error.code != 'CHECK_FAILED':
            typer.echo(json.dumps({'type': 'platform', 'platform': platform, 'status': 'failed', 'policy': {**POLICY, 'qr_timeout_ms': options.get('qr_timeout_ms', POLICY['qr_timeout_ms'])},
                                  'error': {'code': 'TIMEOUT' if error.code == 'TASK_TIMEOUT' else 'UNKNOWN',
                                            'stage': 'worker', 'cause': error.code, 'retryable': True}}))
        messages = {'SEARCH_VERIFICATION_REQUIRED': '平台要求验证，访问已暂停，请按 retry_after 秒后再试', 'RATE_WAIT_EXCEEDED': '排队时间超过 --max-wait，请按 retry_after 秒后再试，或调大 --max-wait', 'RATE_LIMITED': '操作太频繁，请按 retry_after 秒后再试，或调大 --max-wait', 'RATE_COOLDOWN': '平台要求过验证，冷却中，请按 retry_after 秒后再试', 'INVALID_CURSOR': '翻页游标无效，请从第一页重新开始', 'INVALID_CREATOR': '请使用博主主页链接、sec_uid 或名称', 'CREATOR_NOT_FOUND': '没有完全匹配的博主，可参考 candidates 改用 sec_uid', 'CREATOR_AMBIGUOUS': '有多位同名博主，请从 candidates 选择 sec_uid', 'CREATOR_PRIVATE': '这位博主的作品不公开', 'UNSUPPORTED_PLATFORM': '该平台暂不支持博主能力', 'PARTIAL_RESULT': '只取得部分结果，可用 next_cursor 稍后继续', 'PROFILE_BUSY': profile_busy_message(platform, profile), 'OUTPUT_ERROR': '无法写入输出目录，请检查路径、权限和磁盘空间；已采结果仍输出到 stdout', 'STORAGE_ERROR': '无法写入工作缓存，请检查权限和磁盘空间', 'REMOTE_LOGOUT_UNCONFIRMED': '仅清除了本地登录态，未能确认平台登出', 'RECOVERY_REQUIRED': '请运行 session recover 检查占用', 'QR_DECODE_FAILED': '二维码无法解码，请改用 --login-mode image', 'QR_UNAVAILABLE': '未找到二维码，请显式使用 --login-mode browser 或运行 check', 'AUTH_REQUIRED': '请先运行 auth login，或移除 --non-interactive', 'VERIFICATION_REQUIRED': '平台要求验证，请显式使用 --login-mode browser 完成验证'}
        typer.echo(json.dumps({'code': error.code, 'message': messages.get(error.code, error.code),
                               'retryable': error.code in ('PROFILE_BUSY', 'PLATFORM_ERROR', 'PARTIAL_RESULT', 'SEARCH_VERIFICATION_REQUIRED', 'RATE_LIMITED', 'RATE_WAIT_EXCEEDED', 'RATE_COOLDOWN'), 'run_id': error.run_id,
                               **({'candidates': error.candidates} if error.candidates else {}),
                               **({'retry_after': error.retry_after} if error.retry_after else {})}, ensure_ascii=False), err=True)
        raise typer.Exit({'AUTH_REQUIRED': 3, 'PROFILE_BUSY': 4, 'TASK_TIMEOUT': 6, 'CANCELLED': 130}.get(error.code, 5))
    except ValueError as error:
        raise typer.BadParameter(str(error)) from None


@app.command()
def collect(platform: str = typer.Option(...), query: Optional[str] = None, url: Optional[str] = None,
            limit: int = typer.Option(5, min=1, max=100), profile: str = 'default', data_dir: Optional[str] = None,
            non_interactive: bool = False, qr: str = typer.Option('terminal', '--login-mode', '--qr', help='terminal 终端二维码 / image 图片二维码 / browser 临时浏览器扫码；始终静音'),
            login_timeout: int = typer.Option(300, min=1), timeout: int = typer.Option(900, min=1),
            lock_timeout: float = typer.Option(0, min=0, max=300), format: str = 'jsonl',
            save: bool = False, output_dir: Optional[str] = None, comments: bool = False, replies: bool = False,
            quality: str = typer.Option('best', help='推荐画质：best、worst 或具体高度如 720p；保留全部候选，指定档位缺失不静默降级'),
            media: bool = typer.Option(True, '--media/--no-media', help='默认补齐媒体、字幕、章节等能力；--no-media 只要列表字段，B站能省额度'),
            include_source: bool = typer.Option(False, help='附带上游标准化作品字段（不是账号信息或完整 HTTP 响应）'),
            max_wait: float = MAX_WAIT, no_throttle: bool = NO_THROTTLE, verbose: bool = typer.Option(False, '--verbose', '-v', help='额外阶段日志写到 stderr，不改变 JSON 结果')):
    """采集作品，默认返回完整能力与字幕正文，不自动下载视频、音频和图片

    示例：collect --platform bili --query Claude --limit 5 --quality worst

    画质候选取决于作品及账号权限，不保证列出平台所有版本，地址可用性未逐一探测
    best/worst 按已知分辨率选择；竖屏按短边匹配 720p 等档位
    B站支持分轨候选；抖音/小红书/快手/微博取详情内候选；知乎视频/贴吧尽力提取
    默认补查平台字幕、章节、音频资源、预览图、图片规格与分 P；平台特有信息放 extra
    能力统一包含 status/items；未实现为 not_requested，未返回为 not_provided，失败保留正文
    """
    import re
    if quality not in ('best', 'worst') and not re.fullmatch(r'[1-9][0-9]{1,4}p', quality):
        raise typer.BadParameter('--quality 使用 best、worst 或如 720p')
    if bool(query) == bool(url):
        raise typer.BadParameter('--query 与 --url 必须且只能提供一个')
    options = dict(locals())
    options.pop('url')
    options.pop('re', None)
    options.update(query=query or url, mode='link' if url else 'search')
    invoke('collect', **options)


def creator_platform(platform, supported=None):
    from desktop.paging import CREATOR_PLATFORMS, CREATOR_SEARCH_PLATFORMS, PAGED_SEARCH_PLATFORMS
    supported = {'posts': CREATOR_PLATFORMS, 'search': PAGED_SEARCH_PLATFORMS}.get(supported, CREATOR_SEARCH_PLATFORMS)
    if platform not in supported:
        raise typer.BadParameter('当前支持：' + ', '.join(supported))


@creator.command('search')
def creator_search(query: str = typer.Option(..., help='博主名称或关键词'), platform: str = 'dy',
                   limit: int = typer.Option(10, min=1, max=50), cursor: Optional[str] = typer.Option(None, help='上一次输出的 next_cursor'),
                   profile: str = 'default', data_dir: Optional[str] = None, non_interactive: bool = False,
                   qr: str = typer.Option('terminal', '--login-mode', '--qr', help='terminal / image / browser'),
                   login_timeout: int = typer.Option(300, min=1), timeout: int = typer.Option(180, min=1),
                   lock_timeout: float = typer.Option(0, min=0, max=300), format: str = 'jsonl', max_wait: float = MAX_WAIT, no_throttle: bool = NO_THROTTLE, verbose: bool = False):
    """搜索博主，每行一个候选，末行 type=page 给出 next_cursor

    抖音结果混合博主卡片（source=user）和相关视频作者（source=video）；后者字段较少，可能和名称不完全相关
    示例：creator search --query 罗翔 --limit 10
    """
    creator_platform(platform)
    if not query.strip():
        raise typer.BadParameter('--query 不能为空')
    invoke('creator-search', **dict(locals()))


@creator.command('posts')
def creator_posts(reference: Optional[str] = typer.Option(None, '--creator', help='主页链接；抖音、B站还支持分享短链、sec_uid/UID 或完全匹配的名称，小红书需带 xsec_token'),
                  cursor: Optional[str] = typer.Option(None, help='上一次输出的 next_cursor；可不再提供 --creator'),
                  platform: str = 'dy', limit: int = typer.Option(20, min=1, max=100), profile: str = 'default',
                  data_dir: Optional[str] = None, non_interactive: bool = False,
                  qr: str = typer.Option('terminal', '--login-mode', '--qr', help='terminal / image / browser'),
                  login_timeout: int = typer.Option(300, min=1), timeout: int = typer.Option(900, min=1),
                  lock_timeout: float = typer.Option(0, min=0, max=300), format: str = 'jsonl', save: bool = False,
                  output_dir: Optional[str] = None, comments: bool = False, replies: bool = False,
                  quality: str = typer.Option('best', help='best、worst 或 720p 等'),
                  media: bool = typer.Option(True, '--media/--no-media', help='默认补齐媒体、字幕等能力；--no-media 只要列表字段，B站能省额度'),
                  include_source: bool = False, max_wait: float = MAX_WAIT, no_throttle: bool = NO_THROTTLE, verbose: bool = False):
    """按主页顺序翻页采集博主作品，末行 type=page 给出 next_cursor 与博主资料

    单次最多 100 条，继续传 --cursor；has_more=false 表示已到末尾。翻页位置精确到页内，不漏条
    示例：creator posts --creator https://www.douyin.com/user/MS4w... --limit 50
    名称必须唯一且完全匹配，否则返回 CREATOR_AMBIGUOUS / CREATOR_NOT_FOUND 及 candidates
    """
    import re
    creator_platform(platform, 'posts')
    if quality not in ('best', 'worst') and not re.fullmatch(r'[1-9][0-9]{1,4}p', quality):
        raise typer.BadParameter('--quality 使用 best、worst 或如 720p')
    if not reference and not cursor:
        raise typer.BadParameter('需要 --creator 或 --cursor')
    options = dict(locals())
    options.pop('reference')
    options.pop('re', None)
    invoke('collect', mode='creator', query=reference or '', **options)


@app.command('search')
def search_command(query: Optional[str] = typer.Option(None, help='关键词；只传 --cursor 时可省略'),
                   cursor: Optional[str] = typer.Option(None, help='上一次输出的 next_cursor'),
                   platform: str = 'dy', limit: int = typer.Option(20, min=1, max=100, help='本次最多返回多少条，默认一页 20 条'),
                   profile: str = 'default', data_dir: Optional[str] = None, non_interactive: bool = False,
                   qr: str = typer.Option('terminal', '--login-mode', '--qr', help='terminal / image / browser'),
                   login_timeout: int = typer.Option(300, min=1), timeout: int = typer.Option(900, min=1),
                   lock_timeout: float = typer.Option(0, min=0, max=300), format: str = 'jsonl', save: bool = False,
                   output_dir: Optional[str] = None, comments: bool = False, replies: bool = False,
                   quality: str = typer.Option('best', help='best、worst 或 720p 等'),
                   media: bool = typer.Option(True, '--media/--no-media', help='默认补齐媒体、字幕等能力；--no-media 只要列表字段，B站能省额度'),
                   include_source: bool = False, max_wait: float = MAX_WAIT, no_throttle: bool = NO_THROTTLE, verbose: bool = False):
    """按关键词分页采集作品，末行 type=page 给出 next_cursor

    --limit 是本次要多少条，--cursor 是从哪继续，两者独立；has_more=false 表示已到末尾
    示例：search --query 罗翔；search --cursor <next_cursor> --limit 50
    需要一次拿固定条数、不关心翻页时用 collect
    """
    import re
    creator_platform(platform, 'search')
    if quality not in ('best', 'worst') and not re.fullmatch(r'[1-9][0-9]{1,4}p', quality):
        raise typer.BadParameter('--quality 使用 best、worst 或如 720p')
    if not (query or '').strip() and not cursor:
        raise typer.BadParameter('需要 --query 或 --cursor')
    options = dict(locals())
    options.pop('re', None)
    options['query'] = (query or '').strip()
    invoke('collect', mode='search', paged=True, **options)


def load_records(input, platform):
    """读取采集结果 JSON/JSONL，校验后返回记录和平台"""
    try:
        if input == '-':
            text = sys.stdin.read(20 * 1024 * 1024 + 1)
        else:
            with Path(input).open() as stream:
                text = stream.read(20 * 1024 * 1024 + 1)
        if len(text) > 20 * 1024 * 1024:
            raise ValueError('输入超过 20 MB')
        try:
            records = json.loads(text)
        except json.JSONDecodeError:
            records = [json.loads(line) for line in text.splitlines() if line.strip()]
        # 直接接 search/collect 的输出：--format json 是 {items, page}，JSONL 末行是分页信息
        if isinstance(records, dict) and isinstance(records.get('items'), list):
            records = records['items']
        records = records if isinstance(records, list) else [records]
        records = [r for r in records if not (isinstance(r, dict) and r.get('type') == 'page')]
        if not 1 <= len(records) <= 100 or any(not isinstance(r, dict) or not isinstance(r.get('id'), str) for r in records):
            raise ValueError('需要 1–100 条带 id/platform 的采集结果')
        platforms = {r.get('platform') for r in records}
        if len(platforms) != 1 or next(iter(platforms)) not in PLATFORMS:
            raise ValueError('输入必须属于同一受支持平台')
        detected = next(iter(platforms))
        if platform and platform != detected:
            raise ValueError('指定平台与输入不一致')
        platform = detected
        from media_downloader.selection import validate_record
        for record in records:
            validate_record(record)
    except (OSError, ValueError, TypeError) as error:
        raise typer.BadParameter(str(error)) from None
    return records, platform


@app.command('comments')
def comments_command(source: str = typer.Option(..., help='作品页面链接'), cursor: Optional[str] = typer.Option(None, help='上一页返回的 next_cursor'),
                     parent: Optional[str] = typer.Option(None, help='主评论 ID，传了就取这条评论的回复'),
                     platform: Optional[str] = None, profile: str = 'default', data_dir: Optional[str] = None,
                     non_interactive: bool = False, qr: str = typer.Option('terminal', '--login-mode', '--qr', help='terminal 终端二维码、image 图片、browser 浏览器'),
                     timeout: int = typer.Option(180, min=1), max_wait: float = MAX_WAIT, no_throttle: bool = NO_THROTTLE, verbose: bool = False,
                     format: str = 'jsonl'):
    """取一页评论，支持 B 站、抖音、小红书

    comments --source '作品链接'

    comments --source '作品链接' --cursor '上一页的 next_cursor'

    comments --source '作品链接' --parent 主评论ID

    要批量就循环调用；collect --comments 仍可随采集带上有界评论
    """
    from desktop.links import allowed
    platform = platform or next((p for p in PLATFORMS if allowed(source, p)), None)
    if platform not in ('bili', 'dy', 'xhs') or not allowed(source, platform):
        raise typer.BadParameter('评论支持 B 站、抖音、小红书的 HTTPS 作品链接')
    invoke('comments', platform, profile, data_dir, query=source, mode='link', limit=1, cursor=cursor, parent=parent, paged=True,
           non_interactive=non_interactive, qr=qr, timeout=timeout, verbose=verbose, format=format, max_wait=max_wait, no_throttle=no_throttle)


@app.command('transcribe')
def transcribe_command(file: Optional[str] = typer.Option(None, '--file', help='本地音视频文件'),
                       source: Optional[str] = typer.Option(None, help='作品页面链接，下载最低画质后转写'),
                       input: Optional[str] = typer.Option(None, '--input', help='采集结果 JSON/JSONL 文件，- 表示 stdin'),
                       check_only: bool = typer.Option(False, '--check', help='只检查 stt 服务是否可用'),
                       platform: Optional[str] = None, profile: str = 'default', data_dir: Optional[str] = None,
                       non_interactive: bool = False, qr: str = typer.Option('terminal', '--login-mode', '--qr', help='terminal 终端二维码、image 图片、browser 浏览器'),
                       timeout: int = typer.Option(1800, min=1), max_wait: float = MAX_WAIT, no_throttle: bool = NO_THROTTLE, verbose: bool = False):
    """把视频转成带时间戳的文字，有平台字幕时直接用字幕

    需要本机运行 stt 语音转写服务（127.0.0.1:29556），本工具不安装 stt

    transcribe --check

    transcribe --file ./video.mp4

    transcribe --source '作品链接'
    """
    import asyncio
    import tempfile
    from desktop.links import allowed
    from desktop.transcribe import SttError, check, transcribe_file
    if check_only:
        state = asyncio.run(check())
        typer.echo(json.dumps(state, ensure_ascii=False))
        raise typer.Exit(0 if state['state'] != 'missing' else 1)
    if sum(bool(v) for v in (file, source, input)) != 1:
        raise typer.BadParameter('--file、--source、--input 必须且只能选一个')
    if file:
        if not Path(file).is_file():
            raise typer.BadParameter('文件不存在')
        try:
            typer.echo(json.dumps(asyncio.run(transcribe_file(file)), ensure_ascii=False))
        except SttError as error:
            typer.echo(json.dumps({'code': error.code, 'message': str(error), 'retryable': error.code == 'stt_busy',
                                   **({'retry_after': error.retry_after} if error.retry_after else {})}, ensure_ascii=False), err=True)
            raise typer.Exit(1)
        return
    records = None
    if source:
        platform = platform or next((p for p in PLATFORMS if allowed(source, p)), None)
        if not platform or platform not in PLATFORMS or not allowed(source, platform):
            raise typer.BadParameter('无法识别作品平台，请检查 HTTPS 作品链接')
    else:
        records, platform = load_records(input, platform)
    # 下载管线要求一个输出目录，转写用自己的临时目录，这里用完即删
    with tempfile.TemporaryDirectory(prefix='mediacrawler-stt-run-') as folder:
        invoke('download', platform, profile, data_dir, query=source or '', mode='link', limit=1,
               records=records, kind='video', quality='worst', variant_id=None, transcribe=True,
               output_dir=folder, save=True, non_interactive=non_interactive, qr=qr,
               timeout=timeout, verbose=verbose, format='json', max_wait=max_wait, no_throttle=no_throttle)


@app.command('ocr')
def ocr_command(file: Optional[str] = typer.Option(None, '--file', help='本地图片'),
                source: Optional[str] = typer.Option(None, help='作品页面链接，下载全部图片后识别'),
                input: Optional[str] = typer.Option(None, '--input', help='采集结果 JSON/JSONL 文件，- 表示 stdin'),
                auto: bool = typer.Option(False, '--auto', help='配合 --input，只识别正文不到 100 字、至少两张图的图文帖'),
                check_only: bool = typer.Option(False, '--check', help='只检查当前环境能否识别图片'),
                platform: Optional[str] = None, profile: str = 'default', data_dir: Optional[str] = None,
                non_interactive: bool = False, qr: str = typer.Option('terminal', '--login-mode', '--qr', help='terminal 终端二维码、image 图片、browser 浏览器'),
                timeout: int = typer.Option(900, min=1), max_wait: float = MAX_WAIT, no_throttle: bool = NO_THROTTLE, verbose: bool = False):
    """识别图文帖图片里的文字，干货写在图里、正文只有一句“见图”时用

    直接调用 rapidocr 库，模型每次运行只加载一次，打包版已内置；视频请用 transcribe

    ocr --check

    ocr --file ./note.jpg

    ocr --source '作品链接'

    ocr --input results.json --auto
    """
    import asyncio
    import tempfile
    from desktop.links import allowed
    from desktop.ocr import OcrError, check, needs_ocr, ocr_file
    if check_only:
        state = check()
        typer.echo(json.dumps(state, ensure_ascii=False))
        raise typer.Exit(0 if state['state'] == 'ready' else 1)
    if sum(bool(v) for v in (file, source, input)) != 1:
        raise typer.BadParameter('--file、--source、--input 必须且只能选一个')
    if auto and not input:
        raise typer.BadParameter('--auto 只能配合 --input 使用')
    if file:
        if not Path(file).is_file():
            raise typer.BadParameter('文件不存在')
        try:
            typer.echo(json.dumps(asyncio.run(ocr_file(file)), ensure_ascii=False))
        except OcrError as error:
            typer.echo(json.dumps({'code': error.code, 'message': str(error), 'retryable': False}, ensure_ascii=False), err=True)
            raise typer.Exit(1)
        return
    if check()['state'] != 'ready':
        typer.echo(json.dumps({'code': 'ocr_unavailable', 'message': '当前环境没有 OCR 依赖，开发环境运行 uv sync 安装', 'retryable': False}, ensure_ascii=False), err=True)
        raise typer.Exit(1)
    records = None
    if source:
        platform = platform or next((p for p in PLATFORMS if allowed(source, p)), None)
        if not platform or platform not in PLATFORMS or not allowed(source, platform):
            raise typer.BadParameter('无法识别作品平台，请检查 HTTPS 作品链接')
    else:
        records, platform = load_records(input, platform)
        if auto:
            picked = [record for record in records if needs_ocr(record)]
            typer.echo(f'--auto：{len(records)} 条里有 {len(picked)} 条需要识别', err=True)
            if not picked:
                typer.echo('[]')
                return
            records = picked
    with tempfile.TemporaryDirectory(prefix='mediacrawler-ocr-run-') as folder:
        invoke('download', platform, profile, data_dir, query=source or '', mode='link', limit=1,
               records=records, kind='images', quality='best', variant_id=None, ocr=True,
               output_dir=folder, save=True, non_interactive=non_interactive, qr=qr,
               timeout=timeout, verbose=verbose, format='json', max_wait=max_wait, no_throttle=no_throttle)


@app.command('download')
def download_command(source: Optional[str] = typer.Option(None, help='作品页面链接，识别平台后获取媒体'),
                     input: Optional[str] = typer.Option(None, '--input', help='采集结果 JSON/JSONL 文件，- 表示 stdin；同平台最多 100 条'),
                     media_url: Optional[str] = typer.Option(None, help='具体 MP4/M3U8 直链，不启动浏览器'),
                     audio_url: Optional[str] = typer.Option(None, help='直链模式的独立音轨'),
                     referer: Optional[str] = typer.Option(None, help='直链模式需要的 Referer'),
                     platform: Optional[str] = None, profile: str = 'default', data_dir: Optional[str] = None,
                     kind: str = typer.Option('auto', help='auto/video/images；图集自动下载图片'),
                     quality: str = typer.Option('best', help='best/worst/720p 等；普通直链画质固定，HLS 可选择清单内档位'),
                     variant_id: Optional[str] = typer.Option(None, help='--input 中指定媒体版本 ID'),
                     output_dir: Optional[str] = typer.Option(None, help='下载目录，每次创建独立子目录；默认 Downloads/MediaCrawler'),
                     non_interactive: bool = False, qr: str = typer.Option('terminal', '--login-mode', '--qr', help='terminal 终端二维码 / image 图片二维码 / browser 临时浏览器扫码；始终静音'),
                     timeout: int = typer.Option(1800, min=1), max_wait: float = MAX_WAIT, no_throttle: bool = NO_THROTTLE, verbose: bool = typer.Option(False, '--verbose', '-v')):
    """下载作品或已有媒体信息，共用桌面下载器，不自动安装 FFmpeg

    download --source '作品链接' --quality worst

    download --input results.json --variant-id video-2

    download --media-url 'https://cdn.example/video.mp4'

    分轨和点播 M3U8 需要系统 FFmpeg；不支持直播或加密 HLS
    已有媒体信息不会重新登录或刷新地址，过期后重新 collect/source 解析
    stdout 返回路径及错误 JSON；失败或部分成功退出非零
    """
    import re
    from desktop.links import allowed
    if sum(bool(v) for v in (source, input, media_url)) != 1:
        raise typer.BadParameter('--source、--input、--media-url 必须且只能选一个')
    if kind not in ('auto', 'video', 'images') or (quality not in ('best', 'worst') and not re.fullmatch(r'[1-9][0-9]{1,4}p', quality)):
        raise typer.BadParameter('kind 使用 auto/video/images；quality 使用 best/worst/720p 等')
    if (audio_url or referer) and not media_url:
        raise typer.BadParameter('--audio-url/--referer 仅用于 --media-url')
    if variant_id and not input:
        raise typer.BadParameter('--variant-id 需要 --input')
    records = None
    if source:
        platform = platform or next((p for p in PLATFORMS if allowed(source, p)), None)
        if not platform or platform not in PLATFORMS or not allowed(source, platform):
            raise typer.BadParameter('无法识别作品平台，请检查 HTTPS 作品链接')
    elif input:
        records, platform = load_records(input, platform)
    else:
        from urllib.parse import urlparse
        if any(urlparse(u).scheme != 'https' for u in (media_url, audio_url) if u):
            raise typer.BadParameter('媒体直链需要 HTTPS')
        if quality != 'best' and not urlparse(media_url).path.lower().endswith('.m3u8'):
            raise typer.BadParameter('普通媒体直链画质固定；只有明确的 .m3u8 清单可指定画质')
        platform = platform or 'direct'
        video = {'id': 'video-1', 'kind': 'video', 'url': media_url, 'height': None,
                 'hasAudio': not bool(audio_url), 'headers': {'Referer': referer} if referer else {}}
        candidates = [video]
        if audio_url:
            candidates.append({'id': 'audio-1', 'kind': 'audio', 'url': audio_url})
        records = [{'id': 'direct', 'platform': platform, 'contentType': 'video', 'images': [], 'media': {'variants': candidates}}]
        if kind == 'images':
            raise typer.BadParameter('--media-url 用于视频；图片请传采集结果')
    invoke('download', platform, profile, data_dir, query=source or '', mode='link', limit=1,
           records=records, kind=kind, quality=quality, variant_id=variant_id,
           output_dir=output_dir, save=True, non_interactive=non_interactive, qr=qr,
           timeout=timeout, verbose=verbose, format='json', max_wait=max_wait, no_throttle=no_throttle)


@auth.command('login')
def auth_login(platform: str = typer.Option(...), profile: str = 'default', data_dir: Optional[str] = None,
               qr: str = typer.Option('terminal', '--login-mode', '--qr', help='terminal 终端二维码 / image 图片二维码 / browser 临时浏览器扫码；始终静音'), login_timeout: int = typer.Option(300, min=1)):
    invoke('login', **locals())


@auth.command('status')
def auth_status(platform: str = typer.Option(...), profile: str = 'default', data_dir: Optional[str] = None):
    invoke('status', **locals(), non_interactive=True, timeout=90)


@auth.command('logout')
def auth_logout(platform: str = typer.Option(...), profile: str = 'default', data_dir: Optional[str] = None):
    invoke('logout', **locals(), timeout=120)


@session.command('recover')
def session_recover(platform: str = typer.Option(...), profile: str = 'default', data_dir: Optional[str] = None):
    try:
        recover(data_dir, platform, profile)
        typer.echo(json.dumps({'recovered': True}))
    except (CLIError, RuntimeError) as error:
        detail = {'code': str(error)}
        if str(error) == 'PROFILE_BUSY':
            detail.update(message=profile_busy_message(platform, profile), retryable=True)
        typer.echo(json.dumps(detail, ensure_ascii=False), err=True)
        raise typer.Exit(4)


@app.command('clean')
def clean_command(platform: Optional[str] = None, profile: Optional[str] = None, data_dir: Optional[str] = None):
    """清理空闲工作缓存，保留登录态和导出结果"""
    from mediacrawler_cli.cleanup import clean
    try:
        typer.echo(json.dumps(clean(data_dir, platform, profile)))
    except ValueError as error:
        raise typer.BadParameter(str(error)) from None


@app.command()
def check(platform: Optional[str] = typer.Option(None, help='检查单个平台'),
          all: bool = typer.Option(False, help='检查全部平台，网络只测一次'),
          network: bool = typer.Option(True, help='DNS、HTTP 与本机网络诊断'),
          speed: bool = typer.Option(True, help='有界参考测速；--no-speed 只检查连通性'),
          qr_timeout: int = typer.Option(POLICY['qr_timeout_ms'] // 1000, min=1, max=120, help='取码总预算（秒），不含浏览器启动与网络诊断'),
          defaults: bool = typer.Option(False, help='输出共用超时、失败阈值和错误枚举，不访问网络')):
    """网络 → 平台页面 → 实际提取二维码，输出 JSONL 诊断报告

    check --platform bili / check --all / check --defaults

    每个对象有 type、status、policy；失败含 error.code/stage/retryable
    网络报告附 DNS/HTTP、参考下载均值/中位数和节点样本，不代表宽带套餐速度
    测速失败仍继续检查平台；代理路径不同会单独标识，不因 DNS 失败跳过浏览器
    临时独立 profile、无头静音、不扫码、不修改现有登录态
    退出码：0 平台检查通过，5 至少一项平台检查失败（包括进程超时）
    """
    from desktop.health import POLICY, ERRORS, URLS
    if defaults:
        typer.echo(json.dumps({'policy': POLICY, 'error_codes': ERRORS}))
        return
    if bool(platform) == all:
        raise typer.BadParameter('请选择 --platform 或 --all')
    if platform and platform not in PLATFORMS:
        raise typer.BadParameter('平台：' + ', '.join(PLATFORMS))
    targets = list(PLATFORMS) if all else [platform]
    failed = False
    with tempfile.TemporaryDirectory(prefix='mediacrawler-check-') as directory:
        if network:
            try:
                invoke('network-check', targets[0], data_dir=directory, timeout=40,
                       probe_urls=[URLS[p] for p in targets], speed=speed)
            except typer.Exit:
                typer.echo(json.dumps({'type': 'network', 'status': 'failed',
                                      'error': {'code': 'UNKNOWN', 'stage': 'network'}, 'policy': POLICY}))
        for selected in targets:
            try:
                invoke('check', selected, data_dir=directory, timeout=qr_timeout + 45,
                       qr_timeout_ms=qr_timeout * 1000)
            except typer.Exit:
                failed = True
    if failed:
        raise typer.Exit(5)


@app.command()
def doctor():
    """检查本机 Chromium、Node、Python 与平台模块；网络和二维码请用 check"""
    from playwright.sync_api import sync_playwright
    from mediacrawler_cli.browser import options
    import shutil
    with sync_playwright() as playwright:
        browser = Path(options(playwright).get('executable_path', playwright.chromium.executable_path))
        try:
            instance = playwright.chromium.launch(headless=True, args=['--mute-audio'], timeout=15000, **options(playwright))
            instance.close()
            launch = True
        except Exception:
            launch = False
    result = {'chromium': browser.exists() and launch, 'node': bool(shutil.which('node')), 'python': sys.version.split()[0], 'browser': str(browser)}
    import contextlib
    import os
    previous = Path.cwd()
    try:
        os.chdir(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
        with contextlib.redirect_stdout(sys.stderr):
            import execjs
            from desktop.native_platforms import create_native
            from desktop.result_store import ResultStore
            execjs.eval('1 + 1')
            for platform in PLATFORMS:
                create_native(platform, ResultStore(platform, 1, lambda *a, **kw: None))
        result['platform_modules'] = True
    except Exception as error:
        result['platform_modules'] = False
        result['dependency_error'] = type(error).__name__
    finally:
        os.chdir(previous)
    typer.echo(json.dumps(result))
    if not all((result['chromium'], result['node'], result['platform_modules'])):
        raise typer.Exit(1)


@app.command('install-browser')
def install_browser():
    from playwright.__main__ import main as playwright_main
    sys.argv = ['playwright', 'install', 'chromium']
    playwright_main()


def main():
    import os
    root = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
    if getattr(sys, 'frozen', False):
        from platformdirs import user_cache_path
        os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', str(user_cache_path('ms-playwright', appauthor=False)))
        os.environ['PATH'] = str(root / 'bin') + os.pathsep + os.environ.get('PATH', '')
    if sys.argv[1:3] == ['-u', '-m'] and len(sys.argv) == 4 and sys.argv[3] in ('desktop.worker', 'desktop.download_worker'):
        import runpy
        os.chdir(root)
        runpy.run_module(sys.argv[3], run_name='__main__')
        return
    if len(sys.argv) == 3 and sys.argv[1] == '_worker':
        from mediacrawler_cli.worker import main as worker
        worker(sys.argv[2])
    else:
        app()


if __name__ == '__main__':
    main()
