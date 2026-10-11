/**
 * ==============================================================================
 * DỊCH VỤ ĐĂNG NHẬP FACEBOOK THỦ CÔNG & TỰ ĐỘNG LƯU COOKIE (AUTH SERVICE)
 * ==============================================================================
 * Cung cấp giải pháp đăng nhập an toàn, thân thiện:
 * 1. Mở trình duyệt Chrome thật (headless: false) có plugin stealth chống bot.
 * 2. Cho phép người dùng tự điền mật khẩu, quét mã QR, xác thực 2FA.
 * 3. Tự động nhận diện khi đăng nhập thành công qua session cookies (c_user, xs).
 * 4. Tự động lưu cookies vào `fb_cookies.json` và cập nhật lại biến `FB_COOKIES_JSON` trong `.env`.
 * 5. Bắn thông báo Telegram và đóng trình duyệt an toàn.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { CONFIG, getPuppeteerLaunchOptions } = require('../config/env');
const { sendReport } = require('./telegram.service');
const { addLog } = require('./logger.service');
const { syncAccountAfterLogin } = require('./accountManager.service');

puppeteer.use(StealthPlugin());

const ROOT_DIR = path.resolve(__dirname, '../../');
const FB_COOKIES_FILE = path.join(ROOT_DIR, 'fb_cookies.json');
const ENV_FILE = path.join(ROOT_DIR, '.env');

/**
 * Tạm dừng mili-giây
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cập nhật biến FB_COOKIES_JSON trong file .env mà không làm mất các biến khác
 * @param {string} cookieJsonString
 */
function updateEnvCookieVariable(cookieJsonString) {
  try {
    if (!fs.existsSync(ENV_FILE)) {
      fs.writeFileSync(ENV_FILE, `FB_COOKIES_JSON='${cookieJsonString}'\n`, 'utf8');
      return;
    }

    let envContent = fs.readFileSync(ENV_FILE, 'utf8');
    const cookieRegex = /^FB_COOKIES_JSON=.*$/m;

    if (cookieRegex.test(envContent)) {
      envContent = envContent.replace(cookieRegex, `FB_COOKIES_JSON='${cookieJsonString}'`);
    } else {
      envContent += `\nFB_COOKIES_JSON='${cookieJsonString}'\n`;
    }

    fs.writeFileSync(ENV_FILE, envContent, 'utf8');
    // Đồng bộ lại biến trong bộ nhớ hiện tại
    CONFIG.FB_COOKIES_JSON = cookieJsonString;
    console.log('[Auth] Đã cập nhật biến FB_COOKIES_JSON trong file .env thành công.');
  } catch (err) {
    console.error(`[Auth] Lỗi khi cập nhật file .env: ${err.message}`);
  }
}

const { getStoredCookies } = require('./cookie.service');

// Cờ kiểm soát tránh người dùng bấm nút mở đăng nhập nhiều lần cùng lúc
let isLoggingIn = false;

/**
 * Kiểm tra xem hệ thống đã có cookie đăng nhập hợp lệ chưa
 * @returns {{ loggedIn: boolean, count: number, userId?: string, userName?: string, source?: string }}
 */
function checkAuthStatus() {
  try {
    const cookies = getStoredCookies();

    if (Array.isArray(cookies) && cookies.length > 0) {
      const cUser = cookies.find((c) => c.name === 'c_user');
      const xs = cookies.find((c) => c.name === 'xs');

      if (cUser && xs) {
        const source = fs.existsSync(FB_COOKIES_FILE) ? 'fb_cookies.json' : '.env';
        let userName = 'Phạm Nayuta';

        try {
          const { loadAccounts } = require('./accountManager.service');
          const accs = loadAccounts();
          const matched = accs.find((a) => {
            if (a.id === `acc_${cUser.value}`) return true;
            if (Array.isArray(a.cookies) && a.cookies.some((c) => c.name === 'c_user' && c.value === cUser.value)) return true;
            return false;
          });
          if (matched && matched.name && !matched.name.startsWith('Facebook (UID:')) {
            userName = matched.name;
          }
        } catch (_) {}

        return {
          loggedIn: true,
          count: cookies.length,
          userId: cUser.value,
          userName: userName,
          source,
        };
      }
    }

    return {
      loggedIn: false,
      count: 0,
    };
  } catch (err) {
    return {
      loggedIn: false,
      count: 0,
      error: err.message,
    };
  }
}

/**
 * Khởi chạy quy trình đăng nhập Facebook tương tác trên cửa sổ Chrome thật
 * @param {number} [maxWaitSeconds=180] - Thời gian chờ người dùng thao tác (tối đa 180s)
 * @returns {Promise<{ success: boolean, message: string, cookieCount?: number, userId?: string }>}
 */
async function interactiveLogin(maxWaitSeconds = 180) {
  if (isLoggingIn) {
    return {
      success: false,
      message: 'Hiện đang có một cửa sổ trình duyệt đăng nhập đang mở. Vui lòng hoàn tất hoặc đóng cửa sổ đó trước!',
    };
  }

  isLoggingIn = true;
  console.log('\n================================================================');
  console.log('  KHỞI CHẠY ĐĂNG NHẬP FACEBOOK THỦ CÔNG (INTERACTIVE LOGIN)');
  console.log('================================================================');
  console.log('👉 Vui lòng đăng nhập tài khoản Facebook trên cửa sổ Chrome vừa mở (hỗ trợ cả 2FA / quét mã)...');
  addLog('Vui lòng đăng nhập tài khoản Facebook trên cửa sổ Chrome vừa mở (hỗ trợ cả 2FA / quét mã)...');

  let browser = null;

  try {
    const sessionDir = path.resolve(__dirname, '../../.browser_session');
    const chromeArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions',
      '--mute-audio',
    ];

    // BẮT BUỘC headless: false để hiện cửa sổ thật cho người dùng đăng nhập
    browser = await puppeteer.launch(getPuppeteerLaunchOptions({
      headless: false,
      userDataDir: sessionDir,
      args: chromeArgs,
      defaultViewport: {
        width: 1200,
        height: 750,
      },
    }));

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    // Xóa sạch cookie phiên cũ để Chrome mở form đăng nhập Facebook trống cho người dùng thao tác
    try {
      const client = await page.target().createCDPSession();
      await client.send('Network.clearBrowserCookies');
    } catch (_) {}

    console.log('[Auth] Đang điều hướng đến trang: https://www.facebook.com/login...');
    await page.goto('https://www.facebook.com/login', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    const startTime = Date.now();
    const timeoutMs = maxWaitSeconds * 1000;
    let loginSuccess = false;
    let savedCookies = [];
    let detectedUserId = '';

    // Vòng lặp kiểm tra trạng thái đăng nhập mỗi 2 giây
    while (Date.now() - startTime < timeoutMs) {
      if (!browser.isConnected()) {
        throw new Error('Người dùng đã đóng cửa sổ trình duyệt trước khi hoàn tất đăng nhập.');
      }

      // Lấy danh sách cookie hiện tại
      const currentCookies = await page.cookies();
      const cUser = currentCookies.find((c) => c.name === 'c_user');
      const xs = currentCookies.find((c) => c.name === 'xs');

      // Nhận diện URL hiện tại
      const currentUrl = page.url();

      if (cUser && xs) {
        // Đã có session cookie hợp lệ
        loginSuccess = true;
        savedCookies = currentCookies;
        detectedUserId = cUser.value;
        console.log(`[Auth] Phát hiện đăng nhập thành công! User ID: ${detectedUserId}`);
        break;
      }

      // Kiểm tra thêm qua URL nếu không còn chứa login/checkpoint và đã có cUser
      if (
        !currentUrl.includes('/login') &&
        !currentUrl.includes('/checkpoint') &&
        currentUrl.includes('facebook.com') &&
        cUser
      ) {
        loginSuccess = true;
        savedCookies = currentCookies;
        detectedUserId = cUser.value;
        console.log('[Auth] Đã chuyển hướng vào trang chủ Facebook thành công.');
        break;
      }

      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      if (elapsedSec % 10 === 0) {
        console.log(`[Auth] Đang chờ người dùng đăng nhập... (${elapsedSec}s/${maxWaitSeconds}s)`);
      }

      await sleep(2000);
    }

    if (!loginSuccess) {
      throw new Error(`Đã hết thời gian chờ (${maxWaitSeconds}s). Người dùng chưa hoàn tất đăng nhập.`);
    }

    // Trích xuất tên Facebook thật ngầm ngay trên trang hiện tại - KHÔNG mở tab mới, KHÔNG nhảy trang
    let realName = 'Phạm Nayuta';
    try {
      const scraped = await page.evaluate(() => {
        const profileLink = document.querySelector('a[href*="/user/"], a[href*="/profile.php"], a[href^="/me"], a[href*="/me/"]');
        if (profileLink && profileLink.innerText && profileLink.innerText.trim()) {
          const text = profileLink.innerText.trim();
          if (text.length >= 2 && text.length <= 40 && !text.includes('\n')) return text;
        }
        const scripts = Array.from(document.querySelectorAll('script')).map((s) => s.innerText);
        for (const s of scripts) {
          const m = s.match(/"NAME":"([^"]+)"/);
          if (m && m[1] && m[1].length < 50) {
            try { return JSON.parse(`"${m[1]}"`); } catch (_) { return m[1]; }
          }
        }
        const title = document.title || '';
        const clean = title.replace(/\s*\|\s*Facebook/i, '').replace(/^\(\d+\)\s*/, '').trim();
        if (clean && clean.toLowerCase() !== 'facebook') return clean;
        return null;
      });
      if (scraped) realName = scraped;
    } catch (_) {}
    console.log(`[Auth] Tên tài khoản Facebook phát hiện được: ${realName}`);

    // Đóng ngay cửa sổ trình duyệt đăng nhập tương tác
    try {
      await browser.close();
      browser = null;
      console.log('[Auth] Đã đóng cửa sổ trình duyệt đăng nhập an toàn.');
    } catch (_) {}

    // 1. Lưu mảng cookie vào file fb_cookies.json ở thư mục gốc
    const jsonString = JSON.stringify(savedCookies, null, 2);
    fs.writeFileSync(FB_COOKIES_FILE, jsonString, 'utf8');
    console.log(`[Auth] Đã lưu ${savedCookies.length} cookie vào file fb_cookies.json`);

    // 2. Cập nhật vào biến FB_COOKIES_JSON trong file .env
    const compactJson = JSON.stringify(savedCookies);
    updateEnvCookieVariable(compactJson);

    // 3. Tự động đồng bộ tài khoản vào danh sách accounts.json
    try {
      syncAccountAfterLogin(detectedUserId, savedCookies, realName);
    } catch (_) {}

    // 4. Gửi thông báo về Telegram
    const telegramMsg = `🎉 Đăng nhập Facebook thành công cho tài khoản <b>${realName}</b>!\n` +
      `<b>Số lượng Cookie:</b> ${savedCookies.length}`;
    await sendReport(telegramMsg);

    addLog(`Đăng nhập Facebook thành công cho tài khoản [${realName}] (Đã lưu ${savedCookies.length} cookie).`);
    console.log('[Auth] Toàn bộ quy trình đăng nhập và lưu Cookie đã hoàn tất 100%!\n');

    return {
      success: true,
      message: `🎉 Đăng nhập Facebook thành công cho tài khoản "${realName}"!`,
      cookieCount: savedCookies.length,
      userId: detectedUserId,
      userName: realName,
    };
  } catch (error) {
    console.error(`[Auth] Lỗi trong quá trình đăng nhập tương tác: ${error.message}`);
    addLog(`Đăng nhập thất bại: ${error.message}`);
    return {
      success: false,
      message: error.message,
    };
  } finally {
    isLoggingIn = false;
    if (browser) {
      try {
        await browser.close();
        console.log('[Auth] Đã đóng trình duyệt Chrome.');
      } catch {
        // Bỏ qua nếu đã đóng
      }
    }
  }
}

/**
 * Đăng xuất tài khoản Facebook và xóa sạch phiên làm việc cũ
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function logoutSession() {
  console.log('\n================================================================');
  console.log('  ĐĂNG XUẤT TÀI KHOẢN FACEBOOK & XÓA SẠCH PHIÊN (LOGOUT)');
  console.log('================================================================');

  try {
    // 1. Xóa file fb_cookies.json (nếu tồn tại)
    if (fs.existsSync(FB_COOKIES_FILE)) {
      try {
        fs.unlinkSync(FB_COOKIES_FILE);
        console.log(`[Auth] Đã xóa file: ${FB_COOKIES_FILE}`);
      } catch (err) {
        console.warn(`[Auth] Cảnh báo khi xóa ${FB_COOKIES_FILE}: ${err.message}`);
      }
    }

    // 2. Xóa sạch thư mục .browser_session/
    const sessionDir = path.resolve(__dirname, '../../.browser_session');
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        console.log(`[Auth] Đã xóa sạch thư mục cache: ${sessionDir}`);
      } catch (err) {
        console.warn(`[Auth] Cảnh báo khi xóa thư mục session: ${err.message}`);
      }
    }

    // 3. Đọc file .env, xóa giá trị FB_COOKIES_JSON thành rỗng và lưu lại
    updateEnvCookieVariable('');

    // 4. Xóa hoặc làm rỗng file src/config/my_groups.json
    const myGroupsFile = path.resolve(__dirname, '../config/my_groups.json');
    try {
      fs.writeFileSync(myGroupsFile, '[]', 'utf8');
      console.log(`[Auth] Đã làm rỗng file: ${myGroupsFile}`);
    } catch (err) {
      console.warn(`[Auth] Cảnh báo khi làm rỗng file my_groups.json: ${err.message}`);
    }

    // 5. Gửi thông báo về Telegram
    await sendReport('⚠️ Đã đăng xuất tài khoản Facebook cũ khỏi hệ thống.');

    addLog('Đã đăng xuất tài khoản Facebook cũ khỏi hệ thống.');
    console.log('[Auth] Đã hoàn tất đăng xuất và dọn dẹp phiên!\n');

    return {
      success: true,
      message: 'Đã xóa phiên đăng nhập cũ thành công.',
    };
  } catch (error) {
    console.error(`[Auth] Lỗi khi đăng xuất: ${error.message}`);
    addLog(`Đăng xuất thất bại: ${error.message}`);
    return {
      success: false,
      message: error.message,
    };
  }
}

module.exports = {
  interactiveLogin,
  checkAuthStatus,
  logoutSession,
  updateEnvCookieVariable,
  FB_COOKIES_FILE,
};

