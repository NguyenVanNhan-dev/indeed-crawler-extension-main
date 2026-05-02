const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  // 1. Khởi tạo trình duyệt
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 2. Truy cập Indeed
  await page.goto('https://vn.indeed.com/jobs?q=ke+toan'); 
  console.log("Đã truy cập Indeed...");

  // 3. Đọc nội dung file content.js của bạn
  const contentJsPath = path.join(__dirname, 'content.js');
  const contentJsCode = fs.readFileSync(contentJsPath, 'utf8');

  // 4. "Bơm" code vào trang web và thực thi hàm crawlPage
  // Lưu ý: Chúng ta cần định nghĩa các biến môi trường mà extension thường có
  await page.evaluate((jsCode) => {
    // Giả lập các biến global nếu code của bạn yêu cầu
    window.allJobs = [];
    window.currentPage = 1;
    window.maxPages = 2; // Bạn có thể chỉnh lại
    window.isCrawling = true;
    
    // Giả lập hàm updateStatus để không bị lỗi console
    window.updateStatus = (msg) => console.log("Status:", msg);
    window.appendToTable = (job) => console.log("Đã lấy job:", job.title);
    
    // Giả lập chrome.storage.local để code không bị crash
    window.chrome = {
      storage: {
        local: {
          set: (data) => { console.log("Đã lưu vào storage ảo"); }
        }
      }
    };

    // Thực thi toàn bộ code trong content.js
    const script = document.createElement('script');
    script.textContent = jsCode;
    document.body.appendChild(script);
  }, contentJsCode);

  // 5. Gọi hàm crawlPage() từ trong content.js
  await page.evaluate(async () => {
    if (typeof crawlPage === 'function') {
      await crawlPage();
    }
  });

  // 6. Lấy dữ liệu allJobs sau khi crawl xong
  const results = await page.evaluate(() => window.allJobs);
  
  // 7. Lưu kết quả
  fs.writeFileSync('crawled_results.json', JSON.stringify(results, null, 2));
  console.log(`Hoàn thành! Đã lưu ${results.length} jobs.`);

  await browser.close();
})();
