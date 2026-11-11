const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const TOTAL_SLOTS = 5;

// Cấu hình mặc định cho 5 slot bot
let botsConfig = [
  { id: 1, username: '_caubemocoi_', password: 'phong123@' },
  { id: 2, username: 'bot_phu_2', password: 'phong123@' },
  { id: 3, username: 'bot_phu_3', password: 'phong123@' },
  { id: 4, username: 'bot_phu_4', password: 'phong123@' },
  { id: 5, username: 'bot_phu_5', password: 'phong123@' }
];

// Lưu trữ trạng thái, instance bot và LỊCH SỬ LOG/CHAT TRÊN SERVER (không sợ mất khi out web)
const activeBots = {};
for (let i = 1; i <= TOTAL_SLOTS; i++) {
  activeBots[i] = {
    instance: null,
    isRunning: false,
    statusText: 'Đang tắt',
    isOnline: false,
    timeouts: [],
    hasAuthenticated: false,
    waitingForMenu: false,
    statsInterval: null,
    currentWindow: null,
    coords: 'X: --, Y: --, Z: --',
    health: 20,
    food: 20,
    nearest: 'Không có',
    logs: [],       // Lưu lịch sử log
    gameChat: []    // Lưu lịch sử chat
  };
}

function clearBotTimeouts(botId) {
  if (activeBots[botId] && activeBots[botId].timeouts) {
    activeBots[botId].timeouts.forEach(t => clearTimeout(t));
    activeBots[botId].timeouts = [];
  }
}

function logToBot(botId, msg) {
  const time = new Date().toLocaleTimeString('vi-VN');
  const formatted = '[' + time + '] ' + msg;
  console.log(`[Bot ${botId}] ${formatted}`);
  
  if (activeBots[botId]) {
    activeBots[botId].logs.push(formatted);
    // Giữ tối đa 200 log gần nhất tránh tràn RAM
    if (activeBots[botId].logs.length > 200) activeBots[botId].logs.shift();
  }

  io.emit('log_update', { botId, msg: formatted });
}

function addChatToBot(botId, msg) {
  if (activeBots[botId]) {
    activeBots[botId].gameChat.push(msg);
    if (activeBots[botId].gameChat.length > 200) activeBots[botId].gameChat.shift();
  }
  io.emit('chat_update', { botId, msg });
}

function updateBotStatus(botId, text, online) {
  if (activeBots[botId]) {
    activeBots[botId].statusText = text;
    activeBots[botId].isOnline = online;
  }
  io.emit('status_update', { botId, text, online });
}

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>5-Slot Minecraft Bot Dashboard</title>
      <script src="/socket.io/socket.io.js"></script>
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 1100px; margin: 0 auto; background: #ffffff; padding: 25px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border: 1px solid #ddd; }
        h2 { margin-top: 0; color: #2e7d32; display: flex; align-items: center; justify-content: space-between; }
        
        .config-box { background: #fafafa; border: 1px solid #ccc; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .bot-config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 10px; }
        .bot-slot-box { background: #fff; border: 1px solid #ddd; padding: 10px; border-radius: 6px; }
        .bot-slot-box label { font-weight: bold; font-size: 12px; color: #555; display: block; margin-bottom: 3px; }
        .bot-slot-box input { width: 100%; padding: 7px; border-radius: 4px; border: 1px solid #ccc; font-size: 13px; outline: none; margin-bottom: 6px; }

        .action-bar { display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
        .group-btns { display: flex; gap: 10px; }
        button { padding: 10px 16px; border: none; border-radius: 6px; color: white; cursor: pointer; font-weight: bold; font-size: 14px; transition: background 0.2s; }
        .btn-all-on { background: #2e7d32; }
        .btn-all-off { background: #c62828; }
        .btn-save { background: #ff9800; }
        .btn-single-toggle { padding: 6px 12px; font-size: 12px; }

        .bot-tabs { display: flex; gap: 5px; border-bottom: 2px solid #ddd; margin-bottom: 15px; overflow-x: auto; }
        .tab-btn { background: #e0e0e0; color: #333; padding: 10px 16px; border-radius: 6px 6px 0 0; cursor: pointer; border: none; font-weight: bold; display: flex; align-items: center; gap: 6px; }
        .tab-btn.active { background: #2e7d32; color: #fff; }
        .tab-dot { width: 8px; height: 8px; border-radius: 50%; background: #9e9e9e; display: inline-block; }
        .tab-dot.online { background: #4caf50; }

        .stats-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px; }
        .stat-card { background: #f9f9f9; padding: 12px; border-radius: 6px; border-left: 4px solid #2e7d32; font-size: 13px; border: 1px solid #e0e0e0; }
        .stat-card b { color: #2e7d32; display: block; margin-top: 4px; font-size: 15px; font-family: monospace; }
        @media (max-width: 768px) { .stats-bar { grid-template-columns: 1fr 1fr; } }

        .dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        @media (max-width: 768px) { .dashboard-grid { grid-template-columns: 1fr; } }

        .panel { background: #fafafa; border: 1px solid #ccc; border-radius: 6px; padding: 10px; height: 300px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; color: #333; }
        .panel-title { font-weight: bold; margin-bottom: 8px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
        
        .log-entry { margin-bottom: 4px; border-bottom: 1px solid #eee; padding-bottom: 2px; color: #444; }
        .chat-entry { color: #00796b; margin-bottom: 4px; border-bottom: 1px solid #eee; padding-bottom: 2px; font-weight: 500; }

        .control-section { margin-top: 15px; background: #fafafa; padding: 15px; border-radius: 6px; display: flex; gap: 10px; border: 1px solid #ccc; }
        input[type="text"] { flex: 1; padding: 10px; border-radius: 6px; border: 1px solid #ccc; background: #fff; color: #333; font-size: 14px; outline: none; }
        .btn-send { background: #0288d1; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>
          <span>🤖 Quản Lý 5 Slot Minecraft Bot</span>
          <span id="headerBotTitle" style="font-size: 16px; color: #555;">Đang xem: Bot 1</span>
        </h2>
        
        <!-- Cấu hình 5 slot bot -->
        <div class="config-box">
          <div class="bot-config-grid" id="botConfigGrid"></div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
            <button class="btn-save" onclick="saveConfigs()">💾 Lưu Cấu Hình 5 Bot</button>
            <div style="display: flex; gap: 10px;">
              <button class="btn-single-toggle" id="btnToggleCurrent" style="background: #4caf50;" onclick="toggleCurrentBot()">Bật/Tắt Bot Này</button>
            </div>
          </div>
        </div>

        <div class="action-bar">
          <div class="group-btns">
            <button class="btn-all-on" onclick="connectAll()">🚀 Bật Tất Cả Bot (All)</button>
            <button class="btn-all-off" onclick="disconnectAll()">🛑 Tắt Tất Cả Bot (All)</button>
          </div>
          <span id="globalStatus" style="font-weight: bold; color: #555;">Trạng thái: Sẵn sàng</span>
        </div>

        <!-- 5 Tabs Bot -->
        <div class="bot-tabs" id="botTabs"></div>

        <!-- Thông số Bot đang chọn -->
        <div class="stats-bar">
          <div class="stat-card">Tọa độ (X, Y, Z)<b id="statCoords">X: --, Y: --, Z: --</b></div>
          <div class="stat-card">Máu (HP)<b id="statHealth">❤️ -- / 20</b></div>
          <div class="stat-card">Độ đói / No<b id="statFood">🍖 -- / 20</b></div>
          <div class="stat-card">Player gần nhất<b id="statNearest">Không có</b></div>
        </div>

        <div class="dashboard-grid">
          <div>
            <div class="panel-title">
              <span>📜 Nhật ký hệ thống (Logs)</span>
              <span id="statusBadge" style="font-size: 11px; background: #d32f2f; color: #fff; padding: 2px 6px; border-radius: 4px;">Đang tắt</span>
            </div>
            <div id="logs" class="panel"></div>
          </div>
          <div>
            <div class="panel-title">💬 Chat trong game</div>
            <div id="gameChat" class="panel"></div>
          </div>
        </div>

        <div class="control-section">
          <input type="text" id="cmdInput" placeholder="Nhập lệnh hoặc chat thay mặt Bot đang chọn..." onkeypress="handleKeyPress(event)" />
          <button class="btn-send" onclick="sendCommand()">Gửi lệnh</button>
        </div>
      </div>

      <script>
        const socket = io();
        let currentBotId = 1;
        let localConfigs = [];

        window.addEventListener('DOMContentLoaded', () => {
          socket.emit('get_initial_data');
        });

        socket.on('init_data', (data) => {
          localConfigs = data.configs;
          renderConfigGrid();
          renderTabs();
          switchTab(currentBotId);
        });

        function renderConfigGrid() {
          const grid = document.getElementById('botConfigGrid');
          grid.innerHTML = '';
          localConfigs.forEach((cfg) => {
            const div = document.createElement('div');
            div.className = 'bot-slot-box';
            div.innerHTML = \`
              <label>Bot Slot \${cfg.id}:</label>
              <input type="text" placeholder="Username" value="\${cfg.username}" id="user_\${cfg.id}" />
              <input type="password" placeholder="Password (/login)" value="\${cfg.password}" id="pass_\${cfg.id}" />
            \`;
            grid.appendChild(div);
          });
        }

        function renderTabs() {
          const tabsDiv = document.getElementById('botTabs');
          tabsDiv.innerHTML = '';
          localConfigs.forEach((cfg) => {
            const btn = document.createElement('button');
            btn.className = 'tab-btn' + (cfg.id === currentBotId ? ' active' : '');
            btn.id = 'tab_btn_' + cfg.id;
            btn.innerHTML = \`<span class="tab-dot" id="dot_\${cfg.id}"></span> Bot \${cfg.id}: \${cfg.username}\`;
            btn.onclick = () => switchTab(cfg.id);
            tabsDiv.appendChild(btn);
          });
          socket.emit('request_sync_status');
        }

        function switchTab(botId) {
          currentBotId = botId;
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          const activeBtn = document.getElementById('tab_btn_' + botId);
          if (activeBtn) activeBtn.classList.add('active');

          const cfg = localConfigs.find(c => c.id === botId);
          document.getElementById('headerBotTitle').textContent = 'Đang xem: Bot ' + botId + ' (' + (cfg ? cfg.username : '') + ')';
          
          document.getElementById('logs').innerHTML = '';
          document.getElementById('gameChat').innerHTML = '';

          socket.emit('request_bot_history', botId);
        }

        function saveConfigs() {
          localConfigs.forEach(cfg => {
            const u = document.getElementById('user_' + cfg.id);
            const p = document.getElementById('pass_' + cfg.id);
            if (u) cfg.username = u.value.trim();
            if (p) cfg.password = p.value.trim();
          });
          socket.emit('save_configs', localConfigs);
          renderTabs();
          alert('Đã lưu cấu hình 5 Slot Bot thành công!');
        }

        function toggleCurrentBot() {
          saveConfigs();
          socket.emit('toggle_bot', currentBotId);
        }

        function connectAll() {
          saveConfigs();
          socket.emit('connect_all');
        }

        function disconnectAll() {
          socket.emit('disconnect_all');
        }

        socket.on('sync_status', (statusList) => {
          statusList.forEach(st => {
            const dot = document.getElementById('dot_' + st.botId);
            if (dot) {
              if (st.isOnline) dot.classList.add('online');
              else dot.classList.remove('online');
            }
            if (st.botId === currentBotId) {
              const badge = document.getElementById('statusBadge');
              badge.textContent = st.text;
              badge.style.background = st.isOnline ? '#2e7d32' : '#d32f2f';
              
              const toggleBtn = document.getElementById('btnToggleCurrent');
              toggleBtn.textContent = st.isRunning ? '🔴 Tắt Bot Này' : '🟢 Bật Bot Này';
              toggleBtn.style.background = st.isRunning ? '#c62828' : '#4caf50';
            }
          });
        });

        socket.on('status_update', (data) => {
          const dot = document.getElementById('dot_' + data.botId);
          if (dot) {
            if (data.online) dot.classList.add('online');
            else dot.classList.remove('online');
          }
          if (data.botId === currentBotId) {
            const badge = document.getElementById('statusBadge');
            badge.textContent = data.text;
            badge.style.background = data.online ? '#2e7d32' : '#d32f2f';

            const toggleBtn = document.getElementById('btnToggleCurrent');
            const isRunning = data.text.includes('Hoạt động') || data.text.includes('Kết nối');
            toggleBtn.textContent = isRunning ? '🔴 Tắt Bot Này' : '🟢 Bật Bot Này';
            toggleBtn.style.background = isRunning ? '#c62828' : '#4caf50';
          }
        });

        socket.on('stats_update', (data) => {
          if (data.botId === currentBotId) {
            document.getElementById('statCoords').textContent = data.coords;
            document.getElementById('statHealth').textContent = '❤️ ' + data.health + ' / 20';
            document.getElementById('statFood').textContent = '🍖 ' + data.food + ' / 20';
            document.getElementById('statNearest').textContent = data.nearest;
          }
        });

        socket.on('load_history', (data) => {
          if (data.botId === currentBotId) {
            const logsDiv = document.getElementById('logs');
            logsDiv.innerHTML = data.logs.map(l => '<div class="log-entry">' + l + '</div>').join('');
            logsDiv.scrollTop = logsDiv.scrollHeight;

            const chatDiv = document.getElementById('gameChat');
            chatDiv.innerHTML = data.gameChat.map(c => '<div class="chat-entry">' + c + '</div>').join('');
            chatDiv.scrollTop = chatDiv.scrollHeight;
          }
        });

        socket.on('log_update', (data) => {
          if (data.botId === currentBotId) {
            const logsDiv = document.getElementById('logs');
            logsDiv.innerHTML += '<div class="log-entry">' + data.msg + '</div>';
            logsDiv.scrollTop = logsDiv.scrollHeight;
          }
        });

        socket.on('chat_update', (data) => {
          if (data.botId === currentBotId) {
            const chatDiv = document.getElementById('gameChat');
            chatDiv.innerHTML += '<div class="chat-entry">' + data.msg + '</div>';
            chatDiv.scrollTop = chatDiv.scrollHeight;
          }
        });

        function sendCommand() {
          const input = document.getElementById('cmdInput');
          const message = input.value.trim();
          if (message) {
            socket.emit('send_command', { botId: currentBotId, cmd: message });
            input.value = '';
          }
        }

        function handleKeyPress(e) {
          if (e.key === 'Enter') sendCommand();
        }
      </script>
    </body>
    </html>
  `);
});

function sendStatsToWeb(botId) {
  const bObj = activeBots[botId];
  if (!bObj || !bObj.instance || !bObj.instance.entity) return;

  const bot = bObj.instance;
  const pos = bot.entity.position;
  bObj.coords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
  bObj.health = bot.health !== undefined ? bot.health : 20;
  bObj.food = bot.food !== undefined ? bot.food : 20;

  let nearestPlayer = "Không có";
  if (bot.players) {
    const players = Object.values(bot.players).filter(p => p.username !== bot.username && p.entity);
    if (players.length > 0) {
      let closest = players.reduce((prev, curr) => {
        const distPrev = prev.entity.position.distanceTo(bot.entity.position);
        const distCurr = curr.entity.position.distanceTo(bot.entity.position);
        return distCurr < distPrev ? curr : prev;
      });
      nearestPlayer = closest.username;
    }
  }
  bObj.nearest = nearestPlayer;

  io.emit('stats_update', { botId, coords: bObj.coords, health: bObj.health, food: bObj.food, nearest: bObj.nearest });
}

function startSingleBot(config) {
  const botId = config.id;
  const bObj = activeBots[botId];
  if (!bObj) return;

  bObj.isRunning = true;
  clearBotTimeouts(botId);
  if (bObj.instance) {
    try { bObj.instance.quit(); } catch (e) {}
    bObj.instance = null;
  }
  if (bObj.statsInterval) clearInterval(bObj.statsInterval);

  bObj.hasAuthenticated = false;
  bObj.waitingForMenu = false;

  logToBot(botId, "🔄 Đang kết nối tới kingmc.vn với tên " + config.username + "...");
  updateBotStatus(botId, 'Đang kết nối...', false);

  const bot = mineflayer.createBot({
    host: 'kingmc.vn',
    username: config.username,
    version: '1.20.1'
  });

  bObj.instance = bot;

  bot.on('message', (jsonMsg) => {
    const rawText = jsonMsg.toString().trim();
    if (rawText) {
      addChatToBot(botId, rawText);

      const lowerText = rawText.toLowerCase();
      if (!bObj.hasAuthenticated && (lowerText.includes('register') || lowerText.includes('đăng ký'))) {
        bObj.hasAuthenticated = true;
        clearBotTimeouts(botId);

        logToBot(botId, "📝 Phát hiện tài khoản mới, đang tự động đăng ký (/register)...");
        bot.chat(`/register ${config.password} ${config.password}`);

        const tMenu = setTimeout(() => {
          if (!bObj.isRunning || !bObj.instance) return;
          bObj.waitingForMenu = true;
          bot.chat('/menu');
          logToBot(botId, "📋 Đã gửi lệnh /menu sau khi đăng ký");
        }, 4000);
        bObj.timeouts.push(tMenu);
      }
    }
  });

  bot.on('spawn', () => {
    logToBot(botId, "✅ Bot đã vào game thành công!");
    updateBotStatus(botId, 'Đang hoạt động (Online)', true);

    if (bObj.statsInterval) clearInterval(bObj.statsInterval);
    bObj.statsInterval = setInterval(() => sendStatsToWeb(botId), 1000);

    if (!bObj.hasAuthenticated) {
      const t1 = setTimeout(() => {
        if (!bObj.isRunning || !bObj.instance || bObj.hasAuthenticated) return;
        bot.chat('/login ' + config.password);
        logToBot(botId, "🔐 Đã gửi lệnh /login lần 1");

        const t2 = setTimeout(() => {
          if (!bObj.isRunning || !bObj.instance || bObj.hasAuthenticated) return;
          bot.chat('/login ' + config.password);
          logToBot(botId, "🔐 Đã gửi lệnh /login lần 2");

          const t3 = setTimeout(() => {
            if (!bObj.isRunning || !bObj.instance) return;
            bObj.hasAuthenticated = true;
            bObj.waitingForMenu = true;
            bot.chat('/menu');
            logToBot(botId, "📋 Đã gửi lệnh /menu");
          }, 4000);

          bObj.timeouts.push(t3);
        }, 3000);

        bObj.timeouts.push(t2);
      }, 5000);

      bObj.timeouts.push(t1);
    }
  });

  bot.on('windowOpen', (window) => {
    bObj.currentWindow = window;
    let windowTitle = "Menu";
    try {
      windowTitle = window.title ? JSON.parse(window.title).text || window.title.toString() : "Menu";
    } catch (e) {
      windowTitle = window.title ? window.title.toString() : "Menu";
    }

    logToBot(botId, "📋 Đã nhận diện Menu ngầm: " + windowTitle + " (" + window.slots.length + " ô)");

    if (bObj.waitingForMenu && window.slots.length >= 25) {
      bObj.waitingForMenu = false;

      const t4 = setTimeout(() => {
        if (!bObj.isRunning || !bObj.instance || bObj.currentWindow !== window) return;
        try {
          bot.clickWindow(24, 0, 0);
          logToBot(botId, "👉 Đã click slot thứ 24 theo lệnh /menu");

          const t5 = setTimeout(() => {
            if (!bObj.isRunning || !bObj.instance) return;
            bot.chat('/afk');
            logToBot(botId, "💬 Đã gửi lệnh /afk");
          }, 4000);

          bObj.timeouts.push(t5);
        } catch (err) {
          logToBot(botId, "⚠️ Lỗi click slot 24: " + err.message);
        }
      }, 3000);

      bObj.timeouts.push(t4);
    } else if (window.slots.length === 63 || window.slots.length === 54 || window.slots.length >= 10) {
      const t6 = setTimeout(() => {
        if (!bObj.isRunning || !bObj.instance || bObj.currentWindow !== window) return;
        try {
          const randomSlot = Math.floor(Math.random() * 10);
          bot.clickWindow(randomSlot, 0, 0);
          logToBot(botId, "🎲 Đã chọn ngẫu nhiên slot thứ " + randomSlot + " trong menu AFK");
        } catch (err) {
          logToBot(botId, "⚠️ Lỗi click slot ngẫu nhiên: " + err.message);
        }
      }, 1500);

      bObj.timeouts.push(t6);
    }
  });

  bot.on('windowClose', () => {
    bObj.currentWindow = null;
  });

  bot.on('end', (reason) => {
    logToBot(botId, "⚠️ Bot ngắt kết nối do: " + reason);
    clearBotTimeouts(botId);
    if (bObj.statsInterval) clearInterval(bObj.statsInterval);
    updateBotStatus(botId, 'Mất kết nối, chờ reconnect...', false);

    if (bObj.isRunning) {
      logToBot(botId, "⏳ Tự động kết nối lại (reconnect) sau 10 giây...");
      setTimeout(() => {
        if (bObj.isRunning) {
          startSingleBot(config);
        }
      }, 10000);
    }
  });

  bot.on('error', (err) => {
    logToBot(botId, "❌ Lỗi Bot: " + err.message);
    clearBotTimeouts(botId);
    updateBotStatus(botId, 'Lỗi kết nối', false);
  });
}

function stopSingleBot(botId) {
  const bObj = activeBots[botId];
  if (bObj) {
    bObj.isRunning = false;
    clearBotTimeouts(botId);
    if (bObj.statsInterval) clearInterval(bObj.statsInterval);
    if (bObj.instance) {
      try { bObj.instance.quit(); } catch (e) {}
      bObj.instance = null;
    }
    updateBotStatus(botId, 'Đang tắt', false);
    logToBot(botId, "🛑 Đã tắt bot thủ công.");
  }
}

io.on('connection', (socket) => {
  socket.on('get_initial_data', () => {
    socket.emit('init_data', { configs: botsConfig });
  });

  socket.on('request_sync_status', () => {
    const statusList = botsConfig.map(cfg => ({
      botId: cfg.id,
      text: activeBots[cfg.id].statusText,
      isOnline: activeBots[cfg.id].isOnline,
      isRunning: activeBots[cfg.id].isRunning
    }));
    socket.emit('sync_status', statusList);
  });

  socket.on('request_bot_history', (botId) => {
    const bObj = activeBots[botId];
    if (bObj) {
      socket.emit('load_history', {
        botId,
        logs: bObj.logs,
        gameChat: bObj.gameChat
      });
      socket.emit('stats_update', {
        botId,
        coords: bObj.coords,
        health: bObj.health,
        food: bObj.food,
        nearest: bObj.nearest
      });
    }
  });

  socket.on('save_configs', (configs) => {
    if (configs && Array.isArray(configs)) {
      configs.forEach(newCfg => {
        const found = botsConfig.find(c => c.id === newCfg.id);
        if (found) {
          found.username = newCfg.username;
          found.password = newCfg.password;
        }
      });
    }
  });

  socket.on('toggle_bot', (botId) => {
    const cfg = botsConfig.find(c => c.id === botId);
    const bObj = activeBots[botId];
    if (cfg && bObj) {
      if (bObj.isRunning && bObj.instance) {
        stopSingleBot(botId);
      } else {
        startSingleBot(cfg);
      }
    }
  });

  socket.on('connect_all', () => {
    botsConfig.forEach((cfg, idx) => {
      setTimeout(() => {
        startSingleBot(cfg);
      }, idx * 3000);
    });
  });

  socket.on('disconnect_all', () => {
    botsConfig.forEach(cfg => {
      stopSingleBot(cfg.id);
    });
  });

  socket.on('send_command', (data) => {
    const { botId, cmd } = data;
    const bObj = activeBots[botId];
    if (bObj && bObj.instance && bObj.isRunning) {
      if (cmd.trim().toLowerCase() === '/menu') {
        bObj.waitingForMenu = true;
      }
      bObj.instance.chat(cmd);
      logToBot(botId, "📤 [Web gửi]: " + cmd);
    }
  });
});

server.listen(PORT, () => {
  console.log("5-Slot Minecraft Bot Dashboard đang chạy hoàn hảo tại cổng " + PORT);
});
