"""平台原生实现注册，所有页面使用 Electron 持久化分区"""
from importlib import import_module

PLATFORMS = {
    'bili': ('bilibili', 'BilibiliCrawler', 'BiliStoreFactory', 'create_bilibili_client', 'bili_client'),
    'dy': ('douyin', 'DouYinCrawler', 'DouyinStoreFactory', 'create_douyin_client', 'dy_client'),
    'xhs': ('xhs', 'XiaoHongShuCrawler', 'XhsStoreFactory', 'create_xhs_client', 'xhs_client'),
    'zhihu': ('zhihu', 'ZhihuCrawler', 'ZhihuStoreFactory', 'create_zhihu_client', 'zhihu_client'),
    'wb': ('weibo', 'WeiboCrawler', 'WeibostoreFactory', 'create_weibo_client', 'wb_client'),
    'tieba': ('tieba', 'TieBaCrawler', 'TieBaStoreFactory', 'create_tieba_client', 'tieba_client'),
    'ks': ('kuaishou', 'KuaishouCrawler', 'KuaishouStoreFactory', 'create_ks_client', 'ks_client'),
}


def create_native(platform, store):
    module, crawler, factory, create, attr = PLATFORMS[platform]
    instance = getattr(import_module(f'media_platform.{module}.core'), crawler)()
    getattr(import_module(f'store.{module}'), factory).STORES['studio'] = lambda: store
    return instance, create, attr
