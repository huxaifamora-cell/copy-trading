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
  renderVerifyBanner();
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-logout-mobile').addEventListener('click', logout);
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
    await Promise.all([loadAccounts(), loadTraders(), loadTraderProfilesMine()]);
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
  await Promise.all([loadAccounts(), loadTraders(), loadSubscriptions(), loadNotifications(), loadTraderProfilesMine()]);
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
  const badgeMobile = document.getElementById('nav-notif-badge-mobile');
  const dot = document.getElementById('mobile-notif-dot');
  const has = state.unreadCount > 0;
  [badge, badgeMobile].forEach((el) => {
    if (!el) return;
    el.textContent = state.unreadCount;
    el.classList.toggle('hidden', !has);
  });
  if (dot) dot.classList.toggle('hidden', !has);
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
      <div class="table-scroll"><table class="history-table">
        <thead><tr><th>Time</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th><th>Profit</th></tr></thead>
        <tbody>${historyRows}</tbody>
      </table></div>
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
      <div class="table-scroll"><table class="history-table">
        <thead><tr><th>Time</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th><th>Profit</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
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
    const feeLabel = trader.fee_enabled && trader.fee_cents
      ? ` · $${(trader.fee_cents / 100).toFixed(2)}/mo`
      : '';
    li.innerHTML = `
      <div>
        <div class="item-title">${trader.trader_name} — ${trader.headline}</div>
        <div class="item-sub">${trader.follower_count} follower${trader.follower_count == 1 ? '' : 's'}${feeLabel}</div>
      </div>
      <button class="btn follow" data-follow-trader="${trader.id}" data-trader-label="${trader.trader_name} — ${trader.headline}">Follow</button>
    `;
    list.appendChild(li);
  }
  list.querySelectorAll('[data-follow-trader]').forEach((btn) => {
    btn.addEventListener('click', () => openFollowForm(btn.dataset.followTrader, btn.dataset.traderLabel));
  });
}

function riskSummary(rs) {
  if (!rs || Object.keys(rs).length === 0) return 'Default settings';
  const parts = [];
  const mode = rs.lotSizing?.mode;
  if (mode === 'mirror') parts.push('mirrors trader\'s lots');
  else if (mode === 'balance_scaled') parts.push('scaled by balance');
  else if (mode) parts.push(`${mode.replace('_', ' ')} ${rs.lotSizing?.multiplier ?? ''}x`);
  if (rs.symbolAllowlist?.length) parts.push(`symbols: ${rs.symbolAllowlist.join(', ')}`);
  if (rs.maxOpenPositions) parts.push(`max ${rs.maxOpenPositions} positions`);
  if (rs.maxTradesPerDay) parts.push(`max ${rs.maxTradesPerDay} trades/day`);
  if (rs.dailyLossLimitPct) parts.push(`daily loss limit ${rs.dailyLossLimitPct}%`);
  if (rs.dailyProfitTargetPct) parts.push(`daily target ${rs.dailyProfitTargetPct}%`);
  if (rs.maxDrawdownPct) parts.push(`max drawdown ${rs.maxDrawdownPct}%`);
  return parts.join(' · ') || 'Default settings';
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
    const paused = sub.status === 'paused';
    let actions = '';
    if (stopped) {
      actions = '';
    } else if (paused) {
      actions = `<button class="btn small" data-resume="${sub.id}">Resume</button><button class="btn unfollow" data-unfollow="${sub.id}">Unfollow</button>`;
    } else {
      actions = `<button class="btn small" data-pause="${sub.id}">Pause</button><button class="btn unfollow" data-unfollow="${sub.id}">Unfollow</button>`;
    }
    li.innerHTML = `
      <div>
        <div class="item-title">${sub.trader_name} <span class="item-sub">→ ${sub.follower_account_nickname || 'your account'}</span></div>
        <div class="item-sub">${stopped ? 'Stopped' : paused ? 'Paused · ' + riskSummary(sub.risk_settings) : riskSummary(sub.risk_settings)}</div>
      </div>
      <div>${actions}</div>
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
  list.querySelectorAll('[data-pause]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/subscriptions/${btn.dataset.pause}/pause`, { method: 'POST' });
        toast('Paused copying');
        await loadSubscriptions();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
  list.querySelectorAll('[data-resume]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/subscriptions/${btn.dataset.resume}/resume`, { method: 'POST' });
        toast('Resumed copying');
        await loadSubscriptions();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

// ---------- Follow form (risk settings) ----------
function openFollowForm(traderProfileId, label) {
  if (state.accounts.length === 0) {
    toast('Link a MetaTrader account first', true);
    return;
  }
  const form = document.getElementById('form-follow');
  document.getElementById('follow-form-placeholder').classList.add('hidden');
  form.classList.remove('hidden');
  form.traderProfileId.value = traderProfileId;
  document.getElementById('follow-form-target').textContent = `Following: ${label}`;
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.getElementById('btn-cancel-follow').addEventListener('click', () => {
  document.getElementById('form-follow').classList.add('hidden');
  document.getElementById('follow-form-placeholder').classList.remove('hidden');
});

document.querySelectorAll('input[name="lotMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const wrap = document.getElementById('lot-value-wrap');
    const mode = document.querySelector('input[name="lotMode"]:checked').value;
    wrap.classList.toggle('hidden', mode === 'mirror' || mode === 'balance_scaled');
  });
});

document.getElementById('form-follow').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.querySelector('.form-error[data-for="follow"]');
  errEl.textContent = '';
  const fd = new FormData(e.target);

  const symbolAllowlistRaw = (fd.get('symbolAllowlist') || '').trim();
  const symbolAllowlist = symbolAllowlistRaw
    ? symbolAllowlistRaw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;

  const numOrUndefined = (v) => (v ? Number(v) : undefined);

  const riskSettings = {
    lotSizing: {
      mode: fd.get('lotMode'),
      multiplier: numOrUndefined(fd.get('lotValue')),
      fixedLotSize: fd.get('lotMode') === 'fixed_lot' ? numOrUndefined(fd.get('lotValue')) : undefined,
    },
    symbolAllowlist,
    perTradeStopLossPips: numOrUndefined(fd.get('perTradeStopLossPips')),
    maxOpenPositions: numOrUndefined(fd.get('maxOpenPositions')),
    maxTradesPerDay: numOrUndefined(fd.get('maxTradesPerDay')),
    dailyLossLimitPct: numOrUndefined(fd.get('dailyLossLimitPct')),
    dailyProfitTargetPct: numOrUndefined(fd.get('dailyProfitTargetPct')),
    maxDrawdownPct: numOrUndefined(fd.get('maxDrawdownPct')) ?? 20,
  };

  const followerAccountId = state.accounts[0].id; // MVP: copy onto the first linked account

  try {
    await api('/subscriptions', {
      method: 'POST',
      body: { followerAccountId, traderProfileId: Number(fd.get('traderProfileId')), riskSettings },
    });
    toast('Now copying this trader');
    e.target.reset();
    e.target.classList.add('hidden');
    document.getElementById('follow-form-placeholder').classList.remove('hidden');
    document.getElementById('lot-value-wrap').classList.add('hidden');
    await loadSubscriptions();
    await loadNotifications();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---------- Trader milestones & fee ----------
async function loadTraderProfilesMine() {
  try {
    const data = await api('/traders/mine');
    renderTraderProfilesMine(data.traderProfiles);
  } catch (err) {
    // non-critical for the page to still function
  }
}

function renderTraderProfilesMine(profiles) {
  const container = document.getElementById('trader-profiles-mine');
  if (!profiles || profiles.length === 0) {
    container.innerHTML = '<p class="empty-state">You haven\'t listed any account as a trader yet — do that from the Account page.</p>';
    return;
  }

  container.innerHTML = profiles.map((p) => {
    const followerPct = Math.min(100, (p.followerCount / p.milestones.minFollowers) * 100);
    const ratePct = p.successRate === null ? 0 : Math.min(100, (p.successRate / p.milestones.minSuccessRate) * 100);
    const feeForm = p.milestonesMet
      ? `<form class="inline-form fee-form" data-trader-id="${p.id}" style="margin-top:12px;">
           <div class="field-row">
             <label>Monthly fee, USD
               <input type="number" name="feeUsd" min="1" step="0.01" value="${p.feeCents ? (p.feeCents / 100).toFixed(2) : ''}" placeholder="e.g. 25.00" required />
             </label>
             <button type="submit" class="btn primary" style="align-self:flex-end;">${p.feeEnabled ? 'Update fee' : 'Enable fee'}</button>
           </div>
           <p class="form-error" data-fee-error="${p.id}"></p>
           <p class="hint">This records your fee amount — actual billing/payment collection isn't wired up yet and needs a payment processor added separately.</p>
         </form>`
      : `<p class="hint">Meet both milestones to unlock charging a fee for this strategy.</p>`;

    return `
      <div class="milestone-card">
        <div class="item-title">${p.headline}${p.feeEnabled ? ` <span class="item-sub">· $${(p.feeCents / 100).toFixed(2)}/mo</span>` : ''}</div>
        <div class="milestone-row">
          <span>Followers: ${p.followerCount} / ${p.milestones.minFollowers}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${followerPct}%"></div></div>
        <div class="milestone-row" style="margin-top:10px;">
          <span>Success rate (${p.milestones.successRateWindowDays}d): ${p.successRate === null ? 'no trades yet' : p.successRate + '%'} / ${p.milestones.minSuccessRate}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${ratePct}%"></div></div>
        ${feeForm}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.fee-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const traderId = form.dataset.traderId;
      const errEl = form.querySelector(`[data-fee-error="${traderId}"]`);
      errEl.textContent = '';
      const fd = new FormData(form);
      const feeCents = Math.round(Number(fd.get('feeUsd')) * 100);
      try {
        await api(`/traders/${traderId}/fee`, { method: 'PUT', body: { feeCents } });
        toast('Fee saved');
        await Promise.all([loadTraderProfilesMine(), loadTraders()]);
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
  });
}


// ---------- Email verification / password reset entry points ----------
async function handleUrlTokens() {
  const params = new URLSearchParams(window.location.search);
  const verifyToken = params.get('verify');
  const resetToken = params.get('reset');

  if (verifyToken) {
    document.getElementById('view-auth').classList.add('hidden');
    document.getElementById('view-verify-email').classList.remove('hidden');
    const heading = document.getElementById('verify-email-heading');
    const message = document.getElementById('verify-email-message');
    const continueBtn = document.getElementById('btn-verify-continue');
    try {
      await api('/auth/verify-email', { method: 'POST', body: { token: verifyToken } });
      heading.textContent = 'Email verified';
      message.textContent = 'You can now use all features of your account.';
    } catch (err) {
      heading.textContent = 'Verification failed';
      message.textContent = err.message;
    }
    continueBtn.classList.remove('hidden');
    continueBtn.addEventListener('click', () => {
      window.location.href = window.location.pathname;
    });
    return true;
  }

  if (resetToken) {
    document.getElementById('view-auth').classList.add('hidden');
    document.getElementById('view-reset-password').classList.remove('hidden');
    document.getElementById('form-reset-password').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.querySelector('.form-error[data-for="reset-password"]');
      errEl.textContent = '';
      const fd = new FormData(e.target);
      try {
        await api('/auth/reset-password', {
          method: 'POST',
          body: { token: resetToken, password: fd.get('password') },
        });
        toast('Password updated — you can log in now');
        window.location.href = window.location.pathname;
      } catch (err) {
        errEl.textContent = err.message;
      }
    });
    return true;
  }

  return false;
}

// ---------- Forgot password ----------
document.getElementById('btn-show-forgot').addEventListener('click', () => {
  document.getElementById('form-login').classList.add('hidden');
  document.getElementById('form-forgot-password').classList.remove('hidden');
});
document.getElementById('btn-back-to-login').addEventListener('click', () => {
  document.getElementById('form-forgot-password').classList.add('hidden');
  document.getElementById('form-login').classList.remove('hidden');
});
document.getElementById('form-forgot-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.querySelector('.form-error[data-for="forgot-password"]');
  errEl.textContent = '';
  const fd = new FormData(e.target);
  try {
    await api('/auth/forgot-password', { method: 'POST', body: { email: fd.get('email') } });
    document.getElementById('forgot-password-success').style.display = 'block';
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---------- Email verification banner ----------
function renderVerifyBanner() {
  const banner = document.getElementById('verify-banner');
  banner.classList.toggle('hidden', !!state.user.email_verified);
}
document.getElementById('btn-resend-verification').addEventListener('click', async () => {
  try {
    await api('/auth/resend-verification', { method: 'POST', body: { email: state.user.email } });
    toast('Verification email sent — check your inbox');
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- Init ----------
handleUrlTokens().then((handled) => {
  if (handled) return;
  if (state.token && state.user) {
    showApp();
  } else {
    showAuth();
  }
});
