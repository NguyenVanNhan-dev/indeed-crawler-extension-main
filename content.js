// content.js (hiển thị maxPages trong giao diện và cho phép chỉnh sửa)

let isCrawling = false;
let currentPage = 1;
let allJobs = [];
let maxPages = 1; // crawl tối đa 5 trang
let hasExported = false;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(...args) {
  console.log("[Indeed Crawler]", ...args);
}


// 1. Cải thiện hàm lấy lương ngay trên Card
function getSalaryFromCard(card) {
  const selectors = [
    ".salary-snippet-container",
    ".salary-snippet",
    ".estimated-salary",
    "span[data-testid='salary-snippet']",
    ".metadata.salary-snippet-container",
    "div.attribute_snippet" // Một số vùng chứa lương mới
  ];

  for (let selector of selectors) {
    const el = card.querySelector(selector);
    if (el && el.innerText.trim() !== "") {
      const text = el.innerText.trim();
      // Kiểm tra xem text có chứa số không để tránh lấy nhầm text "Full-time"
      if (/\d/.test(text)) return text;
    }
  }
  return "N/A";
}
function getSalaryFromText(card) {
  // Mở rộng selector để lấy toàn bộ phần mô tả tóm tắt
  const snippet = card.querySelector(".job-snippet") || 
                  card.querySelector("[data-testid='job-snippet']") ||
                  card.querySelector(".metadataContainer");

  if (snippet) {
    const text = snippet.innerText.replace(/\s+/g, ' '); // Làm sạch khoảng trắng và xuống dòng
    
    // Danh sách từ khóa mở rộng
    const keywords = ["lương", "mức lương", "thu nhập", "thỏa thuận", "cạnh tranh", "vốn", "triệu"];
    
    // Cách 1: Tách theo dấu chấm hoặc dấu phẩy để lấy câu chứa từ khóa
    const sentences = text.split(/[.;]/); 
    for (let sentence of sentences) {
      const s = sentence.toLowerCase();
      if (keywords.some(kw => s.includes(kw))) {
        return sentence.trim();
      }
    }
    
    // Cách 2: Nếu không tách được câu, kiểm tra xem text có chứa từ "Lương" không
    if (text.toLowerCase().includes("lương")) {
       return text.substring(0, 100) + "..."; // Lấy tạm một đoạn văn bản
    }
  }
  return "N/A";
}

function createPanel() {
  if (document.querySelector("#indeed-crawler-panel")) return;

  const panel = document.createElement("div");
  panel.id = "indeed-crawler-panel";
  panel.innerHTML = `
    <div id="indeed-crawler-controls">
      <button id="indeed-start-btn">Bắt Đầu Thu Thập</button>
      <button id="indeed-stop-btn">Tạm Dừng & Xuất File</button>
      <button id="indeed-reset-btn">Xóa Dữ Liệu</button>
      <label style="margin-left: 10px;">
        Số trang tối đa:
        <input type="number" id="max-pages-input" value="${maxPages}" min="1" style="width: 50px;"/>
      </label>
    </div>
    <div id="indeed-crawler-status">Chưa bắt đầu.</div>
    <div id="indeed-crawler-table-wrapper">
      <table id="indeed-crawler-table">
        <thead>
          <tr>
            <th>Company</th><th>Job Title</th><th>Link</th><th>Salary</th><th>Location</th><th>Page</th><th>Easily Apply</th><th>Date</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  document.body.appendChild(panel);

  document.getElementById("indeed-start-btn").onclick = () => {
    const inputVal = parseInt(document.getElementById("max-pages-input").value);
    if (!isNaN(inputVal) && inputVal > 0) {
      maxPages = inputVal;
      chrome.storage.local.set({ maxPages });
    }
    startCrawl();
  };

  document.getElementById("indeed-stop-btn").onclick = () => {
    if (!isCrawling && allJobs.length === 0) {
      updateStatus("Chưa có dữ liệu để xuất.");
      return;
    }
    isCrawling = false;
    chrome.storage.local.set({ isCrawling: false });
    updateStatus("Đã tạm dừng crawl và xuất file.");
    exportCSV();
  };

  document.getElementById("indeed-reset-btn").onclick = () => {
    chrome.storage.local.clear();
    allJobs = [];
    currentPage = 1;
    isCrawling = false;
    hasExported = false;
    document.querySelector("#indeed-crawler-table tbody").innerHTML = "";
    updateStatus("Đã xóa dữ liệu.");
    document.getElementById("indeed-start-btn").disabled = false;
  };
}

function updateStatus(text) {
  document.getElementById("indeed-crawler-status").textContent = text;
  log(text);
}

function appendToTable(job) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${job.company || "N/A"}</td>
    <td>${job.title || "N/A"}</td>
    <td><a href="${job.link}" target="_blank">Link</a></td>
    <td>${job.salary || "N/A"}</td>
    <td>${job.location || "N/A"}</td>
    <td>${job.page}</td>
    <td>${job.easilyApply}</td>
    <td>${job.crawledAt}</td>
  `;
  document.querySelector("#indeed-crawler-table tbody").appendChild(row);
}

//<td style="font-weight:bold; color: #2557a7;">${job.applyMethod || "N/A"}</td>

async function startCrawl() {
  if (isCrawling) return;
  isCrawling = true;
  chrome.storage.local.set({ isCrawling, maxPages });
  document.getElementById("indeed-start-btn").disabled = true;
  updateStatus("Bắt đầu crawl...");
  await crawlLoop();
}

async function crawlLoop() {
  log("Crawl loop bắt đầu tại trang", currentPage);
  const success = await crawlPage();
  if (!success && isCrawling) {
    updateStatus("Chuyển trang, sẽ tiếp tục sau reload...");
  }
}

async function waitForJobCards(timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const cards = document.querySelectorAll("div.job_seen_beacon");
      if (cards.length > 0) {
        clearInterval(interval);
        log("Đã tìm thấy", cards.length, "job cards");
        resolve(cards);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject("Timeout đợi job card");
      }
    }, 500);
  });
}

// async function crawlPage() {
//   try {
//     updateStatus(`Đang crawl trang ${currentPage}...`);
//     const jobCards = await waitForJobCards();

//     for (let i = 0; i < jobCards.length; i++) {
//       if (!isCrawling) return false;

//       const card = jobCards[i];
//       card.scrollIntoView({ behavior: 'smooth' });
//       await wait(500);

//       const titleLink = card.querySelector("h2.jobTitle a");

//       let jobKey = null;
//       if (titleLink?.href) {
//         const match = titleLink.href.match(/jk=([^&]+)/);
//         if (match) jobKey = match[1];
//       }
      
//       if (!jobKey) {
//         log('Bỏ qua card không có jobKey hợp lệ.');
//         continue;
//       }

//       const jobTitle = titleLink?.innerText?.trim() || "N/A";
//       const jobCompany = (
//         card.querySelector(".companyName") ||
//         card.querySelector("[data-testid='company-name']") ||
//         card.querySelector("span.companyName")
//       )?.innerText?.trim() || "N/A";
//       const jobLocation = (
//         card.querySelector(".companyLocation") ||
//         card.querySelector("[data-testid='text-location']")
//       )?.innerText?.trim() || "N/A";

//       const fingerprint = (jobCompany + jobTitle + jobLocation).toLowerCase().replace(/\s/g, '');

//       if (allJobs.some(job => job.fingerprint === fingerprint)) {
//         log(`Bỏ qua job trùng lặp nội dung (fingerprint): ${jobTitle}`);
//         continue;
//       }

//       let salary =
//         card.querySelector(".salary-snippet")?.innerText?.trim() ||
//         card.querySelector("span[data-testid='salary-snippet']")?.innerText?.trim() ||
//         "N/A";

//       if (salary === "N/A") { 
//         salary = await fetchJobDetail(jobKey);
//       }      

//       const job = {
//         key: jobKey,
//         fingerprint: fingerprint,
//         title: jobTitle,
//         company: jobCompany,
//         location: jobLocation,
//         salary,
//         link: titleLink ? titleLink.href : "N/A",
//         page: currentPage
//       };

//       allJobs.push(job);
//       appendToTable(job);
//       chrome.storage.local.set({ allJobs });
//     }

//     if (currentPage >= maxPages) {
//       updateStatus("Đã đạt giới hạn số trang.");
//       if (!hasExported) {
//         exportCSV();
//         hasExported = true;
//       }
//       isCrawling = false;
//       chrome.storage.local.set({ isCrawling: false });
//       return false;
//     }

//     const nextBtn = document.querySelector("a[aria-label='Next'], a[aria-label='Next Page'], a[data-testid='pagination-page-next']");

//     if (nextBtn && !nextBtn.hasAttribute("aria-disabled")) {
//       currentPage++;
//       chrome.storage.local.set({ currentPage, allJobs, isCrawling, maxPages });
//       nextBtn.scrollIntoView();
//       nextBtn.click();
//       return false;
//     } else {
//       updateStatus("Hoàn tất crawl tất cả trang.");
//       if (!hasExported) {
//         exportCSV();
//         hasExported = true;
//       }
//       isCrawling = false;
//       chrome.storage.local.set({ isCrawling: false });
//       return false;
//     }
//   } catch (err) {
//     console.error("Lỗi crawl page:", err);
//     updateStatus("Lỗi crawl: " + err);
//     return false;
//   }
// }
async function crawlPage() {
  try {
    updateStatus(`Đang crawl trang ${currentPage}...`);
    const jobCards = await waitForJobCards();

    for (let i = 0; i < jobCards.length; i++) {
      if (!isCrawling) return false;
      // --- CHUYỂN DÒNG NÀY VÀO TRONG VÒNG LẶP ---
      // Lấy thời gian chi tiết ngay tại giây phút xử lý job này
      const now = new Date();
      const crawlDate = now.getHours().toString().padStart(2, '0') + ":" + 
                        now.getMinutes().toString().padStart(2, '0') + ":" + 
                        now.getSeconds().toString().padStart(2, '0') + " " + 
                        now.toLocaleDateString('vi-VN');
      // ------------------------------------------
      const card = jobCards[i];
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await wait(1000); // Đợi UI ổn định

      const titleLink = card.querySelector("h2.jobTitle a");
      if (!titleLink) continue;

      const jobKey = titleLink.dataset.jk || titleLink.href.match(/jk=([^&]+)/)?.[1];
      const jobTitle = titleLink.innerText.trim();
      
      const jobCompany = (card.querySelector("[data-testid='company-name']") || card.querySelector(".companyName"))?.innerText.trim() || "N/A";
      const jobLocation = (card.querySelector("[data-testid='text-location']") || card.querySelector(".companyLocation"))?.innerText.trim() || "N/A";

      const metaSection = card.querySelector('[class*="mosaic-provider-jobcards"]');
      const easilyApply = metaSection && metaSection.innerText.includes("Easily apply") ? "Yes" : "No";

      const fingerprint = (jobCompany + jobTitle + jobLocation).toLowerCase().replace(/\s/g, '');
      if (allJobs.some(job => job.fingerprint === fingerprint)) continue;

      // XỬ LÝ LƯƠNG
      let salary = getSalaryFromCard(card);
      let applyMethod = "N/A";

      if (!salary || salary === "N/A" || applyMethod === "N/A") {
        updateStatus(`Đang quét Description cho: ${jobTitle.substring(0, 15)}...`);
        const detail = await fetchJobDetail(jobKey, jobTitle);
        if (salary === "N/A") salary = detail.salary;
        applyMethod = detail.applyMethod;;
      }

      const job = {
        key: jobKey,
        fingerprint,
        title: jobTitle,
        company: jobCompany,
        location: jobLocation,
        salary: salary || "N/A",
        //applyMethod: applyMethod || "N/A",
        link: titleLink.href,
        page: currentPage,
        easilyApply: easilyApply,
        crawledAt: crawlDate
      };

      allJobs.push(job);
      appendToTable(job);
      chrome.storage.local.set({ allJobs });
    }

    // Chuyển trang
    if (currentPage >= maxPages) {
      finishCrawl("Đã đạt giới hạn trang.");
      return false;
    }

    const nextBtn = document.querySelector('a[data-testid="pagination-page-next"], a[aria-label="Next Page"]');
    if (nextBtn) {
      currentPage++;
      chrome.storage.local.set({ currentPage, allJobs, isCrawling, maxPages });
      nextBtn.click();
    } else {
      finishCrawl("Hết trang.");
    }
  } catch (err) {
    updateStatus("Lỗi: " + err.message);
  }
}

function localizeApplyMethod(methodText) {
  const text = methodText.toLowerCase();
  
  if (text.includes("company site") || text.includes("site")) {
    return "Apply on Company Site";
  }
  if (text.includes("apply now") || text.includes("indeed")) {
    return "Apply Now With Indeed";
  }
  
  return methodText;
}

function finishCrawl(reason) {
  updateStatus(reason);
  if (!hasExported) {
    exportCSV();
    hasExported = true;
  }
  isCrawling = false;
  chrome.storage.local.set({ isCrawling: false });
}

async function fetchJobDetail(jobKey, jobTitle) {
  try {
    const url = `https://www.indeed.com/viewjob?jk=${jobKey}`;
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "fetchJobHTML", url }, resolve);
    });

    if (!response || !response.success) return "N/A";

    const doc = new DOMParser().parseFromString(response.html, "text/html");
    const fullDescEl = doc.querySelector("#jobDescriptionText");

    let rawMethod = "N/A";

    const applyBtn = doc.querySelector('#indeedApplyButton') || 
                     doc.querySelector('button[buttontype="primary"]') || 
                     doc.querySelector('button[contenthtml="Apply on company site"]') ||
                     doc.querySelector('[data-testid*="indeedApplyButton-test"]');
    console.log("Apply button element:", applyBtn);
    if (applyBtn) {
      rawMethod = applyBtn.getAttribute("contenthtml") || 
                  applyBtn.getAttribute("aria-label")?.replace("opens in a new tab", "").replace(/[()]/g, "").trim() || 
                  applyBtn.innerText.replace(/\n/g, ' ').trim();
    }
    console.log("Raw apply method:", rawMethod);
    let applyMethod = localizeApplyMethod(rawMethod || "N/A");


    // Lấy lương
    let salary = "N/A";
    let detectCase = "N/A";

    if (fullDescEl) {
      const lines = fullDescEl.innerText.split('\n');
      const moneyRegex = /(\d{1,3}([.,]\d{3})*|\d+)/g;

      for (let line of lines) {
        const lowerLine = line.toLowerCase().trim();
        if (lowerLine.length < 5) continue;

        // BƯỚC 1: ƯU TIÊN CAO NHẤT - TÌM SỐ TIỀN CỤ THỂ
        const matches = lowerLine.match(moneyRegex);
        if (matches && matches.some(m => m.replace(/[.,]/g, '').length >= 6)) {
          if (lowerLine.includes("lương") || lowerLine.includes("thu nhập") || lowerLine.includes("salary")) {
            salary = `${matches[0]} VNĐ`;
            detectCase = "Case 1: Specific Amount Found";
            break; // Tìm thấy số tiền cụ thể thì dừng luôn
          }
        }

        // BƯỚC 2: QUÉT CÁC DÒNG NHƯ ẢNH ANH GỬI (Thu nhập cạnh tranh, Lương tháng,...)
        if (lowerLine.includes("cạnh tranh") || lowerLine.includes("lương tháng") || lowerLine.includes("hấp dẫn") || lowerLine.includes("lương")) {
          if (salary === "N/A") { 
            salary = "Có lương";
            detectCase = "Case 2: Competitive/Attractive (Photo case)";
          }
        }

        // BƯỚC 3: NẾU GHI RÕ CHỮ THỎA THUẬN
        if (lowerLine.includes("thỏa thuận") || lowerLine.includes("negotiable")) {
          if (salary === "N/A" || salary === "Có lương") {
            salary = "Thỏa thuận";
            detectCase = "Case 3: Explicitly Negotiable";
          }
        }
      }
    }
    console.log(`[Crawl] Job: ${jobTitle.substring(0,20)} | Case: ${detectCase} | Res: ${salary}`);
    return { salary, applyMethod };
  } catch (err) {
    console.error("Lỗi fetch:", err);
    return { salary: "N/A", applyMethod: "N/A" };
  }
}
// async function fetchJobDetail(jobKey) {
//   try {
//     const url = `https://www.indeed.com/m/basecamp/viewjob?viewtype=embedded&jk=${jobKey}`;
//     const res = await fetch(url);
//     const html = await res.text();
//     const doc = new DOMParser().parseFromString(html, "text/html");

//     // Danh sách các selectors có thể chứa thông tin lương
//     const salarySelectors = [
//       "#salaryInfoAndJobType span",
//       "[data-testid='detailSalary']",
//       "div.salary-snippet-container",
//       // Thêm các selectors khác bạn tìm thấy ở đây
//     ];

//     for (const selector of salarySelectors) {
//       const element = doc.querySelector(selector);
//       if (element && element.innerText.trim()) {
//         return element.innerText.trim(); // Trả về kết quả đầu tiên tìm thấy
//       }
//     }

//     return "N/A"; // Trả về N/A nếu không tìm thấy ở bất kỳ selector nào
//   } catch (err) {
//     console.warn("Không lấy được detail cho jobKey:", jobKey, err);
//     return "N/A";
//   }
// }

function exportCSV() {
  log("Bắt đầu xuất file CSV với", allJobs.length, "job");
  const headers = ["CompanyName", "Job Title", "Link", "Salary", "Location", "Page", "Easily Apply","Date"];
  const rows = allJobs.map(j =>
    [j.company, j.title, j.link, j.salary, j.location, j.page, j.easilyApply,j.crawledAt].map(v => {
      const val = (typeof v === 'string' || typeof v === 'number') ? v.toString() : '';
      return `"${val.replace(/"/g, '""')}"`;
    }).join(",")
  );

  const csvContent = [headers.join(","), ...rows].join("\n");
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const jobCount = allJobs.length;
  const pageTitle = document.title.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 30);
  const filename = `${jobCount}_jobs_${pageTitle}.csv`;

  chrome.runtime.sendMessage({ action: "saveToCSV", url, filename });
}

chrome.storage.local.get(["allJobs", "currentPage", "isCrawling", "maxPages"], data => {
  if (Array.isArray(data.allJobs)) {
    allJobs = data.allJobs;
    data.allJobs.forEach(appendToTable);
    updateStatus(`Khôi phục ${allJobs.length} công việc đã lưu.`);
  }
  if (typeof data.currentPage === "number") {
    currentPage = data.currentPage;
  }
  if (typeof data.maxPages === "number") {
    maxPages = data.maxPages;
    const input = document.getElementById("max-pages-input");
    if (input) input.value = maxPages;
  }
  if (data.isCrawling) {
    isCrawling = true;
    waitForJobCards(15000).then(() => {
      crawlLoop();
    }).catch(err => {
      console.warn("Không thể tiếp tục vì không tìm thấy job cards:", err);
      updateStatus("Không thể tiếp tục vì không tìm thấy job cards.");
      isCrawling = false;
      chrome.storage.local.set({ isCrawling: false });
    });
  }
});

createPanel();
