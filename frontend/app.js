const API_BASE = window.API_BASE || 'http://localhost:4000/api';

const state = {
  token: localStorage.getItem('wt_token') || null,
  user: JSON.parse(localStorage.getItem('wt_user') || 'null'),
  accounts: [],
  traders: [],
  subscriptions: [],
  notifications: [],
  unreadCount: 0,
};

// ---------- API helper ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ---------- Toast ----------
function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3200);
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------- View switching ----------
function showApp() {
  document.getElementById('view-auth').classList.add('hidden');
  document.getElementById('view-app').classList.remove('hidden');
  document.getElementById('user-name-display').textContent = state.user.display_name;
  document.getElementById('user-avatar').textContent = state.user.display_name.charAt(0);
  document.getElementById('btn-logout').addEventListener('click', logout);
  loadAll();
}

function showAuth() {
  document.getElementById('view-auth').classList.remove('hidden');
  document.getElementById('view-app').classList.add('hidden');
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('wt_token');
  localStorage.removeItem('wt_user');
  showAuth();
}

// ---------- Page navigation ----------
function goToPage(page) {
  document.querySelectorAll('.page').forEach((el) => el.classList.add('hidden'));
  document.getElementById(`page-${page}`).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'notifications') markAllNotificationsRead();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => goToPage(btn.dataset.page));
});
document.querySelectorAll('[data-goto]').forEach((btn) => {
  btn.addEventListener('click', () => goToPage(btn.dataset.goto));
});

// ---------- Auth forms ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('form-login').classList.toggle('hidden', target !== 'login');
    document.getElementById('form-signup').classList.toggle('hidden', target !== 'signup');
  });
});

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.querySelector('.form-error[data-for="login"]');
  errEl.textContent = '';
  const fd = new FormData(e.target);
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email: fd.get('email'), password: fd.get('password') },
    });
    onAuthSuccess(data);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('form-signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.querySelector('.form-error[data-for="signup"]');
  errEl.textContent = '';
  const fd = new FormData(e.target);
  try {
    const data = await api('/auth/signup', {
      method: 'POST',
      body: {
        email: fd.get('email'),
        password: fd.get('password'),
        displayName: fd.get('displayName'),
      },
    });
    onAuthSuccess(data);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

function onAuthSuccess({ token, user }) {
  state.token = token;
  state.user = user;
  localStorage.setItem('wt_token', token);
  localStorage.setItem('wt_user', JSON.stringify(user));
  showApp();
}

// ---------- Link account ----------
document.getElementById('btn-show-link').addEventListener('click', () => {
  document.getElementById('form-link-account').classList.toggle('hidden');
});

document.getElementById('form-link-account').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.querySelector('.form-error[data-for="link-account"]');
  errEl.textContent = '';
  const fd = new FormData(e.target);
  try {
    await api('/accounts', {
      method: 'POST',
      body: {
        platform: fd.get('platform'),
        login: fd.get('login'),
        server: fd.get('server'),
        password: fd.get('password'),
        nickname: fd.get('nickname') || undefined,
      },
    });
    toast('Account connected');
    e.target.reset();
    e.target.classList.add('hidden');
    await loadAccounts();
    await loadNotifications();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---------- Become a trader ----------
document.getElementById('form-become-trader').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.querySelector('.form-error[data-for="become-trader"]');
  errEl.textContent = '';
  const fd = new FormData(e.target);
  try {
    await api('/traders', {
      method: 'POST',
      body: {
        mtAccountId: Number(fd.get('mtAccountId')),
        headline: fd.get('headline'),
        description: fd.get('description') || undefined,
      },
    });
    toast('Now listed as a trader');
    e.target.reset();
    e.target.classList.add('hidden');
    await Promise.all([loadAccounts(), loadTraders()]);
    await loadNotifications();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---------- Notifications ----------
document.getElementById('btn-mark-all-read').addEventListener('click', markAllNotificationsRead);

async function markAllNotificationsRead() {
  if (state.unreadCount === 0) return;
  try {
    await api('/notifications/read-all', { method: 'POST' });
    state.unreadCount = 0;
    renderNotifBadge();
  } catch (err) {
    // non-critical, fail silently
  }
}

// ---------- Data loading ----------
async function loadAll() {
  await Promise.all([loadAccounts(), loadTraders(), loadSubscriptions(), loadNotifications()]);
  renderDashboard();
}

async function loadAccounts() {
  const data = await api('/accounts');
  state.accounts = data.accounts;
  renderAccounts();
  renderTradesAccountSelect();
}

async function loadTraders() {
  const data = await api('/traders');
  state.traders = data.traders;
  renderTraders();
}

async function loadSubscriptions() {
  const data = await api('/subscriptions');
  state.subscriptions = data.subscriptions;
  renderSubscriptions();
}

async function loadNotifications() {
  const data = await api('/notifications');
  state.notifications = data.notifications;
  state.unreadCount = data.unreadCount;
  renderNotifications();
  renderNotifBadge();
  renderDashboard();
}

// ---------- Rendering: dashboard ----------
function renderDashboard() {
  document.getElementById('stat-accounts').textContent = state.accounts.length;
  document.getElementById('stat-follows').textContent = state.subscriptions.filter((s) => s.status === 'active').length;
  document.getElementById('stat-trader-accounts').textContent = state.accounts.filter((a) => a.role === 'trader').length;
  document.getElementById('stat-unread').textContent = state.unreadCount;

  const list = document.getElementById('dashboard-activity');
  const recent = state.notifications.slice(0, 6);
  list.innerHTML = recent.length
    ? recent.map((n) => `
      <li>
        <div class="item-title">${n.message}</div>
        <span class="activity-time">${timeAgo(n.created_at)}</span>
      </li>`).join('')
    : '<li class="empty-state">No activity yet — link an account to get started.</li>';
}

// ---------- Rendering: notifications ----------
function renderNotifBadge() {
  const badge = document.getElementById('nav-notif-badge');
  if (state.unreadCount > 0) {
    badge.textContent = state.unreadCount;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function renderNotifications() {
  const list = document.getElementById('notifications-list');
  list.innerHTML = state.notifications.length
    ? state.notifications.map((n) => `
      <li>
        <div class="item-title">${n.message}</div>
        <span class="activity-time">${timeAgo(n.created_at)}</span>
      </li>`).join('')
    : '<li class="empty-state">No notifications yet.</li>';
}

// ---------- Rendering: accounts ----------
function renderAccounts() {
  const list = document.getElementById('account-list');
  list.innerHTML = '';
  if (state.accounts.length === 0) {
    list.innerHTML = '<li class="empty-state">No accounts linked yet.</li>';
    return;
  }
  for (const acc of state.accounts) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <div class="item-title">${acc.nickname || acc.mt_login} <span class="item-sub">· ${acc.platform.toUpperCase()}</span></div>
        <div class="item-sub">${acc.broker_server} · ${acc.role === 'trader' ? 'trader account' : 'follower account'}</div>
      </div>
      <div>
        <button class="btn small" data-view-details="${acc.id}">View details</button>
        ${acc.role === 'follower' ? `<button class="btn small" data-become-trader="${acc.id}" data-account-label="${acc.nickname || acc.mt_login}">Make trader</button>` : ''}
        <button class="btn small" data-remove-account="${acc.id}">Unlink</button>
      </div>
    `;
    list.appendChild(li);
  }
  list.querySelectorAll('[data-view-details]').forEach((btn) => {
    btn.addEventListener('click', () => showAccountDetails(btn.dataset.viewDetails));
  });
  list.querySelectorAll('[data-become-trader]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = document.getElementById('form-become-trader');
      form.classList.remove('hidden');
      form.mtAccountId.value = btn.dataset.becomeTrader;
      document.getElementById('become-trader-target').textContent =
        `Listing "${btn.dataset.accountLabel}" as a followable trader`;
      form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
  list.querySelectorAll('[data-remove-account]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/accounts/${btn.dataset.removeAccount}`, { method: 'DELETE' });
        toast('Account unlinked');
        await loadAccounts();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

async function showAccountDetails(accountId) {
  const panel = document.getElementById('account-details');
  panel.classList.remove('hidden');
  panel.innerHTML = '<p class="empty-state">Loading account details…</p>';

  try {
    const data = await api(`/accounts/${accountId}/snapshot?days=30`);
    const s = data.snapshot;
    const fmt = (n) => (typeof n === 'number' ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');

    const historyRows = s.trades.length
      ? s.trades.map((t) => `
        <tr>
          <td>${new Date(t.time).toLocaleString()}</td>
          <td>${t.symbol || '—'}</td>
          <td>${(t.type || '').replace('DEAL_TYPE_', '')}</td>
          <td>${t.volume ?? '—'}</td>
          <td>${t.price ?? '—'}</td>
          <td class="${t.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${fmt(t.profit)}</td>
        </tr>`).join('')
      : `<tr><td colspan="6" class="empty-state">No closed trades in the last 30 days.</td></tr>`;

    panel.innerHTML = `
      <button class="details-close" id="close-details">✕ close</button>
      <div class="balance-row">
        <div class="balance-stat"><span class="label">Balance</span><span class="value">${fmt(s.balance)} ${s.currency || ''}</span></div>
        <div class="balance-stat"><span class="label">Equity</span><span class="value ${s.equity >= s.balance ? 'positive' : 'negative'}">${fmt(s.equity)} ${s.currency || ''}</span></div>
        <div class="balance-stat"><span class="label">Margin</span><span class="value">${fmt(s.margin)}</span></div>
        <div class="balance-stat"><span class="label">Free margin</span><span class="value">${fmt(s.freeMargin)}</span></div>
        <div class="balance-stat"><span class="label">Leverage</span><span class="value">1:${s.leverage ?? '—'}</span></div>
      </div>
      <table class="history-table">
        <thead><tr><th>Time</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th><th>Profit</th></tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    `;
    document.getElementById('close-details').addEventListener('click', () => panel.classList.add('hidden'));
  } catch (err) {
    panel.innerHTML = `<p class="form-error">${err.message}</p><button class="details-close" id="close-details">✕ close</button>`;
    document.getElementById('close-details').addEventListener('click', () => panel.classList.add('hidden'));
  }
}

// ---------- Rendering: trades page ----------
function renderTradesAccountSelect() {
  const select = document.getElementById('trades-account-select');
  const previous = select.value;
  select.innerHTML = state.accounts.length
    ? state.accounts.map((a) => `<option value="${a.id}">${a.nickname || a.mt_login} (${a.platform.toUpperCase()})</option>`).join('')
    : '<option value="">No accounts linked</option>';
  if (previous && state.accounts.some((a) => String(a.id) === previous)) {
    select.value = previous;
  }
  if (state.accounts.length > 0) loadTradesForSelectedAccount();
}

document.getElementById('trades-account-select').addEventListener('change', loadTradesForSelectedAccount);

async function loadTradesForSelectedAccount() {
  const select = document.getElementById('trades-account-select');
  const container = document.getElementById('trades-content');
  if (!select.value) {
    container.innerHTML = '<p class="empty-state">Link an account to see trade history.</p>';
    return;
  }
  container.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const data = await api(`/accounts/${select.value}/snapshot?days=30`);
    const s = data.snapshot;
    const fmt = (n) => (typeof n === 'number' ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
    const rows = s.trades.length
      ? s.trades.map((t) => `
        <tr>
          <td>${new Date(t.time).toLocaleString()}</td>
          <td>${t.symbol || '—'}</td>
          <td>${(t.type || '').replace('DEAL_TYPE_', '')}</td>
          <td>${t.volume ?? '—'}</td>
          <td>${t.price ?? '—'}</td>
          <td class="${t.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${fmt(t.profit)}</td>
        </tr>`).join('')
      : `<tr><td colspan="6" class="empty-state">No closed trades in the last 30 days.</td></tr>`;

    container.innerHTML = `
      <div class="balance-row">
        <div class="balance-stat"><span class="label">Balance</span><span class="value">${fmt(s.balance)} ${s.currency || ''}</span></div>
        <div class="balance-stat"><span class="label">Equity</span><span class="value ${s.equity >= s.balance ? 'positive' : 'negative'}">${fmt(s.equity)} ${s.currency || ''}</span></div>
        <div class="balance-stat"><span class="label">Margin</span><span class="value">${fmt(s.margin)}</span></div>
      </div>
      <table class="history-table">
        <thead><tr><th>Time</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th><th>Profit</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<p class="form-error">${err.message}</p>`;
  }
}

// ---------- Rendering: traders & subscriptions ----------
function renderTraders() {
  const list = document.getElementById('trader-list');
  list.innerHTML = '';
  if (state.traders.length === 0) {
    list.innerHTML = '<li class="empty-state">No traders listed yet.</li>';
    return;
  }
  for (const trader of state.traders) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <div class="item-title">${trader.trader_name} — ${trader.headline}</div>
        <div class="item-sub">${trader.follower_count} follower${trader.follower_count == 1 ? '' : 's'}</div>
      </div>
      <button class="btn follow" data-follow-trader="${trader.id}">Follow</button>
    `;
    list.appendChild(li);
  }
  list.querySelectorAll('[data-follow-trader]').forEach((btn) => {
    btn.addEventListener('click', () => followTrader(btn.dataset.followTrader));
  });
}

function renderSubscriptions() {
  const list = document.getElementById('subscription-list');
  list.innerHTML = '';
  if (state.subscriptions.length === 0) {
    list.innerHTML = '<li class="empty-state">You aren\'t copying anyone yet — follow a trader.</li>';
    return;
  }
  for (const sub of state.subscriptions) {
    const li = document.createElement('li');
    const stopped = sub.status === 'stopped';
    li.innerHTML = `
      <div>
        <div class="item-title">${sub.trader_name} <span class="item-sub">→ ${sub.follower_account_nickname || 'your account'}</span></div>
        <div class="item-sub">${stopped ? 'Stopped' : `Copying at ${sub.size_scaling}x size · max drawdown ${sub.max_drawdown_pct}%`}</div>
      </div>
      ${stopped ? '' : `<button class="btn unfollow" data-unfollow="${sub.id}">Unfollow</button>`}
    `;
    list.appendChild(li);
  }
  list.querySelectorAll('[data-unfollow]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/subscriptions/${btn.dataset.unfollow}`, { method: 'DELETE' });
        toast('Stopped copying');
        await loadSubscriptions();
        await loadNotifications();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

async function followTrader(traderProfileId) {
  if (state.accounts.length === 0) {
    toast('Link a MetaTrader account first', true);
    return;
  }
  const followerAccountId = state.accounts[0].id; // MVP: copy onto the first linked account
  try {
    await api('/subscriptions', {
      method: 'POST',
      body: { followerAccountId, traderProfileId },
    });
    toast('Now copying this trader');
    await loadSubscriptions();
    await loadNotifications();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- Init ----------
if (state.token && state.user) {
  showApp();
} else {
  showAuth();
}
