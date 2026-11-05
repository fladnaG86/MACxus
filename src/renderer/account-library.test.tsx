import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountGames, Cover, GameLaunchToolFields, GameTitle, HomePage, LibraryPagination, LibraryProductCard, StoreProductCard, Sidebar, type LibraryFilters } from './App';
import { I18nProvider } from './i18n';
import { defaultLaunchTools } from '../shared/launch-tools';
import { demoSnapshot } from '../shared/demo-data';
import type { AccountLibraryPage } from '../shared/types';

it('offers size information beside Install without adding size text to the library card', () => {
  const product: AccountLibraryPage['products'][number] = { productId: '9AAAAAAAAAAA', title: 'A game', access: 'owned', description: '', categories: [], installability: 'supported', supportNote: '', size: { downloadBytes: 1024 ** 3 } };
  const html = renderToStaticMarkup(<LibraryProductCard product={product} present={false} downloading={false} canInstall install={() => {}} />);
  expect(html).toContain('aria-label="Download and installed size for A game"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('aria-expanded="false"');
  const info = html.match(/<button[^>]*class="package-size-info"[^>]*>/)?.[0];
  expect(info).toContain('data-gamepad-card-options');
  expect(html.indexOf('class="package-size-info"')).toBeGreaterThan(html.indexOf('class="catalog-card-install"'));
  expect(html).not.toContain('About 1.0 GiB');
  expect(html).not.toContain('package-size compact');
});

it.each(['supported', 'unsupported', 'unknown'] as const)('uses the Store %s badge in Owned without enabling unsupported installs', installability => {
  const product: AccountLibraryPage['products'][number] = { productId: '9AAAAAAAAAAA', title: 'Owned & game', access: 'owned',
    description: '', categories: [], installability, supportNote: 'Package <reason>' };
  const html = renderToStaticMarkup(<LibraryProductCard product={product} present={false} downloading={false} canInstall install={() => {}} />);
  const store = renderToStaticMarkup(<StoreProductCard product={product} selected={false} disabled={installability !== 'supported'} label="Install" select={() => {}} install={() => {}} />);
  const badge = (text: string) => text.match(/<span class="catalog-support[^>]*>[\s\S]*?<\/span>/)?.[0];
  expect(badge(html)).toBe(badge(store));
  expect(html).toContain('<span>Owned</span>');
  expect(html.includes('disabled=""')).toBe(installability !== 'supported');
  expect(html).toContain('title="Package &lt;reason&gt;"');
  if (installability === 'unsupported') expect(html).toContain('>Unsupported</span>');
  if (installability !== 'supported') { expect(html).toContain('tabindex="0"'); expect(html).toContain('Action unavailable'); }
});

it('keeps one My Library and Store navigation, no separate Game Pass page',()=>{
  const html=renderToStaticMarkup(<Sidebar data={demoSnapshot()} page="library" go={()=>{}} />);
  expect(html).toContain('My Library'); expect(html).toContain('Store');
  expect(html).not.toContain('<span>Game Pass</span>');
});

it('counts waiting installations in the queue shortcut while a game is running', () => {
  const data = demoSnapshot();
  data.downloads = [{ ...data.downloads[0], status: 'running' }, { ...data.downloads[0], id: 'waiting', status: 'queued' }];
  const html = renderToStaticMarkup(<Sidebar data={data} page="library" go={() => {}} />);
  expect(html).toContain('Downloading (1/2)');
  expect(html).toContain('2 active installations');
});
it('restores the parent-owned filters after the library is recreated',()=>{
  const filters: LibraryFilters = { kind: 'owned', playState: 'installed', query: 'Edition' };
  const data=demoSnapshot(); data.auth={running:false,stored:false,note:''};
  const library=()=>renderToStaticMarkup(<AccountGames data={data} toast={()=>{}} filters={filters} onFiltersChange={()=>{}} />);
  for(const html of [library(),library()]) {
    expect(html).toContain('<option value="owned" selected="">');
    expect(html).toContain('<option value="installed" selected="">');
    expect(html).toContain('value="Edition"');
    expect(html).not.toContain('<option value="all" selected="">');
  }
});
it('offers Access and Play state filters without cloud streaming, preserving installed games offline',()=>{
  const data=demoSnapshot(); data.auth={running:false,stored:false,note:''};
  const html=renderToStaticMarkup(<AccountGames data={data} toast={()=>{}} />);
  expect(html).toContain('aria-label="Access"'); expect(html).toContain('In Game Pass'); expect(html).toContain('Owned');
  expect(html).toContain('aria-label="Play state"'); expect(html).toContain('Ready to install');
  expect(html).not.toContain('Cloud playable'); expect(html).toContain('Installed games remain available');
  expect(html).toContain(data.games[0].title);
  expect(html).not.toContain('Owned · Installed');
  expect(html).toContain(`title="${data.games[0].title}"`);
});

it('preserves full edition names in native hover tooltips and escapes special characters',()=>{
  const html=renderToStaticMarkup(<GameTitle title={'A Long Game Name: "Complete" & Deluxe Edition (PC)'} />);
  expect(html).toContain('title="A Long Game Name: &quot;Complete&quot; &amp; Deluxe Edition (PC)"');
});

it('uses Store box art instead of a package logo and wide artwork for details',()=>{
  const game={ ...demoSnapshot().games[0], coverDataUrl:'data:image/png;base64,AAAA', coverUrl:'https://store-images.s-microsoft.com/box', heroUrl:'https://store-images.s-microsoft.com/hero' };
  expect(renderToStaticMarkup(<Cover game={game} />)).toContain('src="https://store-images.s-microsoft.com/box"');
  expect(renderToStaticMarkup(<Cover game={game} variant="hero" />)).toContain('src="https://store-images.s-microsoft.com/hero"');
  expect(renderToStaticMarkup(<Cover game={{...game, coverUrl:undefined, heroUrl:undefined}} />)).toContain('cover-local');
});

it('uses wide Store art for the Home banner and never stretches a small package logo',()=>{
  const data=demoSnapshot();
  data.games=[{...data.games[0],coverDataUrl:'data:image/png;base64,SMALLLOGO',coverUrl:'https://store-images.s-microsoft.com/box',heroUrl:'https://store-images.s-microsoft.com/hero'}];
  const banner=()=>{const html=renderToStaticMarkup(<HomePage data={data} go={()=>{}} action={()=>{}} />);return html.slice(html.indexOf('<section class="spotlight'),html.indexOf('<div class="spotlight-copy"'));};
  expect(banner()).toContain('url(https://store-images.s-microsoft.com/hero)');
  expect(banner()).not.toContain('SMALLLOGO');
  data.games[0].heroUrl=undefined;
  expect(banner()).toContain('url(https://store-images.s-microsoft.com/box)');
  data.games[0].coverUrl=undefined;
  expect(banner()).not.toContain('--spotlight-art');
});

it('gives installed cards a separate status footer and an accessible compact refresh control',()=>{
  const html=renderToStaticMarkup(<AccountGames data={demoSnapshot()} toast={()=>{}} />);
  expect(html).toContain('class="catalog-card-status"');
  expect(html).toContain('aria-label="Refresh library"');
  expect(html).toContain('class="account-games-results"');
  expect(html).not.toContain('class="library-license"');
});

it('keeps pagination loading inside the button, without the oversized Store loading panel',()=>{
  const more=renderToStaticMarkup(<LibraryPagination loading={true} hasMore={true} load={()=>{}} />);
  expect(more).toContain('disabled'); expect(more).toContain('Loading games');
  expect(more).not.toContain('catalog-loading'); expect(more).not.toContain('library-loading');
  const initial=renderToStaticMarkup(<LibraryPagination loading={true} hasMore={false} load={()=>{}} />);
  expect(initial).toContain('role="status"'); expect(initial).not.toContain('catalog-loading');
  expect(renderToStaticMarkup(<LibraryPagination loading={false} hasMore={false} load={()=>{}} />)).toBe('');
});

it('shows account-wide search progress instead of asking to load more pages', () => {
  for (const loading of [false, true]) {
    const html = renderToStaticMarkup(<LibraryPagination loading={loading} hasMore searching load={() => {}} />);
    expect(html).toContain('Searching all library games');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Load more games');
  }
});

it('keeps installed-only and offline searches local and immediately available', () => {
  const data = demoSnapshot(); data.auth = { running: false, stored: false, note: '' };
  const html = renderToStaticMarkup(<AccountGames data={data} toast={() => {}}
    filters={{ kind: 'all', playState: 'installed', query: data.games[0].title }} />);
  expect(html).toContain(data.games[0].title);
  expect(html).not.toContain('Searching all library games');
  expect(html).not.toContain('No games match');
});

it('offers saved per-game overlay options and Steam-style environment and arguments',()=>{
  const html=renderToStaticMarkup(<GameLaunchToolFields value={{...defaultLaunchTools,mangoHud:true,gamescope:true,launchOptions:'PROTON_ENABLE_WAYLAND=1 %command% --launcher-skip'}} change={()=>{}} />);
  expect(html).toContain('Enable MangoHud'); expect(html).toContain('Run in gamescope');
  expect(html).toContain('Gamescope options'); expect(html).toContain('requires mangoapp');
  expect(html).toContain('Launch options'); expect(html).toContain('PROTON_ENABLE_WAYLAND=1 %command% --launcher-skip');
  expect(html).toContain('checked');
});

it.each(['supported', 'unsupported'] as const)('opens the detail page from a %s library product card, keeping the install button separate', installability => {
  const product: AccountLibraryPage['products'][number] = { productId: '9AAAAAAAAAAA', title: 'Detail game', access: 'gamepass',
    description: '', categories: [], installability, supportNote: 'Package note' };
  const html = renderToStaticMarkup(<LibraryProductCard product={product} present={false} downloading={false} canInstall install={() => {}} open={() => {}} />);
  expect(html).toMatch(/<button class="library-card catalog-card-main" data-gamepad-detail-target="9AAAAAAAAAAA">/);
  expect(html).toContain('class="catalog-card-install"');
  // The card button is always focusable, so the article never adds its own tab stop.
  expect(html).toContain('tabindex="-1"'); expect(html).not.toContain('Action unavailable');
});

it('on macOS offers the Metal HUD instead of the Linux-only MangoHud and gamescope', () => {
  const mac = renderToStaticMarkup(<GameLaunchToolFields value={{ ...defaultLaunchTools, metalHud: true }} change={() => {}} mac />);
  expect(mac).toContain('Show Metal performance HUD'); expect(mac).toContain('checked');
  for (const linuxOnly of ['MangoHud', 'gamescope', 'Tools must already be installed']) expect(mac).not.toContain(linuxOnly);
  const linux = renderToStaticMarkup(<GameLaunchToolFields value={defaultLaunchTools} change={() => {}} />);
  expect(linux).toContain('Enable MangoHud'); expect(linux).toContain('Run in gamescope'); expect(linux).not.toContain('Metal performance HUD');
});

it('offers offline play without anti-cheat only for EAC games, off by default', () => {
  const render = (antiCheat: boolean, enabled = false) => renderToStaticMarkup(<GameLaunchToolFields value={{ ...defaultLaunchTools, offlineWithoutAntiCheat: enabled }} change={() => {}} antiCheat={antiCheat} />);
  expect(render(false)).not.toContain('Play offline without anti-cheat');
  const off = render(true), on = render(true, true);
  expect(off).toContain('Play offline without anti-cheat');
  expect(off).toContain('online multiplayer and other protected features will not work');
  expect(off).not.toContain('checked');
  expect(on).toContain('checked');
});

it('offers DualSense compatibility per game, off by default and with feature limitations', () => {
  const render = (enabled: boolean) => renderToStaticMarkup(<GameLaunchToolFields value={{ ...defaultLaunchTools, dualSenseCompatibility:enabled }} change={() => {}} />);
  const off = render(false), on = render(true);
  expect(off).toContain('DualSense compatibility mode');
  expect(off).not.toContain('checked');
  expect(on).toContain('checked');
  expect(on).toContain('for this game only');
  expect(on).toContain('Does not change Xbox controller settings');
  expect(on).toContain('adaptive triggers may be unavailable');
});

it('offers DLSS only on macOS with its requirements and per-game state', () => {
  const render = (mac: boolean, dlss = false) => renderToStaticMarkup(<GameLaunchToolFields value={{ ...defaultLaunchTools, dlss }} change={() => {}} mac={mac} />);
  expect(render(false)).not.toContain('Enable DLSS');
  const off = render(true), on = render(true, true);
  expect(off).toContain('Enable DLSS (CrossOver)');
  expect(off).not.toContain('checked');
  expect(on).toContain('checked');
  expect(on).toContain('macOS Tahoe or newer for D3DMetal, Sonoma or newer for DXMT');
  expect(on).toContain('Also select DLSS in the game&#x27;s graphics settings');
  expect(on).toContain('Does not affect other engines');
});


it('explains the macOS launch-options contract without advertising custom wrappers', () => {
  const mac = renderToStaticMarkup(<GameLaunchToolFields value={defaultLaunchTools} change={() => {}} mac />);
  expect(mac).toContain('CX_GRAPHICS_BACKEND=dxmt %command% --launcher-skip');
  expect(mac).toContain('shell expansion and custom wrappers are unsupported');
  expect(mac).toContain('graphics support depends on the selected engine');
  expect(mac).not.toContain('NAME=value and wrappers before');
  const linux = renderToStaticMarkup(<GameLaunchToolFields value={defaultLaunchTools} change={() => {}} />);
  expect(linux).toContain('NAME=value and wrappers before');
});

it('offers a package-relative executable override on every platform and shows the stored value', () => {
  const html = renderToStaticMarkup(<GameLaunchToolFields value={{ ...defaultLaunchTools, executable: 'Binaries/WinGDK/Game-WinGDK-Shipping.exe' }} change={() => {}} mac />);
  expect(html).toContain('Custom executable');
  expect(html).toMatch(/<input[^>]*value="Binaries\/WinGDK\/Game-WinGDK-Shipping\.exe"/);
  expect(renderToStaticMarkup(<GameLaunchToolFields value={defaultLaunchTools} change={() => {}} />)).toContain('Custom executable');
});


it('offers the FH5 pack only for its Store identity on macOS', () => {
  const render = (storeId?: string, mac = true, enabled = false) => renderToStaticMarkup(<GameLaunchToolFields value={{ ...defaultLaunchTools, fh5PreviewCompatibility: enabled }} change={() => {}} storeId={storeId} mac={mac} />);
  for (const storeId of [undefined, '9PN198B459VB', '9NKV34XDW014', 'Forza Horizon 5', '9NNX1VVR3KNQ-extra']) {
    expect(render(storeId)).not.toContain('FH5 Preview compatibility pack');
    expect(render(storeId, true, true)).not.toContain('FH5 Preview compatibility pack');
  }
  expect(render('9NNX1VVR3KNQ')).toContain('FH5 Preview compatibility pack');
  expect(render('9nnx1vvr3knq', true, true)).toContain('checked');
  expect(render('9NNX1VVR3KNQ', false)).not.toContain('FH5 Preview compatibility pack');
});

it('shows the untested FH5 hardware warning in both languages before enabling the pack', () => {
  const render = (language: 'en' | 'it', storeId = '9NNX1VVR3KNQ') => renderToStaticMarkup(<I18nProvider language={language}><GameLaunchToolFields value={defaultLaunchTools} change={() => {}} storeId={storeId} mac /></I18nProvider>);
  expect(render('en')).toContain('Only M5 Max has been game-tested.');
  expect(render('en')).toContain('experimental and untested');
  expect(render('en')).toContain('M3 or newer with macOS 26+');
  expect(render('it')).toContain('Solo M5 Max è stato provato nel gioco.');
  expect(render('it')).toContain('sperimentali e non provati');
  expect(render('en', '9PN198B459VB')).not.toContain('experimental and untested');
});
