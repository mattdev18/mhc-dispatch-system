// Shared Staff Authentication Helper for May Harvest Dispatch System

const AUTH_TOKEN_KEY = 'mhc_auth_token';
const AUTH_USER_KEY = 'mhc_auth_user';

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY);
}

function getAuthUser() {
    try {
        const u = localStorage.getItem(AUTH_USER_KEY) || sessionStorage.getItem(AUTH_USER_KEY);
        return u ? JSON.parse(u) : null;
    } catch (e) {
        return null;
    }
}

function setAuthSession(token, user, remember = true) {
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem(AUTH_TOKEN_KEY, token);
    storage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

function clearAuthSession() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
}

async function verifyAuth(redirectOnFail = true) {
    const token = getAuthToken();
    if (!token) {
        if (redirectOnFail) {
            window.location.href = '/login?returnUrl=' + encodeURIComponent(window.location.pathname);
        }
        return false;
    }

    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (!data.success) {
            clearAuthSession();
            if (redirectOnFail) {
                window.location.href = '/login?returnUrl=' + encodeURIComponent(window.location.pathname);
            }
            return false;
        }

        renderUserHeader(data.user);
        return true;
    } catch (e) {
        console.warn('Auth verify network error:', e);
        return true; // Allow offline fallback if token exists
    }
}

function renderUserHeader(user) {
    const headerRight = document.querySelector('.header-right');
    if (!headerRight) return;

    let userBox = document.getElementById('authUserBox');
    if (!userBox) {
        userBox = document.createElement('div');
        userBox.id = 'authUserBox';
        userBox.style.display = 'flex';
        userBox.style.alignItems = 'center';
        userBox.style.gap = '10px';
        userBox.style.background = 'rgba(255,255,255,0.12)';
        userBox.style.padding = '5px 12px';
        userBox.style.borderRadius = '8px';
        headerRight.insertBefore(userBox, headerRight.firstChild);
    }

    userBox.innerHTML = `
        <span style="font-size: 13px; color: #86efac; font-weight: 700;">
            👤 ${escapeAuthHtml(user.name)} (${escapeAuthHtml(user.role.toUpperCase())})
        </span>
        <button type="button" onclick="logoutUser()" style="background: #dc2626; color: white; border: none; border-radius: 5px; padding: 4px 8px; font-size: 11px; font-weight: 700; cursor: pointer;">
            Logout
        </button>
    `;
}

async function logoutUser() {
    const token = getAuthToken();
    try {
        if (token) {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        }
    } catch (e) {}

    clearAuthSession();
    window.location.href = '/login';
}

function escapeAuthHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Global fetch wrapper to automatically include auth header
const originalFetch = window.fetch;
window.fetch = function (url, options = {}) {
    const token = getAuthToken();
    if (token) {
        options.headers = options.headers || {};
        if (options.headers instanceof Headers) {
            options.headers.set('Authorization', `Bearer ${token}`);
        } else {
            options.headers['Authorization'] = `Bearer ${token}`;
        }
    }
    return originalFetch(url, options);
};
