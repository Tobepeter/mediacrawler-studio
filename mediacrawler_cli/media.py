"""兼容原 CLI 媒体入口，实现由桌面与 CLI 共用"""
from desktop.content.media import enrich, fetch, number, selection, variants

__all__ = ['enrich', 'fetch', 'number', 'selection', 'variants']
