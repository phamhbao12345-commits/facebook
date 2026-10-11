/**
 * ==============================================================================
 * API ROUTER QUẢN LÝ TÁC VỤ & NHÓM FACEBOOK (RESTFUL API ENDPOINTS)
 * ==============================================================================
 * Cung cấp các endpoints giao tiếp giữa giao diện Web Dashboard và backend:
 * - GET    /api/tasks          : Lấy toàn bộ danh sách task từ tasks.json
 * - POST   /api/tasks          : Thêm task mới vào tasks.json
 * - DELETE /api/tasks/:id      : Xóa task theo ID
 * - POST   /api/tasks/:id/run  : Kích hoạt chạy task ngay lập tức bằng Puppeteer ngầm
 * - GET    /api/groups         : Lấy danh sách nhóm đã lưu từ my_groups.json
 * - GET    /api/groups/scan    : Tự động cào danh sách nhóm đã tham gia và lưu lại
 * - POST   /api/warmup/run     : Chạy phiên nuôi nick độc lập (không đăng bài)
 * - GET    /api/status         : Lấy thống kê tổng quan hệ thống và cấu hình
 */

const express = require('express');
const router = express.Router();
const { CONFIG } = require('../config/env');
const {
  loadTasks,
  saveTasks,
  executeTaskById,
} = require('../services/scheduler.service');
const {
  scanUserGroups,
  loadSavedGroups,
} = require('../services/groupScanner.service');
const {
  runStandaloneWarmup,
} = require('../services/warmup.service');
const { getLogs } = require('../services/logger.service');
const {
  checkAuthStatus,
  interactiveLogin,
  logoutSession,
} = require('../services/auth.service');
const {
  loadAccounts,
  getAccounts,
  getAccountById,
  addAccount,
  updateAccount,
  deleteAccount,
  interactiveLoginAccount,
} = require('../services/accountManager.service');

/**
 * GET /api/accounts - Lấy danh sách tài khoản kèm thống kê
 */
router.get('/accounts', (req, res) => {
  try {
    const accounts = loadAccounts();
    const stats = {
      total: accounts.length,
      active: accounts.filter((a) => a.status === 'ACTIVE').length,
      inactive: accounts.filter((a) => a.status === 'INACTIVE').length,
      totalPostsToday: accounts.reduce((sum, cur) => sum + (cur.postsToday || 0), 0),
    };
    res.json({
      success: true,
      currentMachine: CONFIG.MACHINE_NAME,
      stats,
      data: accounts,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Lỗi đọc danh sách tài khoản: ${error.message}`,
    });
  }
});

/**
 * POST /api/accounts - Tạo tài khoản Facebook mới
 */
router.post('/accounts', (req, res) => {
  try {
    const { name, dailyPostLimit } = req.body || {};
    const newAccount = addAccount({ name, dailyPostLimit });
    res.status(201).json({
      success: true,
      message: `Đã thêm tài khoản "${newAccount.name}" thành công!`,
      data: newAccount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Lỗi thêm tài khoản: ${error.message}`,
    });
  }
});

/**
 * PUT /api/accounts/:id - Cập nhật cấu hình tài khoản
 */
router.put('/accounts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updated = updateAccount(id, req.body || {});
    if (!updated) {
      return res.status(404).json({
        success: false,
        message: `Không tìm thấy tài khoản với ID: ${id}`,
      });
    }
    res.json({
      success: true,
      message: `Đã cập nhật tài khoản [${id}] thành công!`,
      data: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Lỗi cập nhật tài khoản: ${error.message}`,
    });
  }
});

/**
 * DELETE /api/accounts/:id - Xóa tài khoản
 */
router.delete('/accounts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const ok = deleteAccount(id);
    if (!ok) {
      return res.status(404).json({
        success: false,
        message: `Không tìm thấy tài khoản để xóa: ${id}`,
      });
    }
    res.json({
      success: true,
      message: `Đã xóa tài khoản [${id}] thành công!`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Lỗi xóa tài khoản: ${error.message}`,
    });
  }
});

/**
 * POST /api/accounts/:id/login - Đăng nhập Chrome tương tác riêng cho tài khoản chỉ định
 */
router.post('/accounts/:id/login', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[API] Yêu cầu mở trình duyệt đăng nhập cho tài khoản: ${id}`);
    const result = await interactiveLoginAccount(id);
    res.json(result);
  } catch (error) {
    console.error(`[API] Lỗi đăng nhập tài khoản ${req.params.id}: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * GET /api/auth/status - Kiểm tra trạng thái đăng nhập và cookie Facebook
 */
router.get('/auth/status', (req, res) => {
  try {
    const status = checkAuthStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Lỗi kiểm tra trạng thái đăng nhập: ${error.message}`,
    });
  }
});

/**
 * POST /api/auth/login - Khởi chạy mở Chrome tương tác để người dùng đăng nhập Facebook
 */
router.post('/auth/login', async (req, res) => {
  try {
    console.log('[API] Nhận yêu cầu đăng nhập Facebook thủ công...');
    const result = await interactiveLogin();
    res.json(result);
  } catch (error) {
    console.error(`[API] Lỗi trong quá trình đăng nhập: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * POST /api/auth/logout - Đăng xuất tài khoản Facebook cũ và xóa sạch dữ liệu phiên
 */
router.post('/auth/logout', async (req, res) => {
  try {
    console.log('[API] Nhận yêu cầu đăng xuất tài khoản Facebook...');
    const result = await logoutSession();
    res.json(result);
  } catch (error) {
    console.error(`[API] Lỗi khi đăng xuất: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * GET /api/logs - Lấy nhật ký thời gian thực
 */
router.get('/logs', (req, res) => {
  res.json({
    success: true,
    data: getLogs(),
  });
});

/**
 * GET /api/status - Lấy trạng thái hệ thống
 */
router.get('/status', (req, res) => {
  const tasks = loadTasks();
  const groups = loadSavedGroups();
  const authStatus = checkAuthStatus();
  const stats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === 'PENDING').length,
    running: tasks.filter((t) => t.status === 'RUNNING').length,
    completed: tasks.filter((t) => t.status === 'COMPLETED').length,
    failed: tasks.filter((t) => t.status === 'FAILED').length,
    totalGroups: groups.length,
  };

  res.json({
    success: true,
    stats,
    auth: authStatus,
    config: {
      mockMode: CONFIG.MOCK_MODE,
      headless: CONFIG.HEADLESS,
      port: CONFIG.PORT,
      hasGemini: Boolean(CONFIG.GEMINI_API_KEY),
      hasTelegram: Boolean(CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_CHAT_ID),
      hasCookies: authStatus.loggedIn,
    },
  });
});

/**
 * GET /api/tasks - Lấy toàn bộ danh sách task từ tasks.json
 */
router.get('/tasks', (req, res) => {
  try {
    const tasks = loadTasks();
    res.json({
      success: true,
      data: tasks,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Lỗi đọc danh sách tác vụ: ${error.message}`,
    });
  }
});

/**
 * POST /api/tasks - Thêm task mới vào tasks.json
 */
router.post('/tasks', (req, res) => {
  try {
    const { name, groupId, groupIds, groups: selectedGroups, content, targetTime, warmup, accountId } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp nội dung bài viết!',
      });
    }

    // Hỗ trợ chọn nhiều nhóm (groups/groupIds) hoặc 1 nhóm đơn lẻ (groupId)
    let groupList = [];
    if (Array.isArray(selectedGroups) && selectedGroups.length > 0) {
      groupList = selectedGroups.map((g) => (typeof g === 'object' ? g : { groupId: String(g), groupName: '' }));
    } else if (Array.isArray(groupIds) && groupIds.length > 0) {
      groupList = groupIds.map((id) => (typeof id === 'object' ? id : { groupId: String(id), groupName: '' }));
    } else if (groupId) {
      groupList = [{ groupId: String(groupId).trim(), groupName: '' }];
    }

    if (groupList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng chọn ít nhất 1 nhóm Facebook để đăng bài!',
      });
    }

    const tasks = loadTasks();
    const createdTasks = [];
    const baseTimestamp = Date.now();

    let formattedTime = targetTime;
    if (!formattedTime) {
      const now = new Date();
      formattedTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    } else {
      formattedTime = formattedTime.replace('T', ' ');
      if (formattedTime.length === 16) {
        formattedTime += ':00';
      }
    }

    groupList.forEach((grp, index) => {
      const gId = String(grp.groupId || grp.id || grp).trim();
      const gName = (grp.groupName || grp.name || '').trim();
      if (!gId) return;

      const newId = `task_${baseTimestamp}_${index + 1}`;
      const taskTitle = name
        ? (groupList.length > 1 ? `${name} - ${gName || gId}` : name)
        : `Đăng bài: ${gName || gId}`;

      const newTask = {
        id: newId,
        name: taskTitle.trim(),
        targetTime: formattedTime,
        status: 'PENDING',
        accountId: accountId ? String(accountId).trim() : 'AUTO',
        groupId: gId,
        groupName: gName || undefined,
        content: content.trim(),
        warmup: {
          watchVideoSeconds: parseInt(warmup?.watchVideoSeconds, 10) || 0,
          enableLike: Boolean(warmup?.enableLike),
          scrollFeedSeconds: parseInt(warmup?.scrollFeedSeconds, 10) || 0,
        },
        createdAt: new Date().toISOString(),
      };

      tasks.push(newTask);
      createdTasks.push(newTask);
      console.log(`[API] Đã tạo mới tác vụ thành công: [${newId}] ${newTask.name}`);
    });

    saveTasks(tasks);

    res.status(201).json({
      success: true,
      message: createdTasks.length > 1
        ? `Đã lên lịch đăng bài cho ${createdTasks.length} nhóm thành công!`
        : 'Đã lưu lịch trình tác vụ thành công!',
      count: createdTasks.length,
      data: createdTasks[0],
      tasks: createdTasks,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Lỗi thêm tác vụ: ${error.message}`,
    });
  }
});

/**
 * DELETE /api/tasks/:id - Xóa task theo ID
 */
router.delete('/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    const tasks = loadTasks();
    const taskIndex = tasks.findIndex((t) => t.id === id);

    if (taskIndex === -1) {
      return res.status(404).json({
        success: false,
        message: `Không tìm thấy tác vụ với ID: ${id}`,
      });
    }

    const removedTask = tasks.splice(taskIndex, 1)[0];
    saveTasks(tasks);

    console.log(`[API] Đã xóa tác vụ: [${id}] ${removedTask.name}`);

    res.json({
      success: true,
      message: `Đã xóa thành công tác vụ [${id}]!`,
      data: removedTask,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Lỗi xóa tác vụ: ${error.message}`,
    });
  }
});

/**
 * POST /api/tasks/:id/run - Kích hoạt chạy task ngay lập tức bằng Puppeteer ngầm
 */
router.post('/tasks/:id/run', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[API] Yêu cầu chạy tức thời tác vụ: ${id}`);

    // Kích hoạt chạy bất đồng bộ trong background
    executeTaskById(id).then((result) => {
      console.log(`[API] Kết quả chạy task [${id}]:`, result);
    }).catch((err) => {
      console.error(`[API] Lỗi khi chạy task [${id}]:`, err);
    });

    res.json({
      success: true,
      message: `Đã kích hoạt chạy tác vụ [${id}] trong nền! Theo dõi tiến trình trên màn hình.`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Lỗi kích hoạt tác vụ: ${error.message}`,
    });
  }
});

/**
 * GET /api/groups - Lấy danh sách nhóm đã lưu từ my_groups.json
 */
router.get('/groups', (req, res) => {
  try {
    const groups = loadSavedGroups();
    res.json({
      success: true,
      count: groups.length,
      data: groups,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Lỗi đọc danh sách nhóm: ${error.message}`,
    });
  }
});

/**
 * GET & POST /api/groups/scan - Kích hoạt quét và cập nhật lại my_groups.json
 */
const handleGroupScan = async (req, res) => {
  try {
    console.log('[API] Bắt đầu kích hoạt cào danh sách nhóm đã tham gia...');
    const groups = await scanUserGroups();

    res.json({
      success: true,
      message: `Quét thành công! Đã tìm thấy ${groups.length} nhóm.`,
      count: groups.length,
      data: groups,
    });
  } catch (error) {
    console.error(`[API] Lỗi khi quét nhóm: ${error.message}`);
    res.status(500).json({
      success: false,
      message: `Lỗi khi quét nhóm: ${error.message}`,
    });
  }
};

router.get('/groups/scan', handleGroupScan);
router.post('/groups/scan', handleGroupScan);

/**
 * POST /api/warmup/run - Chạy phiên nuôi nick độc lập (không đăng bài)
 */
router.post('/warmup/run', async (req, res) => {
  try {
    const { watchVideoSeconds, enableLike, enableShare, scrollFeedSeconds } = req.body || {};

    console.log('[API] Yêu cầu kích hoạt phiên nuôi nick độc lập...');

    // Kích hoạt chạy ngầm
    runStandaloneWarmup({
      watchVideoSeconds: parseInt(watchVideoSeconds, 10) || 60,
      enableLike: enableLike !== undefined ? Boolean(enableLike) : true,
      enableShare: Boolean(enableShare),
      scrollFeedSeconds: parseInt(scrollFeedSeconds, 10) || 30,
    }).then((result) => {
      console.log('[API] Kết quả phiên nuôi nick độc lập:', result);
    }).catch((err) => {
      console.error('[API] Lỗi phiên nuôi nick:', err);
    });

    res.json({
      success: true,
      message: 'Đã kích hoạt phiên nuôi nick độc lập thành công! Trình duyệt đang thực hiện tương tác.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Lỗi kích hoạt nuôi nick: ${error.message}`,
    });
  }
});

module.exports = router;
