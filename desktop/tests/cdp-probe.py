import asyncio
import json
import sys
from playwright.async_api import async_playwright
from desktop.page_context import PageContext

async def main():
    request = json.loads(sys.stdin.readline())
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(request['endpoint'], timeout=5000)
        found = {}
        for context in browser.contexts:
            for page in context.pages:
                cdp = await context.new_cdp_session(page)
                info = await cdp.send('Target.getTargetInfo')
                target = info['targetInfo']['targetId']
                for platform, target_id in request['targets'].items():
                    if target == target_id:
                        cookies = await PageContext(page, cdp).cookies([request['origin']])
                        marker = next((c['value'] for c in cookies if c['name'] == 'studio_test'), None)
                        local = await page.evaluate('localStorage.getItem("studio_test")')
                        assert marker == platform, f'cookie partition mismatch: {platform}'
                        assert local == platform, f'localStorage partition mismatch: {platform}'
                        found[platform] = True
                await cdp.detach()
        assert len(found) == 2, 'missing platform targets'
        print(json.dumps({'targets': found, 'cookieIsolation': True, 'localStorageIsolation': True}))

asyncio.run(main())
