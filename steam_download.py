import os
import time
import requests

APPID_TXT_URL = "https://raw.githubusercontent.com/hhuijk-hhuijkcom/hhuijk-a-p-i-d/main/appid.txt"
SLEEP_SEC = 3.2  # 低速防429
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
}

def fetch_remote_appids():
    print("🌐 拉取appid.txt")
    resp = requests.get(APPID_TXT_URL, headers=HEADERS, timeout=30)
    lines = resp.text.splitlines()
    appids = [s.strip() for s in lines if s.strip().isdigit()]
    print(f"原始读取AppID总数：{len(appids)}")
    return appids

def get_game_full_info(appid):
    url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        data = r.json()
        key = str(appid)
        if data[key]["success"]:
            return data[key]["data"]
        return None
    except Exception as e:
        print(f"[{appid}] 查询异常：{e}")
        return None

def is_cn_locked(game_data) -> bool:
    packages = game_data.get("packages", [])
    if not packages:
        return False
    for pkg_id in packages:
        pkg_info = game_data.get("package_groups", {}).get(str(pkg_id))
        if not pkg_info:
            continue
        allow = pkg_info.get("allow_countries", "")
        deny = pkg_info.get("deny_countries", "")
        allow_list = allow.split(",") if allow else []
        deny_list = deny.split(",") if deny else []
        if "CN" in deny_list:
            return True
        if len(allow_list) > 0 and "CN" not in allow_list:
            return True
    return False

def is_valid_game(game_data):
    """筛选：只保留正式游戏本体，剔除Demo/DLC/软件/捆绑包"""
    app_type = game_data.get("type","")
    # 只保留game类型本体
    if app_type != "game":
        return False
    # 排除demo标记
    if game_data.get("is_demo", False):
        return False
    return True

def main():
    appid_list = fetch_remote_appids()
    locked_game = []
    unlocked_game = []
    invalid_type = [] # DLC、Demo、软件等
    query_fail = []

    for idx, aid in enumerate(appid_list,1):
        print(f"\n[{idx}/{len(appid_list)}] 查询 {aid}")
        info = get_game_full_info(aid)
        time.sleep(SLEEP_SEC)

        if not info:
            query_fail.append(aid)
            continue

        if not is_valid_game(info):
            invalid_type.append((aid, info["name"], info["type"]))
            print(f"⏭️ {aid} [{info['name']}] 类型非正式游戏，跳过")
            continue

        lock_status = is_cn_locked(info)
        if lock_status:
            locked_game.append((aid, info["name"]))
            print(f"🔒 锁国区本体：{info['name']}")
        else:
            unlocked_game.append((aid, info["name"]))
            print(f"✅ 国区可购买本体：{info['name']}")

    # 导出清单
    with open("locked_game_本体清单.txt","w",encoding="utf-8") as f:
        for aid,name in locked_game:
            f.write(f"{aid} | {name}\n")
    with open("unlocked_game_本体清单.txt","w",encoding="utf-8") as f:
        for aid,name in unlocked_game:
            f.write(f"{aid} | {name}\n")
    with open("invalid_类型过滤.txt","w",encoding="utf-8") as f:
        for aid,name,t in invalid_type:
            f.write(f"{aid} | {name} | type:{t}\n")
    with open("query_failed.txt","w",encoding="utf-8") as f:
        for aid in query_fail:
            f.write(f"{aid}\n")

    print("\n====================统计汇总====================")
    print(f"原始AppID总量：{len(appid_list)}")
    print(f"❌ 过滤项(Demo/DLC/软件)：{len(invalid_type)}")
    print(f"⚠️ 查询失败AppID：{len(query_fail)}")
    print(f"🎮 有效正式游戏本体总数：{len(locked_game)+len(unlocked_game)}")
    print(f"🔒 锁国区正式游戏本体：{len(locked_game)}")
    print(f"✅ 国区可购买正式游戏本体：{len(unlocked_game)}")
    print("==================================================")
    print("清单文件已全部生成！")

if __name__ == "__main__":
    main()
