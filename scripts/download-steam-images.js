const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// 配置
const OUTPUT_DIR = path.join(process.cwd(), 'hhuijk'); // 输出目录 hhuijk/{appId}/header.jpg
// 远程 appids.txt 地址（从 hhuijk-a-p-i-d 仓库获取）
const APPIDS_REMOTE_URL = 'https://cdn.jsdelivr.net/gh/hhuijk-hhuijkcom/hhuijk-a-p-i-d@main/appids.txt';
const CONCURRENCY = 5; // 并发下载数
const RETRY_TIMES = 3; // 失败重试次数
const TIMEOUT = 15000; // 超时时间(ms)

// Steam CDN 镜像（按优先级尝试）
const CDN_URLS = [
  (appId) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
  (appId) => `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/header.jpg`,
  (appId) => `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://store.steampowered.com/',
      },
      timeout: TIMEOUT,
    }, (res) => {
      if (res.statusCode === 200) {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          // 校验是否是有效图片（大于1KB）
          if (buffer.length > 1024) {
            fs.writeFileSync(destPath, buffer);
            resolve(true);
          } else {
            reject(new Error('File too small, probably invalid'));
          }
        });
      } else if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
        } else {
          reject(new Error(`HTTP ${res.statusCode} no location`));
        }
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

async function downloadWithRetry(appId, destPath) {
  for (let attempt = 0; attempt < RETRY_TIMES; attempt++) {
    for (const cdnFn of CDN_URLS) {
      const url = cdnFn(appId);
      try {
        await downloadFile(url, destPath);
        return { success: true, url };
      } catch (err) {
        // 静默失败，继续下一个CDN
      }
    }
    if (attempt < RETRY_TIMES - 1) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return { success: false };
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: TIMEOUT,
      headers: { 'User-Agent': 'hhuijk-bot' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function readAppIds() {
  try {
    console.log('从远程仓库拉取 appids.txt...');
    const content = await fetchText(APPIDS_REMOTE_URL);
    const ids = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && /^\d+$/.test(line));
    return [...new Set(ids)];
  } catch (e) {
    console.error('远程拉取失败:', e.message);
    return [];
  }
}

async function main() {
  ensureDir(OUTPUT_DIR);

  const appIds = await readAppIds();
  console.log(`读取到 ${appIds.length} 个游戏ID`);

  // 筛选需要下载的（图片不存在）
  const toDownload = [];
  for (const appId of appIds) {
    const imgPath = path.join(OUTPUT_DIR, appId, 'header.jpg');
    if (!fs.existsSync(imgPath)) {
      toDownload.push(appId);
    }
  }

  console.log(`已存在 ${appIds.length - toDownload.length} 张，待下载 ${toDownload.length} 张`);

  if (toDownload.length === 0) {
    console.log('全部图片已存在，无需下载');
    return;
  }

  // 并发下载
  let success = 0;
  let failed = 0;
  let index = 0;

  async function worker() {
    while (index < toDownload.length) {
      const currentIndex = index++;
      const appId = toDownload[currentIndex];
      const gameDir = path.join(OUTPUT_DIR, appId);
      ensureDir(gameDir);
      const imgPath = path.join(gameDir, 'header.jpg');

      const result = await downloadWithRetry(appId, imgPath);

      if (result.success) {
        success++;
      } else {
        failed++;
        // 清理空目录
        try {
          const files = fs.readdirSync(gameDir);
          if (files.length === 0) fs.rmdirSync(gameDir);
        } catch {}
      }

      if ((currentIndex + 1) % 10 === 0 || currentIndex === toDownload.length - 1) {
        console.log(`进度: ${currentIndex + 1}/${toDownload.length} | 成功: ${success} | 失败: ${failed}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, toDownload.length) }, () => worker());
  await Promise.all(workers);

  console.log(`\n下载完成！成功: ${success} 张，失败: ${failed} 张`);
}

main().catch(console.error);
