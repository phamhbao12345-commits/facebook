/**
 * ==============================================================================
 * DỊCH VỤ TƯƠNG TÁC TỰ NHIÊN & NUÔI NICK (FACEBOOK WARMUP SERVICE)
 * ==============================================================================
 * Cung cấp giải pháp nuôi tài khoản tự nhiên với mốc thời gian chi tiết:
 * - Ghi nhận chính xác THỜI GIAN BẮT ĐẦU và THỜI GIAN KẾT THÚC cho từng hành vi:
 *   + Xem Video Watch / Reels
 *   + Lướt News Feed trang chủ
 *   + Tương tác Thích (Like) video/bài viết
 *   + Tương tác Chia sẻ (Share) video/bài viết
 * - Xuất báo cáo Timeline chi tiết về Terminal, Web Dashboard và Telegram.
 */

const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { CONFIG, getPuppeteerLaunchOptions } = require('../config/env');
const { loadCookiesIntoSession, hasValidCookies } = require('./cookie.service');
const { sendReport, sendPhotoReport } = require('./telegram.service');
const { addLog } = require('./logger.service');

puppeteer.use(StealthPlugin());

/**
 * Tạm dừng mili-giây
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Sinh số nguyên ngẫu nhiên [min, max]
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Định dạng thời gian HH:mm:ss
 * @param {Date} [d=new Date()]
 * @returns {string}
 */
function formatTime(d = new Date()) {
  return d.toLocaleTimeString('vi-VN', { hour12: false });
}

/**
 * Thực thi quy trình nuôi nick trên trang Puppeteer có sẵn
 * @param {import('puppeteer').Page} page
 * @param {object} [config={}]
 * @param {number} [config.watchVideoSeconds=0]
 * @param {boolean} [config.enableLike=false]
 * @param {number} [config.scrollFeedSeconds=0]
 * @param {boolean} [config.enableShare=false]
 * @returns {Promise<{ success: boolean, timeline: Array<object>, durationSeconds: number }>}
 */
async function executeWarmup(page, config = {}) {
  const isMock = CONFIG.MOCK_MODE;
  const watchSeconds = typeof config.watchVideoSeconds === 'number' ? config.watchVideoSeconds : 0;
  const feedSeconds = typeof config.scrollFeedSeconds === 'number' ? config.scrollFeedSeconds : 0;
  const enableLike = Boolean(config.enableLike);
  const enableShare = Boolean(config.enableShare);

  const overallStartTime = new Date();
  const timeline = [];

  console.log('\n[Warmup] ============================================================');
  console.log(`[Warmup] BẮT ĐẦU QUY TRÌNH NUÔI NICK VÀO LÚC: ${formatTime(overallStartTime)}`);
  console.log(`- Xem Video (Watch) : ${watchSeconds} giây`);
  console.log(`- Lướt News Feed    : ${feedSeconds} giây`);
  console.log(`- Bấm Like ngẫu nhiên: ${enableLike ? 'Có' : 'Không'}`);
  console.log(`- Chia sẻ bài/video : ${enableShare ? 'Có' : 'Không'}`);
  console.log('[Warmup] ============================================================');

  try {
    // --------------------------------------------------------------------------
    // 1. XEM VIDEO / REELS (WATCH)
    // --------------------------------------------------------------------------
    if (watchSeconds > 0) {
      const stepStart = new Date();
      console.log(`\n[Warmup] [Watch] ⏳ BẮT ĐẦU XEM VIDEO lúc: ${formatTime(stepStart)}`);
      addLog(`[Watch] ⏳ BẮT ĐẦU xem Video lúc ${formatTime(stepStart)} (${watchSeconds}s)`);

      const watchUrl = isMock
        ? `http://localhost:${CONFIG.PORT}/watch`
        : 'https://www.facebook.com/watch';

      try {
        await page.goto(watchUrl, { waitUntil: 'networkidle2', timeout: 35000 });
        await sleep(2000);
      } catch (navErr) {
        console.warn(`[Warmup] [Watch] Cảnh báo điều hướng: ${navErr.message}. Tiếp tục trên trang hiện tại.`);
      }

      const watchLimitMs = watchSeconds * 1000;
      const startWatchMs = Date.now();

      while (Date.now() - startWatchMs < watchLimitMs) {
        const remainingMs = watchLimitMs - (Date.now() - startWatchMs);
        if (remainingMs <= 0) break;

        const scrollDistance = getRandomInt(200, 450);
        await page.evaluate((y) => {
          window.scrollBy({ top: y, left: 0, behavior: 'smooth' });
        }, scrollDistance);

        const pauseTime = getRandomInt(4000, 6000);
        const actualPause = Math.min(pauseTime, remainingMs);
        const elapsedSec = Math.round((Date.now() - startWatchMs) / 1000);

        console.log(`[Warmup] [Watch] [${formatTime()}] Cuộn ${scrollDistance}px | Dừng ${(actualPause / 1000).toFixed(1)}s (Đã xem: ${elapsedSec}s/${watchSeconds}s)`);
        await sleep(actualPause);
      }

      const stepEnd = new Date();
      const actualDuration = Math.round((stepEnd - stepStart) / 1000);
      console.log(`[Warmup] [Watch] 🏁 KẾT THÚC XEM VIDEO lúc: ${formatTime(stepEnd)} (Tổng: ${actualDuration}s)`);
      addLog(`[Watch] 🏁 KẾT THÚC xem Video lúc ${formatTime(stepEnd)} (${actualDuration}s)`);

      timeline.push({
        action: 'Xem Video Watch / Reels',
        startTime: formatTime(stepStart),
        endTime: formatTime(stepEnd),
        duration: `${actualDuration}s`,
        status: 'Hoàn thành',
      });
    }

    // --------------------------------------------------------------------------
    // 2. LƯỚT NEWS FEED TRANG CHỦ
    // --------------------------------------------------------------------------
    if (feedSeconds > 0) {
      const stepStart = new Date();
      console.log(`\n[Warmup] [Feed] ⏳ BẮT ĐẦU LƯỚT FEED lúc: ${formatTime(stepStart)}`);
      addLog(`[Feed] ⏳ BẮT ĐẦU lướt Feed lúc ${formatTime(stepStart)} (${feedSeconds}s)`);

      const feedUrl = isMock
        ? `http://localhost:${CONFIG.PORT}/`
        : 'https://www.facebook.com/';

      try {
        await page.goto(feedUrl, { waitUntil: 'networkidle2', timeout: 35000 });
        await sleep(2000);
      } catch (feedNavErr) {
        console.warn(`[Warmup] [Feed] Cảnh báo điều hướng: ${feedNavErr.message}`);
      }

      const feedLimitMs = feedSeconds * 1000;
      const startFeedMs = Date.now();

      while (Date.now() - startFeedMs < feedLimitMs) {
        const remainingMs = feedLimitMs - (Date.now() - startFeedMs);
        if (remainingMs <= 0) break;

        const scrollDistance = getRandomInt(250, 500);
        await page.evaluate((y) => {
          window.scrollBy({ top: y, left: 0, behavior: 'smooth' });
        }, scrollDistance);

        const pauseTime = getRandomInt(4000, 6000);
        const actualPause = Math.min(pauseTime, remainingMs);
        const elapsedSec = Math.round((Date.now() - startFeedMs) / 1000);

        console.log(`[Warmup] [Feed] [${formatTime()}] Cuộn ${scrollDistance}px | Dừng ${(actualPause / 1000).toFixed(1)}s (Đã lướt: ${elapsedSec}s/${feedSeconds}s)`);
        await sleep(actualPause);
      }

      const stepEnd = new Date();
      const actualDuration = Math.round((stepEnd - stepStart) / 1000);
      console.log(`[Warmup] [Feed] 🏁 KẾT THÚC LƯỚT FEED lúc: ${formatTime(stepEnd)} (Tổng: ${actualDuration}s)`);
      addLog(`[Feed] 🏁 KẾT THÚC lướt Feed lúc ${formatTime(stepEnd)} (${actualDuration}s)`);

      timeline.push({
        action: 'Lướt News Feed trang chủ',
        startTime: formatTime(stepStart),
        endTime: formatTime(stepEnd),
        duration: `${actualDuration}s`,
        status: 'Hoàn thành',
      });
    }

    // --------------------------------------------------------------------------
    // 3. TƯƠNG TÁC THÍCH (LIKE) NGẪU NHIÊN 1 LẦN
    // --------------------------------------------------------------------------
    if (enableLike) {
      const stepStart = new Date();
      console.log(`\n[Warmup] [Like] ⏳ BẮT ĐẦU TƯƠNG TÁC LIKE lúc: ${formatTime(stepStart)}`);
      addLog(`[Like] ⏳ BẮT ĐẦU tương tác Like lúc ${formatTime(stepStart)}`);

      const likeSelectors = [
        '.like-button',
        'div[aria-label*="Thích"][role="button"]',
        'div[aria-label*="Like"][role="button"]',
        'button[aria-label*="Thích"]',
        'button[aria-label*="Like"]',
      ];

      let foundLikes = [];
      for (const sel of likeSelectors) {
        try {
          const elements = await page.$$(sel);
          if (elements && elements.length > 0) {
            foundLikes = elements;
            break;
          }
        } catch {
          // Bỏ qua
        }
      }

      let likeStatus = 'Không tìm thấy nút Like';
      if (foundLikes.length > 0) {
        const randIdx = getRandomInt(0, foundLikes.length - 1);
        const targetBtn = foundLikes[randIdx];

        await targetBtn.evaluate((el) => {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        await sleep(getRandomInt(800, 1500));

        await targetBtn.click();
        console.log(`[Warmup] [Like] Đã bấm Thích (Like) thành công bài viết #${randIdx + 1}!`);
        await sleep(getRandomInt(1500, 2500));
        likeStatus = 'Thành công';
      } else {
        console.log('[Warmup] [Like] Không phát hiện nút Like nào trên màn hình hiện tại.');
      }

      const stepEnd = new Date();
      console.log(`[Warmup] [Like] 🏁 KẾT THÚC TƯƠNG TÁC LIKE lúc: ${formatTime(stepEnd)} | Trạng thái: ${likeStatus}`);
      addLog(`[Like] 🏁 KẾT THÚC tương tác Like lúc ${formatTime(stepEnd)} (${likeStatus})`);

      timeline.push({
        action: 'Tương tác Thích (Like)',
        startTime: formatTime(stepStart),
        endTime: formatTime(stepEnd),
        status: likeStatus,
      });
    }

    // --------------------------------------------------------------------------
    // 4. TƯƠNG TÁC CHIA SẺ (SHARE)
    // --------------------------------------------------------------------------
    if (enableShare) {
      const stepStart = new Date();
      console.log(`\n[Warmup] [Share] ⏳ BẮT ĐẦU TƯƠNG TÁC SHARE lúc: ${formatTime(stepStart)}`);
      addLog(`[Share] ⏳ BẮT ĐẦU tương tác Share lúc ${formatTime(stepStart)}`);

      const shareSelectors = [
        'div[aria-label*="Chia sẻ"][role="button"]',
        'div[aria-label*="Share"][role="button"]',
        'button[aria-label*="Chia sẻ"]',
      ];

      let shareStatus = 'Không tìm thấy nút Share';
      for (const sel of shareSelectors) {
        try {
          const shareBtn = await page.$(sel);
          if (shareBtn) {
            await shareBtn.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            await sleep(1000);
            await shareBtn.click();
            console.log('[Warmup] [Share] Đã click tương tác nút Share bài viết.');
            await sleep(2000);
            shareStatus = 'Thành công';
            break;
          }
        } catch {
          // Tiếp tục
        }
      }

      const stepEnd = new Date();
      console.log(`[Warmup] [Share] 🏁 KẾT THÚC TƯƠNG TÁC SHARE lúc: ${formatTime(stepEnd)} | Trạng thái: ${shareStatus}`);
      addLog(`[Share] 🏁 KẾT THÚC tương tác Share lúc ${formatTime(stepEnd)} (${shareStatus})`);

      timeline.push({
        action: 'Tương tác Chia sẻ (Share)',
        startTime: formatTime(stepStart),
        endTime: formatTime(stepEnd),
        status: shareStatus,
      });
    }

    const overallEndTime = new Date();
    const totalSeconds = Math.round((overallEndTime - overallStartTime) / 1000);

    console.log('\n[Warmup] ============================================================');
    console.log(`[Warmup] TỔNG KẾT QUY TRÌNH NUÔI NICK:`);
    console.log(`- Bắt đầu lúc : ${formatTime(overallStartTime)}`);
    console.log(`- Kết thúc lúc: ${formatTime(overallEndTime)}`);
    console.log(`- Tổng thời gian thực thi: ${totalSeconds} giây`);
    console.log('[Warmup] ============================================================\n');

    return {
      success: true,
      startTime: formatTime(overallStartTime),
      endTime: formatTime(overallEndTime),
      durationSeconds: totalSeconds,
      timeline,
    };
  } catch (error) {
    console.warn(`[Warmup] Cảnh báo trong khi nuôi nick: ${error.message}`);
    return {
      success: false,
      startTime: formatTime(overallStartTime),
      endTime: formatTime(new Date()),
      timeline,
      error: error.message,
    };
  }
}

/**
 * TÁCH BIỆT HOÀN TOÀN: Khởi chạy một phiên nuôi nick độc lập
 * - Có thời gian bắt đầu và kết thúc chi tiết cho từng hành động
 * - Tuyệt đối KHÔNG yêu cầu groupId và KHÔNG đăng bài
 * @param {object} [config={}]
 * @param {number} [config.watchVideoSeconds=60]
 * @param {boolean} [config.enableLike=true]
 * @param {boolean} [config.enableShare=false]
 * @param {number} [config.scrollFeedSeconds=30]
 * @returns {Promise<{ success: boolean, message: string, timeline: Array<object>, startTime: string, endTime: string }>}
 */
async function runStandaloneWarmup(config = {}) {
  const isMock = CONFIG.MOCK_MODE;
  const isHeadless = CONFIG.HEADLESS;
  const watchSeconds = typeof config.watchVideoSeconds === 'number' ? config.watchVideoSeconds : 60;
  const feedSeconds = typeof config.scrollFeedSeconds === 'number' ? config.scrollFeedSeconds : 30;
  const enableLike = config.enableLike !== undefined ? Boolean(config.enableLike) : true;
  const enableShare = Boolean(config.enableShare);

  const sessionStartTime = new Date();

  // 0. Kiểm tra Cookie nếu chạy trên môi trường Facebook thật
  if (!isMock && !hasValidCookies()) {
    const errorMsg = 'Chưa đăng nhập Facebook hoặc chưa có Cookie hợp lệ! Vui lòng bấm "🔑 Đăng nhập Facebook ngay" trên Dashboard trước khi chạy tác vụ.';
    console.warn(`\n[Warmup] ⚠️ CẢNH BÁO: ${errorMsg}`);
    addLog(`⚠️ Không thể chạy nuôi nick: Chưa có Cookie. Vui lòng bấm "🔑 Đăng nhập Facebook ngay"!`);
    await sendReport(`⚠️ <b>[CHƯA ĐĂNG NHẬP FACEBOOK]</b> Không thể chạy nuôi nick do hệ thống chưa có Cookie. Vui lòng bấm <b>"🔑 Đăng nhập Facebook ngay"</b> trên Dashboard!`);
    return {
      success: false,
      message: errorMsg,
      startTime: formatTime(sessionStartTime),
      endTime: formatTime(sessionStartTime),
      timeline: [],
    };
  }

  console.log('\n================================================================');
  console.log('  KHỞI CHẠY TÁC VỤ NUÔI NICK ĐỘC LẬP (STANDALONE WARMUP)');
  console.log(`  BẮT ĐẦU LÚC: ${formatTime(sessionStartTime)}`);
  console.log('  (Tuyệt đối KHÔNG đăng bài - Chỉ xem Video, lướt Feed & Like/Share)');
  console.log('================================================================');
  console.log(`- Môi trường    : ${isMock ? 'MOCK LOCALHOST' : 'FACEBOOK PRODUCTION'}`);
  console.log(`- Cờ HEADLESS   : ${isHeadless ? 'Bật (Chạy ngầm)' : 'Tắt (Mở cửa sổ Chrome)'}`);
  console.log(`- Kế hoạch: Watch: ${watchSeconds}s | Feed: ${feedSeconds}s | Like: ${enableLike} | Share: ${enableShare}`);
  console.log('----------------------------------------------------------------\n');

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

    // Nạp cookies tài khoản
    await loadCookiesIntoSession(page);

    // Thực hiện hành vi nuôi nick và ghi nhận timeline chi tiết
    const warmupResult = await executeWarmup(page, {
      watchVideoSeconds: watchSeconds,
      scrollFeedSeconds: feedSeconds,
      enableLike,
      enableShare,
    });

    const sessionEndTime = new Date();

    // Chụp ảnh màn hình làm bằng chứng hoàn thành nuôi nick
    const proofBuffer = await page.screenshot({ type: 'png' });
    try {
      const { saveScreenshot } = require('./poster.service');
      saveScreenshot(proofBuffer, 'warmup_success');
    } catch (_) {}

    // Tạo nội dung thông báo Telegram có đầy đủ thời gian bắt đầu & kết thúc từng mục
    let timelineText = '';
    if (warmupResult.timeline && warmupResult.timeline.length > 0) {
      timelineText = warmupResult.timeline
        .map((t) => `• <b>${t.action}:</b> ${t.startTime} ➔ ${t.endTime} ${t.duration ? `(${t.duration})` : ''} - <i>${t.status}</i>`)
        .join('\n');
    }

    const reportMsg = `🛡️ <b>[PHIÊN NUÔI NICK ĐỘC LẬP HOÀN TẤT]</b>\n` +
      `⏱️ <b>Bắt đầu:</b> <code>${formatTime(sessionStartTime)}</code>\n` +
      `🏁 <b>Kết thúc:</b> <code>${formatTime(sessionEndTime)}</code>\n` +
      `⏳ <b>Tổng thời lượng:</b> ${Math.round((sessionEndTime - sessionStartTime) / 1000)}s\n\n` +
      `<b>Chi tiết từng hoạt động:</b>\n${timelineText}`;

    await sendPhotoReport(proofBuffer, reportMsg);
    console.log('[Warmup] Phiên nuôi nick độc lập hoàn thành xuất sắc!\n');

    return {
      success: true,
      message: 'Phiên nuôi nick độc lập đã hoàn tất thành công!',
      startTime: formatTime(sessionStartTime),
      endTime: formatTime(sessionEndTime),
      durationSeconds: Math.round((sessionEndTime - sessionStartTime) / 1000),
      timeline: warmupResult.timeline || [],
    };
  } catch (error) {
    const errorTime = formatTime();
    console.error(`[Warmup] Lỗi trong phiên nuôi nick độc lập lúc ${errorTime}: ${error.message}`);
    await sendReport(`❌ <b>[LỖI NUÔI NICK]</b> (${errorTime}): ${error.message}`);
    return {
      success: false,
      message: error.message,
      startTime: formatTime(sessionStartTime),
      endTime: errorTime,
      timeline: [],
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log('[Warmup] Đã đóng trình duyệt Puppeteer và giải phóng tài nguyên.');
    }
  }
}

module.exports = {
  executeWarmup,
  runStandaloneWarmup,
  sleep,
  getRandomInt,
  formatTime,
};
