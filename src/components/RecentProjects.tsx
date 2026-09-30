import { useEffect, useId, useMemo, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, BarChart3, ChevronDown, ClipboardList, Edit2,
  FolderOpen, GalleryHorizontalEnd, LayoutGrid, ListTodo, MessageSquare,
  MoreHorizontal, PanelsTopLeft, Search, ShoppingBag, Trash2, X,
} from 'lucide-react';
import { appEvents } from '../lib/events';
import ActionMenu from './ActionMenu';
import { isSystemContinuation } from '../lib/chat-transcript';
import { formatRelativeTime, getProjectDisplayTitle, getProjectMessages, type Project } from '../lib/project-store';
import { resolvePlatformStatusForProject } from '../lib/status-store';
import {
  isUntitledProject, PROJECT_DATE_GROUPS, PROJECT_PAGE_SIZE, projectCardStatus,
  projectCategory, projectDateGroup, selectRecentProjects,
  type ProjectCardStatus, type ProjectDateGroup, type ProjectSort, type RecentProjectEntry,
} from '../lib/recent-projects';
import './RecentProjects.css';

const CATEGORIES = {
  dashboard: { label: 'Dashboard', icon: BarChart3 },
  storefront: { label: 'Storefront', icon: ShoppingBag },
  portal: { label: 'Portal', icon: PanelsTopLeft },
  portfolio: { label: 'Portfolio', icon: GalleryHorizontalEnd },
  workflow: { label: 'Workflow', icon: ListTodo },
  chat: { label: 'Messaging', icon: MessageSquare },
  forms: { label: 'Forms & booking', icon: ClipboardList },
  app: { label: 'App', icon: LayoutGrid },
};
const STATUS_LABELS = { draft: 'Draft', building: 'In progress', deployed: 'Live', error: 'Needs attention' };
const STATUS_TITLES = {
  draft: 'Draft — still being built, not published yet',
  building: 'In progress — the builder is working on it right now',
  deployed: 'Live — published and available at its web address',
  error: 'Needs attention — the last build or publish ran into a problem',
};

interface RecentProjectsProps {
  projects: Project[];
  onOpenProject: (id: string) => void;
  onRenameProject: (project: Project) => void;
  onDeleteProject: (id: string) => void;
}

export default function RecentProjects({ projects, onOpenProject, onRenameProject, onDeleteProject }: RecentProjectsProps) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProjectSort>('updated');
  const [filter, setFilter] = useState<ProjectCardStatus | 'all'>('all');
  const [limit, setLimit] = useState(PROJECT_PAGE_SIZE);
  const [collapsed, setCollapsed] = useState<Set<ProjectDateGroup>>(new Set());
  const [snapshot, setSnapshot] = useState(() => ({ now: Date.now() }));

  useEffect(() => {
    const refresh = () => setSnapshot({ now: Date.now() });
    const unsubscribe = appEvents.on('platform-status-sync', refresh);
    // Keep date groups accurate when the page remains open across midnight.
    const timer = window.setInterval(refresh, 60_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, []);

  const entries = useMemo<RecentProjectEntry[]>(() => {
    const now = snapshot.now;
    return projects.map(project => {
      const messages = getProjectMessages(project.id);
      const description = messages?.find(message => message.role === 'user' && !message.internal && typeof message.content === 'string' && !isSystemContinuation(message.content))?.content.trim().replace(/\s+/g, ' ') || '';
      const untitled = isUntitledProject(project.name);
      const title = untitled ? 'Untitled project' : getProjectDisplayTitle(project);
      return {
        project, title, description, untitled,
        status: projectCardStatus(project, resolvePlatformStatusForProject(project.id)),
        category: projectCategory(title, description),
        dateGroup: projectDateGroup(project.updatedAt, now),
      };
    });
  }, [projects, snapshot]);
  const results = useMemo(() => selectRecentProjects(entries, search, filter, sort), [entries, search, filter, sort]);
  const loaded = results.slice(0, limit);

  const resetResults = () => {
    setLimit(PROJECT_PAGE_SIZE);
    setCollapsed(new Set());
  };

  const showFullControls = projects.length >= 5;

  return (
    <section className="recent-projects landing-projects-section" aria-labelledby={`${id}-heading`}>
      <div className="recent-projects-heading">
        <div><h2 id={`${id}-heading`}>Projects</h2><p>{projects.length === 1 ? '1 project' : `${projects.length} projects`} · pick up where you left off.</p></div>
      </div>
      <div className="recent-projects-controls">
        <label className="recent-projects-search">
          <Search size={17} aria-hidden="true" />
          <input type="search" aria-label="Search projects" placeholder="Search projects…" value={search} onChange={event => { setSearch(event.target.value); resetResults(); }} />
          {search && <button type="button" aria-label="Clear project search" onClick={() => { setSearch(''); resetResults(); }}><X size={16} /></button>}
        </label>
        {showFullControls && <>
          <label className="recent-projects-select"><span>Status</span><select aria-label="Filter projects by status" value={filter} onChange={event => { setFilter(event.target.value as typeof filter); resetResults(); }}>
            <option value="all">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select><ChevronDown size={15} aria-hidden="true" /></label>
          <label className="recent-projects-select"><span>Sort</span><select aria-label="Sort projects" value={sort} onChange={event => { setSort(event.target.value as ProjectSort); resetResults(); }}>
            <option value="updated">Recently updated</option><option value="name">Name</option><option value="status">Status</option>
          </select><ChevronDown size={15} aria-hidden="true" /></label>
        </>}
      </div>

      {PROJECT_DATE_GROUPS.map(group => {
        const groupEntries = loaded.filter(entry => entry.dateGroup === group);
        if (!groupEntries.length) return null;
        const expanded = !collapsed.has(group);
        const groupId = `${id}-${group.replace(' ', '-')}`;
        return <div className="recent-projects-group" key={group}>
          <h3 className="recent-projects-group-heading"><button type="button" aria-expanded={expanded} aria-controls={groupId} onClick={() => {
            setCollapsed(current => { const next = new Set(current); if (next.has(group)) next.delete(group); else next.add(group); return next; });
          }}><ChevronDown size={16} aria-hidden="true" /><span>{group}</span><small>{results.filter(entry => entry.dateGroup === group).length}</small></button></h3>
          <div id={groupId} className="landing-projects-list" hidden={!expanded}>
            {expanded && groupEntries.map(entry => {
              const { project, title, description, category, status, untitled } = entry;
              const Icon = CATEGORIES[category].icon;
              return <article className="landing-project-card" key={project.id}>
                <div className={`recent-project-thumbnail category-${category}`} title={`App type: ${CATEGORIES[category].label} — detected from what the app does`}>
                  <Icon size={28} strokeWidth={1.5} aria-hidden="true" /><span>{CATEGORIES[category].label}</span>
                </div>
                <div className="recent-project-body">
                  <div className="recent-project-meta"><span className={`recent-project-status status-${status}`} title={STATUS_TITLES[status]}><i aria-hidden="true" />{STATUS_LABELS[status]}</span><time dateTime={new Date(project.updatedAt).toISOString()} title={new Date(project.updatedAt).toLocaleString()}>{formatRelativeTime(project.updatedAt)}</time></div>
                  <h4 className="landing-card-title" title={title}>{title}</h4>
                  <p className="recent-project-description">{description || 'Your next idea starts here.'}</p>
                  <div className="recent-project-footer">
                    {untitled && <button type="button" className="recent-project-continue" onClick={() => onOpenProject(project.id)}>Continue building <ArrowRight size={13} aria-hidden="true" /></button>}
                    <button type="button" className="landing-project-open" aria-label={`Open ${title}`} onClick={() => onOpenProject(project.id)}>Open <ArrowUpRight size={15} aria-hidden="true" /></button>
                  </div>
                </div>
                <div className="landing-card-actions">
                  <ActionMenu label={`Project actions for ${title}`} className="landing-card-menu-btn" items={[
                    { label: 'Open', icon: <FolderOpen size={14} aria-hidden="true" />, onSelect: () => onOpenProject(project.id) },
                    { label: 'Rename', icon: <Edit2 size={14} aria-hidden="true" />, onSelect: () => onRenameProject(project) },
                    { label: 'Delete', icon: <Trash2 size={14} aria-hidden="true" />, onSelect: () => onDeleteProject(project.id), danger: true, separator: true },
                  ]}>
                    <MoreHorizontal size={18} aria-hidden="true" />
                  </ActionMenu>
                </div>
              </article>;
            })}
          </div>
        </div>;
      })}
      {results.length === 0 && <div className="recent-projects-empty"><Search size={24} aria-hidden="true" /><h3>No matching projects</h3><p>Try another name or choose a different status.</p><button type="button" onClick={() => { setSearch(''); setFilter('all'); resetResults(); }}>Clear filters</button></div>}
      {(results.length > limit || search.trim() || filter !== 'all') && (
        <div className="recent-projects-pagination">
          {results.length > loaded.length && <p role="status">Showing {loaded.length} of {results.length} projects</p>}
          {!(results.length > loaded.length) && (search.trim() || filter !== 'all') && <p role="status">{results.length} matching project{results.length !== 1 ? 's' : ''}</p>}
          {results.length > limit && <button type="button" onClick={() => { setLimit(value => value + PROJECT_PAGE_SIZE); setCollapsed(new Set()); }}>Show more <span>({results.length - loaded.length})</span><ChevronDown size={16} aria-hidden="true" /></button>}
        </div>
      )}
    </section>
  );
}
