const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  console.log("Bắt đầu khởi động trình duyệt ảo...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Chuyển tiếp log từ trình duyệt về terminal GitHub
  page.on('console', msg => console.log('BROWSER:', msg.text()));

  try {
    await page.goto('https://vn.indeed.com/jobs?q=ke+toan', { waitUntil: 'networkidle' });
    console.log("Đã truy cập Indeed.");

    const contentJsPath = path.join(__dirname, 'content.js');
    const contentJsCode = fs.readFileSync(contentJsPath, 'utf8');

    // Nạp code và giả lập nhấn nút Bắt đầu
    await page.evaluate((jsCode) => {
      // Giả lập chrome storage để không lỗi
      window.chrome = { storage: { local: { set: () => {}, get: (k, cb) => cb({}) } } };
      
      const script = document.createElement('script');
      script.textContent = jsCode;
      document.body.appendChild(script);

      // Tự động gọi hàm bắt đầu
      if (typeof startCrawl === 'function') {
        startCrawl();
      }
    }, contentJsCode);

    // Đợi cho đến khi biến isCrawling chuyển về false (xong việc)
    console.log("Đang quét dữ liệu, vui lòng đợi...");
    await page.waitForFunction(() => window.isCrawling === false, { timeout: 300000 });

    // Lấy dữ liệu cuối cùng
    const results = await page.evaluate(() => window.allJobs);
    
    // Lưu kết quả vào file
    fs.writeFileSync('data.json', JSON.stringify(results, null, 2));
    console.log(`Thành công! Đã thu thập ${results.length} jobs.`);

  } catch (error) {
    console.error("Lỗi tiến trình:", error);
  } finally {
    await browser.close();
  }
})();
