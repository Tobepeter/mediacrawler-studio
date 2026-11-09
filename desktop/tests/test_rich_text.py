from desktop.content.rich_text import to_markdown, to_plain


def test_markdown_keeps_blocks_and_decodes_entities():
    text = to_markdown('<h2>标题</h2><p>一 &#34;二&#34;</p><ul><li>甲</li><li>乙</li></ul><blockquote>引</blockquote>')
    assert '## 标题' in text and '一 "二"' in text and '- 甲' in text and '> 引' in text


def test_markdown_uses_real_image_and_drops_lazy_copies():
    html = '''<figure><noscript><img src="https://p/a.jpg"/></noscript>
    <img src="data:image/svg+xml;utf8,x" data-original="https://p/a_r.jpg" alt="x"/></figure>'''
    text = to_markdown(html)
    assert text.count('![') == 1 and 'https://p/a_r.jpg' in text and 'data:' not in text


def test_markdown_drops_images_without_https_source():
    assert '![' not in to_markdown('<p>字</p><img src="data:image/png;base64,x"/>')


def test_markdown_keeps_code_language_and_math():
    text = to_markdown('<pre lang="python"><code>a = 1</code></pre><p><span class="ztext-math" data-tex="x^2">x</span></p>')
    assert '```python' in text and 'x^2' in text


def test_plain_breaks_blocks_not_inline():
    assert to_plain('<p>一<b>二</b>三</p><p>四<br/>五</p>') == '一二三\n四\n五'


def test_empty_html():
    assert to_markdown('') == '' and to_plain(None) == ''
