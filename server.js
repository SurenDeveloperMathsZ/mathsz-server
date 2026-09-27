const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`MathsZ server started on port ${PORT}`);

// rooms = { roomCode: { host: ws, guest: ws, mode, difficulty, state } }
const rooms = {};

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function send(ws, type, data = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, ...data }));
    }
}

function broadcast(room, type, data = {}) {
    if (room.host) send(room.host, type, data);
    if (room.guest) send(room.guest, type, data);
}

wss.on('connection', (ws) => {
    console.log('New connection');
    ws.roomCode = null;
    ws.nickname = null;
    ws.isHost = false;

    ws.on('message', (message) => {
        let msg;
        try {
            msg = JSON.parse(message);
        } catch (e) {
            console.log('Invalid JSON');
            return;
        }

        console.log('Received:', msg.type);

        // === СОЗДАНИЕ КОМНАТЫ ===
        if (msg.type === 'create_room') {
            let code = generateRoomCode();
            while (rooms[code]) {
                code = generateRoomCode();
            }

            ws.nickname = msg.nickname || 'Игрок 1';
            ws.roomCode = code;
            ws.isHost = true;

            rooms[code] = {
                host: ws,
                guest: null,
                mode: msg.mode || 'turn',
                difficulty: msg.difficulty || 1,
                state: {
                    status: 'waiting',
                    hostScore: 0,
                    guestScore: 0,
                    currentTurn: 'host',
                    totalTasks: 10,
                    tasksDone: 0
                }
            };

            send(ws, 'room_created', { code, mode: rooms[code].mode });
            console.log('Room created:', code);
        }

        // === ПОДКЛЮЧЕНИЕ К КОМНАТЕ ===
        else if (msg.type === 'join_room') {
            const code = (msg.code || '').toUpperCase();
            const room = rooms[code];

            if (!room) {
                send(ws, 'error', { message: 'Комната не найдена' });
                return;
            }
            if (room.guest) {
                send(ws, 'error', { message: 'Комната уже заполнена' });
                return;
            }

            ws.nickname = msg.nickname || 'Игрок 2';
            ws.roomCode = code;
            ws.isHost = false;
            room.guest = ws;

            room.state.status = 'playing';

            send(room.host, 'game_started', {
                hostNick: room.host.nickname,
                guestNick: room.guest.nickname,
                mode: room.mode,
                difficulty: room.difficulty,
                state: room.state,
                yourRole: 'host'
            });
            send(room.guest, 'game_started', {
                hostNick: room.host.nickname,
                guestNick: room.guest.nickname,
                mode: room.mode,
                difficulty: room.difficulty,
                state: room.state,
                yourRole: 'guest'
            });
            console.log('Room joined:', code);
        }

        // === ПРАВИЛЬНЫЙ ОТВЕТ ===
        else if (msg.type === 'correct_answer') {
            const room = rooms[ws.roomCode];
            if (!room || room.state.status !== 'playing') return;

            if (ws.isHost) {
                room.state.hostScore += 1;
            } else {
                room.state.guestScore += 1;
            }
            room.state.tasksDone += 1;

            if (room.mode === 'turn') {
                room.state.currentTurn = (room.state.currentTurn === 'host') ? 'guest' : 'host';
            }

            if (room.state.tasksDone >= room.state.totalTasks) {
                room.state.status = 'finished';
            }

            broadcast(room, 'state_update', { state: room.state });
        }

        // === НЕПРАВИЛЬНЫЙ ОТВЕТ ===
        else if (msg.type === 'wrong_answer') {
            const room = rooms[ws.roomCode];
            if (!room || room.state.status !== 'playing') return;

            room.state.tasksDone += 1;

            if (room.mode === 'turn') {
                room.state.currentTurn = (room.state.currentTurn === 'host') ? 'guest' : 'host';
            }

            if (room.state.tasksDone >= room.state.totalTasks) {
                room.state.status = 'finished';
            }

            broadcast(room, 'state_update', { state: room.state });
        }

        // === ВЫХОД ИЗ КОМНАТЫ ===
        else if (msg.type === 'leave_room') {
            handleDisconnect(ws);
        }
    });

    ws.on('close', () => {
        console.log('Connection closed');
        handleDisconnect(ws);
    });
});

function handleDisconnect(ws) {
    const code = ws.roomCode;
    if (!code || !rooms[code]) return;

    const room = rooms[code];

    if (ws.isHost) {
        if (room.guest) {
            send(room.guest, 'host_left', { message: 'Хост покинул игру' });
            room.guest.roomCode = null;
        }
        delete rooms[code];
    } else {
        if (room.host) {
            send(room.host, 'guest_left', { message: 'Гость покинул игру' });
        }
        room.guest = null;
        room.state.status = 'waiting';
    }
}
