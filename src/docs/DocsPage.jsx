import { translateText as translate, useLanguage } from '../i18n/LanguageContext.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, FileText, Hash, Languages, Search } from 'lucide-react';
import { FaGithub as Github } from 'react-icons/fa6';
import Markdown, { parseMarkdown } from './Markdown.jsx';
import DocsOverview from './DocsOverview.jsx';
import Playground from './playground/Playground.jsx';
import { SectionLabel } from '../landing/home/HomeView.jsx';
import { DOCS_GROUPS, DOCS_PAGES, createLinkContext, docsHref, getPage, githubSourceUrl, pageSource, parseDocsHash } from './docsPages.js';
import './docs.css';

// ============================================================================
// The package documentation, served by the studio at #/docs/<page>/<anchor>:
// a page list with search, the page itself and its outline.
// ============================================================================

const MAX_RESULTS = 12;

function buildSearchIndex(locale) {
  const items = [];
  for (const page of DOCS_PAGES) {
    items.push({ kind: 'page', title: page.title, context: page.summary, href: docsHref(page.id), terms: `${page.title} ${page.summary} ${pageSource(page, locale).source}` });
    if (!page.source || page.component === 'parameters') continue;
    const { source, reference } = pageSource(page, locale);
    for (const heading of parseMarkdown(source, reference).headings) {
      if (heading.depth < 2 || heading.depth > 3) continue;
      items.push({ kind: 'heading', title: heading.text, context: page.title, href: docsHref(page.id, heading.id), terms: heading.text });
    }
  }
  return items;
}

function search(index, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const item of index) {
    const title = item.title.toLowerCase();
    const terms = `${item.terms} ${translate(item.title)} ${translate(item.context)} ${item.param ? `${translate(item.param.label)} ${translate(item.param.group)}` : ''}`.toLowerCase();
    let score = -1;
    if (title === q) score = 0;
    else if (title.startsWith(q)) score = 1;
    else if (title.includes(q)) score = 2;
    else if (terms.includes(q)) score = 3;
    if (score >= 0) scored.push({ item, score: score + (item.kind === 'page' ? -0.5 : item.kind === 'param' ? 0.6 : 0) });
  }
  return scored.sort((a, b) => a.score - b.score || a.item.title.length - b.item.title.length).slice(0, MAX_RESULTS).map((entry) => entry.item);
}

function Sidebar({ page, open, onToggle }) {
  const { language: locale } = useLanguage();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const index = useMemo(() => buildSearchIndex(locale), [locale]);
  const results = useMemo(() => search(index, query), [index, query, locale]);
  const current = getPage(page);

  useEffect(() => {
    const onKey = (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
      if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !typing)) {
        event.preventDefault();
        if (!open) onToggle(true);
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onToggle]);

  useEffect(() => { setCursor(0); }, [query]);

  const go = (href) => {
    setQuery('');
    onToggle(false);
    window.location.hash = href.slice(1);
  };

  const onKeyDown = (event) => {
    if (!results.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((c) => (c + 1) % results.length); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((c) => (c - 1 + results.length) % results.length); }
    if (event.key === 'Enter') { event.preventDefault(); go(results[cursor].href); }
    if (event.key === 'Escape') setQuery('');
  };

  const kindIcon = { page: FileText, heading: Hash };

  return (
    <aside className={`docs-sidebar${open ? ' open' : ''}`}>
      <button type="button" className="docs-sidebar-toggle" aria-expanded={open} aria-controls="docs-sidebar-body" onClick={() => onToggle(!open)}>
        <span>{translate(current?.title ?? 'Documentation')}</span>
        <ChevronDown size={15} aria-hidden />
      </button>
      <div id="docs-sidebar-body" className="docs-sidebar-body">
        <label className="docs-search">
          <Search size={14} aria-hidden />
          <input ref={inputRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown}
            placeholder={translate('Search the docs')} aria-label={translate('Search the docs')}
            role="combobox" aria-expanded={results.length > 0} aria-controls="docs-search-results" aria-autocomplete="list" aria-activedescendant={results.length ? `docs-result-${cursor}` : undefined} />
          <kbd>Ctrl K</kbd>
        </label>
        {query.trim() ? (
          <ul id="docs-search-results" className="docs-results" role="listbox">
            {results.length === 0 && <li className="docs-results-empty">{translate('No result for “{0}”.', { 0: query.trim() })}</li>}
            {results.map((item, i) => {
              const Icon = kindIcon[item.kind];
              return (
                <li key={`${item.kind}-${item.href}`} id={`docs-result-${i}`} role="option" aria-selected={i === cursor}>
                  <a href={item.href} className={i === cursor ? 'active' : ''} onMouseEnter={() => setCursor(i)}
                    onClick={(event) => { event.preventDefault(); go(item.href); }}>
                    <Icon size={13} aria-hidden />
                    <span><strong>{item.kind === 'param' ? item.title : translate(item.title)}</strong><small>{translate(item.context)}</small></span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <nav className="docs-nav" aria-label={translate('Documentation')}>
            {DOCS_GROUPS.map((group) => (
              <div key={group.id} className="docs-nav-group">
                <h2 className="docs-nav-label">{translate(group.title)}</h2>
                {DOCS_PAGES.filter((item) => item.group === group.id).map((item) => (
                  <a key={item.id} href={docsHref(item.id)} className={item.id === page ? 'active' : ''} aria-current={item.id === page ? 'page' : undefined}
                    onClick={() => onToggle(false)}>
                    {translate(item.title)}
                  </a>
                ))}
              </div>
            ))}
          </nav>
        )}
      </div>
    </aside>
  );
}

const outlineItems = (headings) => headings.filter((heading) => heading.depth === 2 || heading.depth === 3);

function Outline({ items, active, page }) {
  useLanguage();
  return (
    <aside className="docs-outline">
      <h2 className="docs-outline-title"><SectionLabel>{translate('On this page')}</SectionLabel></h2>
      <nav aria-label={translate('On this page')}>
        {items.map((heading) => (
          <a key={heading.id} href={docsHref(page, heading.id)} className={`depth-${heading.depth}${heading.id === active ? ' active' : ''}`}>
            {heading.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}

export default function DocsPage({ onOpenInStudio }) {
  const { language: locale } = useLanguage();
  const rootRef = useRef(null);
  const [route, setRoute] = useState(() => parseDocsHash());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeHeading, setActiveHeading] = useState('');
  const page = getPage(route.page);
  const isMarkdown = page.source && !page.component;
  const doc = pageSource(page, locale);
  const headings = useMemo(() => (isMarkdown ? parseMarkdown(doc.source, doc.reference).headings : []), [isMarkdown, doc.source, doc.reference]);
  const ctx = useMemo(() => createLinkContext(page.id), [page.id]);
  const scroller = useCallback(() => rootRef.current?.closest('.lp-content-scroll') ?? null, []);

  useEffect(() => {
    const onHash = () => setRoute(parseDocsHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const scrollToAnchor = useCallback((anchor) => {
    const box = scroller();
    if (!box) return;
    const target = anchor && rootRef.current?.querySelector(`.docs-article [id="${CSS.escape(anchor)}"]`);
    if (target) box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - (window.innerWidth <= 860 ? 60 : 20);
    else box.scrollTop = 0;
  }, [scroller]);

  // new page or anchor: jump there (component pages place their own anchors)
  useEffect(() => {
    if (page.component && route.anchor) return;
    scrollToAnchor(route.anchor);
  }, [route, page, scrollToAnchor]);

  // the outline follows the reading position
  useEffect(() => {
    const box = scroller();
    const items = outlineItems(headings);
    if (!box || !items.length) { setActiveHeading(''); return undefined; }
    const update = () => {
      const top = box.getBoundingClientRect().top + 90;
      let current = items[0].id;
      for (const heading of items) {
        const el = document.getElementById(heading.id);
        if (el && el.getBoundingClientRect().top <= top) current = heading.id;
      }
      setActiveHeading(current);
    };
    update();
    box.addEventListener('scroll', update, { passive: true });
    return () => box.removeEventListener('scroll', update);
  }, [headings, scroller]);

  // a link to the location we are already at: scroll anyway
  const onClick = (event) => {
    const link = event.target.closest('a[href^="#/docs/"]');
    if (!link || link.getAttribute('href') !== window.location.hash) return;
    event.preventDefault();
    scrollToAnchor(parseDocsHash(link.getAttribute('href')).anchor);
  };

  const outline = outlineItems(headings);
  const hasOutline = outline.length >= 2;
  const index = DOCS_PAGES.indexOf(page);
  const prev = DOCS_PAGES[index - 1];
  const next = DOCS_PAGES[index + 1];

  let content;
  if (page.component === 'overview') content = <DocsOverview onOpenInStudio={onOpenInStudio} />;
  else if (page.component === 'playground') content = <Playground />;
  else content = <Markdown source={doc.source} reference={doc.reference} ctx={ctx} />;

  return (
    <div className={`ui docs${hasOutline ? '' : ' docs--wide'}`} ref={rootRef} onClick={onClick}>
      <Sidebar page={page.id} open={sidebarOpen} onToggle={setSidebarOpen} />
      <article className="docs-article" key={page.id} lang={isMarkdown && !doc.translated ? 'en' : undefined}>
        {isMarkdown && !doc.translated && (
          <p className="docs-translation-note" lang="fr"><Languages size={14} aria-hidden /> {translate('This page is only available in English for now.')}</p>
        )}
        {content}
        <footer className="docs-article-footer">
          {(page.file || page.sourcePath) && (
            <a className="docs-edit" href={page.sourcePath ? `https://github.com/ZyFou/ProceduralTerrains/blob/main/${page.sourcePath}` : githubSourceUrl(isMarkdown ? doc.file : page.file)} target="_blank" rel="noopener noreferrer">
              <Github size={14} aria-hidden /> {translate('Edit this page on GitHub')}
            </a>
          )}
          <nav className="docs-pager" aria-label={translate('Previous and next pages')}>
            {prev ? <a href={docsHref(prev.id)}><small><ArrowLeft size={12} aria-hidden /> {translate('Previous')}</small><strong>{translate(prev.title)}</strong></a> : <span />}
            {next ? <a href={docsHref(next.id)} className="next"><small>{translate('Next')} <ArrowRight size={12} aria-hidden /></small><strong>{translate(next.title)}</strong></a> : <span />}
          </nav>
        </footer>
      </article>
      {hasOutline && <Outline items={outline} active={activeHeading} page={page.id} />}
    </div>
  );
}

