import { useState } from 'react';
import { AUDIT_ACTIONS, auditLabel, summariseDetail, type AuditRow } from '../../shared/audit';
import { Pager, useMe, usePaged, when } from '../lib/adminKit';

/** Read-only view of the admin audit log (owners only). The log itself is append-only in the database. */
export default function AdminAudit({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const [f, setF] = useState({ actor: '', action: '', from: '', to: '' });
  const [applied, setApplied] = useState(f);
  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString();
  const { page, setPage, data, error, loading } = usePaged<AuditRow>(`audit${qs ? `?${qs}` : ''}`, onExpired);

  return (
    <section aria-labelledby="audit-title">
      <div className="admin-toolbar">
        <h1 id="audit-title">Audit log</h1>
        {me.can('audit.export') && (
          <a className="btn btn--ghost btn--sm" href={`/api/admin/audit-export${qs ? `?${qs}` : ''}`}>
            Export CSV{qs ? ' (filtered)' : ''}
          </a>
        )}
      </div>
      <form
        className="admin-search-form audit-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(f);
        }}
      >
        <div className="field admin-search">
          <label htmlFor="au-actor">Who (email contains)</label>
          <input id="au-actor" type="search" value={f.actor} maxLength={80} onChange={(e) => setF({ ...f, actor: e.target.value })} />
        </div>
        <div className="field admin-search">
          <label htmlFor="au-action">What</label>
          <select id="au-action" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
            <option value="">Everything</option>
            {Object.entries(AUDIT_ACTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-from">From</label>
          <input id="au-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="au-to">To</label>
          <input id="au-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        <button className="btn btn--sm" type="submit">
          Filter
        </button>
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          onClick={() => {
            const blank = { actor: '', action: '', from: '', to: '' };
            setF(blank);
            setApplied(blank);
          }}
        >
          Clear
        </button>
      </form>
      <p className="field-hint">Times are India time. Entries cannot be edited or deleted.</p>
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table audit-table">
              <caption className="sr-only">Admin activity</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">What</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={4}>No entries match.</td>
                  </tr>
                )}
                {data.items.map((r) => (
                  <tr key={r.id} data-action={r.action}>
                    <td className="nowrap">{when(r.at)}</td>
                    <td>{r.actor}</td>
                    <td>{auditLabel(r.action)}</td>
                    <td className="audit-detail">{summariseDetail(r.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
        </>
      )}
    </section>
  );
}
