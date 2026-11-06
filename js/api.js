// Слой данных. Реальная реализация поверх Supabase; в тестах подменяется через window.__API__
const T = { objects: 'cl_objects', accounts: 'cl_accounts', articles: 'cl_articles', ops: 'cl_operations', planned: 'cl_planned', members: 'cl_members', branches: 'cl_branches', owners: 'cl_branch_owners' };

export function createApi() {
  const cfg = window.CL_CONFIG || {};
  const sb = window.supabase.createClient(cfg.url, cfg.key);
  const fail = e => { if (e) throw new Error(e.message || String(e)); };

  async function loadAll(table, order) {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await sb.from(table).select('*').order(order, { ascending: true }).range(from, from + size - 1);
      fail(error); out.push(...data); if (data.length < size) break;
    }
    return out;
  }
  return {
    async session() { const { data } = await sb.auth.getSession(); return data.session ? { email: data.session.user.email, id: data.session.user.id } : null; },
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); fail(error); },
    async signUp(email, password) { const { data, error } = await sb.auth.signUp({ email, password }); fail(error); return { needsConfirm: !data.session }; },
    async signOut() { await sb.auth.signOut(); },
    async register() { const { data, error } = await sb.rpc('cl_register'); fail(error); return data; },
    load: table => loadAll(T[table], 'id'),
    async insert(table, row) { const { data, error } = await sb.from(T[table]).insert(row).select().single(); fail(error); return data; },
    async update(table, id, patch) { const { data, error } = await sb.from(T[table]).update(patch).eq('id', id).select().single(); fail(error); return data; },
    async remove(table, id) { const { error } = await sb.from(T[table]).delete().eq('id', id); fail(error); },
    async updateMember(userId, patch) { const { error } = await sb.from(T.members).update(patch).eq('user_id', userId); fail(error); },
    async removeMember(userId) { const { error } = await sb.from(T.members).delete().eq('user_id', userId); fail(error); },
    async loadMembers() { const { data, error } = await sb.from(T.members).select('*').order('created_at'); fail(error); return data; },
  };
}
