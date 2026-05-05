// Login Form Handler
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async(e) => {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const messageDiv = document.getElementById('message');

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (!data.success) {
                showMessage(data.message, 'error');
                return;
            }

            if (data.user.role === 'admin') {
                window.location.href = '/dashboardadmin';
            } else {
                window.location.href = '/dashboard';
            }
        } catch (error) {
            console.error('Login error:', error);
            showMessage('Terjadi kesalahan server!', 'error');
        }
    });
}

// Check Auth & Load Dashboard
document.addEventListener('DOMContentLoaded', async() => {
    const logoutBtn = document.getElementById('logoutBtn');
    const userInfo = document.getElementById('userInfo');

    if (logoutBtn) {
        // Check authentication
        try {
            const response = await fetch('/api/check-auth', {
                credentials: 'include'
            });

            if (response.ok) {
                const user = await response.json();
                userInfo.textContent = `Halo, ${user.user.username}!`;
            } else {
                window.location.href = '/';
            }
        } catch (error) {
            window.location.href = '/';
        }

        // Logout handler
        logoutBtn.addEventListener('click', async() => {
            try {
                await fetch('/api/logout', {
                    method: 'POST',
                    credentials: 'include'
                });
                window.location.href = '/';
            } catch (error) {
                console.error('Logout error:', error);
            }
        });
    }
});

function showMessage(message, type) {
    const messageDiv = document.getElementById('message');
    messageDiv.innerHTML = `<div class="message-${type}">${message}</div>`;
}