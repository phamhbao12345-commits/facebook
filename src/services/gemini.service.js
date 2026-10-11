/**
 * ==============================================================================
 * DỊCH VỤ TỰ ĐỘNG CHỮA LÀNH SELECTOR BẰNG GEMINI 2.5 FLASH (SELF-HEALING AI)
 * ==============================================================================
 * Sử dụng SDK chính thức @google/genai và mô hình đa phương thức gemini-2.5-flash
 * để phân tích ảnh chụp màn hình khi selector bị hỏng hoặc giao diện thay đổi,
 * từ đó trả về selector CSS mới chính xác kèm lý do kỹ thuật.
 */

const { GoogleGenAI } = require('@google/genai');
const { CONFIG } = require('../config/env');

let aiClient = null;

/**
 * Khởi tạo client Google GenAI
 * @returns {GoogleGenAI|null}
 */
function getGenAIClient() {
  if (!CONFIG.GEMINI_API_KEY) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: CONFIG.GEMINI_API_KEY });
  }
  return aiClient;
}

/**
 * Phân tích ảnh chụp màn hình khi gặp lỗi và trả về selector mới dưới dạng JSON
 * @param {string} screenshotBase64 - Dữ liệu ảnh chụp màn hình dạng chuỗi Base64
 * @param {string} failedSelector - Selector hiện tại đang bị lỗi
 * @param {string} errorMsg - Thông điệp lỗi chi tiết từ Puppeteer
 * @returns {Promise<string|null>} Trả về chuỗi selector mới để thử lại, hoặc null nếu không thành công
 */
async function healSelector(screenshotBase64, failedSelector, errorMsg) {
  const client = getGenAIClient();

  if (!client) {
    console.warn('[Gemini] Cảnh báo: Chưa cấu hình GEMINI_API_KEY. Tính năng Self-Healing bằng AI bị bỏ qua.');
    return null;
  }

  console.log(`[Gemini] Kích hoạt Self-Healing (Model: gemini-2.5-flash) cho selector lỗi: "${failedSelector}"`);

  const promptText = `
Bạn là một Senior Automation Engineer chuyên gia Puppeteer và Facebook DOM.
Hệ thống vừa gặp sự cố khi tương tác với một phần tử trên giao diện web:
- Selector bị lỗi: "${failedSelector}"
- Thông báo lỗi Puppeteer: "${errorMsg}"

Nhiệm vụ của bạn:
1. Phân tích ảnh chụp màn hình đính kèm (base64 PNG) để xác định vị trí thực tế của phần tử mục tiêu (ví dụ: nút Đăng bài / Post button, hoặc ô soạn thảo).
2. Đề xuất một CSS selector thay thế tối ưu nhất, có độ tin cậy và khả năng click thành công cao nhất trong Puppeteer.

QUY TẮC BẮT BUỘC: Bạn PHẢI trả về DUY NHẤT một chuỗi JSON hợp lệ tuân thủ chính xác cấu trúc sau, không kèm bất kỳ giải thích ngoài JSON:
{
  "suggested_selector": "string (CSS selector chuẩn, ví dụ: button[aria-label='Đăng'], #btn-post, div[role='button']...)",
  "reason": "string (giải thích ngắn gọn lý do chọn selector này)"
}
`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: screenshotBase64,
              },
            },
            {
              text: promptText,
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      },
    });

    const rawResponse = (response && response.text) ? response.text.trim() : '';
    if (!rawResponse) {
      console.warn('[Gemini] Không nhận được nội dung phản hồi từ mô hình.');
      return null;
    }

    // Làm sạch chuỗi trước khi parse JSON (loại bỏ markdown block nếu có)
    const cleanedJson = rawResponse
      .replace(/^```json/i, '')
      .replace(/^```/i, '')
      .replace(/```$/i, '')
      .trim();

    const result = JSON.parse(cleanedJson);
    const suggestedSelector = result.suggested_selector;
    const reason = result.reason || 'Được tối ưu bởi Gemini 2.5 Flash';

    if (suggestedSelector && typeof suggestedSelector === 'string') {
      console.log(`[Gemini] Self-Healing đề xuất selector mới: "${suggestedSelector}"`);
      console.log(`[Gemini] Lý do: ${reason}`);
      return suggestedSelector.trim();
    }

    console.warn('[Gemini] JSON trả về không có suggested_selector hợp lệ:', result);
    return null;
  } catch (err) {
    console.error(`[Gemini] Lỗi trong quá trình Self-Healing: ${err.message}`);
    return null;
  }
}

module.exports = {
  healSelector,
};
