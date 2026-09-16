/**
 * PulseBoard: Multi-Tenant SaaS Analytics Platform (extreme-1) Project Files
 */

export const pulseBoardFiles: Record<string, string> = {
  '/server/index.js': `const express = require('express');
const app = express();
app.use(express.json());
// PulseBoard Multi-Tenant Server Entry
module.exports = app;`,

  '/server/.env': `PORT=4000\nJWT_SECRET=pulseboard_jwt_production_secret_key\nDATABASE_URL=sqlite:///pulseboard.db`,

  '/server/routes/api.js': `// Router for PulseBoard: auth, events, org, analytics`,

  '/src/App.jsx': `import React, { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Users, Calendar, Plus, Trash2, LogOut } from 'lucide-react';

export default function PulseBoardApp() {
  const [token, setToken] = useState(localStorage.getItem('pulse_token') || '');
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pulse_user') || 'null'); } catch { return null; }
  });
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);

  // Dashboard Data
  const [analytics, setAnalytics] = useState(null);
  const [events, setEvents] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEvents, setTotalEvents] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Event Form
  const [eventName, setEventName] = useState('');
  const [eventValue, setEventValue] = useState('');
  const [eventCategory, setEventCategory] = useState('Revenue');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Org Settings (Admin Only)
  const [activeTab, setActiveTab] = useState('dashboard');
  const [members, setMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [globalError, setGlobalError] = useState('');

  const loadAnalytics = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (categoryFilter && categoryFilter !== 'all') params.set('category', categoryFilter);
      
      const res = await fetch('/api/analytics?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      setAnalytics(data);
    } catch (err) {
      setGlobalError('Failed to load analytics: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadEvents = async (targetPage = page) => {
    if (!token) return;
    try {
      const params = new URLSearchParams({ page: String(targetPage), limit: '10' });
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (categoryFilter && categoryFilter !== 'all') params.set('category', categoryFilter);

      const res = await fetch('/api/events?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      if (data.events) {
        setEvents(data.events);
        setTotalPages(data.totalPages || 1);
        setTotalEvents(data.total || 0);
      } else if (Array.isArray(data)) {
        setEvents(data);
      }
    } catch (err) {
      setGlobalError('Failed to load events: ' + err.message);
    }
  };

  const loadMembers = async () => {
    if (!token || user?.role !== 'admin') return;
    try {
      const res = await fetch('/api/org/members', {
        headers: { Authorization: 'Bearer ' + token }
      });
      const data = await res.json();
      if (Array.isArray(data)) setMembers(data);
    } catch (err) {
      setGlobalError('Failed to load members');
    }
  };

  useEffect(() => {
    if (token) {
      loadAnalytics();
      loadEvents(1);
      if (user?.role === 'admin') loadMembers();
    }
  }, [token, categoryFilter, startDate, endDate]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const body = { email, password };
      if (authMode === 'signup') body.orgName = orgName;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed');
        return;
      }
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem('pulse_token', data.token);
      localStorage.setItem('pulse_user', JSON.stringify(data.user));
    } catch (err) {
      setAuthError('Connection error: ' + err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token }
      });
    } catch {}
    setToken('');
    setUser(null);
    localStorage.removeItem('pulse_token');
    localStorage.removeItem('pulse_user');
  };

  const handleCreateEvent = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({
          name: eventName,
          value: parseFloat(eventValue) || 0,
          category: eventCategory,
          timestamp: new Date().toISOString()
        })
      });
      if (res.ok) {
        setEventName('');
        setEventValue('');
        loadEvents(1);
        loadAnalytics();
      }
    } catch (err) {
      setGlobalError('Failed to create event');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEvent = async (id) => {
    try {
      const res = await fetch('/api/events/' + id, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token }
      });
      if (res.ok) {
        loadEvents();
        loadAnalytics();
      }
    } catch (err) {
      setGlobalError('Failed to delete event');
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/org/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole })
      });
      if (res.ok) {
        setInviteEmail('');
        loadMembers();
        loadAnalytics();
      }
    } catch (err) {
      setGlobalError('Failed to invite member');
    }
  };

  const handleRemoveMember = async (id) => {
    try {
      const res = await fetch('/api/org/members/' + id, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token }
      });
      if (res.ok) {
        loadMembers();
        loadAnalytics();
      }
    } catch (err) {
      setGlobalError('Failed to remove member');
    }
  };

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', background: '#090a0f', color: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: '#13151f', border: '1px solid #1f2333', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '420px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px', color: '#6366f1', textAlign: 'center' }}>PulseBoard</h1>
          <p style={{ color: '#9ca3af', fontSize: '14px', textAlign: 'center', margin: '0 0 24px' }}>Multi-Tenant SaaS Analytics Platform</p>
          
          {authError && (
            <div data-testid="auth-error-msg" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#f87171', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px' }}>
              {authError}
            </div>
          )}

          <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {authMode === 'signup' && (
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#9ca3af' }}>Organization Name</label>
                <input
                  type="text"
                  required
                  placeholder="Acme Corp"
                  data-testid="input-org-name"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', background: '#090a0f', border: '1px solid #282d42', borderRadius: '8px', color: '#fff', boxSizing: 'border-box' }}
                />
              </div>
            )}
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#9ca3af' }}>Email Address</label>
              <input
                type="email"
                required
                placeholder="admin@pulseboard.io"
                data-testid="input-email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', background: '#090a0f', border: '1px solid #282d42', borderRadius: '8px', color: '#fff', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#9ca3af' }}>Password</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                data-testid="input-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', background: '#090a0f', border: '1px solid #282d42', borderRadius: '8px', color: '#fff', boxSizing: 'border-box' }}
              />
            </div>
            <button
              type="submit"
              data-testid="btn-auth-submit"
              style={{ background: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', marginTop: '6px' }}
            >
              {authMode === 'signup' ? 'Create Organization & Account' : 'Sign In'}
            </button>
          </form>

          <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '13px', color: '#9ca3af' }}>
            {authMode === 'signup' ? 'Already have an organization? ' : "Don't have an account? "}
            <button
              type="button"
              data-testid="toggle-auth-mode"
              onClick={() => { setAuthMode(authMode === 'signup' ? 'login' : 'signup'); setAuthError(''); }}
              style={{ background: 'none', border: 'none', color: '#818cf8', fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              {authMode === 'signup' ? 'Sign In' : 'Sign Up'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#090a0f', color: '#f3f4f6', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ background: '#13151f', borderBottom: '1px solid #1f2333', padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <span style={{ fontSize: '20px', fontWeight: 800, color: '#6366f1', letterSpacing: '-0.5px' }}>PulseBoard</span>
          <nav style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              data-testid="nav-dashboard"
              onClick={() => setActiveTab('dashboard')}
              style={{ background: activeTab === 'dashboard' ? '#1f2333' : 'transparent', color: activeTab === 'dashboard' ? '#fff' : '#9ca3af', border: 'none', padding: '8px 14px', borderRadius: '6px', fontWeight: 500, cursor: 'pointer' }}
            >
              Dashboard
            </button>
            {user?.role === 'admin' && (
              <button
                type="button"
                data-testid="nav-org-settings"
                onClick={() => setActiveTab('org_settings')}
                style={{ background: activeTab === 'org_settings' ? '#1f2333' : 'transparent', color: activeTab === 'org_settings' ? '#fff' : '#9ca3af', border: 'none', padding: '8px 14px', borderRadius: '6px', fontWeight: 500, cursor: 'pointer' }}
              >
                Org Settings
              </button>
            )}
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ textAlign: 'right', fontSize: '13px' }}>
            <div style={{ fontWeight: 600, color: '#e5e7eb' }}>{user?.name}</div>
            <div style={{ color: '#9ca3af', fontSize: '11px' }}>{user?.role?.toUpperCase()} • {user?.orgId ? 'Org #' + user.orgId : ''}</div>
          </div>
          <button
            type="button"
            data-testid="btn-logout"
            onClick={handleLogout}
            style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <LogOut size={14} /> Logout
          </button>
        </div>
      </header>

      <main style={{ padding: '28px', maxWidth: '1280px', margin: '0 auto' }}>
        {globalError && (
          <div data-testid="global-error-banner" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#f87171', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{globalError}</span>
            <button onClick={() => setGlobalError('')} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {activeTab === 'dashboard' ? (
          <div>
            <div style={{ background: '#13151f', border: '1px solid #1f2333', borderRadius: '12px', padding: '16px', display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={16} color="#9ca3af" />
                <span style={{ fontSize: '13px', color: '#9ca3af' }}>Filter Date Range:</span>
              </div>
              <input
                type="date"
                data-testid="filter-start-date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                style={{ background: '#090a0f', border: '1px solid #282d42', color: '#fff', padding: '6px 10px', borderRadius: '6px', fontSize: '13px' }}
              />
              <span style={{ color: '#6b7280' }}>to</span>
              <input
                type="date"
                data-testid="filter-end-date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                style={{ background: '#090a0f', border: '1px solid #282d42', color: '#fff', padding: '6px 10px', borderRadius: '6px', fontSize: '13px' }}
              />
              <select
                data-testid="filter-category"
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                style={{ background: '#090a0f', border: '1px solid #282d42', color: '#fff', padding: '6px 10px', borderRadius: '6px', fontSize: '13px' }}
              >
                <option value="all">All Categories</option>
                <option value="Revenue">Revenue</option>
                <option value="Signups">Signups</option>
                <option value="Usage">Usage</option>
              </select>
              {(startDate || endDate || categoryFilter !== 'all') && (
                <button
                  type="button"
                  data-testid="clear-filters"
                  onClick={() => { setStartDate(''); setEndDate(''); setCategoryFilter('all'); }}
                  style={{ background: 'transparent', border: '1px solid #374151', color: '#9ca3af', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                >
                  Clear Filters
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px', marginBottom: '28px' }}>
              <div style={{ background: '#13151f', border: '1px solid #1f2333', borderRadius: '12px', padding: '20px' }}>
                <div style={{ fontSize: '13px', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Total Events</span>
                  <BarChart3 size={18} color="#6366f1" />
                </div>
                <div data-testid="kpi-total-events" style={{ fontSize: '32px', fontWeight: 800, color: '#fff', marginTop: '10px' }}>
                  {analytics?.kpis?.totalEvents ?? totalEvents}
                </div>
                <div style={{ fontSize: '12px', color: '#10b981', marginTop: '6px' }}>Computed server-side</div>
              </div>

              <div style={{ background: '#13151f', border: '1px solid #1f2333', borderRadius: '12px', padding: '20px' }}>
                <div style={{ fontSize: '13px', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Total Value ($)</span>
                  <TrendingUp size={18} color="#10b981" />
                </div>
                <div data-testid="kpi-total-value" style={{ fontSize: '32px', fontWeight: 800, color: '#fff', marginTop: '10px' }}>
                  {analytics?.kpis?.totalValue != null ? '$' + Number(analytics.kpis.totalValue).toFixed(2) : '$0.00'}
                </div>
                <div style={{ fontSize: '12px', color: '#10b981', marginTop: '6px' }}>Aggregated across tenants</div>
              </div>

              <div style={{ background: '#13151f', border: '1px solid #1f2333', borderRadius: '12px', padding: '20px' }}>
                <div style={{ fontSize: '13px', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Active Members</span>
                  <Users size={18} color="#f59e0b" />
                </div>
                <div data-testid="kpi-active-members" style={{ fontSize: '32px', fontWeight: 800, color: '#fff', marginTop: '10px' }}>
                  {analytics?.kpis?.activeMembers ?? 1}
                </div>
                <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '6px' }}>Organization scoped</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', marginBottom: '28px' }}>
              <div style={{ background: '#13151f', border: '1px solid #1f2333', borderRadius: '12px', padding: '20px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 16px', color: '#e5e7eb' }}>Daily Event Totals</h3>
                <div data-testid="chart-daily-totals" style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '180px', borderBottom: '1px solid #282d42', paddingBottom: '8px' }}>
                  {(analytics?.dailyTotals || []).length === 0 ? (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: '13px' }}>No events recorded for this range</div>
                  ) : (
                    analytics.dailyTotals.map((d, i) => (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                        <div style={{ background: '#6366f1', width: '100%', borderRadius: '4px 4px 0 0', height: Math.max(15, (d.count / (analytics.kpis.totalEvents || 1)) * 140) + 'px', transition: 'height 0.3s' }} />
                        <span style={{ fontSize: '10px', color: '#9ca3af', marginTop: '4px', whiteSpace: 'nowrap' }}>{d.date.slice(5)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={{ background: '#13151f', border: '1px solid #1f2333', borderRadius: '12px', padding: '20px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 16px', color: '#e5e7eb' }}>Category Breakdown</h3>
                <div data-testid="chart-category-breakdown" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {(analytics?.categoryBreakdown || []).length === 0 ? (
                    <div style={{ color: '#6b7280', fontSize: '13px', padding: '20px 0', textAlign: 'center' }}>No category data available</div>
                  ) : (
                    analytics.categoryBreakdown.map((cat, i) => (
                      <div key={i}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                          <span style={{ color: '#e5e7eb', fontWeight: 500 }}>{cat.category}</span>
                          <span style={{ color: '#9ca3af' }}>{cat.count} events ({'$' + cat.totalValue.toFixed(2)})</span>
                        </div>
                        <div style={{ width: '100%', background: '#1f2333', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ background: i % 2 === 0 ? '#10b981' : '#f59e0b', height: '100%', width: Math.min(100, (cat.count / (analytics.kpis.totalEvents || 1)) * 100) + '%' }} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div style={{ background: '#13151f', border: '1px solid #1f2333', borderRadius: '12px', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: '#e5e7eb' }}>Events Log</h3>
                <form onSubmit={handleCreateEvent} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input
                    type="text"
                    required
                    placeholder="Event Name"
                    data-testid="input-event-name"
                    value={eventName}
                    onChange={e => setEventName(e.target.value)}
                    style={{ background: '#090a0f', border: '1px solid #282d42', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="Value ($)"
                    data-testid="input-event-value"
                    value={eventValue}
                    onChange={e => setEventValue(e.target.value)}
                    style={{ background: '#090a0f', border: '1px solid #282d42', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', width: '100px' }}
                  />
                  <select
                    data-testid="select-event-category"
                    value={eventCategory}
                    onChange={e => setEventCategory(e.target.value)}
                    style={{ background: '#090a0f', border: '1px solid #282d42', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontSize: '13px' }}
                  >
                    <option value="Revenue">Revenue</option>
                    <option value="Signups">Signups</option>
                    <option value="Usage">Usage</option>
                  </select>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    data-testid="btn-create-event"
                    style={{ background: '#6366f1', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Plus size={14} /> Add Event
                  </button>
                </form>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1f2333', color: '#9ca3af' }}>
                    <th style={{ padding: '10px 12px' }}>ID</th>
                    <th style={{ padding: '10px 12px' }}>Event Name</th>
                    <th style={{ padding: '10px 12px' }}>Category</th>
                    <th style={{ padding: '10px 12px' }}>Value</th>
                    <th style={{ padding: '10px 12px' }}>Date</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody data-testid="events-table-body">
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>No events recorded for this organization</td>
                    </tr>
                  ) : (
                    events.map(ev => (
                      <tr key={ev.id} data-testid={'event-row-' + ev.id} style={{ borderBottom: '1px solid #13151f' }}>
                        <td style={{ padding: '10px 12px', color: '#9ca3af' }}>#{ev.id}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#e5e7eb' }}>{ev.name}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ background: '#1f2333', color: '#cbd5e1', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>{ev.category}</span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#10b981', fontWeight: 600 }}>{'$' + Number(ev.value).toFixed(2)}</td>
                        <td style={{ padding: '10px 12px', color: '#9ca3af' }}>{(ev.timestamp || ev.createdAt || '').slice(0, 10)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <button
                            type="button"
                            data-testid={'btn-delete-event-' + ev.id}
                            onClick={() => handleDeleteEvent(ev.id)}
                            style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: '4px' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', borderTop: '1px solid #1f2333', paddingTop: '12px' }}>
                <span data-testid="pagination-info" style={{ fontSize: '13px', color: '#9ca3af' }}>
                  Showing page {page} of {totalPages} ({totalEvents} total events)
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    data-testid="btn-prev-page"
                    disabled={page <= 1}
                    onClick={() => { const p = Math.max(1, page - 1); setPage(p); loadEvents(p); }}
                    style={{ background: '#1f2333', color: page <= 1 ? '#4b5563' : '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    data-testid="btn-next-page"
                    disabled={page >= totalPages}
                    onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); loadEvents(p); }}
                    style={{ background: '#1f2333', color: page >= totalPages ? '#4b5563' : '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div data-testid="org-settings-page" style={{ background: '#13151f', border: '1px solid #1f2333', borderRadius: '12px', padding: '24px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px', color: '#fff' }}>Organization Settings & Team</h2>
            <p style={{ color: '#9ca3af', fontSize: '14px', margin: '0 0 24px' }}>Manage users, roles, and invitations for your organization.</p>

            <form onSubmit={handleInvite} style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '24px' }}>
              <input
                type="email"
                required
                placeholder="colleague@company.com"
                data-testid="input-invite-email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                style={{ background: '#090a0f', border: '1px solid #282d42', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', width: '260px' }}
              />
              <select
                data-testid="select-invite-role"
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                style={{ background: '#090a0f', border: '1px solid #282d42', color: '#fff', padding: '8px 12px', borderRadius: '6px', fontSize: '13px' }}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="submit"
                data-testid="btn-invite-member"
                style={{ background: '#6366f1', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
              >
                Invite Member
              </button>
            </form>

            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1f2333', color: '#9ca3af' }}>
                  <th style={{ padding: '10px 12px' }}>Email</th>
                  <th style={{ padding: '10px 12px' }}>Role</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody data-testid="members-table-body">
                {members.map(m => (
                  <tr key={m.id} data-testid={'member-row-' + m.id} style={{ borderBottom: '1px solid #13151f' }}>
                    <td style={{ padding: '10px 12px', color: '#e5e7eb', fontWeight: 500 }}>{m.email}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ background: m.role === 'admin' ? 'rgba(99, 102, 241, 0.2)' : '#1f2333', color: m.role === 'admin' ? '#818cf8' : '#9ca3af', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                        {m.role?.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {m.email !== user?.email && (
                        <button
                          type="button"
                          data-testid={'btn-remove-member-' + m.id}
                          onClick={() => handleRemoveMember(m.id)}
                          style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '12px' }}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}`
};
