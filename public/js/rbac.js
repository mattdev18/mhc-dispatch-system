/*
 * rbac.js - Role-based page guard (frontend)
 * Ilagay sa: public/js/rbac.js
 * Idagdag sa <head> ng index.html, dispatch.html at reports.html:
 *     <script src="/js/rbac.js"></script>
 *
 * Paalala: pang-UX lang ito (redirect at pagtatago). Ang tunay na proteksyon
 * ay nasa server.js (requirePermission), kaya hindi ito malulusutan ng DevTools.
 */
(function () {
    // Aling screen ang page na ito? (dapat tugma sa SCREEN_ACCESS sa server.js)
    const path = location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    const PAGE_SCREEN = {
        '/': 'register',
        '/index': 'register',
        '/register': 'register',
        '/dispatch': 'dispatch',
        '/reports': 'reports'
    };
    const screen = PAGE_SCREEN[path];
    if (!screen) return; // login at display (TV) ay hindi binabantayan

    // Itago ang page hanggang makumpirma ang role (iwas "flash" ng content)
    document.documentElement.style.visibility = 'hidden';

    // Hanapin ang login token na itinago ng login.html (64-character hex)
    function findToken() {
        for (const store of [localStorage, sessionStorage]) {
            for (let i = 0; i < store.length; i++) {
                const value = store.getItem(store.key(i));
                if (value && /^[a-f0-9]{64}$/.test(value)) return value;
            }
        }
        return null;
    }

    function whenDomReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    const token = findToken();
    if (!token) {
        location.replace('/login');
        return;
    }

    fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })
        .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('not logged in')); })
        .then(function (data) {
            // Hindi allowed ang role sa page na ito -> ibalik sa sariling home page
            if (!data.screens.includes(screen)) {
                alert('Walang access ang role mo sa page na ito.');
                location.replace(data.home || '/login');
                return;
            }

            window.currentUser = data.user;

            whenDomReady(function () {
                // Alisin ang mga elementong may data-roles na hindi kasama ang role ng user.
                // Halimbawa: <section data-roles="admin,dispatcher"> ... </section>
                document.querySelectorAll('[data-roles]').forEach(function (el) {
                    const roles = el.dataset.roles.split(',').map(function (r) { return r.trim(); });
                    if (!roles.includes(data.user.role)) el.remove();
                });
                document.documentElement.style.visibility = '';
            });
        })
        .catch(function () {
            location.replace('/login');
        });
})();
