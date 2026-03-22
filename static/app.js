let term;
let ws;
let currentSessionName = null;
let sessions = [];

// Initialize variables
const termContainer = document.getElementById('terminal-container');
const sessionList = document.getElementById('session-list');
const currentSessionEl = document.getElementById('current-session-name'); // Corrected ID based on original
const menuToggle = document.getElementById('menu-toggle');
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('modal-overlay'); // Corrected ID based on original
const btnNewSession = document.getElementById('new-session-btn'); // Corrected ID based on original
const modal = document.getElementById('modal-overlay'); // Corrected ID based on original
const btnCloseModal = document.getElementById('cancel-new'); // Corrected ID based on original
const formNewSession = document.getElementById('create-new'); // Corrected ID based on original
const newSessionNameInput = document.getElementById('new-session-name'); // Added from original

// Initialize xterm.js
function initTerminal(cols = 80, rows = 24) {
    if (term) {
        term.dispose();
    }

    term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 14,
        theme: {
            background: '#000',
            foreground: '#fff'
        },
        cols: cols,
        rows: rows,
        scrollback: 0 // Disable internal scrollback to allow container scrolling
    });

    term.open(termContainer);
    
    term.onData(data => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            const encoder = new TextEncoder();
            ws.send(encoder.encode(data));
        }
    });
}

async function fetchSessions() {
    try {
        const response = await fetch('/api/sessions');
        sessions = await response.json();
        renderSessions();
        
        // Initial load
        if (!currentSessionName && sessions.length > 0) {
            selectSession(sessions[0].name);
        }
    } catch (err) {
        console.error('Failed to fetch sessions:', err);
    }
}

function renderSessions() {
    sessionList.innerHTML = '';
    sessions.forEach(s => {
        const li = document.createElement('li');
        li.textContent = s.name;
        li.className = s.name === currentSessionName ? 'active' : '';
        li.onclick = () => {
            selectSession(s.name);
            toggleSidebar(false); // Assuming toggleSidebar exists or needs to be added
        };
        sessionList.appendChild(li);
    });
}

function toggleSidebar(show) {
    if (show === true) {
        sidebar.classList.remove('hidden');
    } else if (show === false) {
        sidebar.classList.add('hidden');
    } else {
        sidebar.classList.toggle('hidden');
    }
}

function selectSession(name) {
    if (currentSessionName === name) return;
    
    currentSessionName = name;
    const session = sessions.find(s => s.name === name);
    currentSessionEl.textContent = name + (session ? ` (${session.width}x${session.height})` : '');
    
    const cols = session ? session.width : 80;
    const rows = session ? session.height + 200 : 224; // Base height + 200 lines history
    
    initTerminal(cols, rows);
    connectWebSocket(name);
    renderSessions();
}

function connectWebSocket(name) {
    if (ws) {
        ws.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/session/${name}`);
    // No longer binaryType = 'arraybuffer' as we send JSON

    ws.onopen = () => {
        term.clear();
        const encoder = new TextEncoder();
        ws.send(encoder.encode('\r'));
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'update') {
                // \x1b[H move to home, \x1b[J clear screen
                term.write('\x1b[H\x1b[J' + data.content);
                
                // Auto-scroll to cursor
                // We use helper to get precise element dimensions if possible
                const charMeasure = term._core._charSizeService;
                const cellWidth = charMeasure ? charMeasure.width : 9;
                const cellHeight = charMeasure ? charMeasure.height : 17;
                
                const absoluteY = data.history_len + data.cursor_y;
                
                const targetTop = (absoluteY * cellHeight) - (termContainer.clientHeight / 2);
                const targetLeft = (data.cursor_x * cellWidth) - (termContainer.clientWidth / 2);
                
                termContainer.scrollTo({
                    top: targetTop,
                    left: targetLeft,
                    behavior: 'smooth'
                });
            }
        } catch (e) {
            console.error('Error handling WS message:', e);
        }
    };

    ws.onclose = () => {
        term.write('\r\n\x1b[31mConnection closed.\x1b[0m\r\n');
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        term.write('\r\n\x1b[31mWebSocket error.\x1b[0m\r\n');
    };
}

async function createNewSession() {
    const name = newSessionNameInput.value.trim();
    if (!name) return;
    
    try {
        const response = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        if (response.ok) {
            modal.classList.add('hidden');
            newSessionNameInput.value = '';
            await fetchSessions();
            selectSession(name);
        } else {
            const err = await response.json();
            alert(`Error: ${err.detail}`);
        }
    } catch (err) {
        console.error('Failed to create session', err);
    }
}

// Event Listeners
menuToggle.onclick = () => toggleSidebar(true);
document.getElementById('close-menu').onclick = () => toggleSidebar(false);
btnNewSession.onclick = () => modal.classList.remove('hidden');
btnCloseModal.onclick = () => {
    modal.classList.add('hidden');
    newSessionNameInput.value = '';
};
formNewSession.onclick = createNewSession;

modal.onclick = (e) => {
    if (e.target === modal) modal.classList.add('hidden');
};

// Initial load
initTerminal(); // Initial empty terminal
fetchSessions().then(() => {
    // Auto-select first session if exists
    const firstSession = sessionList.firstChild;
    if (firstSession) {
        selectSession(firstSession.textContent);
    }
});
