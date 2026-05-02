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

    const contentJsPath = path.join(__dirname, 'content.js');
    const contentJsCode = fs.readFileSync(contentJsPath, 'utf8');

    // Hàm thực thi việc "bơm" code và chạy crawl
    const injectAndStart = async (targetMaxPages) => {
      await page.evaluate(({ jsCode, targetMaxPages }) => {
        // Giả lập môi trường Chrome
        window.chrome = {
          storage: { local: { set: (d, cb) => cb?.(), get: (k, cb) => cb({}), clear: () => {} } },
          runtime: {
            sendMessage: (msg, sendResponse) => {
              if (msg.action === "fetchJobHTML") {
                fetch(msg.url).then(r => r.text()).then(h => sendResponse({ success: true, html: h })).catch(() => sendResponse({ success: false }));
                return true;
              }
            }
          }
        };

        // Chặn lỗi UI
        window.createPanel = () => {};
        window.updateStatus = (t) => console.log(`[Indeed Crawler] STATUS: ${t}`);
        window.appendToTable = (j) => console.log(`[Indeed Crawler] Đã lấy: ${j.title}`);

        // Nạp code content.js
        const script = document.createElement('script');
        script.textContent = jsCode;
        document.body.appendChild(script);

        // Ghi đè cấu hình và chạy
        window.maxPages = targetMaxPages;
        if (typeof startCrawl === 'function') startCrawl();
      }, { jsCode, targetMaxPages });
    };

    const targetMaxPages = 3;
    await injectAndStart(targetMaxPages);

    // VÒNG LẶP KIỂM TRA THÔNG MINH
    let isFinished = false;
    let timeoutCounter = 0;
    const maxWaitTime = 20; // Đợi tối đa ~100 giây (20 lần * 5 giây)

    while (!isFinished && timeoutCounter < maxWaitTime) {
      await new Promise(r => setTimeout(r, 5000)); // Nghỉ 5s mỗi lần kiểm tra

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
        console.log("🔄 Phát hiện trang bị reload/chuyển trang. Đang nạp lại script...");
        await injectAndStart(targetMaxPages);
      } else {
        console.log(`⏳ Đang thu thập... Hiện có: ${status.jobCount} jobs`);
      }
      
      timeoutCounter++;
    }

    // Trích xuất kết quả
    const finalData = await page.evaluate(() => window.allJobs);
    if (finalData && finalData.length > 0) {
      fs.writeFileSync('data.json', JSON.stringify(finalData, null, 2), 'utf8');
      console.log(`✅ Hoàn thành! Thu thập được ${finalData.length} jobs.`);
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
