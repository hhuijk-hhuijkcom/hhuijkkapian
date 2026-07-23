import os
import time
import json
import requests

# ====================== 全局配置【防限流重点】 ======================
APPID_TXT_URL = "https://raw.githubusercontent.com/hhuijk-hhuijkcom/hhuijk-a-p-i-d/main/appid.txt"
ROOT_FOLDER = "hhuijk"
DONE_RECORD_FILE = "finished_appids.json"
FAILED_FILE = "failed_appid.txt"

# ⭐防限流关键：单次循环总等待秒数，建议 ≥3，想要极其稳定设为4/5
SLEEP_SEC = 3.0
USE_APPID_AS_IMAGE_NAME = False  # False=header.jpg True=appid.jpg
EXPORT_SUMMARY_JSON = True

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}
# =================================================================

def safe_filename(name: str) -> str:
    bad_chars = r'\/:*?"<>|'
    for c in bad_chars:
        name = name.replace(c, "_")
    return name.strip()

def load_finished_list():
    if os.path.exists(DONE_RECORD_FILE):
        try:
            with open(DONE_RECORD_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return set(data)
        except Exception:
            return set()
    return set()

def save_finished_list(finished_set):
    with open(DONE_RECORD_FILE, "w", encoding="utf-8") as f:
        json.dump(list(finished_set), f, ensure_ascii=False, indent=2)

def add_failed_appid(aid):
    with open(FAILED_FILE, "a", encoding="utf-8") as f:
        f.write(f"{aid}\n")

def fetch_remote_appids():
    print("🌐 正在远程拉取 appid.txt ...")
    resp = requests.get(APPID_TXT_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    lines = resp.text.splitlines()
    appids = []
    for line in lines:
        s = line.strip()
        if s.isdigit():
            appids.append(s)
    print(f"✅ 读取AppID总数：{len(appids)}")
    return appids

def get_game_name(appid):
    url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        data = r.json()
        key = str(appid)
        if data[key]["success"]:
            return data[key]["data"]["name"]
        return None
    except Exception as e:
        print(f"[{appid}] 获取名称失败: {str(e)}")
        return None

def download_image(url, save_path):
    try:
        res = requests.get(url, headers=HEADERS, timeout=20)
        if res.status_code == 200:
            with open(save_path, "wb") as f:
                f.write(res.content)
            return True
        else:
            print(f"图片HTTP状态码：{res.status_code}")
            return False
    except Exception as e:
        print(f"图片下载异常：{str(e)}")
        return False

def main():
    finished = load_finished_list()
    all_game_summary = []
    appid_list = fetch_remote_appids()

    # 清空旧失败记录（注释掉则追加写入，不清空）
    if os.path.exists(FAILED_FILE):
        os.remove(FAILED_FILE)

    total = len(appid_list)
    for idx, aid in enumerate(appid_list, 1):
        if aid in finished:
            print(f"\n⏭️ [{idx}/{total}] {aid} 已完成，跳过")
            time.sleep(SLEEP_SEC)
            continue

        print(f"\n▶️ [{idx}/{total}] 正在处理 {aid}")
        game_name = get_game_name(aid)
        time.sleep(SLEEP_SEC / 2)  # 获取信息后短暂休息

        if not game_name:
            print(f"❌ {aid} 无效AppID，记入失败列表")
            add_failed_appid(aid)
            time.sleep(SLEEP_SEC)
            continue

        folder = os.path.join(ROOT_FOLDER, aid)
        os.makedirs(folder, exist_ok=True)
        safe_name = safe_filename(game_name)

        # TXT文本
        txt_path = os.path.join(folder, f"{safe_name}.txt")
        if not os.path.exists(txt_path):
            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(f"appid = {aid}\n游戏名称 = {game_name}")
            print(f"📄 生成文本 | {game_name}")
        else:
            print(f"📄 文本已存在，跳过")

        # 图片
        img_url = f"https://cdn.akamai.steamstatic.com/steam/apps/{aid}/header.jpg"
        if USE_APPID_AS_IMAGE_NAME:
            img_filename = f"{aid}.jpg"
        else:
            img_filename = "header.jpg"
        img_path = os.path.join(folder, img_filename)

        if not os.path.exists(img_path):
            dl_ok = download_image(img_url, img_path)
            time.sleep(SLEEP_SEC / 2)
            if dl_ok:
                print(f"🖼️ 图片下载成功")
            else:
                print(f"🖼️ 图片下载失败，写入失败列表")
                add_failed_appid(aid)
                continue
        else:
            print(f"🖼️ 图片已存在，跳过")

        all_game_summary.append({
            "appid": aid,
            "name": game_name,
            "folder": folder
        })

        finished.add(aid)
        save_finished_list(finished)
        time.sleep(SLEEP_SEC)  # 本轮完整结束强制休眠

    if EXPORT_SUMMARY_JSON and all_game_summary:
        with open("all_game_list.json", "w", encoding="utf-8") as f:
            json.dump(all_game_summary, f, ensure_ascii=False, indent=2)
        print("\n📋 汇总清单已保存 all_game_list.json")

    print("\n🎉 本轮任务执行完毕！")

if __name__ == "__main__":
    main()
