"""Cover art fetcher — VNDB, DLsite, web search, and exe icon extraction."""

import configparser
import httpx
import io
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Optional
from urllib.parse import quote_plus

_data_dir = os.environ.get("GT_DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
COVERS_DIR = os.path.join(_data_dir, "covers")
VNDB_API = "https://api.vndb.org/kana/vn"
DLSITE_API = "https://www.dlsite.com/maniax/api/=/product.json"

# DLsite product ID pattern
_RE_DLSITE_ID = re.compile(r"[RBV]J\d{6,8}", re.IGNORECASE)

import random as _random

_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
]


def _headers() -> dict:
    return {
        "User-Agent": _random.choice(_USER_AGENTS),
        "Accept-Language": "ja,ko;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    }



# ─── Game metadata extraction ───

def extract_game_metadata(game_path: str) -> dict:
    """Extract real title and developer from game files.
    Returns {title, developer, dlsite_id}."""
    p = Path(game_path)
    title = ""
    developer = ""
    dlsite_id = ""

    # 1. DLsite ID from folder/readme
    dlsite_id = detect_dlsite_id(game_path) or ""

    # 2. RPG Maker MV/MZ: data/System.json or www/data/System.json
    for sys_path in [p / "data" / "System.json", p / "www" / "data" / "System.json"]:
        if sys_path.is_file():
            try:
                data = json.loads(sys_path.read_text(encoding="utf-8"))
                t = data.get("gameTitle", "")
                if t:
                    title = t
            except Exception:
                pass
            break

    # 3. RPG Maker XP/VX/Ace: Game.ini
    for ini_name in ["Game.ini", "game.ini"]:
        ini_path = p / ini_name
        if ini_path.is_file():
            try:
                cp = configparser.ConfigParser()
                cp.read(str(ini_path), encoding="utf-8")
                t = cp.get("Game", "Title", fallback="")
                if t:
                    title = t
            except Exception:
                pass
            break

    # 4. readme.txt — extract title and developer (try shift_jis, then utf-8)
    for fname in ["readme.txt", "README.txt", "はじめに.txt"]:
        fpath = p / fname
        if fpath.is_file():
            content = ""
            for enc in ["shift_jis", "utf-8", "cp932", "euc-jp"]:
                try:
                    content = fpath.read_text(encoding=enc, errors="strict")
                    break
                except (UnicodeDecodeError, UnicodeError):
                    continue
            if not content:
                content = fpath.read_text(encoding="utf-8", errors="replace")

            # Extract developer: (C)Developer or ©Developer or (c)Developer
            dev_match = re.search(r"(?:\(C\)|©)\s*(.+?)[\r\n]", content, re.IGNORECASE)
            if dev_match:
                dev_text = dev_match.group(1).strip()
                # Clean: remove year prefixes like "2017-2018 "
                dev_text = re.sub(r"^\d{4}[-–]\d{4}\s*", "", dev_text)
                dev_text = re.sub(r"^\d{4}\s*", "", dev_text)
                if dev_text and len(dev_text) < 50:
                    developer = dev_text

            # Extract title: first non-empty non-separator line after separator
            lines = content.split("\n")
            for i, line in enumerate(lines):
                line = line.strip()
                if not line or line.startswith("=") or line.startswith("-"):
                    continue
                # Skip lines that look like metadata
                if any(k in line for k in ["はじめ", "readme", "説明", "○", "●"]):
                    continue
                # First substantial line is likely the title
                cleaned = re.sub(r"\(ver[\d.]+\)", "", line).strip()
                cleaned = re.sub(r"ver[\d.]+", "", cleaned).strip()
                if cleaned and len(cleaned) < 60 and not title:
                    title = cleaned
                break
            break

    return {"title": title, "developer": developer, "dlsite_id": dlsite_id}


def extract_local_cover(game_path: str, save_path: str) -> bool:
    """Try to find a local cover image in the game folder.
    Checks: icon/icon.png, www/icon/icon.png (RPG Maker)."""
    try:
        from PIL import Image

        p = Path(game_path)
        candidates = [
            p / "icon" / "icon.png",
            p / "www" / "icon" / "icon.png",
        ]

        for img_path in candidates:
            if img_path.is_file():
                img = Image.open(str(img_path))
                # Convert to RGB
                if img.mode in ("RGBA", "P", "LA"):
                    bg = Image.new("RGB", img.size, (20, 19, 18))
                    if img.mode == "P":
                        img = img.convert("RGBA")
                    bg.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
                    img = bg
                elif img.mode != "RGB":
                    img = img.convert("RGB")

                # Upscale small icons to at least 256px
                if img.size[0] < 256:
                    scale = 256 // img.size[0] + 1
                    img = img.resize(
                        (img.size[0] * scale, img.size[1] * scale),
                        Image.NEAREST,
                    )

                os.makedirs(os.path.dirname(save_path), exist_ok=True)
                img.save(save_path, "JPEG", quality=90)
                return True
    except Exception:
        pass
    return False


def extract_exe_icon(exe_path: str, save_path: str) -> bool:
    """Extract icon from exe and save as PNG. Returns True on success."""
    try:
        import icoextract
        from PIL import Image

        extractor = icoextract.IconExtractor(exe_path)
        # Save to temp ico first
        with tempfile.NamedTemporaryFile(suffix=".ico", delete=False) as tmp:
            tmp_path = tmp.name
        extractor.export_icon(tmp_path, num=0)

        img = Image.open(tmp_path)
        # Find largest frame
        max_w = 0
        best = img.copy()
        for i in range(getattr(img, "n_frames", 1)):
            img.seek(i)
            if img.size[0] > max_w:
                max_w = img.size[0]
                best = img.copy()

        # Convert to RGB and save as JPEG
        if best.mode in ("RGBA", "P", "LA"):
            bg = Image.new("RGB", best.size, (20, 19, 18))
            if best.mode == "P":
                best = best.convert("RGBA")
            bg.paste(best, mask=best.split()[-1] if best.mode == "RGBA" else None)
            best = bg
        elif best.mode != "RGB":
            best = best.convert("RGB")

        # Upscale if too small (< 200px)
        if best.size[0] < 200:
            scale = 200 // best.size[0] + 1
            best = best.resize((best.size[0] * scale, best.size[1] * scale), Image.NEAREST)

        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        best.save(save_path, "JPEG", quality=90)

        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return True
    except Exception:
        return False


# ─── API searches ───

async def search_vndb(title: str, limit: int = 5) -> list[dict]:
    """Search VNDB for visual novels matching title (fuzzy search)."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(VNDB_API, json={
                "filters": ["search", "=", title],
                "fields": "id,title,developers{id,name},image{id,url,sexual,violence,thumbnail,thumbnail_dims}",
                "sort": "searchrank",
                "results": limit,
            })
            if resp.status_code != 200:
                return []
            data = resp.json()
            results = []
            for vn in data.get("results", []):
                img = vn.get("image")
                if not img or not img.get("url"):
                    continue
                developer = ""
                devs = vn.get("developers") or []
                if devs:
                    developer = devs[0].get("name", "")
                results.append({
                    "vndb_id": vn["id"],
                    "title": vn.get("title", ""),
                    "cover_url": img["url"],
                    "thumbnail_url": img.get("thumbnail", img["url"]),
                    "sexual": img.get("sexual", 0),
                    "violence": img.get("violence", 0),
                    "developer": developer,
                })
            return results
    except Exception:
        return []


async def fetch_dlsite_product(product_id: str) -> Optional[dict]:
    """Fetch DLsite product info by RJ/BJ/VJ ID."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(DLSITE_API, params={
            "workno": product_id.upper(),
            "locale": "ko-KR",
        })
        if resp.status_code != 200:
            return None
        data = resp.json()
        if not data or not isinstance(data, list) or len(data) == 0:
            return None
        product = data[0]
        image_main = product.get("image_main", {})
        cover_url = image_main.get("url", "")
        if cover_url and not cover_url.startswith("http"):
            cover_url = f"https:{cover_url}"
        return {
            "dlsite_id": product_id.upper(),
            "title": product.get("work_name", ""),
            "cover_url": cover_url,
            "maker": product.get("maker_name", ""),
        }


def detect_dlsite_id(game_path: str) -> Optional[str]:
    """Scan game folder (and parent) for DLsite product ID."""
    for p in [Path(game_path), Path(game_path).parent]:
        match = _RE_DLSITE_ID.search(p.name)
        if match:
            return match.group().upper()

    for fname in ["readme.txt", "README.txt", "readme.html", "はじめに.txt", "情報.txt"]:
        fpath = os.path.join(game_path, fname)
        if os.path.isfile(fpath):
            for enc in ["shift_jis", "utf-8", "cp932"]:
                try:
                    with open(fpath, "r", encoding=enc, errors="strict") as f:
                        content = f.read(4096)
                    match = _RE_DLSITE_ID.search(content)
                    if match:
                        return match.group().upper()
                    break
                except (UnicodeDecodeError, UnicodeError):
                    continue
    return None


async def search_dlsite(query: str, limit: int = 5) -> list[dict]:
    """Search DLsite by keyword. Tries ko-KR first, then ja-JP fallback."""
    results = []
    for locale in ("ko-KR", "ja-JP"):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(DLSITE_API, params={
                    "keyword": query,
                    "per_page": limit,
                    "locale": locale,
                })
                if resp.status_code != 200:
                    continue
                data = resp.json()
                if not isinstance(data, list):
                    continue
                seen_ids = {r["dlsite_id"] for r in results}
                for p in data:
                    wno = p.get("workno", "")
                    if wno in seen_ids:
                        continue
                    image_main = p.get("image_main", {})
                    cover_url = image_main.get("url", "")
                    if cover_url and not cover_url.startswith("http"):
                        cover_url = f"https:{cover_url}"
                    if not cover_url:
                        continue
                    results.append({
                        "dlsite_id": wno,
                        "title": p.get("work_name", ""),
                        "cover_url": cover_url,
                        "maker": p.get("maker_name", ""),
                    })
                if results:
                    break
        except Exception:
            continue
    return results[:limit]


async def search_itch(query: str, limit: int = 5) -> list[dict]:
    """Search itch.io for games and extract cover images."""
    encoded_q = quote_plus(query)
    url = f"https://itch.io/search?q={encoded_q}"

    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        resp = await client.get(url, headers=_headers())
        if resp.status_code != 200:
            return []

    results = []
    # Parse game cells: extract game_id, href, cover image, title
    cells = re.findall(
        r'data-game_id="(\d+)"[^>]*class="game_cell[^"]*has_cover[^"]*".*?'
        r'href="(https://[^"]+\.itch\.io/[^"]+)".*?'
        r'data-lazy_src="([^"]+)".*?'
        r'class="title game_link">([^<]+)',
        resp.text, re.DOTALL,
    )
    for game_id, href, img_url, title in cells:
        if len(results) >= limit:
            break
        results.append({
            "url": img_url,
            "thumbnail_url": img_url,
            "title": title.strip(),
            "source": "itch",
            "page_url": href,
        })

    return results


_SKIP_DOMAINS = {"gstatic.com", "google.com", "googleapis.com", "schema.org",
                  "googleusercontent.com", "w3.org"}

# Game-related sites get priority in search results
_GAME_SITE_PRIORITY = {
    "itch.io": 3, "img.itch.zone": 3,
    "dlsite.com": 3, "dlsite.jp": 3,
    "vndb.org": 3,
    "getchu.com": 3, "getchuimg.com": 3,
    "dmm.co.jp": 2, "pics.dmm.co.jp": 2,
    "store.steampowered.com": 2, "steamcdn": 2,
    "fanza.com": 2,
    "ytimg.com": 1,
}


def _site_priority(url: str) -> int:
    """Higher = more likely to be a real game cover."""
    for domain, score in _GAME_SITE_PRIORITY.items():
        if domain in url:
            return score
    return 0


async def search_web_images(query: str, limit: int = 5) -> list[dict]:
    """Search for images via Bing (primary) and Google (fallback).
    Prioritizes results from game-related sites (itch.io, DLsite, VNDB, etc.)."""
    # Try Bing first (more stable, less bot detection)
    results = await _bing_search(query, limit)
    if results:
        return results
    # Fallback to Google
    return await _google_search(query, limit)


async def _bing_search(query: str, limit: int = 5) -> list[dict]:
    """Bing image search (primary)."""
    encoded_q = quote_plus(query)
    url = f"https://www.bing.com/images/search?q={encoded_q}&first=1&count={limit * 3}&adlt=off"

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers=_headers())
            if resp.status_code != 200:
                return []
    except Exception:
        return []

    results = []
    # Method 1: structured data in "iusc" class
    pattern = re.compile(r'<a[^>]*class="iusc"[^>]*m="([^"]*)"', re.DOTALL)
    for match in pattern.finditer(resp.text):
        try:
            raw = match.group(1).replace("&quot;", '"').replace("&amp;", "&")
            data = json.loads(raw)
            img_url = data.get("murl", "")
            thumb_url = data.get("turl", "")
            title = data.get("t", "")
            if img_url:
                results.append({
                    "url": img_url,
                    "thumbnail_url": thumb_url or img_url,
                    "title": title or query,
                    "source": "web",
                })
            if len(results) >= limit:
                break
        except (json.JSONDecodeError, KeyError):
            continue

    # Method 2: fallback regex if structured data fails
    if not results:
        img_urls = re.findall(
            r'"(https?://[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"', resp.text
        )
        seen = set()
        for img_url in img_urls:
            if any(d in img_url for d in _SKIP_DOMAINS):
                continue
            img_url = img_url.replace("\\u003d", "=").replace("\\u0026", "&")
            if img_url in seen:
                continue
            seen.add(img_url)
            if any(x in img_url for x in ["/s72-", "/s90-", "/s100-", "=s72", "=s90"]):
                continue
            results.append({
                "url": img_url,
                "thumbnail_url": img_url,
                "title": query,
                "source": "web",
            })
            if len(results) >= limit:
                break

    # Sort by game site priority
    results.sort(key=lambda r: -_site_priority(r["url"]))
    return results[:limit]


async def _google_search(query: str, limit: int = 5) -> list[dict]:
    """Google Images search (fallback)."""
    encoded_q = quote_plus(query)
    url = f"https://www.google.com/search?q={encoded_q}&tbm=isch&safe=off"

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers=_headers())
            if resp.status_code != 200:
                return []
    except Exception:
        return []

    text = resp.text
    all_img_urls = re.findall(
        r'"(https?://[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"', text
    )

    seen = set()
    candidates = []
    for img_url in all_img_urls:
        if any(d in img_url for d in _SKIP_DOMAINS):
            continue
        img_url = img_url.replace("\\u003d", "=").replace("\\u0026", "&")
        if img_url in seen:
            continue
        seen.add(img_url)
        if any(x in img_url for x in ["/s72-", "/s90-", "/s100-", "=s72", "=s90"]):
            continue

        idx = text.find(img_url[:50])
        context = ""
        if idx > 0:
            chunk = text[max(0, idx - 400):idx + len(img_url) + 400]
            nearby = re.findall(r'"([A-Za-z\u3000-\u9fff][^"]{3,80})"', chunk)
            context = " ".join(s for s in nearby if not s.startswith("http"))

        priority = _site_priority(img_url)
        candidates.append({
            "url": img_url,
            "thumbnail_url": img_url,
            "title": query,
            "source": "web",
            "_priority": priority,
            "_context": context,
        })

    query_words = set(re.split(r'[\s_\-]+', query.lower()))
    query_words -= {"game", "ゲーム", "gameplay", "cover"}

    for c in candidates:
        ctx = c["_context"].lower()
        matched = sum(1 for w in query_words if w in ctx)
        c["_relevance"] = matched

    candidates.sort(key=lambda c: (-c["_relevance"], -c["_priority"]))

    results = []
    for c in candidates[:limit]:
        results.append({
            "url": c["url"],
            "thumbnail_url": c["thumbnail_url"],
            "title": c["title"],
            "source": c["source"],
        })

    return results


def _is_safe_url(url: str) -> bool:
    """Block internal/private URLs to prevent SSRF."""
    from urllib.parse import urlparse
    import ipaddress
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        host = parsed.hostname or ""
        if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1", ""):
            return False
        # Block private IP ranges
        try:
            ip = ipaddress.ip_address(host)
            if ip.is_private or ip.is_loopback or ip.is_link_local:
                return False
        except ValueError:
            pass  # hostname, not IP — OK
        return True
    except Exception:
        return False


async def download_image(url: str, save_path: str) -> bool:
    """Download image and save to disk."""
    if not _is_safe_url(url):
        return False
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=_headers()) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return False
            content_type = resp.headers.get("content-type", "")
            # Reject if content-type is not image OR body is suspiciously small
            if not content_type.startswith("image") or len(resp.content) < 1000:
                return False
            with open(save_path, "wb") as f:
                f.write(resp.content)
            return True
    except Exception:
        return False


def _title_match_score(query: str, candidate: str) -> float:
    """Title similarity using SequenceMatcher + word overlap (combined)."""
    from difflib import SequenceMatcher
    q = query.lower().strip()
    c = candidate.lower().strip()
    if not q or not c:
        return 0
    # Sequence similarity (fuzzy)
    seq_score = SequenceMatcher(None, q, c).ratio()
    # Word overlap
    q_words = set(q.split())
    c_words = set(c.split())
    word_score = len(q_words & c_words) / len(q_words) if q_words else 0
    # Use the higher of the two
    return max(seq_score, word_score)


# ─── Main auto-fetch ───

async def auto_fetch_cover(game_id: int, game_title: str,
                           game_path: str = "",
                           exe_path: str = "") -> dict:
    """Auto-fetch cover with smart search:
    1. Extract metadata from game files (real title, developer)
    2. DLsite ID → DLsite keyword → VNDB → Web search (with improved query)
    3. Exe icon as last-resort fallback
    Returns {cover_path, source, vndb_id, dlsite_id, developer}."""
    os.makedirs(COVERS_DIR, exist_ok=True)
    save_path = os.path.join(COVERS_DIR, f"{game_id}.jpg")
    developer = ""

    # Step 0: Extract metadata for better search
    meta = extract_game_metadata(game_path) if game_path else {}
    real_title = meta.get("title") or game_title
    developer = meta.get("developer", "")
    meta_dlsite_id = meta.get("dlsite_id", "")

    # Build search queries (try real title first, then folder name)
    search_titles = [real_title]
    if game_title != real_title and game_title:
        search_titles.append(game_title)

    # Strategy 1: DLsite by ID
    dlsite_id = meta_dlsite_id
    if dlsite_id:
        product = await fetch_dlsite_product(dlsite_id)
        if product and product.get("cover_url"):
            developer = developer or product.get("maker", "")
            if await download_image(product["cover_url"], save_path):
                return {
                    "cover_path": save_path,
                    "source": "dlsite",
                    "vndb_id": "",
                    "dlsite_id": dlsite_id,
                    "developer": developer,
                }

    # Strategy 2: DLsite keyword search (pick best match)
    best_dlsite = None
    best_dlsite_score = 0
    for title in search_titles:
        dlsite_results = await search_dlsite(title, limit=5)
        for r in dlsite_results:
            score = _title_match_score(title, r["title"])
            if score > best_dlsite_score and r.get("cover_url"):
                best_dlsite_score = score
                best_dlsite = (r, title)
    if best_dlsite and best_dlsite_score >= 0.35:
        r, title = best_dlsite
        developer = developer or r.get("maker", "")
        if await download_image(r["cover_url"], save_path):
            return {
                "cover_path": save_path,
                "source": "dlsite",
                "vndb_id": "",
                "dlsite_id": r["dlsite_id"],
                "developer": developer,
            }

    # Strategy 3: VNDB search (pick best match)
    best_vndb = None
    best_vndb_score = 0
    for title in search_titles:
        vndb_results = await search_vndb(title)
        for r in vndb_results:
            score = _title_match_score(title, r["title"])
            if score > best_vndb_score and r.get("cover_url"):
                best_vndb_score = score
                best_vndb = (r, title)
    if best_vndb and best_vndb_score >= 0.35:
        r, title = best_vndb
        developer = developer or r.get("developer", "")
        if await download_image(r["cover_url"], save_path):
            return {
                "cover_path": save_path,
                "source": "vndb",
                "vndb_id": r["vndb_id"],
                "dlsite_id": "",
                "developer": developer,
            }

    # Strategy 3.5: itch.io direct search (best title match)
    best_itch = None
    best_itch_score = 0
    for title in search_titles:
        itch_results = await search_itch(title, limit=5)
        for r in itch_results:
            score = _title_match_score(title, r["title"])
            if score > best_itch_score and r.get("url"):
                best_itch_score = score
                best_itch = r
    if best_itch and best_itch_score >= 0.4:
        if await download_image(best_itch["url"], save_path):
            return {
                "cover_path": save_path,
                "source": "itch",
                "vndb_id": "",
                "dlsite_id": "",
                "developer": developer,
            }

    # Strategy 4: Local icon (RPG Maker icon/icon.png etc.)
    if game_path and extract_local_cover(game_path, save_path):
        return {
            "cover_path": save_path,
            "source": "local",
            "vndb_id": "",
            "dlsite_id": "",
            "developer": developer,
        }

    # Strategy 5: Web image search with specific query
    for title in search_titles:
        # Try multiple query variations for better coverage
        queries = []
        if developer:
            queries.append(f"{title} {developer}")
        queries.append(f"{title} ゲーム")
        queries.append(f'"{title}" game')
        for query in queries:
            web_results = await search_web_images(query, limit=3)
            for r in web_results:
                if await download_image(r["url"], save_path):
                    return {
                        "cover_path": save_path,
                        "source": "web",
                        "vndb_id": "",
                        "dlsite_id": "",
                        "developer": developer,
                    }
            if web_results:
                break  # 결과 있으면 다음 title 변형으로

    # Strategy 6: Extract exe icon as last resort
    actual_exe = exe_path
    if not actual_exe and game_path:
        from . import engine_bridge
        actual_exe = engine_bridge.find_game_exe(game_path) or ""
    if actual_exe and Path(actual_exe).is_file():
        if extract_exe_icon(actual_exe, save_path):
            return {
                "cover_path": save_path,
                "source": "icon",
                "vndb_id": "",
                "dlsite_id": "",
                "developer": developer,
            }

    return {"cover_path": "", "source": "", "vndb_id": "", "dlsite_id": "", "developer": developer}
