"""下载入口适配，传输由桌面共用下载服务完成"""
from pathlib import Path

from desktop.media_download import download_record
from desktop.paging import CreatorError


async def transcribe_records(records, emit, runner=None):
    from desktop.transcribe import transcribe_result
    results = []
    for record in records:
        result = {**await transcribe_result({'record': record, 'runner': runner}, emit, runner.page if runner else None), 'id': record['id']}
        results.append(result)
        emit('item', item=result)
        if result['code']:
            emit('warning', code=result['code'])
    return results


async def download_records(request, records, emit, runner=None):
    if request.get('transcribe'):
        return await transcribe_records(records, emit, runner)
    results = []
    for index, record in enumerate(records, 1):
        try:
            result = await download_record({
                'record': record, 'kind': request.get('kind', 'auto'),
                'directory': str(Path(request['download_dir']) / f'{index:03d}'),
                'runner': runner, 'quality': request.get('quality', 'best'),
                'variant_id': request.get('variant_id'), 'report_files': True,
            }, emit, runner.page if runner else None)
            result['id'] = record['id']
        except CreatorError:
            # 节流和验证要带上 retry_after 交给统一的错误出口
            raise
        except RuntimeError as error:
            code = str(error)
            result = {'id': record['id'], 'saved': 0, 'files': [], 'code': code if code in (
                'quality_unavailable', 'audio_unavailable', 'ffmpeg_required', 'unsupported', 'login', 'unavailable') else 'download_failed'}
        results.append(result)
        emit('item', item={**result, 'id': record['id']})
        if result.get('code'):
            emit('warning', code=result['code'])
    return results
