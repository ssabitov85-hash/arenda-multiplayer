const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Создаем HTTP сервер с раздачей статики
const server = http.createServer((req, res) => {
    // Определяем путь к файлу
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, '..', filePath);
    
    // Определяем MIME тип
    const ext = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.png': 'image/png',
        '.MOV': 'video/quicktime',
        '.mp4': 'video/mp4',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json'
    };
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 
            'Content-Type': contentTypes[ext] || 'application/octet-stream'
        });
        res.end(data);
    });
});

// Создаем WebSocket сервер
const wss = new WebSocket.Server({ server });

const rooms = {};
const clients = new Map();

function generateId() {
    return Math.random().toString(36).substring(2, 8);
}

function getPlayerColors() {
    const colors = [0x44aaff, 0xff6644, 0x44ff88, 0xff44ff, 0xffdd44, 0x88ddff];
    return colors[Math.floor(Math.random() * colors.length)];
}

wss.on('connection', (ws, req) => {
    let playerId = null;
    let roomCode = null;
    
    console.log('🔗 Новое подключение');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Получено:', data.type, data);
            
            switch(data.type) {
                case 'create_room': {
                    const code = data.roomCode || String(Math.floor(100000 + Math.random() * 900000));
                    roomCode = code;
                    playerId = generateId();
                    
                    if (!rooms[code]) {
                        rooms[code] = {
                            players: [],
                            gameStarted: false,
                            lightOn: true,
                            gameOver: false,
                            code: code
                        };
                    }
                    
                    const player = {
                        id: playerId,
                        name: data.playerName || 'Игрок',
                        position: { x: 0, y: 5, z: 0 },
                        rotation: { pitch: 0, yaw: 0 },
                        alive: true,
                        color: getPlayerColors(),
                        isHost: rooms[code].players.length === 0
                    };
                    
                    rooms[code].players.push(player);
                    clients.set(playerId, { ws, roomCode });
                    
                    ws.send(JSON.stringify({
                        type: 'room_created',
                        roomCode: code,
                        playerId: playerId,
                        players: rooms[code].players
                    }));
                    
                    broadcastToRoom(code, {
                        type: 'player_joined',
                        players: rooms[code].players
                    }, playerId);
                    break;
                }
                
                case 'join_room': {
                    const code = data.roomCode;
                    if (!rooms[code]) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Лобби не найдено' }));
                        return;
                    }
                    
                    if (rooms[code].gameStarted) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Игра уже началась' }));
                        return;
                    }
                    
                    roomCode = code;
                    playerId = generateId();
                    
                    const player = {
                        id: playerId,
                        name: data.playerName || 'Игрок',
                        position: { x: 0, y: 5, z: 0 },
                        rotation: { pitch: 0, yaw: 0 },
                        alive: true,
                        color: getPlayerColors(),
                        isHost: false
                    };
                    
                    rooms[code].players.push(player);
                    clients.set(playerId, { ws, roomCode });
                    
                    ws.send(JSON.stringify({
                        type: 'room_joined',
                        roomCode: code,
                        playerId: playerId,
                        players: rooms[code].players
                    }));
                    
                    broadcastToRoom(code, {
                        type: 'player_joined',
                        players: rooms[code].players
                    }, playerId);
                    break;
                }
                
                case 'request_players': {
                    if (rooms[roomCode]) {
                        ws.send(JSON.stringify({
                            type: 'request_players',
                            players: rooms[roomCode].players
                        }));
                    }
                    break;
                }
                
                case 'start_game': {
                    if (rooms[roomCode] && rooms[roomCode].players.length >= 2) {
                        rooms[roomCode].gameStarted = true;
                        broadcastToRoom(roomCode, {
                            type: 'game_start',
                            players: rooms[roomCode].players
                        });
                    }
                    break;
                }
                
                case 'player_update': {
                    if (rooms[roomCode]) {
                        const p = rooms[roomCode].players.find(p => p.id === playerId);
                        if (p) {
                            p.position = data.position;
                            p.rotation = data.rotation;
                        }
                        broadcastToRoom(roomCode, {
                            type: 'player_update',
                            players: rooms[roomCode].players
                        }, playerId);
                    }
                    break;
                }
                
                case 'player_died': {
                    if (rooms[roomCode]) {
                        const p = rooms[roomCode].players.find(p => p.id === playerId);
                        if (p) p.alive = false;
                        
                        const aliveCount = rooms[roomCode].players.filter(p => p.alive).length;
                        if (aliveCount <= 1) {
                            const winner = rooms[roomCode].players.find(p => p.alive);
                            broadcastToRoom(roomCode, {
                                type: 'game_over',
                                winner: winner ? winner.id : null,
                                winnerName: winner ? winner.name : null,
                                players: rooms[roomCode].players
                            });
                        } else {
                            broadcastToRoom(roomCode, {
                                type: 'player_died',
                                playerId: playerId,
                                playerName: p ? p.name : null,
                                players: rooms[roomCode].players
                            });
                        }
                    }
                    break;
                }
                
                case 'light_toggle': {
                    if (rooms[roomCode]) {
                        rooms[roomCode].lightOn = data.isOn;
                        broadcastToRoom(roomCode, {
                            type: 'light_toggle',
                            isOn: data.isOn
                        });
                    }
                    break;
                }
                
                case 'restart_game': {
                    if (rooms[roomCode]) {
                        rooms[roomCode].gameStarted = false;
                        rooms[roomCode].gameOver = false;
                        rooms[roomCode].players.forEach(p => {
                            p.alive = true;
                            p.position = { x: 0, y: 5, z: 0 };
                        });
                        broadcastToRoom(roomCode, {
                            type: 'game_restarted',
                            players: rooms[roomCode].players
                        });
                    }
                    break;
                }
                
                case 'leave_room': {
                    leaveRoom();
                    break;
                }
            }
        } catch(e) {
            console.error('Error processing message:', e);
        }
    });
    
    ws.on('close', () => {
        leaveRoom();
    });
    
    function leaveRoom() {
        if (roomCode && rooms[roomCode]) {
            rooms[roomCode].players = rooms[roomCode].players.filter(p => p.id !== playerId);
            broadcastToRoom(roomCode, {
                type: 'player_left',
                players: rooms[roomCode].players
            });
            
            if (rooms[roomCode].players.length === 0) {
                delete rooms[roomCode];
            }
        }
        if (playerId) {
            clients.delete(playerId);
        }
        playerId = null;
        roomCode = null;
    }
    
    function broadcastToRoom(roomCode, data, excludeId) {
        const room = rooms[roomCode];
        if (!room) return;
        
        room.players.forEach(p => {
            if (p.id !== excludeId) {
                const client = clients.get(p.id);
                if (client && client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(JSON.stringify(data));
                }
            }
        });
    }
});

// Запускаем сервер
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ WebSocket server running on port ${PORT}`);
});
