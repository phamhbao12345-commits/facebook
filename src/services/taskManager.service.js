/**
 * ==============================================================================
 * BỘ NÃO QUẢN LÝ HÀNG ĐỢI & TÁC VỤ (TASK MANAGER SERVICE)
 * ==============================================================================
 * Quản lý cơ sở dữ liệu tác vụ (tasks.json):
 * - Đọc và ghi trạng thái tác vụ an toàn và đồng bộ, không mất dữ liệu khi restart.
 * - Quản lý vòng đời tác vụ: PENDING -> RUNNING -> COMPLETED / FAILED.
 * - Lọc tác vụ đến hạn thực thi theo lịch trình (targetTime).
 * - Cung cấp số liệu thống kê thời gian thực cho Dashboard quản trị.
 */

const fs = require('fs');
const path = require('path');

const TASKS_FILE_PATH = path.resolve(__dirname, '../config/tasks.json');

/**
 * Đọc toàn bộ danh sách tác vụ từ file tasks.json
 * @returns {Array<object>} Danh sách các task
 */
function loadTasks() {
  try {
    if (!fs.existsSync(TASKS_FILE_PATH)) {
      fs.writeFileSync(TASKS_FILE_PATH, JSON.stringify([], null, 2), 'utf8');
      return [];
    }
    const rawData = fs.readFileSync(TASKS_FILE_PATH, 'utf8');
    return JSON.parse(rawData);
  } catch (error) {
    console.error(`[TaskManager] Lỗi khi nạp dữ liệu tasks.json: ${error.message}`);
    return [];
  }
}

/**
 * Lưu danh sách tác vụ vào file tasks.json
 * @param {Array<object>} tasks - Mảng các task cần lưu
 */
function saveTasks(tasks) {
  try {
    fs.writeFileSync(TASKS_FILE_PATH, JSON.stringify(tasks, null, 2), 'utf8');
  } catch (error) {
    console.error(`[TaskManager] Lỗi khi lưu tasks.json: ${error.message}`);
    throw error;
  }
}

/**
 * Cập nhật trạng thái tác vụ và tự động ghi đè ngay vào tasks.json
 * @param {string} taskId - ID của tác vụ cần cập nhật
 * @param {'PENDING'|'RUNNING'|'COMPLETED'|'FAILED'} status - Trạng thái mới
 * @param {object} [extraData={}] - Dữ liệu bổ sung (error, details, v.v.)
 * @returns {object|null} Trả về task sau khi cập nhật
 */
function updateTaskStatus(taskId, status, extraData = {}) {
  const tasks = loadTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);

  if (taskIndex === -1) {
    console.warn(`[TaskManager] Cảnh báo: Không tìm thấy task với ID: ${taskId}`);
    return null;
  }

  const task = tasks[taskIndex];
  task.status = status;

  if (status === 'RUNNING') {
    task.lastExecuted = new Date().toISOString();
  } else if (status === 'COMPLETED') {
    task.errorLog = null;
    task.completedAt = new Date().toISOString();
  } else if (status === 'FAILED') {
    task.errorLog = extraData.error || extraData.errorLog || 'Lỗi không xác định trong quá trình thực thi';
    task.retryCount = (task.retryCount || 0) + 1;
    task.failedAt = new Date().toISOString();
  }

  // Hợp nhất bất kỳ trường dữ liệu bổ sung nào
  Object.assign(task, extraData);

  saveTasks(tasks);
  console.log(`[TaskManager] Đã cập nhật task [${taskId}] -> Trạng thái: ${status}`);
  return task;
}

/**
 * Chuyển đổi chuỗi thời gian sang timestamp an toàn trên mọi hệ điều hành
 * @param {string} dateStr - Ví dụ: "2026-10-08 14:00:00" hoặc ISO string
 * @returns {number}
 */
function parseTargetTime(dateStr) {
  if (!dateStr) return 0;
  // Chuẩn hóa định dạng "YYYY-MM-DD HH:mm:ss" sang ISO tương thích
  const formatted = dateStr.replace(' ', 'T');
  const timestamp = new Date(formatted).getTime();
  return isNaN(timestamp) ? new Date(dateStr).getTime() : timestamp;
}

/**
 * Lấy danh sách các task đang chờ và đã đến hạn thực thi (targetTime <= now)
 * @returns {Array<object>}
 */
function getNextPendingTasks() {
  const tasks = loadTasks();
  const now = Date.now();

  return tasks
    .filter((task) => {
      if (task.status !== 'PENDING') return false;
      const targetTimeMs = parseTargetTime(task.targetTime);
      return now >= targetTimeMs;
    })
    .sort((a, b) => parseTargetTime(a.targetTime) - parseTargetTime(b.targetTime));
}

/**
 * Lấy số liệu thống kê trạng thái của toàn bộ tác vụ trong hệ thống
 * @returns {{ total: number, pending: number, running: number, completed: number, failed: number }}
 */
function getTaskStats() {
  const tasks = loadTasks();
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'PENDING').length,
    running: tasks.filter((t) => t.status === 'RUNNING').length,
    completed: tasks.filter((t) => t.status === 'COMPLETED').length,
    failed: tasks.filter((t) => t.status === 'FAILED').length,
  };
}

module.exports = {
  loadTasks,
  saveTasks,
  updateTaskStatus,
  getNextPendingTasks,
  getTaskStats,
};
