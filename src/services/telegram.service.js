/**
 * ==============================================================================
 * KÊNH BÁO CÁO & GIÁM SÁT TELEGRAM (TELEGRAM REPORTING SERVICE)
 * ==============================================================================
 * Cung cấp giải pháp giám sát tiến độ thời gian thực cho người quản trị:
 * - sendReport(message): Gửi báo cáo văn bản định dạng HTML (task khởi chạy, hoàn thành, thống kê).
 * - sendPhotoReport(imageBuffer, caption): Gửi ảnh chụp màn hình bằng chứng thành công hoặc ảnh lỗi.
 */

const axios = require('axios');
const { CONFIG } = require('../config/env');

/**
 * Gửi báo cáo quản trị dạng văn bản HTML về Telegram
 * @param {string} message - Nội dung báo cáo định dạng HTML
 * @returns {Promise<boolean>}
 */
async function sendReport(message) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = CONFIG;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] Cảnh báo: Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID. Bỏ qua gửi báo cáo.');
    return false;
  }

  const endpoint = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const payload = {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };

    const response = await axios.post(endpoint, payload, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.data && response.data.ok) {
      console.log('[Telegram] Đã gửi báo cáo văn bản thành công.');
      return true;
    }

    console.warn('[Telegram] API phản hồi không thành công:', response.data);
    return false;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[Telegram] Lỗi gửi báo cáo văn bản: ${errorDetails}`);
    return false;
  }
}

/**
 * Gửi ảnh chụp màn hình (Buffer) kèm chú thích về Telegram
 * @param {Buffer} imageBuffer - Buffer dữ liệu ảnh PNG/JPEG
 * @param {string} [caption=''] - Chú thích đính kèm (hỗ trợ HTML)
 * @returns {Promise<boolean>}
 */
async function sendPhotoReport(imageBuffer, caption = '') {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = CONFIG;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] Cảnh báo: Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID. Bỏ qua gửi ảnh.');
    return false;
  }

  const endpoint = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;

  try {
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);

    if (caption) {
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');
    }

    const photoBlob = new Blob([imageBuffer], { type: 'image/png' });
    formData.append('photo', photoBlob, 'report_screenshot.png');

    const response = await axios.post(endpoint, formData, {
      timeout: 25000,
    });

    if (response.data && response.data.ok) {
      console.log('[Telegram] Đã gửi ảnh báo cáo thành công về Telegram.');
      return true;
    }

    console.warn('[Telegram] Gửi ảnh thất bại:', response.data);
    return false;
  } catch (error) {
    const errorDetails = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[Telegram] Lỗi gửi ảnh: ${errorDetails}`);
    return false;
  }
}

module.exports = {
  sendReport,
  sendPhotoReport,
  // Tương thích ngược với các module trước
  sendTelegramAlert: sendReport,
  sendTelegramPhoto: sendPhotoReport,
};
