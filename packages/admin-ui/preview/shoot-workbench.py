"""Capture the workbench at its real viewport sizes, without changing the layout."""
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


VIEWS = (
    # File name, activity button title, and a populated section in the active pane.
    ('inbox', 'Needs you', '.aw-inbox .aw-row'),
    ('board', 'Board', '.aw-board .aw-card'),
    ('list', 'All work', '.aw-table tbody tr'),
    ('marketing', 'Marketing', 'text=Autopilot'),
    ('seo', 'SEO', 'text=Guide coverage'),
    ('fleet', 'Fleet', '.aw-node'),
    ('clients', 'Clients', '.aw-directory__open'),
    ('settings', 'Settings', '.aw-settings .aw-panel'),
)
UNKNOWN_PREFIX = '[workbench-preview] Unknown API:'
OUT = Path(os.environ.get('AW_SHOTS', '/tmp/aw-shots'))


def capture(browser, base, theme, viewport, narrow, diagnostics, paths):
    scope = f'{theme}/narrow' if narrow else theme
    ctx = browser.new_context(viewport=viewport, color_scheme=theme, reduced_motion='reduce')
    # Every run starts from an empty tab/sidebar state, including narrow passes.
    ctx.add_init_script('try { localStorage.clear(); } catch {}')
    ctx.route(re.compile(r'^https?://'), lambda route: route.abort())
    page = ctx.new_page()
    page.set_default_timeout(10_000)
    page.on('pageerror', lambda error: diagnostics['Page errors'].add(f'{scope}: {error}'))

    def console(message):
        if message.text.startswith(UNKNOWN_PREFIX):
            diagnostics['Unknown API paths'].add(message.text[len(UNKNOWN_PREFIX):].strip())
        elif message.type == 'error':
            diagnostics['Console errors'].add(f'{scope}: {message.text}')

    page.on('console', console)
    activity = page.locator('.aw-activity')
    pane = page.locator('.aw-pane:not([hidden])')
    explorer = page.get_by_role('complementary', name='Explorer')
    loading = re.compile(r'^(Loading(?:\s.*)?(?:…|\.{3})|Running the checks…)$')

    def shot(name, ready):
        ready.wait_for(state='visible')
        expect(pane.get_by_text(loading).filter(visible=True)).to_have_count(0)
        expect(page.locator('.aw-toast.is-error, .aw-status__err')).to_have_count(0)
        page.evaluate('document.fonts.ready')
        # Let layout settle and move off the last button so hover UI is not baked in.
        page.mouse.move(0, 0)
        page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        dst = OUT / theme / f'{name}{"-narrow" if narrow else ""}.png'
        page.screenshot(path=str(dst), animations='disabled')
        paths.append(dst)

    def view(name, label, marker):
        button = activity.get_by_title(label, exact=True)
        button.click()
        expect(button).to_have_attribute('aria-pressed', 'true')
        shot(name, pane.locator(marker).first)

    def ticket():
        # Open via the real ticket link in the explorer without assuming fixture IDs.
        explorer.locator('.aw-tree__leaf[title]').first.click()
        shot('ticket', pane.locator('.aw-ticket__head h2'))

    try:
        page.goto(f'{base}?theme={theme}')
        if narrow:
            view(*VIEWS[1])
            ticket()
            return

        for entry in VIEWS:
            view(*entry)
            if entry[0] == 'marketing':
                marketing = pane.locator('.aw-mk')
                for tab, marker in (
                    ('Contacts', 'button:has-text("Open")'),
                    ('Email', 'text=Recent events'),
                    ('Posts', 'text=Scheduled'),
                    ('Sequences', 'text=How each sequence is doing'),
                    ('Sources', 'th:has-text("Reached")'),
                    ('Settings', 'text=Schedule and volume'),
                ):
                    marketing.get_by_role('tab', name=tab, exact=True).click()
                    shot(f'marketing-{tab.lower()}', marketing.locator(marker).first)
                # The settings sub-groups stay a segmented filter inside the section.
                for group, marker in (('Safety', 'text=Review first emails'), ('Content', 'text=How publishing works')):
                    marketing.get_by_role('radio', name=group, exact=True).click()
                    shot(f'marketing-settings-{group.lower()}', marketing.locator(marker).first)
        # Every SEO tab, on the same page: the tab strip is the only change.
        activity.get_by_title('SEO', exact=True).click()
        shot('seo', pane.get_by_text('Guide coverage').first)
        desk = pane.get_by_role('tablist', name='SEO desk section')
        for name, label, marker in (
            ('seo-audit-pages', 'Audit', '.aw-seo-pages tbody tr'),
            ('seo-answers', 'AI answers', '.aw-seo-chart'),
            ('seo-ranks', 'Rankings', '.aw-seo-ranks tbody tr'),
            ('seo-citations', 'Citations', '.aw-seo-citations tbody tr'),
            ('seo-settings', 'Settings', 'text=Buyer questions'),
        ):
            desk.get_by_role('tab', name=label, exact=True).click()
            shot(name, pane.locator(marker).first)
        desk.get_by_role('tab', name='Audit', exact=True).click()
        pane.get_by_role('radio', name='Per finding', exact=True).click()
        shot('seo-audit-findings', pane.locator('.aw-table tbody tr').first)
        desk.get_by_role('tab', name='Overview', exact=True).click()
        ticket()
        # The project destination: Overview leads with needs-attention rows;
        # the world map sits behind Show map (collapsed by default).
        explorer.locator('.aw-tree__name').first.click()
        shot('project', pane.get_by_role('region', name='Needs attention'))
        pane.get_by_role('button', name='Show map').click()
        shot('project-map', pane.locator('.aw-world'))
        tabs = pane.get_by_role('tablist', name='Project sections')
        tabs.get_by_role('tab', name='Work', exact=True).click()
        shot('project-work', pane.get_by_role('heading', name='Project work'))
        tabs.get_by_role('tab', name='Setup', exact=True).click()
        shot('project-setup', pane.locator('.aw-psol'))
        activity.get_by_title('Clients', exact=True).click()
        pane.locator('.aw-directory__open').first.click()
        shot('client', pane.locator('h2').first)

        activity.get_by_title('New task (N)', exact=True).click()
        modal = page.get_by_role('dialog', name='New task', exact=True)
        shot('new-task', modal)
        page.keyboard.press('Escape')
        modal.wait_for(state='hidden')
        page.keyboard.press('Meta+k' if sys.platform == 'darwin' else 'Control+k')
        shot('palette', page.get_by_role('dialog', name='Command palette'))
    finally:
        ctx.close()


def main():
    base, *themes = sys.argv[1:]
    diagnostics = {name: set() for name in ('Page errors', 'Console errors', 'Unknown API paths', 'Capture failures')}
    paths = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel='chrome', headless=True)
            for theme in themes:
                for width, height in ((1440, 900), (1000, 700)):
                    try:
                        capture(browser, base, theme, {'width': width, 'height': height}, width == 1000, diagnostics, paths)
                    except Exception as error:
                        diagnostics['Capture failures'].add(f'{theme} {width}×{height}: {error}')
            browser.close()
    finally:
        print(f'PNG paths ({len(paths)}):')
        for path in paths:
            print(f'  {path}')
        for label, values in diagnostics.items():
            print(f'{label}:')
            for value in sorted(values) or ['none']:
                print(f'  {value}')
    return int(any(diagnostics[name] for name in ('Page errors', 'Console errors', 'Capture failures')))


if __name__ == '__main__':
    sys.exit(main())
