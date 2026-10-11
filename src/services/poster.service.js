/**
 * ==============================================================================
 * DỊCH VỤ THỰC THI QUY TRÌNH ĐĂNG BÀI (POSTER WORKFLOW SERVICE)
 * ==============================================================================
 * Điều khiển tự động hóa bằng Puppeteer Stealth:
 * - Đọc cấu hình HEADLESS từ biến môi trường (chạy ngầm hoặc hiển thị cửa sổ).
 * - Nạp cookies từ CONFIG.FB_COOKIES_JSON để duy trì phiên làm việc an toàn.
 * - Chặn tài nguyên nặng (image, stylesheet, font, media) khi chạy thật để tiết kiệm RAM.
 * - Thực hiện quy trình nuôi nick tương tác tự nhiên (executeWarmup) trước khi vào Group.
 * - Vào Group mục tiêu, gõ nội dung bài viết với tốc độ 50 - 80ms/ký tự.
 * - Bấm nút Đăng bài tích hợp Self-Healing với Gemini 2.5 Flash: tự động chụp ảnh gửi Telegram,
 *   phân tích tìm selector mới và thử lại tối đa 2 lần.
 * - Chụp ảnh màn hình lưu vào thư mục `screenshots/` và gửi báo cáo xác nhận về Telegram.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { CONFIG, getPuppeteerLaunchOptions } = require('../config/env');
const { executeWarmup, sleep, getRandomInt } = require('./warmup.service');
const { healSelector } = require('./gemini.service');
const { sendReport, sendPhotoReport } = require('./telegram.service');
const { loadCookiesIntoSession, hasValidCookies } = require('./cookie.service');
const {
  getAvailableAccount,
  getAccountById,
  updateAccountUsage,
} = require('./accountManager.service');

// Kích hoạt plugin Stealth che giấu dấu vết Puppeteer
puppeteer.use(StealthPlugin());

/**
 * Lưu ảnh chụp màn hình ra thư mục screenshots/
 * @param {Buffer} buffer - Dữ liệu ảnh
 * @param {string} prefix - Tiền tố tên file (ví dụ: 'success', 'error')
 * @returns {string} Đường dẫn tệp ảnh đã lưu
 */
function saveScreenshot(buffer, prefix = 'shot') {
  try {
    const dir = path.resolve(__dirname, '../../screenshots');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filename = `${prefix}_${Date.now()}.png`;
    const fullPath = path.join(dir, filename);
    fs.writeFileSync(fullPath, buffer);
    console.log(`[Poster] Đã lưu ảnh chụp màn hình: ${fullPath}`);
    return fullPath;
  } catch (err) {
    console.warn(`[Poster] Không thể lưu ảnh cục bộ: ${err.message}`);
    return '';
  }
}

/**
 * Tìm selector đầu tiên xuất hiện trong danh sách ứng viên
 * @param {import('puppeteer').Page} page
 * @param {string[]} candidates
 * @returns {Promise<string|null>}
 */
async function findActiveSelector(page, candidates) {
  for (const sel of candidates) {
    try {
      const el = await page.$(sel);
      if (el) return sel;
    } catch {
      // Tiếp tục
    }
  }
  return null;
}

/**
 * Nạp danh sách cookie của tài khoản vào Puppeteer
 * @param {import('puppeteer').Page} page
 * @param {Array<object>} cookies
 */
async function setAccountCookies(page, cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return false;
  try {
    const sanitized = cookies.map((c) => {
      const cookie = {
        name: c.name,
        value: c.value,
        domain: c.domain || '.facebook.com',
        path: c.path || '/',
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
      };
      if (c.sameSite) {
        const s = String(c.sameSite).toLowerCase();
        if (['lax', 'strict', 'none'].includes(s)) {
          cookie.sameSite = s.charAt(0).toUpperCase() + s.slice(1);
        }
      }
      return cookie;
    });
    await page.setCookie(...sanitized);
    console.log(`[Poster] Đã nạp ${sanitized.length} cookie của tài khoản vào Puppeteer.`);
    return true;
  } catch (err) {
    console.warn(`[Poster] Lỗi nạp cookie tài khoản: ${err.message}`);
    return false;
  }
}

/**
 * Thực thi quy trình đăng bài cho một tác vụ hoàn chỉnh
 * @param {object} task - Đối tượng tác vụ từ tasks.json
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function runTaskWorkflow(task) {
  const isMock = CONFIG.MOCK_MODE;
  const isHeadless = CONFIG.HEADLESS;
  const taskId = task.id || `task_${Date.now()}`;
  const taskName = task.name || 'Đăng bài Group';
  const groupId = task.groupId || CONFIG.FB_GROUP_ID;
  const content = task.content || '';
  const warmupConfig = task.warmup || {};

  // 1. Phân bổ tài khoản thực thi (Chỉ định cụ thể hoặc AUTO)
  let executingAccount = null;
  const requestedAccountId = task.accountId;

  if (requestedAccountId && requestedAccountId !== 'AUTO') {
    executingAccount = getAccountById(requestedAccountId);
    if (!executingAccount) {
      throw new Error(`Tài khoản chỉ định [${requestedAccountId}] không tồn tại trong hệ thống!`);
    }
    if (executingAccount.status !== 'ACTIVE') {
      throw new Error(`Tài khoản [${executingAccount.name}] (${executingAccount.id}) hiện đang tạm ngưng (INACTIVE)!`);
    }
    const limit = executingAccount.dailyPostLimit || 3;
    if (executingAccount.postsToday >= limit) {
      throw new Error(`Tài khoản [${executingAccount.name}] đã đạt giới hạn đăng bài trong ngày (${executingAccount.postsToday}/${limit})!`);
    }
  } else {
    // Tự động chọn tài khoản tối ưu
    executingAccount = getAvailableAccount();
  }

  // Kiểm tra Cookie nếu chạy trên Facebook Live
  if (!isMock) {
    const hasAccountCookies = executingAccount && Array.isArray(executingAccount.cookies) && executingAccount.cookies.length > 0;
    if (!hasAccountCookies && !hasValidCookies()) {
      const noCookieMsg = 'Chưa đăng nhập Facebook hoặc chưa có Cookie hợp lệ! Vui lòng bấm "🔑 Đăng nhập Facebook" trên Dashboard trước khi chạy tác vụ.';
      console.warn(`\n[Poster] ⚠️ CẢNH BÁO: ${noCookieMsg}`);
      await sendReport(`⚠️ <b>[CHƯA ĐĂNG NHẬP FACEBOOK]</b>\n` +
        `Không thể thực thi tác vụ: <code>${taskId}</code> (${taskName}).\n` +
        `<i>Lý do:</i> Tài khoản chưa có Cookie Facebook hợp lệ.\n` +
        `👉 Vui lòng vào Tab <b>"Quản lý Tài khoản"</b> để đăng nhập nick.`);
      return {
        success: false,
        error: noCookieMsg,
      };
    }
  }

  const targetUrl = isMock
    ? `http://localhost:${CONFIG.PORT}/`
    : `https://www.facebook.com/groups/${groupId}`;

  console.log('\n================================================================');
  console.log(`[Poster] BẮT ĐẦU CHẠY TÁC VỤ: [${taskId}] ${taskName}`);
  console.log(`- Môi trường      : ${isMock ? 'MOCK LOCALHOST' : 'FACEBOOK LIVE'}`);
  console.log(`- Cờ HEADLESS     : ${isHeadless ? 'Bật (Chạy ngầm)' : 'Tắt (Mở cửa sổ Chrome)'}`);
  console.log(`- Tài khoản chọn  : ${executingAccount ? `${executingAccount.name} (${executingAccount.id})` : 'Mặc định'}`);
  console.log(`- Group mục tiêu  : ${groupId}`);
  console.log(`- Điều hướng URL  : ${targetUrl}`);
  console.log('================================================================\n');

  let browser = null;

  try {
    // Xác định thư mục session riêng của tài khoản
    let sessionDir;
    if (executingAccount && executingAccount.userDataDir) {
      sessionDir = path.resolve(__dirname, '../../', executingAccount.userDataDir);
    } else {
      sessionDir = path.resolve(__dirname, '../../.browser_session');
    }

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const chromeArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--mute-audio',
    ];

    if (isHeadless) {
      chromeArgs.push('--headless=new');
    }

    browser = await puppeteer.launch(getPuppeteerLaunchOptions({
      headless: isHeadless ? 'new' : false,
      userDataDir: sessionDir,
      args: chromeArgs,
      defaultViewport: {
        width: 1280,
        height: 800,
      },
    }));

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );

    // 1. Chặn tải tài nguyên nặng trên môi trường thật
    if (!isMock) {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });
      console.log('[Poster] Đã kích hoạt chặn Image/Stylesheet/Font/Media để tối ưu RAM.');

      // Nạp cookie ưu tiên của tài khoản được phân bổ
      if (executingAccount && Array.isArray(executingAccount.cookies) && executingAccount.cookies.length > 0) {
        await setAccountCookies(page, executingAccount.cookies);
      } else {
        await loadCookiesIntoSession(page);
      }
    }

    // 2. Chạy quy trình tương tác tự nhiên (executeWarmup) trước khi vào Group
    let warmupTimeline = [];
    if (warmupConfig) {
      const warmupResult = await executeWarmup(page, warmupConfig);
      warmupTimeline = warmupResult?.timeline || [];
    }

    // 3. Chuyển hướng tới Group mục tiêu
    console.log(`[Poster] Đang chuyển hướng tới: ${targetUrl}...`);
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    console.log('[Poster] Đã tải xong trang Group.');
    await sleep(2000);

    // 4. Tìm và focus vào ô soạn thảo bài viết
    const postBoxCandidates = isMock
      ? ['#post-box']
      : [
          'div[role="textbox"][contenteditable="true"]',
          'div[aria-label*="Tạo bài viết công khai"][role="textbox"]',
          'div[aria-label*="Viết gì đó..."][role="textbox"]',
          'div[aria-label*="Create a public post"][role="textbox"]',
          'div[role="textbox"]',
        ];

    let postBoxSelector = await findActiveSelector(page, postBoxCandidates);

    // Mở modal nếu chưa mở sẵn
    if (!postBoxSelector && !isMock) {
      const openModalTriggers = [
        'div[role="button"][aria-label*="Tạo bài viết công khai"]',
        'span:contains("Bạn viết gì đi")',
        'span:contains("Viết gì đó")',
      ];
      for (const openSel of openModalTriggers) {
        try {
          await page.click(openSel);
          await sleep(2000);
          postBoxSelector = await findActiveSelector(page, postBoxCandidates);
          if (postBoxSelector) break;
        } catch {
          // Thử tiếp
        }
      }
    }

    if (!postBoxSelector) {
      throw new Error('Không tìm thấy khung soạn thảo bài viết (Post Box) trên giao diện.');
    }

    console.log(`[Poster] Tìm thấy khung soạn thảo bài viết: "${postBoxSelector}". Focus vào ô nhập.`);
    await page.click(postBoxSelector);
    await sleep(800);

    // 5. Gõ nội dung bài viết với delay 50 - 80ms/ký tự mô phỏng người thật
    console.log('[Poster] Đang gõ nội dung bài viết với tốc độ 50 - 80ms/ký tự...');
    for (const char of content) {
      await page.keyboard.type(char, { delay: getRandomInt(50, 80) });
    }
    console.log('[Poster] Đã nhập xong nội dung bài viết.');
    await sleep(1500);

    // 6. Bấm nút Đăng bài tích hợp Self-Healing với Gemini 2.5 Flash
    let postBtnSelector = isMock
      ? '#btn-post'
      : 'button[aria-label="Đăng"], div[aria-label="Đăng"][role="button"], div[aria-label="Post"][role="button"]';

    const maxRetries = 2;
    let clickedSuccess = false;
    let attempt = 0;

    while (attempt <= maxRetries && !clickedSuccess) {
      attempt++;
      console.log(`[Poster] Bấm nút Đăng (Lần ${attempt}/${maxRetries + 1}) với selector: "${postBtnSelector}"`);

      try {
        await page.waitForSelector(postBtnSelector, { timeout: 8000, visible: true });
        await page.click(postBtnSelector);
        clickedSuccess = true;
        console.log('[Poster] Đã bấm nút Đăng thành công!');
      } catch (clickErr) {
        console.warn(`[Poster] Thao tác click thất bại với selector "${postBtnSelector}": ${clickErr.message}`);

        // Chụp ảnh màn hình buffer sự cố
        const errScreenshot = await page.screenshot({ type: 'png' });
        const savedErrPath = saveScreenshot(errScreenshot, `error_${taskId}`);

        // Gửi ảnh sự cố về Telegram
        const caption = `⚠️ <b>[CẢNH BÁO SỰ CỐ TÁC VỤ]</b>\n` +
          `Task: <code>${taskId}</code> - ${taskName}\n` +
          `Lần thử: <code>${attempt}/${maxRetries + 1}</code>\n` +
          `Lỗi: <code>${clickErr.message}</code>`;
        await sendPhotoReport(errScreenshot, caption);

        if (attempt <= maxRetries) {
          console.log('[Poster] Kích hoạt Gemini 2.5 Flash chữa lành selector...');
          const base64Img = errScreenshot.toString('base64');
          const healed = await healSelector(base64Img, postBtnSelector, clickErr.message);

          if (healed) {
            console.log(`[Poster] Áp dụng selector mới từ Gemini: "${healed}"`);
            postBtnSelector = healed;
          } else {
            console.warn('[Poster] Gemini không đưa ra selector mới. Thử lại với selector hiện tại.');
          }
          await sleep(2500);
        } else {
          throw new Error(`Thất bại sau ${maxRetries + 1} lần thử bấm nút Đăng: ${clickErr.message}`);
        }
      }
    }

    // 7. Chờ hoàn thành và chụp ảnh màn hình lưu vào screenshots/ & gửi Telegram
    await sleep(4000);

    if (isMock) {
      const statusText = await page.$eval('#status-msg', (el) => el.innerText || el.textContent);
      console.log(`[Poster] Phản hồi từ Mock Server: "${statusText}"`);
    }

    const proofBuffer = await page.screenshot({ type: 'png' });
    const proofPath = saveScreenshot(proofBuffer, `success_${taskId}`);

    // Cập nhật lượt sử dụng của tài khoản thực thi
    if (executingAccount) {
      updateAccountUsage(executingAccount.id);
    }

    const accountInfoText = executingAccount
      ? `<b>Tài khoản:</b> ${executingAccount.name} (<code>${executingAccount.id}</code> - Lượt đăng hôm nay: ${(executingAccount.postsToday || 0) + 1}/${executingAccount.dailyPostLimit || 3})\n`
      : '';

    const successNotice = `✅ <b>[TÁC VỤ ĐĂNG BÀI HOÀN TẤT]</b>\n` +
      `<b>ID Tác vụ:</b> <code>${taskId}</code>\n` +
      `<b>Tên tác vụ:</b> ${taskName}\n` +
      `${accountInfoText}` +
      `<b>Nhóm ID:</b> <code>${groupId}</code>\n` +
      `${timelineText}` +
      `<b>Bằng chứng:</b> <code>${path.basename(proofPath)}</code>\n` +
      `<b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`;

    await sendPhotoReport(proofBuffer, successNotice);
    console.log(`[Poster] Tác vụ [${taskId}] đã hoàn thành xuất sắc!\n`);

    return {
      success: true,
      message: 'Đăng bài thành công!',
    };
  } catch (error) {
    console.error(`[Poster] Lỗi khi thực thi tác vụ [${taskId}]: ${error.message}`);
    const errNotice = `❌ <b>[TÁC VỤ ĐĂNG BÀI THẤT BẠI]</b>\n` +
      `<b>ID Tác vụ:</b> <code>${taskId}</code>\n` +
      `<b>Tên:</b> ${taskName}\n` +
      `<b>Lỗi:</b> <code>${error.message}</code>\n` +
      `<b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`;
    await sendReport(errNotice);

    return {
      success: false,
      error: error.message,
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log('[Poster] Đã đóng trình duyệt Puppeteer và giải phóng tài nguyên.');
    }
  }
}

module.exports = {
  runTaskWorkflow,
  saveScreenshot,
  // Alias tương thích ngược
  executeTask: runTaskWorkflow,
  runPostWorkflow: (groupId, content) => runTaskWorkflow({ groupId, content }),
};
