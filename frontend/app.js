const API_BASE = window.API_BASE || 'http://localhost:4000/api';

const state = {
  token: localStorage.getItem('wt_token') || null,
  user: JSON.parse(localStorage.getItem('wt_user') || 'null'),
  accounts: [],
  traders: [],
  subscriptions: [],
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

// ---------- View switching ----------
function showDashboard() {
  document.getElementById('view-auth').classList.add('hidden');
  document.getElementById('view-dashboard').classList.remove('hidden');
  document.getElementById('accountNav').innerHTML =
    `${state.user.display_name} &nbsp; <button id="btn-logout">Log out</button>`;
  document.getElementById('btn-logout').addEventListener('click', logout);
  loadAll();
}

function showAuth() {
  document.getElementById('view-auth').classList.remove('hidden');
  document.getElementById('view-dashboard').classList.add('hidden');
  document.getElementById('accountNav').innerHTML = '';
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('wt_token');
  localStorage.removeItem('wt_user');
  showAuth();
}

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
  showDashboard();
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
  } catch (err) {
    errEl.textContent = err.message;
  }
});

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
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---------- Data loading ----------
async function loadAll() {
  await Promise.all([loadAccounts(), loadTraders(), loadSubscriptions()]);
  renderTicker();
}

async function loadAccounts() {
  const data = await api('/accounts');
  state.accounts = data.accounts;
  renderAccounts();
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

// ---------- Rendering ----------
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
      ? s.trades
          .map(
            (t) => `
        <tr>
          <td>${new Date(t.time).toLocaleString()}</td>
          <td>${t.symbol || '—'}</td>
          <td>${(t.type || '').replace('DEAL_TYPE_', '')}</td>
          <td>${t.volume ?? '—'}</td>
          <td>${t.price ?? '—'}</td>
          <td class="${t.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${fmt(t.profit)}</td>
        </tr>`
          )
          .join('')
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
    list.innerHTML = '<li class="empty-state">You aren\'t copying anyone yet — follow a trader above.</li>';
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
  } catch (err) {
    toast(err.message, true);
  }
}

function renderTicker() {
  const track = document.getElementById('tickerTrack');
  const items = state.traders.length
    ? state.traders
    : [{ trader_name: 'Wiretrade', headline: 'Link an account to see live traders', follower_count: 0 }];
  const html = items
    .concat(items) // duplicate for seamless scroll
    .map(
      (t) =>
        `<span class="ticker-item">${t.trader_name} <span class="up">${t.headline}</span></span>`
    )
    .join('');
  track.innerHTML = html;
}

// ---------- Init ----------
if (state.token && state.user) {
  showDashboard();
} else {
  showAuth();
}
