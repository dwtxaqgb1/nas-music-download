#!/usr/bin/env python3
"""Bridge v2: fnmusic-ext <--> nas-music-download lxserver (port 5200).
Search via internal /api/music/search.
Playback: resolve url via /api/music/url, download to local cache, serve as file.
"""
import json, urllib.parse, urllib.request, sys, time, re, os, threading, subprocess, hashlib
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

_no_source_warned = False

NMD = os.environ.get("NMD_URL", "http://127.0.0.1:5200")
BRIDGE_PORT = os.environ.get("BRIDGE_PORT", "8773")
SELF = f"http://127.0.0.1:{BRIDGE_PORT}"
CACHE_DIR = os.environ.get("CACHE_DIR", "/vol1/1000/音乐/fnmusic下载")
os.makedirs(CACHE_DIR, exist_ok=True)
COVER_DIR = os.path.join(CACHE_DIR, "covers")
os.makedirs(COVER_DIR, exist_ok=True)
# clean old .part files
for f in os.listdir(CACHE_DIR):
    if f.endswith(".part"):
        try:
            p = os.path.join(CACHE_DIR, f)
            if time.time() - os.path.getmtime(p) > 86400: os.remove(p)
        except: pass
# load persisted play mode
try:
    with open("/usr/local/etc/lx_bridge_cfg.json") as f:
        _cfg = json.load(f)
    os.environ["PLAY_MODE"] = _cfg.get("play_mode","stream")
except: pass

_lock = threading.Lock()
_stream_locks = {}
def _song_lock(key):
    with _lock:
        if key not in _stream_locks: _stream_locks[key] = threading.Lock()
        return _stream_locks[key]
_log_buf = []

def log(*a):
    msg = time.strftime("%H:%M:%S") + " " + " ".join(str(x) for x in a)
    print(msg, flush=True)
    _log_buf.append(msg)
    if len(_log_buf) > 200: _log_buf.pop(0)

def http_json(url, data=None, timeout=20):
    global _no_source_warned
    headers = {"Content-Type":"application/json"}
    if data is not None:
        body = json.dumps(data).encode()
    else:
        body = None
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if ("未找到支持" in body or "自定义源" in body) and not _no_source_warned:
            _no_source_warned = True
            log("="*60)
            log("⚠️  未检测到可用音源！")
            log("   请打开 nmd 后台 (端口5200) 登录")
            log("   在「设置」中上传并启用音源JS（如玉宁熙.js）")
            log("="*60)
        raise

def resolve_url(song, skip=0):
    """Try original platform, then other platforms. Fast."""
    qs = ["flac","320k","128k"]
    for q in qs[skip:]:
        try:
            r = http_json(f"{NMD}/api/music/url",
                {"songInfo":song, "quality":q, "enableAutoSwitchApiSource":True}, timeout=10)
            url = r.get("url")
            if url: return url, r.get("type","flac")
        except: pass
    name = song.get("name","")
    singer = song.get("singer","")
    orig_src = song.get("source","kw")
    if name:
        log(f"  searching '{name}' on other platforms...")
        kw = f"{name} {singer}".strip()
        for src in ["kw","wy","mg","tx","kg"]:
            if src == orig_src: continue
            try:
                d = http_json(f"{NMD}/api/music/search?name={urllib.parse.quote(kw)}&source={src}&type=song&limit=3&page=1", timeout=8)
                items = d if isinstance(d,list) else (d.get("data",{}).get("items",[]) if isinstance(d.get("data"),dict) else d.get("data",[]))
                for it in items:
                    if it.get("name","").startswith(name[:2]):
                        for q in ["flac","320k","128k"]:
                            try:
                                r = http_json(f"{NMD}/api/music/url",
                                    {"songInfo":it, "quality":q, "enableAutoSwitchApiSource":True}, timeout=8)
                                url = r.get("url")
                                if url:
                                    log(f"  found on {src}: {it.get('name')}")
                                    return url, r.get("type","flac")
                            except: pass
            except: pass
    return None, None

def safe_name(s):
    return re.sub(r'[\\/:*?"<>|]', '_', s).strip()

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try: self.wfile.write(body)
        except: pass
    def _serve_file(self, path, ct):
        size = os.path.getsize(path)
        range_h = self.headers.get("Range")
        if range_h:
            rng = re.match(r"bytes=(\d+)-(\d*)", range_h)
            start = int(rng.group(1)) if rng else 0
            end = int(rng.group(2)) if rng and rng.group(2) else size-1
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            start, end = 0, size-1
            self.send_response(200)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(end-start+1))
        self.send_header("Accept-Ranges","bytes")
        self.end_headers()
        with open(path,"rb") as f:
            f.seek(start)
            remaining = end-start+1
            while remaining > 0:
                chunk = f.read(min(1<<16, remaining))
                if not chunk: break
                try: self.wfile.write(chunk)
                except: break
                remaining -= len(chunk)

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/save-source":
            length = int(self.headers.get("Content-Length",0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                name = data.get("name","source.js")
                content = data.get("content","")
                src_dir = os.environ.get("SOURCE_DIR", "/vol1/@appdata/com.nasmusic.download/data/users/source/_open")
                os.makedirs(src_dir, exist_ok=True)
                safe = name.replace("/","_")
                with open(f"{src_dir}/{safe}","w") as f: f.write(content)
                sj = f"{src_dir}/sources.json"
                try:
                    with open(sj) as f: arr = json.load(f)
                except: arr = []
                arr = [x for x in arr if x.get("id") != safe]
                arr.append({
                    "id": safe, "name": safe.rsplit(".",1)[0], "version": "", "author": "",
                    "description": "", "homepage": "", "size": len(content),
                    "supportedSources": ["kg","kw","wy","tx","mg"], "enabled": False,
                    "uploadTime": time.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                    "sourceUrl": "", "allowUnsafeVM": True, "requireUnsafe": False
                })
                with open(sj,"w") as f: json.dump(arr, f, ensure_ascii=False)
                try: subprocess.run(["docker","restart","nas-music-download"], timeout=30)
                except: pass
                self._json(200, {"ok":True,"file":safe}); return
            except Exception as e:
                self._json(500, {"ok":False,"error":str(e)}); return
        self._json(405, {"ok":False,"error":"use GET"}); return

    def do_GET(self):
        global _gh_mirror, _source_cache, _gh_repos, _cached_repo
        t0 = time.time()
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        def one(k,d=""):
            v=qs.get(k,[d]); return v[0] if v else d
        try:


            if u.path == "/list-saved":
                files = []
                if os.path.isdir(os.environ.get("SOURCE_DIR", "/vol1/@appdata/com.nasmusic.download/data/users/source/_open")):
                    for f in os.listdir(os.environ.get("SOURCE_DIR", "/vol1/@appdata/com.nasmusic.download/data/users/source/_open")):
                        fp = os.path.join(os.environ.get("SOURCE_DIR", "/vol1/@appdata/com.nasmusic.download/data/users/source/_open"), f)
                        if os.path.isfile(fp) and f.endswith(".js"):
                            files.append({"name": f, "size": os.path.getsize(fp), "mtime": os.path.getmtime(fp)})
                files.sort(key=lambda x: -x["mtime"])
                self._json(200, {"ok":True,"files":files}); return

            if u.path == "/peek-saved":
                name = u.query.split("name=")[1] if "name=" in u.query else ""
                name = urllib.parse.unquote(name).replace("/","_")
                fp = os.path.join(os.environ.get("SOURCE_DIR", "/vol1/@appdata/com.nasmusic.download/data/users/source/_open"), name)
                if os.path.exists(fp):
                    with open(fp, "r", encoding="utf-8") as f:
                        content = f.read()
                    self._json(200, {"ok":True,"content":content[:5000]}); return
                self._json(404, {"ok":False,"error":"not found"}); return

            if u.path == "/export-source":
                name = u.query.split("name=")[1] if "name=" in u.query else ""
                name = urllib.parse.unquote(name).replace("/","_")
                fp = os.path.join(os.environ.get("SOURCE_DIR", "/vol1/@appdata/com.nasmusic.download/data/users/source/_open"), name)
                if os.path.exists(fp):
                    with open(fp,"rb") as f: data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type","application/javascript")
                    self.send_header("Content-Disposition","attachment; filename*=UTF-8''" + urllib.parse.quote(name))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._json(404, {"ok":False,"error":"not found"}); return

            if u.path == "/delete-saved":
                length = int(self.headers.get("Content-Length",0))
                body = self.rfile.read(length)
                data = json.loads(body)
                name = data.get("name","").replace("/","_")
                fp = os.path.join(os.environ.get("SOURCE_DIR", "/vol1/@appdata/com.nasmusic.download/data/users/source/_open"), name)
                if os.path.exists(fp): os.remove(fp)
                self._json(200, {"ok":True}); return

            if u.path == "/download-saved":
                name = u.query.split("name=")[1] if "name=" in u.query else ""
                name = urllib.parse.unquote(name).replace("/","_")
                fp = os.path.join(os.environ.get("SOURCE_DIR", "/vol1/@appdata/com.nasmusic.download/data/users/source/_open"), name)
                if os.path.exists(fp):
                    with open(fp,"rb") as f: data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type","application/javascript")
                    self.send_header("Content-Disposition","attachment; filename*=UTF-8''" + urllib.parse.quote(name))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self._json(404, {"ok":False,"error":"not found"}); return

            if u.path == "/set-token":
                length = int(self.headers.get("Content-Length",0))
                body = self.rfile.read(length)
                data = json.loads(body)
                _cfg["token"] = data.get("token","")
                _save_cfg()
                self._json(200, {"ok":True}); return

            if u.path == "/get-token":
                self._json(200, {"ok":True,"token":_cfg.get("token","")}); return

            if u.path == "/healthz":
                self._json(200, {"ok":True,"service":"lxbridge-v2","version":"2.0",
                    "sources":["kg","wy","mg","kw","tx"],
                    "user_source":{"configured":True,"initialized":True,
                        "source":{"name":"nmd-lxserver","version":"2.0",
                            "platforms":{s:{"name":s,"qualitys":["128k","320k","flac"]} for s in ["kg","kw","mg","tx","wy"]}},
                        "running":True}}); return

            if u.path == "/logs":
                self._json(200, {"ok":True,"logs":list(reversed(_log_buf[-100:]))}); return

            if u.path == "/get-mirror":
                self._json(200, {"ok":True,"mirror":_gh_mirror,"repos":_gh_repos}); return

            if u.path == "/set-mirror":
                _gh_mirror = one("url","").strip()
                try: _gh_repos = json.loads(one("repos","[]"))
                except: _gh_repos = []
                _source_cache = None
                _save_cfg()
                self._json(200, {"ok":True,"mirror":_gh_mirror,"repos":_gh_repos}); return

            if u.path == "/search-sources":
                q = one("q","").strip()
                req_repo = one("repo","")
                if _source_cache and _cached_repo == req_repo:
                    items = [i for i in _source_cache if not q or q.lower() in i["name"].lower()]
                    self._json(200, {"ok":True,"items":items}); return
                try:
                    import zipfile, io
                    repo = one("repo","")
                    # strip https://github.com/ prefix
                    repo = repo.replace("https://github.com/","").strip("/")
                    def gh_get(url):
                        for attempt in range(2):
                            try:
                                req = urllib.request.Request(url, headers={"User-Agent":"lx-bridge"})
                                return json.loads(urllib.request.urlopen(req, timeout=15).read())
                            except:
                                if attempt == 0 and _gh_mirror:
                                    try:
                                        u = _gh_mirror.rstrip("/") + "/" + url
                                        req = urllib.request.Request(u, headers={"User-Agent":"lx-bridge"})
                                        return json.loads(urllib.request.urlopen(req, timeout=15).read())
                                    except: continue
                                continue
                        return {}
                    rel_url = f"https://api.github.com/repos/{repo}/releases?per_page=30"
                    releases = []
                    try:
                        rels = gh_get(rel_url)
                        for rel in rels:
                            assets = []
                            for a in rel.get("assets",[]):
                                if a["name"].endswith(".js"):
                                    assets.append({"name": a["name"], "raw": a["browser_download_url"], "type":"js"})
                                elif a["name"].endswith(".zip"):
                                    assets.append({"name": a["name"], "raw": a["browser_download_url"], "type":"zip"})
                            if assets:
                                releases.append({"tag": rel.get("tag_name",""), "name": rel.get("name",""), "date": rel.get("published_at","")[:10], "assets": assets})
                    except: pass
                    # fallback: list tree .js files if no releases
                    if not releases:
                        try:
                            br = gh_get(f"https://api.github.com/repos/{repo}")
                            branch = br.get("default_branch","main")
                            tree_url = f"https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1"
                            tree = gh_get(tree_url)
                            # get latest commit date
                            commits = gh_get(f"https://api.github.com/repos/{repo}/commits?per_page=1")
                            latest_date = commits[0]["commit"]["committer"]["date"][:10] if commits else ""
                            js_files = []
                            for t in tree.get("tree",[]):
                                if t["path"].endswith(".js"):
                                    raw = f"https://raw.githubusercontent.com/{repo}/{branch}/{t['path']}"
                                    js_files.append({"name": t["path"], "raw": raw, "type":"js"})
                                elif t["path"].endswith(".zip"):
                                    raw = f"https://raw.githubusercontent.com/{repo}/{branch}/{t['path']}"
                                    js_files.append({"name": t["path"], "raw": raw, "type":"zip"})
                            if js_files:
                                releases.append({"tag":"仓库文件","name":"","date":latest_date,"assets":js_files})
                        except Exception as e:
                            log(f"  tree err: {e}")
                    self._json(200, {"ok":True,"releases":releases}); return
                except Exception as e:
                    self._json(500, {"ok":False,"error":str(e)}); return

            if u.path == "/extract-zip":
                import zipfile, io
                zurl = one("url","")
                prefixes = [_gh_mirror.rstrip("/")] if _gh_mirror else []
                prefixes.append("")
                for p in prefixes:
                    try:
                        u = p + "/" + zurl if p else zurl
                        req = urllib.request.Request(u, headers={"User-Agent":"lx-bridge"})
                        zdata = urllib.request.urlopen(req, timeout=90).read()
                        zf = zipfile.ZipFile(io.BytesIO(zdata))
                        items = []
                        for info in zf.infolist():
                            if not info.filename.endswith(".js"): continue
                            try:
                                fname = info.filename.encode("cp437").decode("gbk")
                            except:
                                fname = info.filename
                            content = zf.read(info).decode("utf-8",errors="replace")
                            items.append({"name": fname.split("/")[-1], "inline": content})
                        self._json(200, {"ok":True,"items":items}); return
                    except Exception as e:
                        log(f"  zip err: {e}"); continue
                self._json(500, {"ok":False,"error":"zip failed"}); return

            if u.path == "/fetch-source":
                raw = one("raw","")
                prefixes = [_gh_mirror.rstrip("/")] if _gh_mirror else []
                prefixes.append("")
                for p in prefixes:
                    try:
                        u = p + "/" + raw if p else raw
                        req = urllib.request.Request(u, headers={"User-Agent":"lx-bridge"})
                        content = urllib.request.urlopen(req, timeout=15).read().decode("utf-8",errors="replace")
                        self._json(200, {"ok":True,"content":content}); return
                    except Exception as e:
                        log(f"  fetch err: {e}"); continue
                self._json(500, {"ok":False,"error":"fetch failed"}); return

            if u.path == "/save-source":
                length = int(self.headers.get("Content-Length",0))
                body = self.rfile.read(length)
                try:
                    data = json.loads(body)
                    name = data.get("name","source.js")
                    content = data.get("content","")
                    # write file directly
                    src_dir = os.environ.get("SOURCE_DIR", "/vol1/@appdata/com.nasmusic.download/data/users/source/_open")
                    os.makedirs(src_dir, exist_ok=True)
                    safe = name.replace("/","_")
                    with open(f"{src_dir}/{safe}","w") as f: f.write(content)
                    # add to sources.json
                    sj = f"{src_dir}/sources.json"
                    try:
                        with open(sj) as f: arr = json.load(f)
                    except: arr = []
                    # remove old entry with same id
                    arr = [x for x in arr if x.get("id") != safe]
                    arr.append({
                        "id": safe, "name": safe.rsplit(".",1)[0], "version": "", "author": "",
                        "description": "", "homepage": "", "size": len(content),
                        "supportedSources": ["kg","kw","wy","tx","mg"], "enabled": False,
                        "uploadTime": time.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                        "sourceUrl": "", "allowUnsafeVM": True, "requireUnsafe": False
                    })
                    with open(sj,"w") as f: json.dump(arr, f, ensure_ascii=False)
                    # restart nmd to reload sources
                    try: subprocess.run(["docker","restart","nas-music-download"], timeout=30)
                    except: pass
                    self._json(200, {"ok":True,"file":safe}); return
                except Exception as e:
                    self._json(500, {"ok":False,"error":str(e)}); return

            if u.path == "/get_playmode":
                self._json(200, {"ok":True,"mode":os.environ.get("PLAY_MODE","stream")}); return

            if u.path == "/set_playmode":
                mode = one("mode","stream")
                if mode not in ("stream","download"):
                    self._json(400, {"ok":False,"error":"bad mode"}); return
                os.environ["PLAY_MODE"] = mode
                # persist
                cfg = "/usr/local/etc/lx_bridge_cfg.json"
                try:
                    with open(cfg) as f: c = json.load(f)
                except: c = {}
                c["play_mode"] = mode
                with open(cfg,"w") as f: json.dump(c, f)
                self._json(200, {"ok":True,"mode":mode}); return

            if u.path == "/set_mode":
                mode = one("mode","lxmusic")
                env = "/vol1/@appcenter/fnmusic-ext/repo/.env"
                if mode not in ("lxmusic","musicdl"):
                    self._json(400, {"ok":False,"error":"bad mode"}); return
                try:
                    with open(env) as f: lines = f.readlines()
                    out = []
                    for ln in lines:
                        if ln.startswith("FNMUSIC_MUSICDL_ENABLED="):
                            out.append(f"FNMUSIC_MUSICDL_ENABLED='{'true' if mode=='musicdl' else 'false'}'\n")
                        elif ln.startswith("FNMUSIC_LX_ENABLED="):
                            out.append(f"FNMUSIC_LX_ENABLED='{'true' if mode=='lxmusic' else 'false'}'\n")
                        else:
                            out.append(ln)
                    with open(env,"w") as f: f.writelines(out)
                    # restart fnmusic-sources container
                    subprocess.run(["docker","restart","fnmusic-sources"], timeout=30)
                    log(f"switched source mode -> {mode}")
                    self._json(200, {"ok":True,"mode":mode}); return
                except Exception as e:
                    self._json(500, {"ok":False,"error":str(e)}); return

            # /cover?url=<encoded> -- proxy & cache album art locally
            if u.path == "/cover":
                cu = one("url","")
                if not cu:
                    self.send_response(400); self.end_headers(); return
                h = hashlib.md5(cu.encode()).hexdigest()[:16]
                cp = os.path.join(COVER_DIR, h + ".jpg")
                if not os.path.exists(cp):
                    try:
                        req = urllib.request.Request(cu, headers={"User-Agent":"Mozilla/5.0"})
                        with urllib.request.urlopen(req, timeout=10) as r:
                            data = r.read()
                        with open(cp,"wb") as f: f.write(data)
                    except Exception as e:
                        log(f"  cover fetch err: {e}")
                if os.path.exists(cp) and os.path.getsize(cp) > 0:
                    self._serve_file(cp, "image/jpeg")
                else:
                    self.send_response(404); self.end_headers()
                return

            # /stream/<source>_<songmid> --- stream while saving
            m = re.match(r"^/stream/([a-z]+)_(.+)$", u.path)
            if m:
                src, songmid = m.group(1), m.group(2)
                key = f"{src}_{songmid}"
                # check if local file already exists
                cache_path = _file_map.get(key)
                if not cache_path or not os.path.exists(cache_path):
                    song = _song_cache.get(key) or _song_cache.get(f"lx:{src}:{songmid}")
                    if not song:
                        self.send_response(404); self.end_headers(); return
                    # resolve direct URL
                    direct_url, ext = resolve_url(song)
                    if not direct_url:
                        self.send_response(502); self.end_headers(); return
                    if ext not in ("flac","mp3"): ext = "flac"
                    name = safe_name(song.get("name","unknown")) or "unknown"
                    singer = safe_name(song.get("singer","")) or "unknown"
                    fname = f"{name} - {singer}.{ext}"
                    cache_path = os.path.join(CACHE_DIR, fname)
                    _file_map[key] = cache_path
                    # if file already fully downloaded, serve it
                    if os.path.exists(cache_path):
                        size = os.path.getsize(cache_path)
                        ct = "audio/flac" if ext=="flac" else "audio/mpeg"
                        self._serve_file(cache_path, ct)
                        return
                    # stream or download mode
                    PLAY_MODE = os.environ.get("PLAY_MODE","stream")
                    log(f"  {PLAY_MODE} {fname} from {direct_url[:60]}...")
                    remote = None; first = b""
                    for skip_q in range(3):
                      try:
                        req = urllib.request.Request(direct_url, headers={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36","Referer":"https://music.163.com/"})
                        remote = urllib.request.urlopen(req, timeout=60)
                        first = remote.read(1<<16)
                        if not first:
                          raise Exception("empty body")
                        break
                      except Exception as e:
                        log(f"  q{skip_q} failed: {e}")
                        if skip_q < 2:
                          log(f"  downgrade quality...")
                          direct_url, ext = resolve_url(song, skip=skip_q+1)
                          if not direct_url: break
                    if not remote or not first:
                      raise Exception("all qualities failed")
                    ct = remote.headers.get("Content-Type","audio/flac")
                    total = int(remote.headers.get("Content-Length",0))
                    sl = _song_lock(key)
                    with sl:
                        if os.path.exists(cache_path):
                            self._serve_file(cache_path, ct); return
                        if os.path.exists(cache_path+".part"): os.remove(cache_path+".part")
                        PLAY_MODE = os.environ.get("PLAY_MODE","stream")
                        if PLAY_MODE == "download":
                            # Send headers immediately so the app keeps the connection alive
                            self.send_response(200)
                            self.send_header("Content-Type", ct)
                            self.send_header("Content-Length", str(total))
                            self.send_header("Accept-Ranges", "bytes")
                            self.end_headers()
                            out = open(cache_path+".part","wb")
                            out.write(first)
                            while True:
                                chunk = remote.read(1<<16)
                                if not chunk: break
                                out.write(chunk)
                            out.close()
                            os.rename(cache_path+".part", cache_path)
                            # Pipe completed file to the waiting client
                            with open(cache_path, "rb") as f:
                                while True:
                                    chunk = f.read(1<<16)
                                    if not chunk: break
                                    try: self.wfile.write(chunk)
                                    except: break
                            log(f"downloaded & served {fname} {total}B in {time.time()-t0:.2f}s")
                            return
                        range_h = self.headers.get("Range")
                        out = open(cache_path+".part","wb")
                        if range_h:
                            rng = re.match(r"bytes=(\d+)-(\d*)", range_h)
                            start = int(rng.group(1)) if rng else 0
                            self.send_response(206)
                            self.send_header("Content-Range", f"bytes {start}-{total-1}/{total}")
                        else:
                            start = 0
                            self.send_response(200)
                        self.send_header("Content-Type", ct)
                        self.send_header("Content-Length", str(total))
                        self.send_header("Accept-Ranges","bytes")
                        self.end_headers()
                        bytes_sent = len(first)
                        buf = first
                        out.write(first)
                        buffered = len(first)
                        BUF_SIZE = 1*1024*1024
                        try:
                            while True:
                                chunk = remote.read(1<<16)
                                if not chunk: break
                                out.write(chunk)
                                buf += chunk
                                buffered += len(chunk)
                                if buffered >= BUF_SIZE:
                                    try: self.wfile.write(buf)
                                    except: raise
                                    buf = b""
                                    buffered = 0
                                bytes_sent += len(chunk)
                        finally:
                            if buf:
                                try: self.wfile.write(buf)
                                except: pass
                            out.close()
                        if total == 0 or bytes_sent >= total:
                            os.rename(cache_path+".part", cache_path)
                        log(f"streamed {fname} {bytes_sent}B in {time.time()-t0:.2f}s")
                        return
                # local file exists, serve it
                ext = cache_path.rsplit(".",1)[-1]
                ct = "audio/flac" if ext=="flac" else "audio/mpeg"
                self._serve_file(cache_path, ct)
                return

            if u.path == "/api/v1/search":
                kw = one("keyword") or one("q") or ""
                limit = int(one("limit","20") or 20)
                log(f"search {kw!r}")
                # search cache
                ckey = ("search", kw, limit)
                if ckey in _search_cache:
                    exp, items = _search_cache[ckey]
                    if exp > time.time():
                        # re-populate _song_cache from cached items so playback works
                        for it in items:
                            sid = it.get("id","")
                            parts = sid.split(":")
                            if len(parts) < 3: continue
                            src, sm = parts[1], parts[2]
                            song_info = {
                                "name": it.get("title",""), "singer": it.get("artist",""),
                                "source": src, "songmid": sm, "interval":"00:00",
                                "img":"", "types":[]}
                            _song_cache[sid] = song_info
                            _song_cache[f"{src}_{sm}"] = song_info
                        _trim_cache(_song_cache)
                        log(f"search cache hit -> {len(items)} items")
                        self._json(200, {"ok":True,"items":items}); return
                # parallel search across working sources only
                from concurrent.futures import ThreadPoolExecutor
                def search_src(src):
                    try:
                        d = http_json(f"{NMD}/api/music/search?name={urllib.parse.quote(kw)}&source={src}&type=song&limit={limit}&page=1", timeout=10)
                        return src, d if isinstance(d, list) else []
                    except Exception as e:
                        log(f"  {src} err: {e}")
                        return src, []
                items = []
                seen = set()
                with ThreadPoolExecutor(max_workers=5) as ex:
                    for src, results in ex.map(search_src, ["kw","wy","mg","tx","kg"]):
                        for s in results:
                            sm = s.get("songmid","")
                            sid = f"lx:{src}:{sm}"
                            song_info = {
                                "name":s.get("name",""),"singer":s.get("singer",""),
                                "source":src,"songmid":sm,"interval":s.get("interval","00:00"),
                                "img":s.get("img",""),"types":s.get("types",[])}
                            _song_cache[sid] = song_info
                            _song_cache[f"{src}_{sm}"] = song_info
                            _trim_cache(_song_cache)
                            # dedup by title+artist (keep first hit, sources ordered by preference)
                            dkey = (s.get("name","").strip(), s.get("singer","").strip())
                            if dkey in seen: continue
                            seen.add(dkey)
                            iv = s.get("interval","0:0")
                            try:
                                parts = iv.split(":"); dur = int(parts[0])*60+int(parts[1])
                            except: dur = 0
                            cover = s.get("img","")
                            if cover:
                                cover = f"{SELF}/cover?url=" + urllib.parse.quote(cover, safe="")
                            items.append({"id":sid,"lx_source":src,
                                "title":s.get("name",""),"artist":s.get("singer",""),
                                "album":s.get("albumName",""),"duration_s":float(dur),
                                "ext":"flac","cover_url":cover,
                                "file_size":0,"verified":True})
                now = time.time()
                for k in [k for k,(exp,_) in _search_cache.items() if exp <= now]: del _search_cache[k]
                _search_cache[ckey] = (now+300, items)
                log(f"search -> {len(items)} items in {time.time()-t0:.2f}s")
                self._json(200, {"ok":True,"items":items}); return

            if u.path == "/api/v1/track/url":
                sid = one("id"); quality = one("quality","lossless")
                log(f"url {sid}")
                local = f"{SELF}/stream/{sid.split(':')[1]}_{sid.split(':')[2]}"
                self._json(200, {"ok":True,"data":{"id":sid,"url":local,"ext":"flac",
                    "file_size":0,"actual_tier":quality,"validation_status":"media_verified"}}); return

            if u.path == "/api/v1/track/lyric":
                sid = one("id")
                src, sm = sid.split(":")[1], sid.split(":")[2]
                try:
                    d = http_json(f"{NMD}/api/music/lyric?source={src}&songmid={sm}", timeout=10)
                    self._json(200, {"ok":True,"data":{"lyric":d.get("lyric","")}})
                except Exception as e:
                    self._json(200, {"ok":True,"data":{"lyric":""}})
                return

            if u.path == "/api/v1/track/info":
                sid = one("id")
                si = _song_cache.get(sid, {})
                iv = si.get("interval","0:0")
                try:
                    parts = iv.split(":"); dur = int(parts[0])*60+int(parts[1])
                except: dur = 0
                self._json(200, {"ok":True,"data":{
                    "id":sid,
                    "title":si.get("name",""),
                    "artist":si.get("singer",""),
                    "album":"",
                    "cover_url": (f"{SELF}/cover?url=" + urllib.parse.quote(si.get("img",""), safe="")) if si.get("img") else "",
                    "duration_s":float(dur),
                    "ext":"flac"
                }}); return
            self._json(404, {"ok":False,"error":"nf"})
        except Exception as e:
            log("EXC", u.path, e)
            try: self._json(500, {"ok":False,"error":str(e)})
            except: pass

_song_cache = {}
_search_cache = {}
_file_map = {}
_source_cache = None
_cached_repo = None

def _trim_cache(d, max=2000):
    while len(d) > max:
        d.pop(next(iter(d)))
_gh_mirror = ""
_gh_repos = []
_cfg_file = "/usr/local/etc/lx_bridge_cfg.json"
try:
    with open(_cfg_file) as f:
        _cfg = json.load(f)
        _gh_mirror = _cfg.get("mirror","")
        _gh_repos = _cfg.get("repos",[])
except: pass
# default repos
if not _gh_repos:
    _gh_repos = ["guoyue2010/lxmusic-","Macrohard0001/lx-ikun-music-sources","pdone/lx-music-source","liuyunss/LX-source","skxingyu/lx_music-"]

def _save_cfg():
    try:
        out = {"mirror":_gh_mirror,"repos":_gh_repos}
        if "token" in _cfg: out["token"] = _cfg["token"]
        if "play_mode" in _cfg: out["play_mode"] = _cfg["play_mode"]
        with open(_cfg_file,"w") as f:
            json.dump(out, f)
    except Exception as e: log("save_cfg error: "+str(e))

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv)>1 else 8773
    log(f"bridge v2 on :{port} -> nmd:{NMD}, download-then-play")
    ThreadedHTTPServer(("0.0.0.0", port), H).serve_forever()
