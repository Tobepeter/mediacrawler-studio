"""有界网络抽样；吞吐量仅代表测试节点，不能单独判定平台改版"""
import asyncio
import ipaddress
import json
import socket
import threading
from datetime import datetime, timezone
from statistics import mean, median
from time import monotonic
from urllib.parse import urlparse

import httpx
import psutil
from desktop.health import POLICY, classify, failure

REFERENCES = ('https://www.baidu.com', 'https://www.qq.com')


def local_network():
    interfaces = []
    addresses = psutil.net_if_addrs()
    for name, stats in psutil.net_if_stats().items():
        if not stats.isup or 'loopback' in getattr(stats, 'flags', ''):
            continue
        if any(addr.family in (socket.AF_INET, socket.AF_INET6)
               and not ipaddress.ip_address(addr.address.split('%')[0]).is_loopback
               for addr in addresses.get(name, [])):
            interfaces.append(name)
    # UDP connect 只查询路由，不发包，不等同于外网可达
    route = 'unknown'
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(('1.1.1.1', 443))
            route = 'available'
    except OSError:
        pass
    return {'status': 'connected' if interfaces else 'offline', 'interfaces': interfaces,
            'ipv4_route': route, 'internet': 'unknown'}


async def dns_probe(host):
    started = monotonic()
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    def resolve():
        try:
            socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            result = {'status': 'ok'}
        except OSError:
            result = {'status': 'failed', 'code': 'DNS_FAILED'}
        def deliver():
            if not future.done():
                future.set_result(result)
        try:
            loop.call_soon_threadsafe(deliver)
        except RuntimeError:
            pass
    # 系统 DNS 阻塞不能延长诊断截止时间或阻止进程退出
    threading.Thread(target=resolve, daemon=True).start()
    try:
        result = await asyncio.wait_for(future, POLICY['probe_timeout_ms'] / 1000)
    except TimeoutError:
        result = {'status': 'failed', 'code': 'TIMEOUT'}
    return {**result, 'duration_ms': round((monotonic() - started) * 1000), 'resolver': 'system'}


async def probe(client, url):
    host = urlparse(url).hostname
    started = monotonic()
    async def http():
        try:
            async with asyncio.timeout(POLICY['probe_timeout_ms'] / 1000):
                async with client.stream('GET', url) as response:
                    return {'status': 'ok' if response.status_code < 400 else 'failed',
                            'status_code': response.status_code, 'reachable': True,
                            'error': failure('ACCESS_RESTRICTED' if response.status_code in (403, 429) else 'HTTP_ERROR', 'http', status_code=response.status_code) if response.status_code >= 400 else None,
                            'duration_ms': round((monotonic() - started) * 1000)}
        except Exception as error:
            return {'status': 'failed', 'reachable': False, 'error': classify(error, 'http'),
                    'duration_ms': round((monotonic() - started) * 1000)}
    dns, result = await asyncio.gather(dns_probe(host), http())
    return {'host': host, 'dns': dns, 'http': result, 'transport': 'python_httpx_env_proxy'}


async def speed_probe(client):
    samples = []
    remaining = POLICY['speed_max_bytes']
    deadline = monotonic() + POLICY['speed_timeout_ms'] / 1000
    # 南大公开 CLI 节点配置；Cloudflare 作为独立参考，不声称代表国内线路
    targets = []
    try:
        async with asyncio.timeout(2):
            payload = bytearray()
            async with client.stream('GET', 'https://speed.nju.edu.cn/cli.json') as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload) > 65536:
                        raise ValueError('Node list too large')
            for node in json.loads(payload)[:1]:
                base = node['server']
                if base.startswith('//'):
                    base = 'https:' + base
                url = base.rstrip('/') + '/' + node['dlURL'].lstrip('/')
                if urlparse(url).scheme == 'https' and urlparse(url).hostname.endswith('.nju.edu.cn'):
                    targets.append(('nju', url))
    except Exception:
        samples.append({'node': 'nju', 'status': 'unavailable', 'code': 'NODE_DISCOVERY_FAILED'})
    targets.append(('cloudflare', 'https://speed.cloudflare.com/__down?bytes=10000000'))
    for name, url in targets:
        size = 0
        started = monotonic()
        body_started = None
        budget = min(4, deadline - started)
        if budget <= 0 or remaining <= 0:
            break
        code = None
        try:
            async with asyncio.timeout(budget):
                async with client.stream('GET', url, headers={'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache'}) as response:
                    response.raise_for_status()
                    body_started = monotonic()
                    async for chunk in response.aiter_raw(chunk_size=65536):
                        take = min(len(chunk), remaining)
                        size += take
                        remaining -= take
                        if remaining <= 0:
                            break
        except Exception as error:
            code = classify(error, 'speed')['code']
        duration = monotonic() - (body_started or started)
        valid = size >= 65536 and duration >= 0.1 and code in (None, 'TIMEOUT')
        samples.append({'node': name, 'status': 'ok' if valid else 'insufficient',
                        'bytes': size, 'duration_ms': round(duration * 1000),
                        'mbps': round(size * 8 / duration / 1e6, 2) if valid else None, 'code': code})
    rates = [s['mbps'] for s in samples if s.get('mbps') is not None]
    return {'status': 'ok' if rates else 'unavailable', 'scope': 'sampled_routes',
            'mean_mbps': round(mean(rates), 2) if rates else None,
            'median_mbps': round(median(rates), 2) if rates else None,
            'successful_samples': len(rates), 'samples': samples,
            'confidence': 'limited' if len(rates) < 2 else 'reference'}


async def diagnose_network(platform_urls=(), speed=True):
    report = {'type': 'network', 'checked_at': datetime.now(timezone.utc).isoformat(),
              'policy': POLICY, 'local': local_network(), 'targets': [],
              'speed': {'status': 'skipped'}}
    started = monotonic()
    try:
        async with asyncio.timeout(POLICY['network_timeout_ms'] / 1000):
            async with httpx.AsyncClient(timeout=4, follow_redirects=True) as client:
                urls = list(dict.fromkeys((*REFERENCES, *platform_urls)))
                report['targets'] = await asyncio.gather(*(probe(client, url) for url in urls))
                if speed:
                    report['speed'] = await speed_probe(client)
        report['status'] = 'ok' if all(t['http']['status'] == 'ok' for t in report['targets']) and (not speed or report['speed']['status'] == 'ok') else 'partial'
    except Exception as error:
        report['status'] = 'partial'
        report['error'] = classify(error, 'network')
    if any(t['http'].get('reachable') for t in report['targets']):
        report['local']['internet'] = 'reachable'
    if report['local']['status'] == 'offline' and report['local']['internet'] != 'reachable':
        report['error'] = failure('NETWORK_OFFLINE', 'network')
    report['duration_ms'] = round((monotonic() - started) * 1000)
    return report
