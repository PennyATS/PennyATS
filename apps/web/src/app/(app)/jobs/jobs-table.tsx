"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

export type JobRow = {
  id: string; title: string; department: string | null; team: string | null;
  location: string | null; region: string | null; headcount: number | null;
  status: "draft" | "open" | "closed"; active: number;
};
type Key = "job" | "department" | "location" | "status" | "headcount";
type Filters = { q: string; status: string; department: string; location: string; active: string };
type View = { name: string; filters: Filters; sort: Key; descending: boolean; visible: Key[]; pinned: Key[]; widths: Record<Key, number> };
const columns: { key: Key; label: string; width: number }[] = [
  { key: "job", label: "Job", width: 330 },
  { key: "department", label: "Team / department", width: 200 },
  { key: "location", label: "Location / region", width: 200 },
  { key: "status", label: "Job status", width: 135 },
  { key: "headcount", label: "Headcount", width: 115 },
];
const emptyFilters: Filters = { q: "", status: "", department: "", location: "", active: "" };
const defaultWidths = Object.fromEntries(columns.map((col) => [col.key, col.width])) as Record<Key, number>;
const storageKey = "pennyats:jobs-views:v1";
const keys = new Set(columns.map((col) => col.key));

function ColumnIcon({ column }: { column: Key }) {
  const paths = {
    job: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M8 6V4h8v2M3 11h18" /></>,
    department: <><rect x="3" y="9" width="7" height="11" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" /><path d="M5 13h3m8-5h3m-3 4h3" /></>,
    location: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    status: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    headcount: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5v1" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0">{paths[column]}</svg>;
}

function compare(a: string | number | null, b: string | number | null) {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
}

export function JobsTable({ rows, canCreate }: { rows: JobRow[]; canCreate: boolean }) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState<Key>("job");
  const [descending, setDescending] = useState(false);
  const [visible, setVisible] = useState<Key[]>(columns.map((col) => col.key));
  const [pinned, setPinned] = useState<Key[]>(["job"]);
  const [widths, setWidths] = useState(defaultWidths);
  const [views, setViews] = useState<View[]>([]);
  const [viewName, setViewName] = useState("");
  const [selectedView, setSelectedView] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const resizing = useRef<{ key: Key; start: number; width: number } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [renderedWidths, setRenderedWidths] = useState<Partial<Record<Key, number>>>({});

  useEffect(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(parsed)) setViews(parsed.filter((v) => typeof v?.name === "string" && v.filters));
    } catch { /* Storage is optional. */ }
  }, []);
  useEffect(() => {
    function move(event: PointerEvent) {
      if (!resizing.current) return;
      const { key, start, width } = resizing.current;
      setWidths((current) => ({ ...current, [key]: Math.max(90, Math.min(640, width + event.clientX - start)) }));
      setSelectedView("");
    }
    function stop() { resizing.current = null; }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
  }, []);

  const departments = [...new Set(rows.map((row) => row.department).filter((v): v is string => !!v))].sort();
  const locations = [...new Set(rows.map((row) => row.location).filter((v): v is string => !!v))].sort();
  const filterCount = [filters.status, filters.department, filters.location, filters.active].filter(Boolean).length;
  const filtered = useMemo(() => {
    const q = filters.q.trim().toLocaleLowerCase();
    const sortValue = (row: JobRow) => ({
      job: row.title, department: row.team || row.department, location: row.location || row.region,
      status: row.status, headcount: row.headcount,
    })[sort];
    return rows.filter((row) =>
      (!q || [row.title, row.department, row.team, row.location, row.region].some((part) => part?.toLocaleLowerCase().includes(q))) &&
      (!filters.status || row.status === filters.status) &&
      (!filters.department || row.department === filters.department) &&
      (!filters.location || row.location === filters.location) &&
      (!filters.active || (filters.active === "yes" ? row.active > 0 : row.active === 0))
    ).sort((a, b) => {
      const result = compare(sortValue(a), sortValue(b));
      return (descending ? -result : result) || a.title.localeCompare(b.title);
    });
  }, [rows, filters, sort, descending]);

  const ordered = columns.filter((col) => visible.includes(col.key) && pinned.includes(col.key))
    .concat(columns.filter((col) => visible.includes(col.key) && !pinned.includes(col.key)));
  const orderKey = ordered.map((col) => col.key).join(",");
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const measure = () => {
      const measured: Partial<Record<Key, number>> = {};
      table.querySelectorAll<HTMLTableCellElement>("thead th[data-column]").forEach((cell) => {
        measured[cell.dataset.column as Key] = cell.getBoundingClientRect().width;
      });
      setRenderedWidths((current) => Object.keys(measured).every((key) => Math.abs((current[key as Key] ?? 0) - (measured[key as Key] ?? 0)) < 0.5) ? current : measured);
    };
    const observer = new ResizeObserver(measure);
    table.querySelectorAll("thead th").forEach((cell) => observer.observe(cell));
    measure();
    return () => observer.disconnect();
  }, [orderKey]);
  let offset = 0;
  const lefts = Object.fromEntries(ordered.filter((col) => pinned.includes(col.key)).map((col) => {
    const left = offset; offset += renderedWidths[col.key] ?? widths[col.key]; return [col.key, left];
  })) as Partial<Record<Key, number>>;

  function changeFilter(key: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedView("");
  }
  function persist(next: View[]) {
    setViews(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Session-only fallback. */ }
  }
  function saveView() {
    const name = viewName.trim().slice(0, 40);
    if (!name) return;
    const view: View = { name, filters, sort, descending, visible, pinned, widths };
    persist([...views.filter((v) => v.name !== name), view].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedView(name); setViewName("");
  }
  function loadView(name: string) {
    setSelectedView(name);
    const view = views.find((v) => v.name === name);
    if (!view || !keys.has(view.sort)) return;
    setFilters({ ...emptyFilters, ...view.filters }); setSort(view.sort); setDescending(view.descending);
    setVisible(view.visible.filter((key) => keys.has(key)).concat(view.visible.includes("job") ? [] : ["job"]));
    setPinned(view.pinned.filter((key) => keys.has(key)));
    setWidths({ ...defaultWidths, ...view.widths });
  }
  function deleteView() {
    persist(views.filter((v) => v.name !== selectedView));
    setSelectedView("");
  }
  const sticky = (key: Key) => pinned.includes(key) ? { left: lefts[key] } : undefined;

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">Jobs</h1><p className="muted mt-0.5 text-xs">{rows.length} job{rows.length === 1 ? "" : "s"}</p></div>
      {canCreate && <Link href="/jobs/new" className="btn">New job</Link>}
    </div>
    <div className="mt-5 flex flex-wrap items-center gap-2" aria-label="Jobs table controls">
      <input type="search" className="input h-9 min-w-[190px] flex-1 sm:max-w-xs" aria-label="Search jobs" placeholder="Search jobs" value={filters.q} onChange={(e) => changeFilter("q", e.target.value)} />
      <button type="button" className="btn btn-secondary" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>Filters{filterCount > 0 && <span className="data-count">{filterCount}</span>}</button>
      <details className="relative">
        <summary className="btn btn-secondary list-none cursor-pointer">Views</summary>
        <div className="data-menu right-0 w-64">
          <label className="label" htmlFor="jobs-view">Saved views</label>
          <div className="flex gap-1.5"><select id="jobs-view" className="input" value={selectedView} onChange={(e) => loadView(e.target.value)}><option value="">Current view</option>{views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}</select>{selectedView && <button type="button" className="btn btn-secondary" onClick={deleteView} aria-label={`Delete ${selectedView} view`}>Delete</button>}</div>
          <div className="mt-3 flex gap-1.5"><input className="input" aria-label="New view name" placeholder="Name this view" value={viewName} onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveView(); }} /><button type="button" className="btn btn-secondary" disabled={!viewName.trim()} onClick={saveView}>Save</button></div>
          <p className="muted mt-2 text-xs">Saved in this browser.</p>
        </div>
      </details>
      <details className="relative">
        <summary className="btn btn-secondary list-none cursor-pointer">Columns</summary>
        <div className="data-menu right-0 w-64">
          <div className="mb-2 text-xs font-semibold">Show and pin columns</div>
          {columns.map((col) => <div key={col.key} className="flex items-center justify-between gap-2 py-1 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={visible.includes(col.key)} disabled={col.key === "job"} onChange={(e) => { setVisible((current) => e.target.checked ? [...current, col.key] : current.filter((key) => key !== col.key)); setSelectedView(""); }} />{col.label}</label>
            <button type="button" className={`data-pin ${pinned.includes(col.key) ? "data-pin-active" : ""}`} aria-label={`${pinned.includes(col.key) ? "Unpin" : "Pin"} ${col.label}`} aria-pressed={pinned.includes(col.key)} onClick={() => { setPinned((current) => current.includes(col.key) ? current.filter((key) => key !== col.key) : [...current, col.key]); setSelectedView(""); }}>{pinned.includes(col.key) ? "Pinned" : "Pin"}</button>
          </div>)}
          <p className="muted mt-2 text-xs">Drag a header edge to resize.</p>
        </div>
      </details>
      <span className="muted ml-auto text-xs">{filtered.length} shown</span>
    </div>
    {showFilters && <div className="data-filters mt-2 flex flex-wrap items-end gap-2">
      <label className="text-xs">Job status<select className="input mt-1 min-w-28" value={filters.status} onChange={(e) => changeFilter("status", e.target.value)}><option value="">All statuses</option><option value="open">Open</option><option value="draft">Draft</option><option value="closed">Closed</option></select></label>
      <label className="text-xs">Department<select className="input mt-1 min-w-32" value={filters.department} onChange={(e) => changeFilter("department", e.target.value)}><option value="">All departments</option>{departments.map((v) => <option key={v}>{v}</option>)}</select></label>
      <label className="text-xs">Location<select className="input mt-1 min-w-32" value={filters.location} onChange={(e) => changeFilter("location", e.target.value)}><option value="">All locations</option>{locations.map((v) => <option key={v}>{v}</option>)}</select></label>
      <label className="text-xs">Candidates<select className="input mt-1 min-w-32" value={filters.active} onChange={(e) => changeFilter("active", e.target.value)}><option value="">Any count</option><option value="yes">Has active</option><option value="no">None active</option></select></label>
      {filterCount > 0 && <button type="button" className="btn btn-secondary" onClick={() => { setFilters((current) => ({ ...current, status: "", department: "", location: "", active: "" })); setSelectedView(""); }}>Clear filters</button>}
    </div>}
    <div className="data-table-scroll mt-3" role="region" aria-label="Jobs table" tabIndex={0}>
      <table ref={tableRef} className="data-table" style={{ width: ordered.reduce((sum, col) => sum + widths[col.key], 0) }}>
        <colgroup>{ordered.map((col) => <col key={col.key} style={{ width: widths[col.key] }} />)}</colgroup>
        <thead><tr>{ordered.map((col) => <th key={col.key} data-column={col.key} scope="col" aria-sort={sort === col.key ? (descending ? "descending" : "ascending") : "none"} className={pinned.includes(col.key) ? "data-sticky" : ""} style={sticky(col.key)}>
          <button type="button" className="data-sort" onClick={() => { if (sort === col.key) setDescending(!descending); else { setSort(col.key); setDescending(false); } setSelectedView(""); }} aria-label={`Sort by ${col.label}`}><ColumnIcon column={col.key} /><span>{col.label}</span><span className="data-sort-arrow">{sort === col.key ? (descending ? "↓" : "↑") : "↕"}</span></button>
          <span className="data-resize" role="separator" tabIndex={0} aria-label={`Resize ${col.label} column`} aria-orientation="vertical" onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setWidths((current) => ({ ...current, [col.key]: Math.max(90, Math.min(640, current[col.key] + (e.key === "ArrowRight" ? 10 : -10))) })); setSelectedView(""); } }} onPointerDown={(e) => { e.preventDefault(); resizing.current = { key: col.key, start: e.clientX, width: widths[col.key] }; }} />
        </th>)}</tr></thead>
        <tbody>{filtered.map((job) => <tr key={job.id}>{ordered.map((col) => <td key={col.key} className={pinned.includes(col.key) ? "data-sticky" : ""} style={sticky(col.key)}>
          {col.key === "job" && <div className="flex items-center justify-between gap-3"><div className="min-w-0"><Link href={`/jobs/${job.id}`} className="data-job-title">{job.title}</Link><div className="data-secondary truncate">{[job.department, job.location].filter(Boolean).join(" · ") || "No department or location"}</div></div><span className="data-candidates" title={`${job.active} active candidate${job.active === 1 ? "" : "s"}`}>{job.active}<span className="sr-only"> active candidate{job.active === 1 ? "" : "s"}</span></span></div>}
          {col.key === "department" && <><div className="data-primary">{job.team || job.department || "—"}</div>{job.team && job.department && <div className="data-secondary">{job.department}</div>}</>}
          {col.key === "location" && <><div className="data-primary">{job.location || job.region || "—"}</div>{job.location && job.region && <div className="data-secondary">{job.region}</div>}</>}
          {col.key === "status" && <span className={`data-status data-status-${job.status}`}>{job.status}</span>}
          {col.key === "headcount" && <span className="data-numeric">{job.headcount ?? "—"}</span>}
        </td>)}</tr>)}</tbody>
      </table>
      {filtered.length === 0 && <div className="data-empty">{rows.length === 0 ? (canCreate ? "No jobs yet. Create a job to get started." : "You aren't on any hiring teams yet.") : "No jobs match these filters."}</div>}
    </div>
  </>;
}
