// ════════════════════════════════════════════════════════════
//   AUTH & CLOUD
// ════════════════════════════════════════════════════════════
// Supabase authentication, cloud save/load, admin panel

// SUPABASE AUTH & CLOUD
// ══════════════════════════════════════════════════════
const SUPA_URL = 'https://pulzirakjqehsulmjhdj.supabase.co';
const SUPA_KEY = 'sb_publishable_OhLaDHyG14xrHMfSW4xzpw_BieCf9gC';
let supa;
try {
  supa = supabase.createClient(SUPA_URL, SUPA_KEY);
} catch(e) {
  console.warn('Supabase SDK not loaded, running offline');
  // Stub — чтобы код не падал при отсутствии Supabase SDK
  const _offErr = {message:'offline'};
  const _offQ = () => {
    const q = {data:null, error:_offErr, single:()=>({data:null,error:null}), eq:()=>q, order:()=>q, limit:()=>({data:[],error:null}), select:()=>q};
    return q;
  };
  supa = {
    from:()=>({select:_offQ, insert:()=>({select:()=>({data:[],error:_offErr})}), update:()=>({eq:()=>({error:_offErr})}), delete:()=>({eq:()=>({error:_offErr})}), upsert:()=>({data:null,error:_offErr})}),
    auth:{getSession:()=>Promise.resolve({data:{session:null}}), signInWithPassword:()=>Promise.resolve({error:_offErr}), signUp:()=>Promise.resolve({error:_offErr}), signOut:()=>Promise.resolve({}), onAuthStateChange:()=>({data:{subscription:{unsubscribe:()=>{}}}})}
  };
}

let currentUser = null;  // { id, email, name, role }


// ─── TOGGLE PASSWORD VISIBILITY ───
const EYE_OPEN_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function togglePass(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = show ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
}

// ─── AUTH TAB SWITCH ───
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('loginForm').style.display    = isLogin ? 'block' : 'none';
  document.getElementById('registerForm').style.display = isLogin ? 'none'  : 'block';
  document.getElementById('tabLoginBtn').classList.toggle('active',  isLogin);
  document.getElementById('tabRegBtn').classList.toggle('active',   !isLogin);
  document.getElementById('authError').classList.remove('show');
  document.getElementById('regError').classList.remove('show');
}

// ─── REGISTER ───
async function doRegister() {
  const name  = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass  = document.getElementById('regPass').value;
  const btn   = document.getElementById('regSubmitBtn');
  const err   = document.getElementById('regError');
  err.classList.remove('show');

  if (!name)         { err.textContent='Введите имя'; err.classList.add('show'); return; }
  if (!email)        { err.textContent='Введите email'; err.classList.add('show'); return; }
  if (pass.length<6) { err.textContent='Пароль минимум 6 символов'; err.classList.add('show'); return; }

  btn.disabled=true; btn.textContent='Отправляем...';

  const { data, error } = await supa.auth.signUp({
    email, password: pass,
    options: { data: { name, role: 'manager' } }
  });

  btn.disabled=false; btn.textContent='Отправить заявку →';

  if (error) { err.textContent=error.message; err.classList.add('show'); return; }

  // Создать профиль со статусом pending
  if (data.user) {
    await supa.from('profiles').upsert({
      id: data.user.id, name, email, role: 'manager', approved: false
    });
  }

  // Показать экран ожидания
  hideAuthScreen();
  document.getElementById('pendingEmail').textContent = email;
  document.getElementById('pendingScreen').classList.add('show');
}

// ─── PENDING CHECK ───
async function checkApproved(userId) {
  const { data } = await supa.from('profiles').select('approved').eq('id', userId).single();
  return data?.approved !== false; // null или true = одобрен (для старых записей без поля)
}

// ─── INIT: проверить сессию при загрузке ───
async function initAuth() {
  // ─── DEV MODE: bypass auth ───
  try { hideAuthScreen(); } catch(e){}
  state.role = 'manager';
  state.userName = 'Test User';
  try { updateHeaderUser(); } catch(e){}
  try { loadDraft(); } catch(e){}
  try { updateNextBtns(); } catch(e){}
  // Попробовать подключиться к Supabase в фоне
  try {
    const { data: { session } } = await supa.auth.getSession();
    if (session) await onLogin(session.user);
  } catch(e) {
    console.log('Supabase offline, running in dev mode');
  }
}

function showAuthScreen() {
  document.getElementById('authScreen').classList.remove('hidden');
}
function hideAuthScreen() {
  document.getElementById('authScreen').classList.add('hidden');
}

async function onLogin(user) {
  // Подгрузить профиль
  const { data: profile } = await supa.from('profiles').select('*').eq('id', user.id).single();

  // Если профиля нет — создать
  if (!profile) {
    await supa.from('profiles').upsert({
      id: user.id, email: user.email,
      name: user.user_metadata?.name || user.email.split('@')[0],
      role: 'manager', approved: false
    });
    hideAuthScreen();
    document.getElementById('pendingEmail').textContent = user.email;
    document.getElementById('pendingScreen').classList.add('show');
    return;
  }

  // Проверить одобрение (admin всегда одобрен)
  if (profile.role !== 'admin' && profile.approved === false) {
    hideAuthScreen();
    document.getElementById('pendingEmail').textContent = user.email;
    document.getElementById('pendingScreen').classList.add('show');
    return;
  }

  currentUser = {
    id: user.id,
    email: user.email,
    name: profile?.name || user.email.split('@')[0],
    role: profile?.role || 'manager'
  };
  hideAuthScreen();
  document.getElementById('pendingScreen').classList.remove('show');
  updateHeaderUser();

  // Показать кнопку Панель только admin
  const adminBtn = document.getElementById('adminPanelBtn');
  const pricesBtn = document.getElementById('pricesBtn');
  // v1.5.1: все кнопки видны всем, роли в v1.6
  if (adminBtn) adminBtn.style.display = '';
  if (pricesBtn) pricesBtn.style.display = '';
}

function updateHeaderUser() {
  if (!currentUser) return;
  const wrap = document.getElementById('headerUserInfo');
  if (!wrap) return;
  wrap.style.display = 'flex';
  const name = document.getElementById('headerUserName');
  const role = document.getElementById('headerUserRole');
  if (name) name.textContent = currentUser.name || '';
  if (role) {
    role.textContent = currentUser.role === 'admin' ? 'Admin' : 'Менеджер';
    role.className = 'user-role-tag ' + currentUser.role;
  }
}

// ─── LOGIN ───
async function doLogin() {
  const email = document.getElementById('authEmail').value.trim();
  const pass  = document.getElementById('authPass').value;
  const btn   = document.getElementById('authSubmitBtn');
  const err   = document.getElementById('authError');
  err.classList.remove('show');
  if (!email || !pass) { err.textContent='Заполните все поля'; err.classList.add('show'); return; }
  btn.disabled = true; btn.textContent = 'Входим...';
  const { data, error } = await supa.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false; btn.textContent = 'Войти →';
  if (error) { err.textContent = 'Неверный email или пароль'; err.classList.add('show'); return; }
  await onLogin(data.user);
}

// ─── LOGOUT ───
async function doLogout() {
  await supa.auth.signOut();
  currentUser = null;
  document.getElementById('headerUserInfo').style.display = 'none';
  const pricesBtn = document.getElementById('pricesBtn');
  // v1.5.1: кнопка Цены остаётся видимой
  document.getElementById('pendingScreen').classList.remove('show');
  switchAuthTab('login');
  showAuthScreen();
}

// ══════════════════════════════════════════════════════

// CLOUD SAVE / LOAD ORDERS
// ══════════════════════════════════════════════════════

// Переопределяем getOrders / saveOrders для облака
async function getOrdersCloud() {
  // v1.5.1: auth убрана, заказы доступны всем
  const { data, error } = await supa.from('orders').select('*, profiles(name)').order('created_at', {ascending:false});
  if (error) { console.error(error); return []; }
  return (data||[]).map(o => ({
    id: o.order_number || o.id,
    _supaId: o.id,
    status: o.status,
    createdAt: new Date(o.created_at).getTime(),
    managerName: o.profiles?.name || '—',
    ...o.data
  }));
}

async function saveOrderCloud(orderData) {
  const payload = {
    created_by: null, // v1.5.1: auth убрана, роли в v1.6
    bitrix_deal: orderData.bitrix_deal || null,
    status: 'draft',
    data: {
      type: orderData.type, fabric: orderData.fabric, fit: orderData.fit, sku: orderData.sku ? {article:orderData.sku.article,name:orderData.sku.name,category:orderData.sku.category,fit:orderData.sku.fit} : null, extras: orderData.extras || [], labels: orderData.labels || [],
      color: orderData.color, sizes: orderData.sizes, customSizes: orderData.customSizes,
      totalQty: orderData.totalQty, zones: orderData.zones, tech: orderData.tech,
      zoneTechs: orderData.zoneTechs,
      zonePrints: orderData.zonePrints, flexZones: orderData.flexZones,
      dtgZones: orderData.dtgZones, embZones: orderData.embZones, dtfZones: orderData.dtfZones, zoneArtworks: orderData.zoneArtworks,
      textileColor: orderData.textileColor, dtgTextile: orderData.dtgTextile,
      designNotes: orderData.designNotes,
      name: orderData.name, contact: orderData.contact,
      email: orderData.email, deadline: orderData.deadline,
      address: orderData.address, notes: orderData.notes,
      labelOption: orderData.labelOption, packOption: orderData.packOption,
      urgentOption: orderData.urgentOption, total: orderData.total
    },
    total_sum: orderData.total || 0,
    total_qty: orderData.totalQty || 0,
    item_type: orderData.type || null,
    artwork_link: orderData.artwork_link || null,
    notes: orderData.notes || null
  };
  const { data, error } = await supa.from('orders').insert(payload).select();
  if (error) { console.error('Save order error:', error); return null; }
  return data?.[0] || null;
}

async function updateOrderCloud(supaId, orderData) {
  const payload = {
    bitrix_deal: orderData.bitrix_deal || null,
    data: {
      type: orderData.type, fabric: orderData.fabric, fit: orderData.fit, sku: orderData.sku ? {article:orderData.sku.article,name:orderData.sku.name,category:orderData.sku.category,fit:orderData.sku.fit} : null, extras: orderData.extras || [], labels: orderData.labels || [],
      color: orderData.color, sizes: orderData.sizes, customSizes: orderData.customSizes,
      totalQty: orderData.totalQty, zones: orderData.zones, tech: orderData.tech,
      zoneTechs: orderData.zoneTechs,
      zonePrints: orderData.zonePrints, flexZones: orderData.flexZones,
      dtgZones: orderData.dtgZones, embZones: orderData.embZones, dtfZones: orderData.dtfZones, zoneArtworks: orderData.zoneArtworks,
      textileColor: orderData.textileColor, dtgTextile: orderData.dtgTextile,
      designNotes: orderData.designNotes,
      name: orderData.name, contact: orderData.contact,
      email: orderData.email, deadline: orderData.deadline,
      address: orderData.address, notes: orderData.notes,
      labelOption: orderData.labelOption, packOption: orderData.packOption,
      urgentOption: orderData.urgentOption, total: orderData.total
    },
    total_sum: orderData.total || 0,
    total_qty: orderData.totalQty || 0,
    item_type: orderData.type || null,
    artwork_link: orderData.artwork_link || null,
    notes: orderData.notes || null
  };
  const { data, error } = await supa.from('orders').update(payload).eq('id', supaId).select();
  if (error) { console.error('Update order error:', error); return null; }
  return data?.[0] || null;
}


async function deleteOrderCloud(supaId) {
  const { error } = await supa.from('orders').delete().eq('id', supaId);
  if (error) console.error(error);
}

async function updateOrderStatusCloud(supaId, status) {
  const { error } = await supa.from('orders').update({status}).eq('id', supaId);
  if (error) console.error(error);
}

// ══════════════════════════════════════════════════════

// ADMIN PANEL
// ══════════════════════════════════════════════════════
let adminCurrentTab = 'orders';

function openAdminPanel() {
  document.getElementById('adminPanel').classList.add('show');
  document.getElementById('adminUserName').textContent = currentUser.name;
  adminTab('orders');
}
function adminToStudio() {
  document.getElementById('adminPanel').classList.remove('show');
}

function adminTab(tab) {
  adminCurrentTab = tab;
  document.querySelectorAll('.admin-tab').forEach((t,i) => {
    t.classList.toggle('active', ['orders','users'][i] === tab);
  });
  document.getElementById('adminTabOrders').style.display = tab === 'orders' ? 'block' : 'none';
  document.getElementById('adminTabUsers').style.display  = tab === 'users'  ? 'block' : 'none';
  if (tab === 'orders') loadAdminOrders();
  if (tab === 'users')  loadAdminUsers();
}

async function loadAdminOrders() {
  const tbody = document.getElementById('adminOrdersTbody');
  tbody.innerHTML = '<tr><td colspan="9" style="padding:20px;text-align:center;color:var(--text-dim)">Загрузка...</td></tr>';

  const { data, error } = await supa.from('orders')
    .select('*, profiles(name)').order('created_at', {ascending:false});
  if (error) { tbody.innerHTML = '<tr><td colspan="9" style="padding:20px;color:var(--accent)">Ошибка загрузки</td></tr>'; return; }

  // Stats
  const total = data.length;
  const newC  = data.filter(o=>o.status==='draft').length;
  const workC = data.filter(o=>o.status==='production').length;
  const rev   = data.reduce((a,o)=>a+(o.data?.total||0),0);
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statNew').textContent   = newC;
  document.getElementById('statWork').textContent  = workC;
  document.getElementById('statRev').textContent   = (rev/1000).toFixed(0)+'к ₽';

  const STATUS = {draft:'Черновик',review:'Согласование',approved:'Одобрен',production:'В работе',done:'Готов'};
  tbody.innerHTML = data.map(o => {
    const d = o.data || {};
    const date = new Date(o.created_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'});
    return `<tr>
      <td><strong>${o.order_number||o.id.slice(0,8)}</strong></td>
      <td>${d.name||'—'}</td>
      <td>${o.profiles?.name||'—'}</td>
      <td>${TYPE_NAMES[d.type]||d.type||'—'} · ${(d.tech||'').toUpperCase()}</td>
      <td>${d.totalQty||0} шт</td>
      <td>${(d.total||0).toLocaleString('ru')} ₽</td>
      <td><span class="a-badge a-badge-${o.status}">${STATUS[o.status]||o.status}</span></td>
      <td style="color:var(--text-dim);font-size:11px">${date}</td>
      <td>
        <select class="admin-btn" style="padding:0 6px;height:28px;cursor:pointer"
          onchange="adminChangeStatus('${o.id}',this.value)">
          ${Object.entries(STATUS).map(([v,l])=>`<option value="${v}"${o.status===v?' selected':''}>${l}</option>`).join('')}
        </select>
        <button class="admin-btn danger" onclick="adminDeleteOrder('${o.id}')">✕</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" style="padding:20px;text-align:center;color:var(--text-dim)">Заказов пока нет</td></tr>';
}

async function adminChangeStatus(supaId, status) {
  await supa.from('orders').update({status}).eq('id', supaId);
}

async function adminDeleteOrder(supaId) {
  if (!confirm('Удалить заказ?')) return;
  await supa.from('orders').delete().eq('id', supaId);
  loadAdminOrders();
}

async function loadAdminUsers() {
  const tbody = document.getElementById('adminUsersTbody');
  tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-dim)">Загрузка...</td></tr>';

  const { data: profiles, error } = await supa.from('profiles').select('*').order('created_at');
  if (error) { tbody.innerHTML = '<tr><td colspan="5" style="padding:20px;color:var(--accent)">Ошибка</td></tr>'; return; }

  // Считаем заказы каждого
  const { data: orderCounts } = await supa.from('orders').select('created_by');
  const countMap = {};
  (orderCounts||[]).forEach(o => { countMap[o.created_by] = (countMap[o.created_by]||0)+1; });

  tbody.innerHTML = profiles.map(p => {
    const isPending = p.approved === false;
    const roleLabel = p.role==='admin' ? 'Admin' : 'Менеджер';
    return `<tr${isPending?' style="background:rgba(230,160,32,.06)"':''}>
      <td><strong>${p.name||'—'}</strong></td>
      <td style="color:var(--text-dim);font-size:11px">${p.email||'—'}</td>
      <td>
        <span class="a-badge a-badge-${p.role}">${roleLabel}</span>
        ${isPending ? '<span class="a-badge a-badge-pending" style="margin-left:4px">Ожидает</span>' : ''}
      </td>
      <td>${countMap[p.id]||0}</td>
      <td>
        ${isPending
          ? `<button class="admin-btn approve-btn" onclick="adminApproveUser('${p.id}','${p.name||''}')">✓ Одобрить</button>
             <button class="admin-btn danger" onclick="adminDeleteUser('${p.id}','${p.name||''}')">✕</button>`
          : `<button class="admin-btn" onclick="adminToggleRole('${p.id}','${p.role}','${p.name||''}')">
               ${p.role==='admin'?'→ Менеджер':'→ Admin'}
             </button>
             ${p.id !== currentUser.id ? `<button class="admin-btn danger" onclick="adminDeleteUser('${p.id}','${p.name||''}')">✕</button>` : ''}`
        }
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-dim)">Пусто</td></tr>';
}

async function adminApproveUser(userId, name) {
  if (!confirm(`Одобрить доступ для ${name}?`)) return;
  await supa.from('profiles').update({ approved: true }).eq('id', userId);
  loadAdminUsers();
}

async function adminToggleRole(userId, currentRole, name) {
  const newRole = currentRole === 'admin' ? 'manager' : 'admin';
  if (!confirm(`Изменить роль ${name} на «${newRole}»?`)) return;
  await supa.from('profiles').update({role: newRole}).eq('id', userId);
  loadAdminUsers();
}

async function adminDeleteUser(userId, name) {
  if (!confirm(`Удалить пользователя ${name}? Его заказы останутся.`)) return;
  // Удаляем через admin API — нужен service key, поэтому просто удаляем профиль
  await supa.from('profiles').delete().eq('id', userId);
  loadAdminUsers();
}

// ─── ADD USER ───
function showAddUserModal() {
  document.getElementById('addUserModal').classList.add('show');
  document.getElementById('addUserError').classList.remove('show');
}
function hideAddUserModal() {
  document.getElementById('addUserModal').classList.remove('show');
}

async function confirmAddUser() {
  const name  = document.getElementById('newUserName').value.trim();
  const email = document.getElementById('newUserEmail').value.trim();
  const pass  = document.getElementById('newUserPass').value;
  const role  = document.getElementById('newUserRole').value;
  const err   = document.getElementById('addUserError');
  const btn   = document.getElementById('addUserOkBtn');
  err.classList.remove('show');

  if (!name||!email||!pass) { err.textContent='Заполните все поля'; err.classList.add('show'); return; }
  if (pass.length < 6) { err.textContent='Пароль минимум 6 символов'; err.classList.add('show'); return; }

  btn.disabled=true; btn.textContent='Создаём...';

  const { data, error } = await supa.auth.signUp({
    email, password: pass,
    options: { data: { name, role } }
  });

  btn.disabled=false; btn.textContent='Создать →';

  if (error) { err.textContent=error.message; err.classList.add('show'); return; }

  // Обновляем профиль (триггер создаст его, но имя/роль могут не прийти сразу)
  if (data.user) {
    await supa.from('profiles').upsert({ id: data.user.id, name, email, role, approved: true });
  }

  hideAddUserModal();
  document.getElementById('newUserName').value='';
  document.getElementById('newUserEmail').value='';
  document.getElementById('newUserPass').value='';
  loadAdminUsers();
}




