/**
 * ==============================================================================
 * CẤU HÌNH HỆ THỐNG QUẢN LÝ TẬP TRUNG (ENVIRONMENT CONFIG)
 * ==============================================================================
 * Quản lý các tham số vận hành cho Facebook Automation Manager:
 * - HEADLESS: boolean (mặc định true - chạy ngầm tiết kiệm tài nguyên)
 * - MOCK_MODE: boolean (mặc định false - kết nối Facebook thật; true khi test local)
 * - PORT: number (3000)
 * - GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, FB_COOKIES_JSON
 */

const path = require('path');
const dotenv = require('dotenv');

// Nạp file .env từ thư mục gốc
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Đối tượng cấu hình toàn cục
 */
const CONFIG = {
  // Chế độ chạy ẩn ngầm không mở cửa sổ (mặc định: true)
  HEADLESS: process.env.HEADLESS !== undefined
    ? String(process.env.HEADLESS).trim().toLowerCase() === 'true'
    : true,

  // Chế độ giả lập (mặc định: false - chạy thật trên Facebook)
  MOCK_MODE: process.env.MOCK_MODE !== undefined
    ? String(process.env.MOCK_MODE).trim().toLowerCase() === 'true'
    : false,

  // Cổng máy chủ Mock nội bộ
  PORT: parseInt(process.env.PORT, 10) || 3000,

  // Khóa API Google Gemini (model gemini-2.5-flash phục vụ Self-Healing)
  GEMINI_API_KEY: (process.env.GEMINI_API_KEY || '').trim(),

  // Token Telegram Bot dùng để báo cáo và giám sát
  TELEGRAM_BOT_TOKEN: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),

  // Chat ID Telegram nhận thông báo quản trị
  TELEGRAM_CHAT_ID: (process.env.TELEGRAM_CHAT_ID || '').trim(),

  // Chuỗi JSON cookies duy trì phiên đăng nhập Facebook
  FB_COOKIES_JSON: (process.env.FB_COOKIES_JSON || process.env.FB_COOKIES_ENV || '').trim(),

  // Tên định danh thiết bị / máy tính (phục vụ quản lý khi chạy nhiều máy)
  MACHINE_NAME: (process.env.MACHINE_NAME || require('os').hostname() || 'Máy 1').trim(),
};

const fs = require('fs');

/**
 * Tự động tìm kiếm đường dẫn trình duyệt Google Chrome hoặc Edge trên hệ thống
 * @returns {string|undefined}
 */
function getChromeExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const candidatePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_) {}
  }

  return undefined;
}

/**
 * Trả về options launch Puppeteer với trình duyệt Chrome thật trên hệ thống
 * @param {object} customOptions
 * @returns {object}
 */
function getPuppeteerLaunchOptions(customOptions = {}) {
  const options = { ...customOptions };

  if (options.executablePath) {
    return options;
  }

  const detectedPath = getChromeExecutablePath();
  if (detectedPath) {
    options.executablePath = detectedPath;
  } else {
    options.channel = 'chrome';
  }

  return options;
}

CONFIG.CHROME_EXECUTABLE_PATH = getChromeExecutablePath();

module.exports = {
  CONFIG,
  getChromeExecutablePath,
  getPuppeteerLaunchOptions,
};
