/**
 * ==============================================================================
 * MÁY CHỦ WEB DASHBOARD & ĐIỀU PHỐI HỆ THỐNG (WEB SERVER & ENGINE ENTRY POINT)
 * ==============================================================================
 * 1. Khởi chạy Web Server bằng Express.js trên cổng cấu hình (mặc định 3000).
 * 2. Phục vụ giao diện Quản trị Dashboard trực quan tại `public/index.html`.
 * 3. Cung cấp hệ thống REST API (`/api/tasks`, `/api/tasks/:id/run`, v.v.).
 * 4. Duy trì Scheduler Service chạy ngầm tự động quét hàng đợi mỗi 30 giây.
 * 5. Bắt tín hiệu dừng an toàn (SIGINT, SIGTERM) để giải phóng cổng mạng và bộ nhớ.
 */

const path = require('path');
const express = require('express');
const { CONFIG } = require('./config/env');
const apiRoutes = require('./routes/api');
const { startScheduler, stopScheduler } = require('./services/scheduler.service');

const app = express();

// Middleware parse JSON và Form Data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Phục vụ giao diện tĩnh từ thư mục public/
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// Đăng ký API routes
app.use('/api', apiRoutes);

// Phục vụ trang index.html cho route gốc
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Khởi chạy máy chủ Express
let serverInstance = null;

function startWebServer() {
  return new Promise((resolve) => {
    serverInstance = app.listen(CONFIG.PORT, () => {
      console.log('================================================================');
      console.log('  HỆ THỐNG QUẢN LÝ ĐĂNG BÀI & TƯƠNG TÁC NUÔI NICK TỰ ĐỘNG FACEBOOK');
      console.log('================================================================');
      console.log(`- Môi trường (MOCK_MODE)       : ${CONFIG.MOCK_MODE ? 'Mock Localhost (Thử nghiệm)' : 'Facebook Production'}`);
      console.log(`- Cờ chạy ngầm (HEADLESS)      : ${CONFIG.HEADLESS ? 'Bật (Chạy ngầm)' : 'Tắt (Mở cửa sổ Chrome)'}`);
      console.log(`- Cổng máy chủ (PORT)          : ${CONFIG.PORT}`);
      console.log(`- Gemini AI 2.5 Flash          : ${CONFIG.GEMINI_API_KEY ? 'Đã sẵn sàng' : 'Chưa cấu hình API Key'}`);
      console.log(`- Telegram Alert               : ${CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_CHAT_ID ? 'Đã kết nối' : 'Chưa cấu hình'}`);
      console.log(`- Cookie tài khoản             : ${CONFIG.FB_COOKIES_JSON ? 'Đã cấu hình' : 'Dùng phiên trong .browser_session'}`);
      console.log('----------------------------------------------------------------');
      console.log(`🚀 Máy chủ Web Dashboard đang chạy tại: http://localhost:${CONFIG.PORT}`);
      console.log(`👉 Mở trình duyệt vào http://localhost:${CONFIG.PORT} để quản lý trực quan`);
      console.log('----------------------------------------------------------------\n');
      resolve(serverInstance);
    });
  });
}

// Hàm khởi động chính
async function main() {
  try {
    // 1. Khởi động Web Server Express
    await startWebServer();

    // 2. Kích hoạt Scheduler Service chạy ngầm tự động quét hàng đợi mỗi 30 giây
    startScheduler(30000);
    console.log('[System] Vòng lặp Scheduler đang chạy ngầm liên tục 24/7 để theo dõi lịch trình.');
    console.log('[System] Nhấn Ctrl+C để dừng máy chủ bất cứ lúc nào.\n');

    // 3. Đăng ký xử lý tắt hệ thống an toàn (Graceful Shutdown)
    const handleShutdown = () => {
      console.log('\n[System] Đang đóng hệ thống an toàn...');
      stopScheduler();

      if (serverInstance) {
        serverInstance.close(() => {
          console.log('[System] Đã đóng máy chủ Web Express. Tạm biệt!');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    };

    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
  } catch (error) {
    console.error(`[System] Lỗi khi khởi động ứng dụng: ${error.message}`);
    process.exit(1);
  }
}

// Thực thi
main();
