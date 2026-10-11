/**
 * ==============================================================================
 * DỊCH VỤ QUẢN LÝ COOKIE XÁC THỰC (FACEBOOK COOKIE SERVICE)
 * ==============================================================================
 * Xử lý nạp cookie từ biến môi trường CONFIG.FB_COOKIES_JSON vào phiên Puppeteer:
 * - Hỗ trợ chuỗi JSON thường, chuỗi bọc trong nháy đơn/kép, và chuỗi mã hóa Base64.
 * - Tự động thiết lập domain và các cờ bảo mật (secure, httpOnly, sameSite).
 */

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config/env');

const ROOT_DIR = path.resolve(__dirname, '../../');
const FB_COOKIES_FILE = path.join(ROOT_DIR, 'fb_cookies.json');

/**
 * Đọc mảng cookie thô từ file fb_cookies.json hoặc biến môi trường FB_COOKIES_JSON
 * @returns {Array<object>|null}
 */
function getStoredCookies() {
  try {
    // 1. Ưu tiên đọc từ file fb_cookies.json ở thư mục gốc
    if (fs.existsSync(FB_COOKIES_FILE)) {
      const rawFile = fs.readFileSync(FB_COOKIES_FILE, 'utf8').trim();
      if (rawFile) {
        const parsed = JSON.parse(rawFile);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }

    // 2. Fallback sang biến môi trường CONFIG.FB_COOKIES_JSON
    if (CONFIG.FB_COOKIES_JSON) {
      let raw = CONFIG.FB_COOKIES_JSON.trim();

      // Loại bỏ dấu nháy đơn hoặc nháy kép bao bọc chuỗi multiline trong file .env
      if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
        raw = raw.slice(1, -1).trim();
      }

      // Chuẩn hóa khoảng trắng: thay thế non-breaking space (\u00A0) thành standard space
      raw = raw.replace(/\u00A0/g, ' ');

      if (raw.startsWith('[') || raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [parsed];
      } else {
        // Trường hợp chuỗi được mã hóa Base64
        const decoded = Buffer.from(raw, 'base64').toString('utf8').replace(/\u00A0/g, ' ');
        const parsed = JSON.parse(decoded);
        return Array.isArray(parsed) ? parsed : [parsed];
      }
    }
  } catch (err) {
    console.warn(`[Cookie] Lỗi khi đọc dữ liệu cookie: ${err.message}`);
  }

  return null;
}

/**
 * Kiểm tra xem hệ thống đã có cookie đăng nhập hợp lệ (chứa c_user & xs) hay chưa
 * @returns {boolean}
 */
function hasValidCookies() {
  const cookies = getStoredCookies();
  if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
    return false;
  }
  const hasCUser = cookies.some((c) => c.name === 'c_user');
  const hasXs = cookies.some((c) => c.name === 'xs');
  return Boolean(hasCUser && hasXs);
}

/**
 * Nạp danh sách cookie vào trang Puppeteer
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>} Trả về true nếu nạp thành công
 */
async function loadCookiesIntoSession(page) {
  const cookies = getStoredCookies();

  if (!cookies || cookies.length === 0) {
    console.log('[Cookie] Không tìm thấy cookie trong fb_cookies.json hoặc .env. Sử dụng phiên sẵn có trong .browser_session.');
    return false;
  }

  try {
    // Lọc và làm sạch cookie hợp lệ trước khi set vào Puppeteer
    const sanitizedCookies = cookies.map((c) => {
      const cookie = {
        name: c.name,
        value: c.value,
        domain: c.domain || '.facebook.com',
        path: c.path || '/',
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
      };
      // Xử lý sameSite hợp lệ theo chuẩn Chrome
      if (c.sameSite) {
        const s = String(c.sameSite).toLowerCase();
        if (['lax', 'strict', 'none'].includes(s)) {
          cookie.sameSite = s.charAt(0).toUpperCase() + s.slice(1);
        }
      }
      return cookie;
    });

    await page.setCookie(...sanitizedCookies);
    console.log(`[Cookie] Đã nạp thành công ${sanitizedCookies.length} cookie vào phiên Puppeteer.`);
    return true;
  } catch (err) {
    console.warn(`[Cookie] Cảnh báo lỗi nạp cookie vào trang: ${err.message}`);
    return false;
  }
}

module.exports = {
  getStoredCookies,
  hasValidCookies,
  loadCookiesIntoSession,
  FB_COOKIES_FILE,
};

