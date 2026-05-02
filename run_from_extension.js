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

  // Chuyển tiếp log từ Browser về Terminal
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes("[Indeed Crawler]")) console.log(text);
  });

  try {
    const searchUrl = 'https://vn.indeed.com/jobs?q=kế+toán';
    console.log(`🔗 Đang truy cập: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Đọc nội dung tệp content.js
    const contentJsPath = path.join(__dirname, 'content.js');
    const contentJsCode = fs.readFileSync(contentJsPath, 'utf8');

    // Hàm thực thi việc "bơm" code và chạy crawl
    const injectAndStart = async (targetMaxPages) => {
      // TRUYỀN contentJsCode VÀO TRÌNH DUYỆT QUA THAM SỐ THỨ 2
      await page.evaluate(({ code, targetMaxPages }) => {
        // Giả lập môi trường Chrome để tránh crash code trong content.js
        window.chrome = {
          storage: { 
            local: { 
              set: (d, cb) => {
                if (d.allJobs) window.allJobs = d.allJobs; // Đồng bộ dữ liệu
                cb?.(); 
              }, 
              get: (k, cb) => cb({}), 
              clear: () => {} 
            } 
          },
          runtime: {
            sendMessage: (msg, sendResponse) => {
              if (msg.action === "fetchJobHTML") {
                fetch(msg.url)
                  .then(r => r.text())
                  .then(h => sendResponse({ success: true, html: h }))
                  .catch(() => sendResponse({ success: false }));
                return true;
              }
            }
          }
        };

        // Chặn lỗi UI khi tìm các phần tử panel không tồn tại[cite: 1]
        window.createPanel = () => {};
        window.updateStatus = (t) => console.log(`[Indeed Crawler] STATUS: ${t}`);
        window.appendToTable = (j) => console.log(`[Indeed Crawler] Đã lấy: ${j.title}`);

        // Nạp code content.js vào document[cite: 1]
        const script = document.createElement('script');
        script.textContent = code;
        document.body.appendChild(script);

        // Ghi đè cấu hình số trang và kích hoạt hàm crawl[cite: 1]
        window.maxPages = targetMaxPages;
        if (typeof startCrawl === 'function') {
          startCrawl();
        }
      }, { code: contentJsCode, targetMaxPages });
    };

    const targetMaxPages = 3;
    await injectAndStart(targetMaxPages);

    // VÒNG LẶP KIỂM TRA TRẠNG THÁI
    let isFinished = false;
    let timeoutCounter = 0;
    const maxWaitTime = 40; // Đợi tối đa ~200 giây

    while (!isFinished && timeoutCounter < maxWaitTime) {
      await new Promise(r => setTimeout(r, 5000));

      const status = await page.evaluate(() => {
        return {
          isCrawling: window.isCrawling,
          hasVars: typeof window.allJobs !== 'undefined',
          jobCount: window.allJobs ? window.allJobs.length : 0
        };
      }).catch(() => ({ isCrawling: null, hasVars: false }));

      if (status.isCrawling === false) {
        console.log("✅ Script báo cáo đã hoàn thành.");
        isFinished = true;
      } else if (!status.hasVars) {
        console.log("🔄 Phát hiện chuyển trang. Đang nạp lại script...");
        await injectAndStart(targetMaxPages);
      } else {
        console.log(`⏳ Đang quét trang... Hiện thu được: ${status.jobCount} jobs`);
      }
      
      timeoutCounter++;
    }

    // Trích xuất kết quả từ biến window.allJobs trong trình duyệt[cite: 1]
    const finalData = await page.evaluate(() => window.allJobs);
    if (finalData && finalData.length > 0) {
      fs.writeFileSync('data.json', JSON.stringify(finalData, null, 2), 'utf8');
      console.log(`✅ Hoàn thành! Đã lưu ${finalData.length} jobs vào data.json.`);
    } else {
      console.log("❌ Không thu thập được dữ liệu.");
    }

  } catch (err) {
    console.error("⚠️ Lỗi:", err.message);
  } finally {
    await browser.close();
    console.log("🏁 Kết thúc.");
  }
})();
