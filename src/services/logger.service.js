/**
 * ==============================================================================
 * DỊCH VỤ NHẬT KÝ TIẾN TRÌNH THỜI GIAN THỰC (LIVE ACTIVITY LOGGER)
 * ==============================================================================
 * Quản lý bộ đệm log trong bộ nhớ để giao diện Web Dashboard hiển thị trực tiếp
 * mốc thời gian bắt đầu & kết thúc của các hành vi (xem video, like, share, đăng bài).
 */

const MAX_LOGS = 100;
const activityLogs = [
  {
    time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    message: 'Hệ thống Live Activity Logger đã sẵn sàng.',
  },
];

/**
 * Thêm một dòng nhật ký tiến trình
 * @param {string} message
 */
function addLog(message) {
  const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  activityLogs.push({ time, message });

  if (activityLogs.length > MAX_LOGS) {
    activityLogs.shift();
  }
}

/**
 * Lấy toàn bộ danh sách log gần nhất
 * @returns {Array<{ time: string, message: string }>}
 */
function getLogs() {
  return [...activityLogs];
}

module.exports = {
  addLog,
  getLogs,
};
