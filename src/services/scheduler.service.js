/**
 * ==============================================================================
 * DỊCH VỤ ĐIỀU PHỐI LỊCH TRÌNH TÁC VỤ (TASK SCHEDULER SERVICE)
 * ==============================================================================
 * Quản lý và điều phối các tác vụ theo lịch hẹn:
 * - Đọc và cập nhật trực tiếp cơ sở dữ liệu `src/config/tasks.json`.
 * - Vòng lặp quét mỗi 30 giây:
 *   + Quét các task có status === 'PENDING' và new Date() >= new Date(task.targetTime).
 *   + Khi đến hạn: đổi trạng thái sang 'RUNNING', lưu file và gọi runTaskWorkflow(task).
 *   + Khi hoàn tất: đổi sang 'COMPLETED' (hoặc 'FAILED' nếu lỗi), lưu file và gửi báo cáo Telegram.
 */

const fs = require('fs');
const path = require('path');
const { runTaskWorkflow } = require('./poster.service');
const { sendReport } = require('./telegram.service');

const TASKS_FILE_PATH = path.resolve(__dirname, '../config/tasks.json');

let schedulerTimer = null;
let isProcessing = false;

/**
 * Đọc toàn bộ danh sách tác vụ từ tasks.json
 * @returns {Array<object>}
 */
function loadTasks() {
  try {
    if (!fs.existsSync(TASKS_FILE_PATH)) {
      fs.writeFileSync(TASKS_FILE_PATH, JSON.stringify([], null, 2), 'utf8');
      return [];
    }
    const raw = fs.readFileSync(TASKS_FILE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[Scheduler] Lỗi đọc file tasks.json: ${err.message}`);
    return [];
  }
}

/**
 * Lưu danh sách tác vụ vào tasks.json
 * @param {Array<object>} tasks
 */
function saveTasks(tasks) {
  try {
    fs.writeFileSync(TASKS_FILE_PATH, JSON.stringify(tasks, null, 2), 'utf8');
  } catch (err) {
    console.error(`[Scheduler] Lỗi lưu file tasks.json: ${err.message}`);
  }
}

/**
 * Chuyển đổi định dạng thời gian "YYYY-MM-DD HH:mm:ss" sang timestamp ms
 * @param {string} dateStr
 * @returns {number}
 */
function parseTime(dateStr) {
  if (!dateStr) return 0;
  const isoStr = dateStr.replace(' ', 'T');
  const ms = new Date(isoStr).getTime();
  return isNaN(ms) ? new Date(dateStr).getTime() : ms;
}

/**
 * Quét các task đến hạn và thực thi
 */
async function scanAndExecuteTasks() {
  if (isProcessing) {
    console.log('[Scheduler] Đang có tác vụ đang chạy, tạm hoãn chu kỳ quét.');
    return;
  }

  try {
    const tasks = loadTasks();
    const now = Date.now();

    // Tìm các task có status === 'PENDING' và đã đến hạn
    const dueTasks = tasks.filter((t) => {
      if (t.status !== 'PENDING') return false;
      const targetTimeMs = parseTime(t.targetTime);
      return now >= targetTimeMs;
    });

    if (dueTasks.length === 0) {
      console.log(`[Scheduler] [${new Date().toLocaleTimeString('vi-VN')}] Hàng đợi không có task đến hạn. Đợi chu kỳ quét tiếp theo (30s)...`);
      return;
    }

    // Lấy task đầu tiên để thực thi
    const targetTask = dueTasks[0];
    const taskIndex = tasks.findIndex((t) => t.id === targetTask.id);

    isProcessing = true;
    console.log(`\n[Scheduler] >>> PHÁT HIỆN TÁC VỤ ĐẾN HẠN: [${targetTask.id}] "${targetTask.name}" <<<`);

    // 1. Đổi trạng thái sang RUNNING và lưu tasks.json
    tasks[taskIndex].status = 'RUNNING';
    tasks[taskIndex].lastExecuted = new Date().toISOString();
    saveTasks(tasks);

    // Bắn thông báo Telegram
    const startMsg = `🚀 <b>[BẮT ĐẦU TÁC VỤ THEO LỊCH HẸN]</b>\n` +
      `<b>ID:</b> <code>${targetTask.id}</code>\n` +
      `<b>Tên:</b> ${targetTask.name}\n` +
      `<b>Group ID:</b> <code>${targetTask.groupId}</code>\n` +
      `<b>Lịch hẹn:</b> <code>${targetTask.targetTime}</code>`;
    await sendReport(startMsg);

    // 2. Gọi runTaskWorkflow thực thi
    const result = await runTaskWorkflow(targetTask);

    // Nạp lại dữ liệu mới nhất phòng trường hợp file bị sửa
    const refreshedTasks = loadTasks();
    const updatedIndex = refreshedTasks.findIndex((t) => t.id === targetTask.id);

    if (updatedIndex !== -1) {
      if (result.success) {
        // 3. Đổi trạng thái sang COMPLETED
        refreshedTasks[updatedIndex].status = 'COMPLETED';
        refreshedTasks[updatedIndex].completedAt = new Date().toISOString();
        refreshedTasks[updatedIndex].errorLog = null;
        console.log(`[Scheduler] Tác vụ [${targetTask.id}] đã đổi trạng thái thành -> COMPLETED.`);
      } else {
        // Đổi trạng thái sang FAILED nếu lỗi
        refreshedTasks[updatedIndex].status = 'FAILED';
        refreshedTasks[updatedIndex].failedAt = new Date().toISOString();
        refreshedTasks[updatedIndex].errorLog = result.error || 'Lỗi không xác định';
        console.error(`[Scheduler] Tác vụ [${targetTask.id}] đổi trạng thái thành -> FAILED.`);
      }

      // Lưu lại file tasks.json
      saveTasks(refreshedTasks);
    }
  } catch (err) {
    console.error(`[Scheduler] Lỗi trong chu kỳ quét: ${err.message}`);
  } finally {
    isProcessing = false;
  }
}

/**
 * Kích hoạt chạy một task ngay lập tức theo ID
 * @param {string} taskId
 * @returns {Promise<{ success: boolean, message: string, task?: object, error?: string }>}
 */
async function executeTaskById(taskId) {
  if (isProcessing) {
    return {
      success: false,
      message: 'Hệ thống đang bận thực thi một tác vụ khác. Vui lòng chờ ít phút.',
    };
  }

  const tasks = loadTasks();
  const taskIndex = tasks.findIndex((t) => t.id === taskId);

  if (taskIndex === -1) {
    return {
      success: false,
      message: `Không tìm thấy tác vụ với ID: ${taskId}`,
    };
  }

  const targetTask = tasks[taskIndex];
  isProcessing = true;

  try {
    console.log(`\n[Scheduler] >>> KÍCH HOẠT CHẠY TỨC THỜI TASK: [${targetTask.id}] "${targetTask.name}" <<<`);

    // Cập nhật trạng thái RUNNING
    tasks[taskIndex].status = 'RUNNING';
    tasks[taskIndex].lastExecuted = new Date().toISOString();
    saveTasks(tasks);

    // Gửi thông báo bắt đầu qua Telegram
    const startNotice = `⚡ <b>[KÍCH HOẠT CHẠY TỨC THỜI]</b>\n` +
      `<b>ID:</b> <code>${targetTask.id}</code>\n` +
      `<b>Tên:</b> ${targetTask.name}\n` +
      `<b>Group ID:</b> <code>${targetTask.groupId}</code>`;
    await sendReport(startNotice);

    // Chạy tác vụ
    const result = await runTaskWorkflow(targetTask);

    const refreshedTasks = loadTasks();
    const updatedIndex = refreshedTasks.findIndex((t) => t.id === targetTask.id);

    if (updatedIndex !== -1) {
      if (result.success) {
        refreshedTasks[updatedIndex].status = 'COMPLETED';
        refreshedTasks[updatedIndex].completedAt = new Date().toISOString();
        refreshedTasks[updatedIndex].errorLog = null;
      } else {
        refreshedTasks[updatedIndex].status = 'FAILED';
        refreshedTasks[updatedIndex].failedAt = new Date().toISOString();
        refreshedTasks[updatedIndex].errorLog = result.error || 'Lỗi không xác định';
      }
      saveTasks(refreshedTasks);
    }

    return {
      success: result.success,
      message: result.success ? 'Tác vụ đã hoàn thành xuất sắc!' : (result.error || 'Thực thi thất bại'),
      task: refreshedTasks[updatedIndex] || targetTask,
    };
  } catch (err) {
    console.error(`[Scheduler] Lỗi khi chạy tức thời task ${taskId}: ${err.message}`);
    return {
      success: false,
      message: err.message,
    };
  } finally {
    isProcessing = false;
  }
}

/**
 * Khởi động scheduler quét hàng đợi mỗi 30 giây
 * @param {number} [intervalMs=30000]
 */
function startScheduler(intervalMs = 30000) {
  if (schedulerTimer) {
    console.log('[Scheduler] Scheduler đã đang chạy.');
    return;
  }

  console.log(`[Scheduler] Khởi động vòng lặp kiểm tra hàng đợi mỗi ${intervalMs / 1000} giây.`);
  
  // Quét ngay lần đầu tiên
  scanAndExecuteTasks();

  // Thiết lập interval mỗi 30 giây
  schedulerTimer = setInterval(scanAndExecuteTasks, intervalMs);
}

/**
 * Dừng scheduler an toàn
 */
function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[Scheduler] Đã dừng vòng lặp scheduler.');
  }
}

module.exports = {
  loadTasks,
  saveTasks,
  startScheduler,
  stopScheduler,
  scanAndExecuteTasks,
  executeTaskById,
};

