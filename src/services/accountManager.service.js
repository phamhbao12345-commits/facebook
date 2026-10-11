/**
 * ==============================================================================
 * DỊCH VỤ QUẢN LÝ ĐA TÀI KHOẢN FACEBOOK (MULTI-ACCOUNT MANAGER SERVICE)
 * ==============================================================================
 * Quản lý danh sách tài khoản Facebook độc lập hoàn toàn:
 * - Lưu trữ trong `src/config/accounts.json`.
 * - Mỗi tài khoản sở hữu một hồ sơ trình duyệt `--user-data-dir` riêng biệt.
 * - Quản lý hạn mức bài viết trong ngày (dailyPostLimit / postsToday).
 * - Tự động reset bộ đếm bài đăng khi bước sang ngày mới.
 * - Thuật toán chọn tài khoản tối ưu (getAvailableAccount):
 *   + Chọn tài khoản ACTIVE.
 *   + Chưa vượt quá hạn mức bài đăng trong ngày.
 *   + Ưu tiên tài khoản nghỉ lâu nhất (lastUsed cũ nhất hoặc chưa dùng).
 * - Hỗ trợ đăng nhập trực tiếp (interactiveLoginAccount) cho từng nick.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { sendReport } = require('./telegram.service');
const { addLog } = require('./logger.service');
const { getPuppeteerLaunchOptions } = require('../config/env');

puppeteer.use(StealthPlugin());

const ROOT_DIR = path.resolve(__dirname, '../../');
const ACCOUNTS_FILE = path.resolve(__dirname, '../config/accounts.json');

/**
 * Tạm dừng mili-giây
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Lấy chuỗi ngày hiện tại (YYYY-MM-DD)
 * @returns {string}
 */
function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Đọc toàn bộ danh sách tài khoản từ accounts.json
 * Tự động kiểm tra và reset postsToday nếu đã sang ngày mới
 * @returns {Array<object>}
 */
function loadAccounts() {
  try {
    let accounts = [];
    if (fs.existsSync(ACCOUNTS_FILE)) {
      try {
        const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
        accounts = JSON.parse(raw);
        if (!Array.isArray(accounts)) accounts = [];
      } catch (_) {
        accounts = [];
      }
    }

    let isModified = false;

    // 1. Tự động đồng bộ tài khoản đã đăng nhập từ cookie hệ thống
    try {
      const { getStoredCookies } = require('./cookie.service');
      const storedCookies = getStoredCookies();
      if (storedCookies && Array.isArray(storedCookies) && storedCookies.length > 0) {
        const cUser = storedCookies.find((c) => c.name === 'c_user');
        if (cUser && cUser.value) {
          const uid = cUser.value;
          const existing = accounts.find((a) => {
            if (a.id === `acc_${uid}`) return true;
            if (Array.isArray(a.cookies) && a.cookies.some((c) => c.name === 'c_user' && c.value === uid)) return true;
            return false;
          });

          const currentMachine = (process.env.MACHINE_NAME || require('os').hostname() || 'Máy 1').trim();
          if (existing) {
            existing.cookies = storedCookies;
            existing.status = 'ACTIVE';
            if (!existing.name || existing.name.startsWith('Facebook (UID:')) {
              existing.name = 'Phạm Nayuta';
              isModified = true;
            }
            if (!existing.machineName) {
              existing.machineName = currentMachine;
              isModified = true;
            }
          } else {
            accounts.unshift({
              id: `acc_${uid}`,
              name: 'Phạm Nayuta',
              userId: uid,
              machineName: currentMachine,
              status: 'ACTIVE',
              cookies: storedCookies,
              userDataDir: '.browser_session',
              dailyPostLimit: 5,
              postsToday: 0,
              lastUsed: null,
              lastResetDate: getTodayString(),
            });
            isModified = true;
          }
        }
      }
    } catch (err) {
      // Bỏ qua lỗi phụ
    }

    // 2. CHỈ HIỂN THỊ TỪNG TÀI KHOẢN ĐÃ ĐĂNG NHẬP VÔ (CÓ COOKIE c_user)
    const countBeforeFilter = accounts.length;
    accounts = accounts.filter((acc) => {
      return Array.isArray(acc.cookies) && acc.cookies.length > 0 && acc.cookies.some((c) => c.name === 'c_user');
    });

    if (accounts.length !== countBeforeFilter) {
      isModified = true;
    }

    // 3. Tự động kiểm tra reset theo ngày
    const today = getTodayString();
    accounts.forEach((acc) => {
      if (acc.lastResetDate !== today) {
        acc.postsToday = 0;
        acc.lastResetDate = today;
        isModified = true;
      }
    });

    if (isModified) {
      saveAccounts(accounts);
    }

    return accounts;
  } catch (err) {
    console.error(`[AccountManager] Lỗi đọc accounts.json: ${err.message}`);
    return [];
  }
}

/**
 * Lưu danh sách tài khoản vào accounts.json
 * @param {Array<object>} accounts
 */
function saveAccounts(accounts) {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
  } catch (err) {
    console.error(`[AccountManager] Lỗi ghi accounts.json: ${err.message}`);
  }
}

/**
 * Lấy danh sách tài khoản (alias cho loadAccounts)
 * @returns {Array<object>}
 */
function getAccounts() {
  return loadAccounts();
}

/**
 * Tìm tài khoản theo ID
 * @param {string} accountId
 * @returns {object|null}
 */
function getAccountById(accountId) {
  const accounts = loadAccounts();
  return accounts.find((acc) => acc.id === accountId) || null;
}

/**
 * Chọn tài khoản hợp lệ để đăng bài:
 * - Trạng thái: ACTIVE
 * - Chưa đạt giới hạn: postsToday < dailyPostLimit
 * - Ưu tiên nick nghỉ lâu nhất (lastUsed cũ nhất hoặc null)
 * @returns {object|null}
 */
function getAvailableAccount() {
  const accounts = loadAccounts();

  // Lọc các tài khoản đủ điều kiện và ĐÃ ĐĂNG NHẬP VÔ
  const activeCandidates = accounts.filter((acc) => {
    const hasCookies = Array.isArray(acc.cookies) && acc.cookies.length > 0 && acc.cookies.some((c) => c.name === 'c_user');
    const limit = typeof acc.dailyPostLimit === 'number' ? acc.dailyPostLimit : 3;
    const currentPosts = typeof acc.postsToday === 'number' ? acc.postsToday : 0;
    return acc.status === 'ACTIVE' && currentPosts < limit && hasCookies;
  });

  if (activeCandidates.length === 0) {
    console.warn('[AccountManager] Không có tài khoản nào khả dụng (tất cả đều đã đạt hạn mức trong ngày hoặc bị tạm dừng).');
    return null;
  }

  // Sắp xếp: ưu tiên tài khoản chưa từng dùng (lastUsed === null), sau đó tới tài khoản có lastUsed nhỏ nhất
  activeCandidates.sort((a, b) => {
    if (!a.lastUsed && b.lastUsed) return -1;
    if (a.lastUsed && !b.lastUsed) return 1;
    if (!a.lastUsed && !b.lastUsed) return 0;
    return new Date(a.lastUsed).getTime() - new Date(b.lastUsed).getTime();
  });

  const chosen = activeCandidates[0];
  console.log(`[AccountManager] Đã chọn tài khoản: [${chosen.id}] "${chosen.name}" (Đã đăng ${chosen.postsToday}/${chosen.dailyPostLimit} bài hôm nay)`);
  return chosen;
}

/**
 * Nạp thông tin profile và cookies của tài khoản chỉ định
 * @param {string} accountId
 * @returns {{ account: object, absoluteUserDataDir: string, cookies: Array }}
 */
function switchAccount(accountId) {
  const account = getAccountById(accountId);
  if (!account) {
    throw new Error(`Không tìm thấy tài khoản với ID: ${accountId}`);
  }

  const relativeDir = account.userDataDir || `.browser_session/${account.id}`;
  const absoluteUserDataDir = path.resolve(ROOT_DIR, relativeDir);

  // Đảm bảo thư mục lưu trữ profile tồn tại
  if (!fs.existsSync(absoluteUserDataDir)) {
    fs.mkdirSync(absoluteUserDataDir, { recursive: true });
  }

  console.log(`[AccountManager] Chuyển đổi sang tài khoản: [${account.id}] "${account.name}"`);
  console.log(`- Thư mục dữ liệu: ${absoluteUserDataDir}`);
  console.log(`- Số lượng Cookie: ${Array.isArray(account.cookies) ? account.cookies.length : 0}`);

  return {
    account,
    absoluteUserDataDir,
    cookies: Array.isArray(account.cookies) ? account.cookies : [],
  };
}

/**
 * Tăng biến đếm bài viết trong ngày và ghi nhận mốc thời gian lastUsed
 * @param {string} accountId
 * @returns {object|null}
 */
function updateAccountUsage(accountId) {
  const accounts = loadAccounts();
  const index = accounts.findIndex((a) => a.id === accountId);

  if (index === -1) {
    console.warn(`[AccountManager] Không tìm thấy tài khoản để cập nhật usage: ${accountId}`);
    return null;
  }

  const now = new Date();
  accounts[index].postsToday = (accounts[index].postsToday || 0) + 1;
  accounts[index].lastUsed = now.toISOString();
  accounts[index].lastResetDate = getTodayString();

  saveAccounts(accounts);
  console.log(`[AccountManager] Đã cập nhật lượt đăng cho tài khoản [${accountId}]: ${accounts[index].postsToday}/${accounts[index].dailyPostLimit} bài.`);
  return accounts[index];
}

/**
 * Thêm tài khoản mới vào hệ thống
 * @param {object} param
 * @param {string} param.name - Tên gợi nhớ
 * @param {number} [param.dailyPostLimit=3] - Giới hạn bài đăng/ngày
 * @param {Array} [param.cookies=[]] - Danh sách cookie
 * @returns {object}
 */
function addAccount({ name, dailyPostLimit = 3, cookies = [] }) {
  const accounts = loadAccounts();

  // Sinh ID tự động
  let maxNum = 0;
  accounts.forEach((a) => {
    const match = a.id && a.id.match(/^acc_(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  const nextNum = maxNum + 1;
  const newId = `acc_${String(nextNum).padStart(2, '0')}`;
  const relativeSessionDir = `.browser_session/${newId}`;

  const newAccount = {
    id: newId,
    name: (name || `Tài khoản ${nextNum}`).trim(),
    status: 'ACTIVE',
    cookies: Array.isArray(cookies) ? cookies : [],
    userDataDir: relativeSessionDir,
    dailyPostLimit: Math.max(1, parseInt(dailyPostLimit, 10) || 3),
    postsToday: 0,
    lastUsed: null,
    lastResetDate: getTodayString(),
  };

  accounts.push(newAccount);
  saveAccounts(accounts);

  // Tạo thư mục session
  const absPath = path.resolve(ROOT_DIR, relativeSessionDir);
  if (!fs.existsSync(absPath)) {
    fs.mkdirSync(absPath, { recursive: true });
  }

  addLog(`Đã thêm tài khoản mới: [${newId}] ${newAccount.name}`);
  console.log(`[AccountManager] Đã thêm tài khoản mới: [${newId}] ${newAccount.name}`);
  return newAccount;
}

/**
 * Cập nhật cấu hình tài khoản
 * @param {string} accountId
 * @param {object} data
 * @returns {object|null}
 */
function updateAccount(accountId, data = {}) {
  const accounts = loadAccounts();
  const index = accounts.findIndex((a) => a.id === accountId);

  if (index === -1) {
    return null;
  }

  if (data.name !== undefined) accounts[index].name = String(data.name).trim();
  if (data.status !== undefined) accounts[index].status = data.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  if (data.dailyPostLimit !== undefined) {
    accounts[index].dailyPostLimit = Math.max(1, parseInt(data.dailyPostLimit, 10) || 3);
  }
  if (data.cookies !== undefined && Array.isArray(data.cookies)) {
    accounts[index].cookies = data.cookies;
  }

  saveAccounts(accounts);
  addLog(`Đã cập nhật cấu hình tài khoản: [${accountId}] ${accounts[index].name}`);
  return accounts[index];
}

/**
 * Xóa tài khoản khỏi hệ thống và dọn dẹp thư mục lưu trữ
 * @param {string} accountId
 * @returns {boolean}
 */
function deleteAccount(accountId) {
  const accounts = loadAccounts();
  const index = accounts.findIndex((a) => a.id === accountId);

  if (index === -1) {
    return false;
  }

  const removed = accounts.splice(index, 1)[0];
  saveAccounts(accounts);

  // Dọn dẹp thư mục userDataDir nếu có
  if (removed.userDataDir) {
    try {
      const absPath = path.resolve(ROOT_DIR, removed.userDataDir);
      if (fs.existsSync(absPath)) {
        fs.rmSync(absPath, { recursive: true, force: true });
        console.log(`[AccountManager] Đã xóa thư mục phiên: ${absPath}`);
      }
    } catch (cleanErr) {
      console.warn(`[AccountManager] Cảnh báo khi dọn dẹp thư mục: ${cleanErr.message}`);
    }
  }

  addLog(`Đã xóa tài khoản: [${accountId}] ${removed.name}`);
  return true;
}

/**
 * Mở cửa sổ Chrome thật với Profile riêng của tài khoản để người dùng tự đăng nhập và lưu Cookie
 * @param {string} accountId
 * @param {number} [maxWaitSeconds=180]
 * @returns {Promise<{ success: boolean, message: string, userId?: string, cookieCount?: number }>}
 */
async function interactiveLoginAccount(accountId, maxWaitSeconds = 180) {
  const account = getAccountById(accountId);
  if (!account) {
    throw new Error(`Không tìm thấy tài khoản: ${accountId}`);
  }

  console.log('\n================================================================');
  console.log(`  ĐĂNG NHẬP THỦ CÔNG CHO TÀI KHOẢN: [${account.id}] "${account.name}"`);
  console.log('================================================================');
  addLog(`Mở Chrome đăng nhập riêng cho [${account.name}]...`);

  let browser = null;

  try {
    const { absoluteUserDataDir } = switchAccount(accountId);

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

    browser = await puppeteer.launch(getPuppeteerLaunchOptions({
      headless: false,
      userDataDir: absoluteUserDataDir,
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

    console.log(`[AccountManager] Điều hướng tới https://www.facebook.com/login...`);
    await page.goto('https://www.facebook.com/login', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    const startTime = Date.now();
    const timeoutMs = maxWaitSeconds * 1000;
    let loginSuccess = false;
    let detectedCookies = [];
    let detectedUserId = '';

    while (Date.now() - startTime < timeoutMs) {
      if (!browser.isConnected()) {
        throw new Error('Cửa sổ trình duyệt đã bị đóng trước khi hoàn tất đăng nhập.');
      }

      const currentCookies = await page.cookies();
      const cUser = currentCookies.find((c) => c.name === 'c_user');
      const xs = currentCookies.find((c) => c.name === 'xs');
      const currentUrl = page.url();

      if (cUser && xs) {
        loginSuccess = true;
        detectedCookies = currentCookies;
        detectedUserId = cUser.value;
        break;
      }

      if (!currentUrl.includes('/login') && !currentUrl.includes('/checkpoint') && currentUrl.includes('facebook.com') && cUser) {
        loginSuccess = true;
        detectedCookies = currentCookies;
        detectedUserId = cUser.value;
        break;
      }

      await sleep(2000);
    }

    if (!loginSuccess) {
      throw new Error(`Hết thời gian chờ (${maxWaitSeconds}s). Bạn chưa hoàn tất đăng nhập.`);
    }

    // Trích xuất tên Facebook thật ngầm ngay trên trang hiện tại - KHÔNG mở tab mới, KHÔNG nhảy trang
    let realName = account.name;
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

    // Đóng ngay cửa sổ Chrome tương tác
    try {
      await browser.close();
      browser = null;
      console.log(`[AccountManager] Đã đóng cửa sổ trình duyệt an toàn.`);
    } catch (_) {}

    const currentMachine = (process.env.MACHINE_NAME || require('os').hostname() || 'Máy 1').trim();

    // Cập nhật cookies và tên vào tài khoản
    updateAccount(accountId, {
      name: realName,
      userId: detectedUserId,
      cookies: detectedCookies,
      machineName: currentMachine,
      status: 'ACTIVE',
    });

    // Đồng bộ cookies vào file hệ thống
    try {
      const FB_COOKIES_FILE = path.resolve(ROOT_DIR, 'fb_cookies.json');
      fs.writeFileSync(FB_COOKIES_FILE, JSON.stringify(detectedCookies, null, 2), 'utf8');
    } catch (_) {}

    // Thông báo Telegram
    const notice = `🎉 <b>[ĐĂNG NHẬP TÀI KHOẢN THÀNH CÔNG]</b>\n` +
      `<b>Tên tài khoản:</b> ${realName} (<code>${accountId}</code>)\n` +
      `<b>User ID:</b> <code>${detectedUserId}</code>\n` +
      `<b>Số lượng Cookie:</b> ${detectedCookies.length} cookie\n` +
      `<b>Thiết bị:</b> ${currentMachine}\n` +
      `Hồ sơ session độc lập đã được lưu trữ an toàn!`;
    await sendReport(notice);

    addLog(`Đăng nhập thành công cho [${realName}]! User ID: ${detectedUserId}`);
    console.log(`[AccountManager] Đăng nhập thành công cho [${realName}].\n`);

    return {
      success: true,
      message: `Đăng nhập thành công cho "${realName}"! Đã chuyển hướng về trang chủ.`,
      userId: detectedUserId,
      cookieCount: detectedCookies.length,
    };
  } catch (error) {
    console.error(`[AccountManager] Lỗi đăng nhập tài khoản [${accountId}]: ${error.message}`);
    addLog(`Đăng nhập [${account.name}] thất bại: ${error.message}`);
    return {
      success: false,
      message: error.message,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Bỏ qua
      }
    }
  }
}

/**
 * Đồng bộ hoặc thêm tài khoản sau khi đăng nhập thành công
 * @param {string} userId - Facebook User ID (c_user)
 * @param {Array} cookies - Mảng cookies
 * @param {string} [name] - Tên gợi nhớ
 */
function syncAccountAfterLogin(userId, cookies, name) {
  try {
    const raw = fs.existsSync(ACCOUNTS_FILE) ? JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')) : [];
    const accounts = Array.isArray(raw) ? raw : [];
    const accId = `acc_${userId}`;
    const existing = accounts.find((a) => a.id === accId || (Array.isArray(a.cookies) && a.cookies.some((c) => c.name === 'c_user' && c.value === userId)));

    const resolvedName = (name && !name.startsWith('Facebook (UID:')) ? name : 'Phạm Nayuta';
    const currentMachine = (process.env.MACHINE_NAME || require('os').hostname() || 'Máy 1').trim();

    if (existing) {
      existing.cookies = cookies;
      existing.status = 'ACTIVE';
      if (resolvedName) existing.name = resolvedName;
      existing.machineName = currentMachine;
    } else {
      accounts.unshift({
        id: accId,
        name: resolvedName,
        userId: userId,
        machineName: currentMachine,
        status: 'ACTIVE',
        cookies: cookies,
        userDataDir: '.browser_session',
        dailyPostLimit: 5,
        postsToday: 0,
        lastUsed: null,
        lastResetDate: getTodayString(),
      });
    }

    saveAccounts(accounts);
    return accounts;
  } catch (err) {
    console.warn(`[AccountManager] Lỗi syncAccountAfterLogin: ${err.message}`);
    return [];
  }
}

module.exports = {
  loadAccounts,
  saveAccounts,
  getAccounts,
  getAccountById,
  getAvailableAccount,
  switchAccount,
  updateAccountUsage,
  addAccount,
  updateAccount,
  deleteAccount,
  interactiveLoginAccount,
  syncAccountAfterLogin,
  ACCOUNTS_FILE,
};
