/**
 * ==============================================================================
 * DỊCH VỤ QUÉT DANH SÁCH NHÓM ĐÃ THAM GIA (GROUP SCANNER SERVICE)
 * ==============================================================================
 * Tự động hóa đăng nhập bằng Cookie và cào danh sách toàn bộ các nhóm Facebook
 * mà tài khoản hiện tại đã tham gia:
 * - Điều hướng tới `https://www.facebook.com/groups/joins/`.
 * - Tự động cuộn trang 3 - 5 lần để tải đầy đủ danh sách nhóm đã tham gia.
 * - Trích xuất: `{ groupId, groupName, groupUrl }`.
 * - Loại bỏ các liên kết trùng lặp và lưu vào `src/config/my_groups.json`.
 * - Trả về mảng danh sách các nhóm đã quét được.
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { CONFIG, getPuppeteerLaunchOptions } = require('../config/env');
const { loadCookiesIntoSession, hasValidCookies } = require('./cookie.service');
const { sendReport } = require('./telegram.service');
const { addLog } = require('./logger.service');

puppeteer.use(StealthPlugin());

const MY_GROUPS_FILE = path.resolve(__dirname, '../config/my_groups.json');

/**
 * Tạm dừng mili-giây
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Đọc danh sách nhóm đã lưu từ my_groups.json
 * @returns {Array<{ groupId: string, groupName: string, groupUrl: string }>}
 */
function loadSavedGroups() {
  try {
    if (!fs.existsSync(MY_GROUPS_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(MY_GROUPS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[GroupScanner] Lỗi đọc file my_groups.json: ${err.message}`);
    return [];
  }
}

/**
 * Lưu danh sách nhóm vào my_groups.json
 * @param {Array} groups
 */
function saveGroupsToFile(groups) {
  try {
    fs.writeFileSync(MY_GROUPS_FILE, JSON.stringify(groups, null, 2), 'utf8');
    console.log(`[GroupScanner] Đã lưu ${groups.length} nhóm vào ${MY_GROUPS_FILE}`);
  } catch (err) {
    console.error(`[GroupScanner] Lỗi ghi file my_groups.json: ${err.message}`);
  }
}

/**
 * Tự động quét danh sách các nhóm Facebook đã tham gia
 * @returns {Promise<Array<{ groupId: string, groupName: string, groupUrl: string }>>}
 */
async function scanUserGroups() {
  console.log('\n================================================================');
  console.log('  BẮT ĐẦU QUÉT DANH SÁCH NHÓM FACEBOOK ĐÃ THAM GIA');
  console.log('================================================================');
  addLog('Bắt đầu quy trình quét danh sách nhóm đã tham gia...');

  const userHasCookies = hasValidCookies();

  // Nếu ở chế độ MOCK và hoàn toàn không có Cookie, mới dùng dữ liệu giả lập
  if (CONFIG.MOCK_MODE && !userHasCookies) {
    console.log('[GroupScanner] Đang ở chế độ MOCK_MODE và chưa có Cookie. Tạo danh sách nhóm giả lập...');
    addLog('Đang ở chế độ MOCK_MODE: Nạp danh sách 4 nhóm giả lập để kiểm thử.');
    const mockGroups = [
      {
        groupId: '123456789',
        groupName: 'Cộng Đồng Lập Trình Node.js & Tự Động Hóa',
        groupUrl: 'https://www.facebook.com/groups/123456789/',
      },
      {
        groupId: '987654321',
        groupName: 'Hội Mua Bán & Trao Đổi Công Nghệ',
        groupUrl: 'https://www.facebook.com/groups/987654321/',
      },
      {
        groupId: '555666777',
        groupName: 'Cộng Đồng Marketing & MMO Việt Nam',
        groupUrl: 'https://www.facebook.com/groups/555666777/',
      },
      {
        groupId: '888999000',
        groupName: 'Chia Sẻ Tài Liệu Học Lập Trình & AI',
        groupUrl: 'https://www.facebook.com/groups/888999000/',
      },
    ];

    saveGroupsToFile(mockGroups);
    addLog(`Đã nạp và lưu thành công ${mockGroups.length} nhóm vào hệ thống.`);
    return mockGroups;
  }

  // Kiểm tra Cookie nếu không có
  if (!userHasCookies) {
    const errorMsg = 'Chưa đăng nhập Facebook hoặc chưa có Cookie hợp lệ! Vui lòng bấm "🔑 Đăng nhập Facebook ngay" trên Dashboard trước khi quét nhóm.';
    console.warn(`[GroupScanner] ⚠️ ${errorMsg}`);
    addLog(`⚠️ Không thể quét nhóm: Chưa có Cookie. Vui lòng bấm "🔑 Đăng nhập Facebook ngay"!`);
    throw new Error(errorMsg);
  }

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
      '--disable-background-networking',
      '--disable-default-apps',
      '--mute-audio',
    ];

    chromeArgs.push('--headless=new');

    browser = await puppeteer.launch(getPuppeteerLaunchOptions({
      headless: 'new',
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

    // Nạp cookies tài khoản
    const cookieLoaded = await loadCookiesIntoSession(page);
    if (!cookieLoaded && !CONFIG.FB_COOKIES_JSON) {
      console.warn('[GroupScanner] Cảnh báo: Chưa có cookie, có thể Facebook sẽ yêu cầu đăng nhập.');
    }

    const targetUrl = 'https://www.facebook.com/groups/joins/';
    console.log(`[GroupScanner] Đang truy cập: ${targetUrl}...`);

    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    console.log('[GroupScanner] Đã tải xong trang danh sách nhóm.');
    await sleep(3000);

    // Tự động cuộn trang 4 lần để Facebook tải thêm các nhóm phía dưới
    console.log('[GroupScanner] Đang cuộn trang để nạp toàn bộ danh sách nhóm...');
    for (let i = 1; i <= 5; i++) {
      await page.evaluate(() => {
        window.scrollBy({ top: window.innerHeight * 2, behavior: 'smooth' });
      });
      console.log(`[GroupScanner] Đã cuộn trang lần ${i}/5`);
      await sleep(2000);
    }

    // Quét trích xuất các liên kết nhóm
    console.log('[GroupScanner] Đang phân tích DOM và trích xuất thông tin nhóm...');
    const extractedData = await page.evaluate(() => {
      const results = [];
      const links = document.querySelectorAll('a[href*="/groups/"]');
      const ignoredSlugs = [
        'joins',
        'feed',
        'discover',
        'create',
        'notifications',
        'search',
        'category',
      ];

      links.forEach((a) => {
        const href = a.href || '';
        let text = (a.innerText || '').trim();

        // Nếu innerText rỗng, tìm kiếm trong thẻ con hoặc thuộc tính aria-label
        if (!text) {
          const heading = a.querySelector('[role="heading"], strong, span');
          if (heading) {
            text = (heading.innerText || heading.textContent || '').trim();
          }
        }
        if (!text) {
          text = (a.getAttribute('aria-label') || '').trim();
        }

        // Lấy tên nhóm từ tiêu đề đầu tiên nếu có nhiều dòng (bỏ phần 'Lần hoạt động gần nhất: ...')
        if (text.includes('\n')) {
          text = text.split('\n')[0].trim();
        }

        const match = href.match(/\/groups\/([a-zA-Z0-9._-]+)/);
        if (match && match[1]) {
          const groupId = match[1];

          if (
            !ignoredSlugs.includes(groupId) &&
            text.length > 2 &&
            !text.toLowerCase().includes('nhóm đã tham gia') &&
            !text.toLowerCase().includes('tham gia nhóm') &&
            !text.toLowerCase().includes('tạo nhóm')
          ) {
            results.push({
              groupId,
              groupName: text,
              groupUrl: `https://www.facebook.com/groups/${groupId}/`,
            });
          }
        }
      });

      return results;
    });

    // Lọc bỏ các nhóm trùng lặp theo groupId
    const uniqueMap = new Map();
    extractedData.forEach((item) => {
      if (!uniqueMap.has(item.groupId)) {
        uniqueMap.set(item.groupId, item);
      }
    });

    const finalGroups = Array.from(uniqueMap.values());
    console.log(`[GroupScanner] Quét hoàn tất! Tìm thấy ${finalGroups.length} nhóm hợp lệ.`);

    // Lưu vào my_groups.json
    saveGroupsToFile(finalGroups);

    // Gửi thông báo kết quả về Telegram nếu có
    const reportMsg = `🔍 <b>[QUÉT NHÓM THÀNH CÔNG]</b>\n` +
      `Đã quét được <b>${finalGroups.length} nhóm</b> đã tham gia.\n` +
      `Dữ liệu đã được lưu vào hệ thống và sẵn sàng để lên lịch đăng bài!`;
    await sendReport(reportMsg);

    return finalGroups;
  } catch (error) {
    console.error(`[GroupScanner] Lỗi trong quá trình quét nhóm: ${error.message}`);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log('[GroupScanner] Đã đóng trình duyệt quét nhóm.');
    }
  }
}

module.exports = {
  scanUserGroups,
  loadSavedGroups,
};
