/**
 * ==============================================================================
 * MÁY CHỦ GIẢ LẬP FACEBOOK (MOCK HTTP SERVER)
 * ==============================================================================
 * Sử dụng module http thuần của Node.js để phục vụ giao diện mock_facebook.html.
 * Phục vụ kiểm thử Puppeteer nội bộ không phụ thuộc mạng bên ngoài hay tài khoản thật.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config/env');

let serverInstance = null;

/**
 * Khởi động máy chủ HTTP nội bộ phục vụ trang Facebook Mock
 * @returns {Promise<http.Server>} Trả về Promise chứa instance máy chủ HTTP
 */
function startMockServer() {
  return new Promise((resolve, reject) => {
    // Nếu máy chủ đã đang chạy thì tái sử dụng
    if (serverInstance && serverInstance.listening) {
      console.log(`[MockServer] Máy chủ mock đã đang chạy tại http://localhost:${CONFIG.PORT}`);
      return resolve(serverInstance);
    }

    const htmlPath = path.resolve(__dirname, 'mock_facebook.html');

    const server = http.createServer((req, res) => {
      // Phục vụ trang HTML giả lập cho mọi yêu cầu GET hoặc root
      fs.readFile(htmlPath, 'utf8', (err, htmlContent) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`Lỗi đọc file mock: ${err.message}`);
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        res.end(htmlContent);
      });
    });

    server.on('error', (err) => {
      console.error(`[MockServer] Lỗi khi khởi động máy chủ mock: ${err.message}`);
      reject(err);
    });

    server.listen(CONFIG.PORT, () => {
      serverInstance = server;
      console.log(`[MockServer] Máy chủ Mock Facebook đã sẵn sàng tại: http://localhost:${CONFIG.PORT}`);
      resolve(server);
    });
  });
}

/**
 * Dừng máy chủ Mock an toàn khi hoàn thành quy trình
 * @returns {Promise<void>}
 */
function stopMockServer() {
  return new Promise((resolve) => {
    if (!serverInstance) {
      return resolve();
    }

    serverInstance.close((err) => {
      if (err) {
        console.warn(`[MockServer] Cảnh báo khi dừng server: ${err.message}`);
      } else {
        console.log('[MockServer] Đã đóng máy chủ Mock an toàn.');
      }
      serverInstance = null;
      resolve();
    });
  });
}

module.exports = {
  startMockServer,
  stopMockServer,
};
