const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log("🚀 Khởi động trình duyệt ảo...");
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'] 
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();

  // Chuyển tiếp log từ Browser về Terminal để debug
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes("[Indeed Crawler]")) {
      console.log(text);
    }
  });

  try {
    const searchUrl = 'https://vn.indeed.com/jobs?q=kế+toán';
    console.log(`🔗 Đang truy cập: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Đọc nội dung tệp content.js mà bạn đã cung cấp
    const contentJsPath = path.join(__dirname, 'content.js');
    let contentJsCode = fs.readFileSync(contentJsPath, 'utf8');

    await page.evaluate((jsCode) => {
      // 1. GIẢ LẬP MÔI TRƯỜNG CHROME
      window.chrome = {
        storage: {
          local: {
            set: (data, cb) => { if (cb) cb(); },
            get: (keys, cb) => { cb({}); },
            clear: () => {}
          }
        },
        runtime: {
          sendMessage: (msg, sendResponse) => {
            // Giả lập fetch detail để lấy lương nếu cần
            if (msg.action === "fetchJobHTML") {
              fetch(msg.url)
                .then(r => r.text())
                .then(html => sendResponse({ success: true, html }))
                .catch(() => sendResponse({ success: false }));
              return true; // Báo hiệu bất đồng bộ
            }
            if (msg.action === "saveToCSV") {
              console.log("[Indeed Crawler] Yêu cầu xuất CSV nhận được.");
            }
          }
        }
      };

      // 2. NGĂN CHẶN LỖI UI (DOM NULL)
      // Ghi đè hàm tạo giao diện để không chạy trên server
      window.createPanel = () => { console.log("[Indeed Crawler] Bỏ qua tạo giao diện Panel."); };

      // Ghi đè hàm cập nhật trạng thái (Chặn lỗi textContent of null)
      window.updateStatus = (text) => {
        console.log(`[Indeed Crawler] STATUS: ${text}`);
      };

      // Ghi đè hàm thêm vào bảng (Chặn lỗi appendChild of null)
      window.appendToTable = (job) => {
        console.log(`[Indeed Crawler] Đã thêm job: ${job.title} - ${job.company}`);
      };

      // 3. NẠP CODE CONTENT.JS VÀO TRANG
      const script = document.createElement('script');
      script.textContent = jsCode;
      document.body.appendChild(script);

      // 4. TỰ ĐỘNG CHỈNH SỐ TRANG VÀ CHẠY
      window.maxPages = 3; // Bạn có thể chỉnh số trang ở đây
      if (typeof startCrawl === 'function') {
        startCrawl();
      } else {
        console.log("[Indeed Crawler] LỖI: Không tìm thấy hàm startCrawl.");
      }
    }, contentJsCode);

    // 5. ĐỢI CHO ĐẾN KHI HOÀN THÀNH (Dựa vào biến isCrawling trong content.js)
    console.log("⏳ Đang thu thập dữ liệu...");
    
    // Đợi tối đa 10 phút, kiểm tra mỗi 5 giây
    await page.waitForFunction(() => window.isCrawling === false, { timeout: 600000 });

    // 6. TRÍCH XUẤT DỮ LIỆU CUỐI CÙNG
    const finalData = await page.evaluate(() => window.allJobs);
    
    if (finalData && finalData.length > 0) {
      const outputPath = path.join(__dirname, 'data.json');
      fs.writeFileSync(outputPath, JSON.stringify(finalData, null, 2), 'utf8');
      console.log(`✅ Thành công! Đã thu thập ${finalData.length} công việc và lưu vào data.json`);
    } else {
      console.log("❌ Không thu thập được dữ liệu nào.");
    }

  } catch (err) {
    console.error("⚠️ Lỗi trong quá trình thực thi:", err.message);
  } finally {
    await browser.close();
    console.log("🏁 Đã đóng trình duyệt.");
  }
})();
