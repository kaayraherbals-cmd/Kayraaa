/** Admin view of signed-up members (people with an account on the site, not launch-list subscribers). */
export interface MemberRow {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'member';
  provider: string;
  has_password: boolean;
  created_at: string;
  last_login_at: string;
}
export const MEMBER_CSV_HEADERS = ['email', 'name', 'provider', 'role', 'has_password', 'created_at', 'last_login_at'] as const;
export const memberCsvRow = (m: MemberRow): Record<string, unknown> => ({
  email: m.email,
  name: m.name ?? '',
  provider: m.provider,
  role: m.role,
  has_password: m.has_password ? 'yes' : 'no',
  created_at: m.created_at,
  last_login_at: m.last_login_at,
});
