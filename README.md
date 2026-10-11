# 🚀 Facebook Group Autoposter & Account Farm Manager

Hệ thống tự động hóa nuôi tài khoản Facebook, quét nhóm đã tham gia và lên lịch đăng bài thông minh với **Tự Chữa Lành Bằng AI (Gemini 2.5 Flash)** và **Báo Cáo Telegram Kèm Ảnh Chụp Màn Hình**.

---

## ✨ Tính Năng Nổi Bật

- **👥 Quản Lý Đa Tài Khoản Theo Máy (Multi-Machine / Multi-Account):**
  - Quản lý đồng thời nhiều tài khoản Facebook trên từng máy tính (`Máy 1`, `Máy 2`, `Máy 3`).
  - Tự động xoay tua tài khoản nghỉ lâu nhất (Auto Rotation).
  - Giới hạn bài đăng an toàn theo ngày (Daily Quota) chống checkpoint.
- **🔍 Tự Động Quét Nhóm (Group Scanner):**
  - Tự động cào danh sách toàn bộ các nhóm Facebook đã tham gia.
  - Chọn nhiều nhóm đăng bài cùng lúc với bộ tìm kiếm nhanh và checkbox tiện lợi.
- **🛡️ Nuôi Nick & Tương Tác Ẩn Ngầm (Headless Warmup):**
  - Chạy ẩn ngầm 100% không hiện cửa sổ làm phiền công việc.
  - Cài đặt thời gian lướt Newfeed, xem video Reels/Watch theo số giây tùy chỉnh.
  - Tự động like bài viết ngẫu nhiên theo hành vi người dùng thật.
  - Phím tắt cài đặt nhanh: Nhanh (30s), Chuẩn (60s), Nuôi kỹ (120s).
- **🤖 Trí Tuệ Nhân Tạo Tự Sửa Lỗi (Self-Healing AI):**
  - Tích hợp **Google Gemini 2.5 Flash Vision**.
  - Tự động phân tích ảnh chụp màn hình và DOM khi Facebook thay đổi giao diện để tự cập nhật selector mà không cần sửa code.
- **📸 Báo Cáo & Chụp Màn Hình Tự Động Qua Telegram:**
  - Chụp ảnh bằng chứng đăng bài thành công và gửi thẳng về bot Telegram.
  - Chụp ảnh sự cố / lỗi gửi cảnh báo tức thì.
  - Lưu trữ ảnh bằng chứng tại thư mục `screenshots/`.
- **🎨 Giao Diện Web Dashboard Đẳng Cấp:**
  - Thiết kế Dark Mode phong cách Glassmorphism.
  - Tích hợp **Tailwind CSS v3.4** mượt mà.
  - Đáp ứng (Responsive) 100% trên điện thoại di động, máy tính bảng và màn hình lớn.

---

## 🛠️ Cài Đặt & Sử Dụng

### 1. Yêu Cầu Môi Trường
- [Node.js](https://nodejs.org/) (Phiên bản v18 trở lên).
- Trình duyệt Chrome hoặc Chromium (để Puppeteer chạy tự động hóa).

### 2. Cài Đặt Dependencies
```bash
npm install
```

### 3. Cấu Hình File `.env`
Sao chép file `.env.example` thành `.env`:
```bash
cp .env.example .env
```
Cấu hình các tham số cần thiết trong `.env`:
```env
PORT=3000
MACHINE_NAME="Máy 1 (asus)"
HEADLESS=true
TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
TELEGRAM_CHAT_ID="your_telegram_chat_id"
GEMINI_API_KEY="your_gemini_api_key"
```

### 4. Khởi Chạy Hệ Thống
```bash
npm start
```
Truy cập giao diện Web Dashboard tại: **`http://localhost:3000`**

---

## 🔒 Bảo Mật & Lưu Ý Quan Trọng
- Tệp cấu hình chứa token (`.env`), cookie (`fb_cookies.json`), và dữ liệu tài khoản (`src/config/accounts.json`) đã được cấu hình trong `.gitignore` để **tuyệt đối không bị lộ lên GitHub**.
- Vui lòng không chia sẻ file `.env` hoặc `fb_cookies.json` cho bất kỳ ai.

---

## 📄 Giấy Phép
Dự án được phát triển phục vụ mục đích tự động hóa marketing và quản lý mạng xã hội an toàn, hiệu quả.
