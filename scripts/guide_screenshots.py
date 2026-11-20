"""Regenerate the screenshots in public/guide/ from a running dev server.

Usage: npm run dev (in another terminal), then python scripts/guide_screenshots.py [base_url]
Needs: pip install playwright && playwright install chromium
The Run screenshot needs Python to start in the browser. Without network access to jsDelivr, unpack a Pyodide 0.29.5
release and set PYODIDE_DIST to its pyodide/ folder; requests to the CDN are then answered from there.
"""
import mimetypes
import os
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/') + '?nochooser'
TPL = lambda name: f"__bw.loadTemplate(__bw.TEMPLATES.findIndex(t => t.name.startsWith({json.dumps(name)})))"
OUT = Path(__file__).resolve().parent.parent / 'public' / 'guide'
OUT.mkdir(exist_ok=True)
AI_PLAN = {
    'summary': 'Loads the demo mast, takes the 80 m north speed and 78 m direction, and plots monthly means and a frequency rose.',
    'nodes': [
        {'key': 'src', 'tool': 'Demo dataset', 'params': {'dataset': "'demo_data'"}},
        {'key': 'load', 'tool': 'load_csv'},
        {'key': 'spd', 'tool': 'Select column', 'params': {'column': "'Spd80mN'"}},
        {'key': 'dir', 'tool': 'Select column', 'params': {'column': "'Dir78mS'"}},
        {'key': 'mm', 'tool': 'monthly_means', 'var': 'monthly_80m'},
        {'key': 'rose', 'tool': 'freq_table', 'var': 'rose_80m'}],
    'edges': [{'from': 'src.path', 'to': 'load.filepath_or_folder'}, {'from': 'load.data', 'to': 'spd.data'},
              {'from': 'load.data', 'to': 'dir.data'}, {'from': 'spd.series', 'to': 'mm.data'},
              {'from': 'spd.series', 'to': 'rose.var_series'}, {'from': 'dir.series', 'to': 'rose.direction_series'}],
}


def shot(page, name):
    page.wait_for_timeout(250)
    page.screenshot(path=str(OUT / f'{name}.jpg'), type='jpeg', quality=80)
    print('wrote', name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 1360, 'height': 780}, color_scheme='light')
    if os.environ.get('PYODIDE_DIST'):
        dist, cdn = Path(os.environ['PYODIDE_DIST']), 'https://cdn.jsdelivr.net/pyodide/v0.29.5/full/'
        def serve(route):
            name = route.request.url[len(cdn):].split('?')[0]
            ct = 'application/wasm' if name.endswith('.wasm') else (mimetypes.guess_type(name)[0] or 'application/octet-stream')
            route.fulfill(status=200, body=(dist / name).read_bytes(), headers={'content-type': ct, 'access-control-allow-origin': '*'})
        context.route(cdn + '**', serve)
    page = context.new_page()
    page.goto(BASE)
    page.wait_for_function('window.__bw && window.__bw.ai')
    page.evaluate('localStorage.clear()')
    page.evaluate("__bw.setLibs(['bw'])")
    page.evaluate('__bw.loadTemplate(1)')
    page.click('.node:has(.tt:text-is("Shear.Average")) .nh')
    shot(page, 'overview')

    page.evaluate('__bw.loadTemplate(0)')
    page.click('.node:has(.tt:text-is("monthly_means")) .nh')
    port = page.locator('.node:has(.tt:text-is("load_csv")) .port.out[data-port="data"]').bounding_box()
    page.mouse.move(port['x'] + 6, port['y'] + 6)
    page.mouse.down()
    page.mouse.move(port['x'] + 120, port['y'] + 90, steps=6)
    shot(page, 'wiring')
    page.mouse.up()

    page.click('.node:has(.tt:text-is("export_tab_file")) .nh')
    shot(page, 'inspector')

    page.click('#vCode')
    shot(page, 'python')
    page.click('#vCanvas')

    page.evaluate('__bw.loadTemplate(0)')
    page.click('#vRun')
    page.click('#runGo')
    page.wait_for_function('!__bw.RUN.busy && __bw.RUN.results.length', timeout=600000)
    page.evaluate("document.querySelectorAll('.rs-step-hide').forEach(e => e.remove())")
    page.evaluate("document.querySelector('#runBody').scrollTop = 0")
    shot(page, 'run')
    page.click('#vCanvas')

    # windkit: the library choice, a mixed pipeline, and an interactive figure from a run
    page.evaluate('__bw.chooseLibs(true)')
    shot(page, 'libraries')
    page.keyboard.press('Escape')
    page.evaluate(TPL('brightwind + windkit'))
    page.evaluate("__bw.S.view = {x: -560, y: 40, k: 0.82}; document.querySelector('#world').style.transform = 'translate(-560px, 40px) scale(0.82)'")
    page.click('.node:has(.tt:text-is("tswc_from_dataframe")) .nh')
    shot(page, 'windkit')
    page.evaluate(TPL('windkit: wind climate'))
    page.click('#vRun')
    page.click('#runGo')
    page.wait_for_function('!__bw.RUN.busy && __bw.RUN.results.length', timeout=600000)
    page.wait_for_function('document.querySelector(".rs-plotly .main-svg")', timeout=60000)
    page.evaluate("document.querySelector('.rs-plotly').closest('.run-step').scrollIntoView({block: 'start'})")
    shot(page, 'windkit-run')
    page.click('#vCanvas')
    page.evaluate("__bw.setLibs(['bw'])")

    page.route('**/api.anthropic.com/**', lambda route: route.fulfill(status=200, headers={'access-control-allow-origin': '*'}, json={
        'id': 'm', 'type': 'message', 'role': 'assistant', 'stop_reason': 'tool_use',
        'content': [{'type': 'tool_use', 'id': 't1', 'name': 'build_pipeline', 'input': AI_PLAN}]}))
    page.click('#aiBtn')
    page.fill('#aiKey', 'sk-ant-example')
    page.click('#aiSetup summary')
    page.uncheck('#aiEdit')
    page.fill('#aiPrompt', 'Monthly means and a frequency rose of the 80 m north anemometer on the demo mast')
    page.click('#aiGo')
    page.wait_for_function('document.querySelector("#aiStop").hidden')
    page.evaluate('localStorage.clear()')
    shot(page, 'assistant')

    phone = browser.new_page(viewport={'width': 390, 'height': 760}, has_touch=True, is_mobile=True, color_scheme='light')
    phone.goto(BASE)
    phone.wait_for_function('window.__bw')
    phone.evaluate('localStorage.clear()')
    phone.evaluate('__bw.loadTemplate(0)')
    phone.wait_for_timeout(300)
    phone.screenshot(path=str(OUT / 'phone.jpg'), type='jpeg', quality=80)
    print('wrote phone')
    browser.close()
