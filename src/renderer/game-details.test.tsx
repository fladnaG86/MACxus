import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { formatMinutes, GameDetailsContent, Gallery } from './GameDetails';
import type { GameActivity, GameStoreDetails } from '../shared/types';
const game=demoSnapshot().games[0];
const details: GameStoreDetails={productId:game.storeId!,title:game.title,description:'<script>literal text</script>',publisher:'Example publisher',categories:['Strategy','Card & board'],screenshots:['https://store-images.s-microsoft.com/example'],releaseDate:'invalid'};
const render=(activity: GameActivity, data: GameStoreDetails|undefined=details)=>renderToStaticMarkup(<GameDetailsContent game={game} details={data} activity={activity} play={<button>Play</button>} manage={<button>Manage content</button>} back={()=>{}} refresh={()=>{}} />);
it.each([[undefined,'Unavailable'],[NaN,'Unavailable'],[-1,'Unavailable'],[0,'0 min'],[0.5,'&lt;1 min'],[12,'12 min'],[60,'1 h'],[2052,'34 h 12 min']] as const)('formats remote minutes %s as %s', (minutes,expected)=>{
  expect(renderToStaticMarkup(<span>{formatMinutes(minutes)}</span>)).toContain(expected);
});
it('renders real metadata as escaped text and gallery thumbnails, never executable HTML',()=>{
  const html=render({status:'available',minutesPlayed:2052,lastPlayed:'2026-01-01T12:00:00Z'});
  expect(html).toContain('34 h 12 min'); expect(html).toContain('From Xbox'); expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;literal text&lt;/script&gt;');
  expect(html).toContain('Card &amp; board'); expect(html).toContain('Open screenshot 1'); expect(html).not.toContain('Invalid Date'); expect(html).toContain('data-gamepad-detail-back');
  expect(html).toContain('data-gamepad-action-row'); expect(html).not.toContain('data-game-menu');
});
it.each(['unavailable','unsupported','signed-out','error'] as const)('never displays a fabricated zero for %s',status=>{
  const html=render({status},undefined); expect(html).toContain('Unavailable'); expect(html).not.toContain('>0 min<'); expect(html).not.toContain('Sample data');
});
it('shows a not-installed game with its own status and action, without a Manage menu',()=>{
  const html=renderToStaticMarkup(<GameDetailsContent game={game} details={details} activity={{status:'unavailable'}} status={<span className="gd-ready not-installed">Not installed</span>} play={<button>Install</button>} back={()=>{}} refresh={()=>{}} />);
  expect(html).toContain('gd-ready not-installed'); expect(html).not.toContain('>Installed<');
  expect(html).toContain('>Install</button>'); expect(html).not.toContain('More game actions'); expect(html).toContain('About the game');
});
it('does not present missing screenshots or failed metadata as an installation blocker',()=>{
  const html=render({status:'unavailable'},{...details,screenshots:[],description:''});
  expect(html).toContain('No screenshots available'); expect(html).toContain('>Play</button>'); expect(html).not.toContain('Open screenshot');
});
it('uses the shared secondary close button and advertises scoped gallery controller shortcuts',()=>{
  const html=renderToStaticMarkup(<Gallery title="Example" images={details.screenshots} initial={0} close={()=>{}} />);
  expect(html).toContain('class="secondary gd-gallery-close"');
  expect(html).toContain('data-gamepad-cancel'); expect(html).toContain('data-gamepad-gallery=""');
  expect(html).toContain('data-gamepad-gallery-previous'); expect(html).toContain('data-gamepad-gallery-next');
  for (const key of ['B','L1','R1']) expect(html).toContain(`aria-hidden="true">${key}</span>`);
  expect(html).toContain('aria-live="polite"'); expect(html).not.toContain('icon-button');
});
