"""知乎等平台的正文是 HTML：纯文本给卡片、复制和导出，Markdown 给详情阅读"""
import re

from bs4 import BeautifulSoup
from markdownify import MarkdownConverter

from desktop.paging import https_url

BLOCKS = ('p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'figcaption', 'tr', 'hr')


def real_image(tag):
    # 知乎的 src 常是懒加载占位图，真实地址在 data-* 上
    value = tag.get('data-original') or tag.get('data-actualsrc') or tag.get('src') or ''
    value = https_url(value)
    return value if value.startswith('https://') else ''


def parse(html):
    soup = BeautifulSoup(html, 'html.parser')
    # 懒加载图片在 noscript 里还有一份，留着会重复
    for tag in soup.find_all(['noscript', 'script', 'style']):
        tag.decompose()
    for tag in soup.find_all(class_='ztext-math'):
        tag.replace_with(soup.new_string(tag.get('data-tex') or tag.get_text()))
    return soup


def code_language(tag):
    if tag.get('lang'):
        return tag['lang']
    code = tag.find('code')
    match = re.search(r'language-([\w+-]+)', ' '.join(code.get('class') or [])) if code else None
    return match.group(1) if match else None


def to_markdown(html):
    if not html:
        return ''
    soup = parse(html)
    for tag in soup.find_all('img'):
        src = real_image(tag)
        if src:
            tag.attrs = {'src': src}
        else:
            tag.decompose()
    text = MarkdownConverter(heading_style='ATX', bullets='-', code_language_callback=code_language).convert_soup(soup)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def to_plain(html):
    if not html:
        return ''
    soup = parse(html)
    for tag in soup.find_all('br'):
        tag.replace_with('\n')
    for tag in soup.find_all(BLOCKS):
        tag.append('\n')
    lines = (line.strip() for line in soup.get_text().splitlines())
    return '\n'.join(line for line in lines if line)
