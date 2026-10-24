import { useEffect, useState } from 'react';
import type { MemberRow } from '../../shared/members';
import { Pager, api, errorText, usePaged, useMe, when } from '../lib/adminKit';

/** People with an account on the site. Deleting removes the member row and the sign-in identity (owners only). */
export default function AdminMembers({ onExpired }: { onExpired: () => void }) {
  const me = useMe();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setApplied(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const { page, setPage, data, error, loading, reload } = usePaged<MemberRow>(`members${applied ? `?q=${encodeURIComponent(applied)}` : ''}`, onExpired);

  async function remove(m: MemberRow) {
    if (!window.confirm(`Permanently delete the account for ${m.email}? This also removes their sign-in and cannot be undone.`)) return;
    const r = await api(`members?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    if (r.status === 401) return onExpired();
    setNotice(r.ok ? 'Account deleted.' : errorText(r, 'Could not delete the account.'));
    void reload();
  }

  return (
    <section aria-labelledby="mem-title">
      <div className="admin-toolbar">
        <h1 id="mem-title">Members</h1>
        <div className="field admin-search">
          <label htmlFor="mem-q">Search name or email</label>
          <input id="mem-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
        </div>
        {me.can('members.export') && (
          <a className="btn btn--ghost btn--sm" href="/api/admin/members-export">
            Export CSV
          </a>
        )}
      </div>
      <p className="field-hint">Passwords are never stored here or shown anywhere; Supabase keeps only hashes. Most recent sign-in first.</p>
      {notice && <p className="form-status form-status--info" role="status">{notice}</p>}
      {error && <p className="form-status form-status--error" role="alert">{error}</p>}
      {loading && !data && <div className="admin-skeleton" role="status" aria-label="Loading"><span /><span /><span /></div>}
      {data && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Members</caption>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Name</th>
                  <th scope="col">Sign-in</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={6}>{applied ? 'No members match this search.' : 'No members yet.'}</td>
                  </tr>
                )}
                {data.items.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.email} {m.role === 'admin' && <span className="badge admin-role">Admin</span>}
                    </td>
                    <td>{m.name ?? ''}</td>
                    <td>
                      {m.provider}
                      {m.has_password ? ' + password' : ''}
                    </td>
                    <td className="nowrap">{when(m.created_at)}</td>
                    <td className="nowrap">{when(m.last_login_at)}</td>
                    <td>
                      {me.can('members.delete') && m.role !== 'admin' && (
                        <button type="button" className="btn btn--ghost btn--sm btn--danger" onClick={() => void remove(m)}>
                          Delete
                        </button>
                      )}
                    </td>
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
