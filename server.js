import express from 'express';
import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';

const app = express();
const PORT = process.env.PORT || 3000;

// Find Chromium path on Render
function getChromiumPath() {
  const paths = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ];
  for (const p of paths) {
    try {
      execSync(`test -f ${p}`);
      return p;
    } catch {}
  }
  return '/usr/bin/chromium-browser';
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Prom.ua parser is running 🚀' });
});

app.get('/parse', async (req, res) => {
  const { url } = req.query;

  if (!url || !url.includes('prom.ua/opinions/list/')) {
    return res.status(400).json({
      error: 'Передай правильну ссилку. Приклад: ?url=https://prom.ua/opinions/list/3828017'
    });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: getChromiumPath(),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'uk-UA,uk;q=0.9,ru;q=0.8' });

    const allReviews = [];
    let pageNum = 1;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    let keepGoing = true;

    while (keepGoing) {
      const pageUrl = pageNum === 1 ? url : `${url}?page=${pageNum}`;
      await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      const reviews = await page.evaluate(() => {
        const items = document.querySelectorAll('[data-qaid="opinion_item"]');
        const results = [];
        items.forEach(item => {
          const dateEl = item.querySelector('time, [data-qaid="date"]');
          const dateText = dateEl ? (dateEl.getAttribute('datetime') || dateEl.textContent.trim()) : null;
          const productLinkEl = item.querySelector('a[href*="/p"]');
          const productName = productLinkEl ? productLinkEl.textContent.trim() : null;
          const productUrl = productLinkEl ? productLinkEl.href : null;
          if (dateText && productName) {
            results.push({ dateText, productName, productUrl });
          }
        });
        return results;
      });

      if (reviews.length === 0) break;

      for (const r of reviews) {
        const parsedDate = parseDate(r.dateText);
        if (!parsedDate) continue;
        if (parsedDate < thirtyDaysAgo) { keepGoing = false; break; }
        allReviews.push({ ...r, date: parsedDate.toISOString().split('T')[0] });
      }

      pageNum++;
      if (pageNum > 20) break;
    }

    await browser.close();

    const productMap = {};
    for (const r of allReviews) {
      const key = r.productUrl || r.productName;
      if (!productMap[key]) {
        productMap[key] = { name: r.productName, url: r.productUrl, count: 0, lastDate: r.date };
      }
      productMap[key].count++;
      if (r.date > productMap[key].lastDate) productMap[key].lastDate = r.date;
    }

    const products = Object.values(productMap).sort((a, b) => b.count - a.count);
    const labeled = products.map(p => ({
      ...p,
      color: p.count >= 3 ? 'green' : p.count >= 1 ? 'yellow' : 'red',
      label: p.count >= 3 ? '🟢 Хіт' : p.count >= 1 ? '🟡 Середній' : '🔴 Слабий'
    }));

    res.json({ success: true, totalReviews: allReviews.length, period: '30 днів', products: labeled });

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function parseDate(str) {
  if (!str) return null;
  str = str.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return new Date(str);
  const dmy = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dmy) return new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`);
  const months = {
    'січня':1,'лютого':2,'березня':3,'квітня':4,'травня':5,'червня':6,
    'липня':7,'серпня':8,'вересня':9,'жовтня':10,'листопада':11,'грудня':12,
    'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
    'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12
  };
  const wordy = str.match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
  if (wordy) {
    const m = months[wordy[2].toLowerCase()];
    if (m) return new Date(`${wordy[3]}-${String(m).padStart(2,'0')}-${wordy[1].padStart(2,'0')}`);
  }
  return null;
}

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
