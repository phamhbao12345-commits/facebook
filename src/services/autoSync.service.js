/**
 * ==============================================================================
 * DỊCH VỤ TỰ ĐỘNG ĐẨY CODE LÊN GITHUB (AUTO-SYNC GIT WATCHER SERVICE)
 * ==============================================================================
 * 1. Tự động lắng nghe thay đổi file trong thư mục `src/`, `public/`, `README.md`.
 * 2. Tự động loại trừ các file dữ liệu nhạy cảm hoặc log (accounts.json, tasks.json).
 * 3. Gom các lần Save (Debounce 15 giây) để không tạo quá nhiều commit thừa.
 * 4. Tự động chạy `git add`, `git commit` và `git push origin main`.
 * 5. Báo cáo trực tiếp lên Console để người dùng theo dõi trạng thái.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../../');
const MIN_GIT_PATH = path.join(process.env.LOCALAPPDATA || '', 'MinGit', 'cmd', 'git.exe');
const GIT_CMD = fs.existsSync(MIN_GIT_PATH) ? `"${MIN_GIT_PATH}"` : 'git';

// Các thư mục và file bỏ qua không kích hoạt push
const IGNORED_PATTERNS = [
  'node_modules',
  '.git',
  '.browser_session',
  'screenshots',
  'accounts.json',
  'tasks.json',
  'my_groups.json',
  '.env',
  'fb_cookies.json',
  '.log'
];

let syncTimer = null;
let isSyncing = false;

function shouldIgnore(filePath) {
  if (!filePath) return true;
  const normalized = filePath.replace(/\\/g, '/');
  return IGNORED_PATTERNS.some(pattern => normalized.includes(pattern));
}

function runGitCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: ROOT_DIR }, (error, stdout, stderr) => {
      if (error) {
        return reject({ error, stderr: stderr || stdout });
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Thực hiện đẩy commit lên GitHub
 */
async function performPush() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    // 1. Kiểm tra có thay đổi nào cần commit không
    const status = await runGitCommand(`${GIT_CMD} status --porcelain`);
    if (!status) {
      isSyncing = false;
      return;
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false });
    const dateStr = now.toLocaleDateString('vi-VN');

    console.log(`\n[AutoSync] 🔄 Phát hiện thay đổi mã nguồn! Đang tự động gom và đẩy lên GitHub...`);

    // 2. Add và Commit
    await runGitCommand(`${GIT_CMD} add .`);
    const commitMsg = `auto: Cập nhật mã nguồn lúc ${timeStr} ${dateStr}`;
    await runGitCommand(`${GIT_CMD} commit -m "${commitMsg}"`);

    // 3. Push lên GitHub
    await runGitCommand(`${GIT_CMD} push origin main`);

    console.log(`[AutoSync] 🚀 THÀNH CÔNG: Đã đẩy bản cập nhật lên GitHub!`);
    console.log(`[AutoSync] 🌐 Render sẽ tự động cập nhật lại trang web trong khoảng 1-2 phút.\n`);
  } catch (err) {
    console.warn(`[AutoSync] ⚠️ Gặp sự cố khi tự động đẩy lên GitHub: ${err.stderr || err.error?.message || err}`);
  } finally {
    isSyncing = false;
  }
}

/**
 * Kích hoạt đếm ngược 15 giây sau lần lưu file cuối cùng
 */
function triggerDebouncedSync(changedFile) {
  if (shouldIgnore(changedFile)) return;

  if (syncTimer) {
    clearTimeout(syncTimer);
  }

  syncTimer = setTimeout(() => {
    performPush();
  }, 15000); // Đợi 15 giây sau khi dừng gõ / lưu file
}

/**
 * Khởi động Watcher theo dõi thư mục
 */
function startAutoSyncWatcher() {
  console.log('[AutoSync] 🟢 Đã kích hoạt Auto-Deploy: Mọi thay đổi code khi bấm Lưu (Ctrl+S) sẽ tự động đẩy lên GitHub sau 15s.');

  const watchDirs = [
    path.join(ROOT_DIR, 'src'),
    path.join(ROOT_DIR, 'public')
  ];

  watchDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      try {
        fs.watch(dir, { recursive: true }, (eventType, filename) => {
          if (filename) {
            triggerDebouncedSync(filename);
          }
        });
      } catch (err) {
        console.warn(`[AutoSync] Không thể theo dõi thư mục ${dir}: ${err.message}`);
      }
    }
  });

  // Theo dõi file README.md
  const readmePath = path.join(ROOT_DIR, 'README.md');
  if (fs.existsSync(readmePath)) {
    try {
      fs.watch(readmePath, () => triggerDebouncedSync('README.md'));
    } catch (_) {}
  }
}

module.exports = {
  startAutoSyncWatcher,
  performPush
};
