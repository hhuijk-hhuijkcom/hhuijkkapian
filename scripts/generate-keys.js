/**
 * Steam Depot Keys 自动生成脚本
 * 匿名登录 Steam，遍历 appid.txt 获取所有公开 depot 的解密密钥
 * 输出: depotkeys.json 和 appaccesstokens.json
 */

const SteamUser = require('steam-user');
const fs = require('fs');
const path = require('path');

const APPID_FILE = path.join(__dirname, '..', 'appid.txt');
const DEPOT_KEYS_OUT = path.join(__dirname, '..', 'depotkeys.json');
const ACCESS_TOKENS_OUT = path.join(__dirname, '..', 'appaccesstokens.json');

// 读取 appid.txt
function readAppIds() {
  if (!fs.existsSync(APPID_FILE)) {
    console.error('appid.txt 不存在！');
    process.exit(1);
  }
  const content = fs.readFileSync(APPID_FILE, 'utf-8');
  return content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !isNaN(line))
    .map(id => parseInt(id));
}

// 加载已有的密钥（支持增量更新）
function loadExisting(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      console.warn(`加载 ${filePath} 失败，将创建新文件`);
    }
  }
  return {};
}

// 延时函数
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 主流程
async function main() {
  const startIndex = parseInt(process.env.START_INDEX || '0');
  const batchSize = parseInt(process.env.BATCH_SIZE || '100'); // 每次处理100个

  const appIds = readAppIds();
  console.log(`共读取到 ${appIds.length} 个 AppID`);

  const depotKeys = loadExisting(DEPOT_KEYS_OUT);
  const accessTokens = loadExisting(ACCESS_TOKENS_OUT);

  console.log(`已有 ${Object.keys(depotKeys).length} 个 depot key`);
  console.log(`已有 ${Object.keys(accessTokens).length} 个 access token`);

  const client = new SteamUser({
    enablePicsCache: false,
    autoRelogin: false,
  });

  // 登录 Steam（匿名）
  console.log('正在匿名登录 Steam...');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('登录超时')), 30000);

    client.on('loggedOn', () => {
      clearTimeout(timeout);
      console.log('Steam 登录成功');
      resolve();
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    client.logOn({ anonymous: true });
  });

  // 处理批次
  const endIndex = Math.min(startIndex + batchSize, appIds.length);
  console.log(`处理范围: ${startIndex} - ${endIndex - 1} (共 ${endIndex - startIndex} 个)`);

  let successCount = 0;
  let failCount = 0;

  for (let i = startIndex; i < endIndex; i++) {
    const appId = appIds[i];

    try {
      // 1. 获取产品信息（找到所有 depot）
      const productInfo = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('获取产品信息超时')), 15000);

        client.getProductInfo(appId, [], false, (err, apps) => {
          clearTimeout(timeout);
          if (err) reject(err);
          else resolve(apps && apps[appId]);
        });
      });

      if (!productInfo || !productInfo.depots) {
        failCount++;
        if (i % 10 === 0) console.log(`[${i + 1}/${endIndex}] AppID ${appId}: 无 depot 信息`);
        continue;
      }

      // 2. 遍历所有 depot，获取解密密钥
      const depots = productInfo.depots;
      let depotCount = 0;

      for (const [depotId, depotInfo] of Object.entries(depots)) {
        // 跳过非数字的 depot id（如 "branches" 等）
        if (isNaN(depotId)) continue;

        // 如果已有该 depot 的密钥，跳过
        if (depotKeys[depotId]) {
          depotCount++;
          continue;
        }

        try {
          const key = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('获取 depot key 超时')), 10000);

            client.getDepotDecryptionKey(parseInt(depotId), appId, (err, result) => {
              clearTimeout(timeout);
              if (err) reject(err);
              else resolve(result);
            });
          });

          if (key && key.key) {
            // key.key 是 Buffer，转为 hex 字符串
            const hexKey = Buffer.isBuffer(key.key)
              ? key.key.toString('hex')
              : key.key;
            depotKeys[depotId] = hexKey;
            depotCount++;
          }
        } catch (e) {
          // 获取单个 depot key 失败，继续下一个
        }

        // 避免 Steam 限流
        await sleep(100);
      }

      // 3. 获取 App Access Token
      if (!accessTokens[appId]) {
        try {
          const token = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('获取 access token 超时')), 10000);

            client.getAppAccessToken(appId, (err, token) => {
              clearTimeout(timeout);
              if (err) reject(err);
              else resolve(token);
            });
          });

          if (token) {
            accessTokens[appId] = String(token);
          }
        } catch (e) {
          // 获取 access token 失败，忽略
        }
      }

      if (depotCount > 0) {
        successCount++;
        if (i % 10 === 0) {
          console.log(`[${i + 1}/${endIndex}] AppID ${appId}: 获取 ${depotCount} 个 depot key`);
        }
      } else {
        failCount++;
      }

      // 每50个保存一次（防止中途失败丢失数据）
      if ((i - startIndex + 1) % 50 === 0) {
        saveFiles(depotKeys, accessTokens);
        console.log(`已保存进度 (${i + 1}/${endIndex})`);
      }

      // 避免 Steam 限流
      await sleep(200);

    } catch (e) {
      failCount++;
      if (i % 50 === 0) {
        console.log(`[${i + 1}/${endIndex}] AppID ${appId} 失败: ${e.message}`);
      }
    }

    // 检查是否超时（GitHub Actions 限制）
    if (process.env.GITHUB_ACTIONS && i - startIndex >= batchSize - 1) {
      break;
    }
  }

  // 保存最终结果
  saveFiles(depotKeys, accessTokens);

  console.log('\n========== 完成 ==========');
  console.log(`成功: ${successCount}`);
  console.log(`失败: ${failCount}`);
  console.log(`总 depot key: ${Object.keys(depotKeys).length}`);
  console.log(`总 access token: ${Object.keys(accessTokens).length}`);

  // 登出
  client.logOff();
  process.exit(0);
}

function saveFiles(depotKeys, accessTokens) {
  fs.writeFileSync(DEPOT_KEYS_OUT, JSON.stringify(depotKeys, null, 2), 'utf-8');
  fs.writeFileSync(ACCESS_TOKENS_OUT, JSON.stringify(accessTokens, null, 2), 'utf-8');
  console.log(`已保存 depotkeys.json (${Object.keys(depotKeys).length} 条)`);
  console.log(`已保存 appaccesstokens.json (${Object.keys(accessTokens).length} 条)`);
}

// 错误处理
process.on('unhandledRejection', (err) => {
  console.error('未处理的 Promise 错误:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n接收到中断信号，正在退出...');
  process.exit(1);
});

main().catch(err => {
  console.error('运行失败:', err);
  process.exit(1);
});
