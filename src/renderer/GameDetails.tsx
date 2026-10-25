import { translate, type Translator } from '../shared/i18n';
import { useI18n } from './i18n';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clock3, Gamepad2, Images, LoaderCircle, MoreHorizontal, RefreshCw, X } from 'lucide-react';
import type { AppSnapshot, Game, GameActivity, GameStoreDetails } from '../shared/types';
import './game-details.css';
import { Achievements } from './Achievements';

export function formatMinutes(minutes?: number, t: Translator = translate.bind(null, 'en')): string {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return t("Unavailable");
  if (minutes === 0) return '0 min';
  if (minutes < 1) return '<1 min';
  const hours = Math.floor(minutes / 60), remainder = Math.floor(minutes % 60);
  return hours ? `${hours} h${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`;
}

function activityNote(activity: GameActivity | undefined, t: Translator): string {
  switch (activity?.status) {
    case 'signed-out': return t("Sign in to view Xbox activity.");
    case 'unsupported': return t("Update the backend to read Xbox activity.");
    case 'error': return t("Xbox activity could not be loaded. Try refreshing.");
    case 'unavailable': return t("Xbox has no activity available for this game.");
    default: return activity?.partial ? t("Some Xbox activity could not be retrieved.") : t("From Xbox");
  }
}

function Artwork({ src, alt, ...props }: { src?: string; alt: string; className?: string; loading?: 'lazy' }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img src={src} alt={alt} {...props} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="gd-artwork-unavailable"><Gamepad2 /><span>{alt || t("Artwork unavailable")}</span></span>;
}

export function Gallery({ title, images, initial, close }: { title: string; images: string[]; initial: number; close: () => void }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(initial);
  const ref = useRef<HTMLElement>(null), onClose = useRef(close); onClose.current = close;
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    ref.current?.querySelector<HTMLButtonElement>('[data-gamepad-cancel]')?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose.current(); }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setIndex(i => (i + (event.key === 'ArrowRight' ? 1 : images.length - 1)) % images.length); }
      if (event.key === 'Tab') {
        const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (origin?.isConnected) origin.focus({ preventScroll: true }); };
  }, [images.length]);
  return <div className="gd-lightbox-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={ref} className="gd-lightbox" role="dialog" aria-modal="true" aria-label={t("{value0} screenshots", { value0: title })} data-gamepad-gallery="">
      <header><span>{title}<small aria-live="polite">{index + 1} / {images.length} · Microsoft Store</small></span><button className="secondary gd-gallery-close" data-gamepad-cancel aria-label={t("Close gallery")} onClick={close}><X />{t("Close")}<span className="gd-controller-hint" aria-hidden="true">B</span></button></header>
      <div className="gd-lightbox-image"><Artwork src={images[index]} alt={t("{value0} screenshot {value1}", { value0: title, value1: index + 1 })} /></div>
      <footer><button className="secondary" data-gamepad-gallery-previous aria-label={t("Previous screenshot")} onClick={() => setIndex(i => (i - 1 + images.length) % images.length)}><span className="gd-controller-hint" aria-hidden="true">L1</span><ChevronLeft />{t("Previous")}</button><button className="secondary" data-gamepad-gallery-next aria-label={t("Next screenshot")} onClick={() => setIndex(i => (i + 1) % images.length)}>{t("Next")}<ChevronRight /><span className="gd-controller-hint" aria-hidden="true">R1</span></button></footer>
    </section>
  </div>;
}

interface PageProps {
  game: Game;
  back: () => void;
  play: ReactNode;
  manage: ReactNode;
  notices?: ReactNode;
  technical?: ReactNode;
  achievements?: ReactNode;
}
interface ContentProps extends PageProps {
  details?: GameStoreDetails;
  activity?: GameActivity;
  metadataLoading?: boolean;
  activityLoading?: boolean;
  metadataError?: boolean;
  refresh: () => void;
}

/** Descriptive data never gates Play or changes package/licensing decisions. */
export function GameDetailsContent({ game, back, play, manage, notices, technical, achievements, details, activity, metadataLoading, activityLoading, metadataError, refresh }: ContentProps) {
  const { t, language } = useI18n();
  const [gallery, setGallery] = useState<number>();
  const [expanded, setExpanded] = useState(false);
  const manageRef = useRef<HTMLDetailsElement>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const closeManage = (restoreFocus = true) => {
    if (manageRef.current) manageRef.current.open = false;
    setManageOpen(false);
    if (restoreFocus) manageRef.current?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  };
  const images = details?.screenshots ?? [];
  const description = details?.description ?? '';
  const shortDescription = description.split(/\r?\n\s*\r?\n/)[0];
  const release = details?.releaseDate && Number.isFinite(Date.parse(details.releaseDate)) ? new Date(details.releaseDate).toLocaleDateString(language, { year: 'numeric', month: 'long', day: 'numeric' }) : undefined;
  const lastPlayed = activity?.lastPlayed && Number.isFinite(Date.parse(activity.lastPlayed)) ? new Date(activity.lastPlayed).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' }) : t("Unavailable");
  useEffect(() => {
    if (!manageOpen) return;
    const fit = () => {
      const summary = manageRef.current?.querySelector('summary');
      const menu = manageRef.current?.querySelector<HTMLElement>('[role="menu"]');
      if (!summary || !menu) return;
      const rect = summary.getBoundingClientRect();
      const top = Math.max(8, (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + 8);
      const above = rect.top - top - 6, below = window.innerHeight - rect.bottom - 14;
      const upwards = below < 240 && above > below;
      menu.style.top = upwards ? 'auto' : 'calc(100% + 6px)';
      menu.style.bottom = upwards ? 'calc(100% + 6px)' : 'auto';
      menu.style.maxHeight = `${Math.max(40, Math.min(380, upwards ? above : below))}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    return () => { window.removeEventListener('resize', fit); window.removeEventListener('scroll', fit, true); };
  }, [manageOpen]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (manageRef.current?.open) { event.preventDefault(); closeManage(); return; }
      if (!document.querySelector('[data-game-menu]')) { event.preventDefault(); back(); }
    };
    const outside = (event: PointerEvent) => { if (manageRef.current?.open && event.target instanceof Node && !manageRef.current.contains(event.target)) closeManage(false); };
    window.addEventListener('keydown', escape); document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', escape); document.removeEventListener('pointerdown', outside); };
  }, [back]);
  return <section className="game-details-page" data-gamepad-detail={game.id}>
    <div className="gd-back-row"><button className="gd-back" data-gamepad-detail-back onClick={back}><ArrowLeft />{t("Back to library")}<span className="gd-back-hint" aria-hidden="true">B</span></button></div>
    <section className="gd-hero">
      <Artwork className="gd-hero-art" src={details?.heroUrl ?? game.heroUrl ?? game.coverUrl} alt="" />
      <div className="gd-hero-shade" />
      <div className="gd-hero-copy"><span className={`gd-ready ${game.installState}`}><Check />{game.installState === 'ready' ? t("Installed") : game.installState === 'incomplete' ? t("Incomplete") : t("Imported")}</span><h1>{game.title}</h1><p>{details?.publisher ?? game.publisher ?? t("Publisher not provided")}</p><div className="gd-tags">{details?.categories.map(category => <span key={category}>{category}</span>)}</div></div>
    </section>
    <div className="gd-page-content">
      <section className="gd-play-row" data-gamepad-action-row aria-label={t("Game actions and activity")}>
        <div className="button-row gd-play-controls">{play}</div>
        <div className="gd-stat"><Clock3 /><div><span>{t("Xbox time played")}{' '}<button className="gd-refresh" aria-label={t("Refresh Xbox activity")} disabled={activityLoading} onClick={refresh}>{activityLoading ? <LoaderCircle className="spin" /> : <RefreshCw />}</button></span><strong>{activityLoading && !activity ? t("Loading…") : formatMinutes(activity?.minutesPlayed, t)}</strong><small>{activityLoading ? t("Reading Xbox activity…") : activityNote(activity, t)}</small></div></div>
        <div className="gd-stat gd-last-played"><div><span>{t("Last played")}</span><strong>{activityLoading && !activity ? t("Loading…") : lastPlayed}</strong></div></div>
        <details ref={manageRef} className="gd-actions" data-game-menu={manageOpen ? '' : undefined} onToggle={event => setManageOpen(event.currentTarget.open)}><summary aria-label={t("More game actions")}><MoreHorizontal /><span>{t("Manage")}</span></summary><div role="menu" aria-label={t("Manage game")} onClick={event => { if ((event.target as HTMLElement).closest('button:not(:disabled)')) closeManage(); }}>{manage}</div></details>
      </section>
      {notices}
      {achievements}
      <div className="gd-detail-columns">
        <div className="gd-description-column">
          <section className="gd-about"><h2>{t("About the game")}</h2><p>{metadataLoading ? t("Loading game information…") : description ? expanded ? description : shortDescription : metadataError ? t("Game information could not be loaded. You can still play.") : t("Microsoft Store did not provide a description for this game.")}</p>{description !== shortDescription ? <button className="gd-text-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? t("Show less") : t("Read more")}<ChevronRight /></button> : null}</section>
          <section className="gd-gallery"><header><h2>{t("Screenshots")}</h2>{images.length ? <button className="gd-text-button" onClick={() => setGallery(0)}><Images />{t("View all")}{' '}{images.length}</button> : null}</header><div>{images.slice(0, 4).map((url, index) => <button key={url} aria-label={t("Open screenshot {value0}", { value0: index + 1 })} onClick={() => setGallery(index)}><Artwork loading="lazy" src={url} alt={t("{value0} screenshot {value1}", { value0: game.title, value1: index + 1 })} /></button>)}</div>{!images.length ? <p className="gd-empty">{metadataLoading ? t("Loading screenshots…") : t("No screenshots available.")}</p> : null}</section>
        </div>
        <aside className="gd-facts"><h2>{t("Game information")}</h2><dl><div><dt>{t("Publisher")}</dt><dd>{details?.publisher ?? game.publisher ?? t("Unavailable")}</dd></div><div><dt>{t("Release date")}</dt><dd>{release ?? t("Unavailable")}</dd></div><div><dt>{t("Categories")}</dt><dd>{details?.categories.length ? details.categories.join(' · ') : t("Unavailable")}</dd></div>{details ? <div><dt>{t("Metadata source")}</dt><dd>Microsoft Store</dd></div> : null}</dl><details><summary>{t("Installation details")}</summary>{technical}</details></aside>
      </div>
      <p className="gd-disclaimer">{t("Xbox activity may be delayed or unavailable for some games. Local session time is not added to the Xbox total.")}</p>
    </div>
    {gallery !== undefined && images.length ? <Gallery title={game.title} images={images} initial={gallery} close={() => setGallery(undefined)} /> : null}
  </section>;
}

export function GameDetails(props: PageProps & { data: AppSnapshot }) {
  const { game, data } = props;
  const [details, setDetails] = useState<GameStoreDetails>();
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [metadataError, setMetadataError] = useState(false);
  const [activity, setActivity] = useState<GameActivity>();
  const [activityLoading, setActivityLoading] = useState(true);
  const request = useRef(0);
  useEffect(() => {
    let live = true; setDetails(undefined); setMetadataLoading(true); setMetadataError(false);
    window.launcher.getGameDetails(game.id).then(value => { if (live) setDetails(value); }).catch(() => { if (live) setMetadataError(true); }).finally(() => { if (live) setMetadataLoading(false); });
    return () => { live = false; };
  }, [game.id, data.settings.market]);
  const loadActivity = useCallback((refresh = false) => {
    const id = ++request.current; setActivityLoading(true);
    void window.launcher.getGameActivity(game.id, refresh).then(value => { if (request.current === id) setActivity(value); }).catch(() => { if (request.current === id) setActivity({ status: 'error' }); }).finally(() => { if (request.current === id) setActivityLoading(false); });
  }, [game.id, data.auth.username, data.auth.stored, data.auth.running, data.backend.binaryPath]);
  useEffect(() => { setActivity(undefined); loadActivity(); return () => { request.current++; }; }, [loadActivity]);
  return <GameDetailsContent {...props} details={details} activity={activity} metadataLoading={metadataLoading} metadataError={metadataError} activityLoading={activityLoading} refresh={() => loadActivity(true)} achievements={<Achievements gameId={game.id} title={game.title} data={data} />} />;
}
