import os
import re
import shutil
import tempfile
import zipfile
import tarfile
import subprocess
from pathlib import Path
from app import ssh_keys

WORK_DIR = Path(os.environ.get("WORK_DIR", "/work"))

_TOKEN_RE = re.compile(r"(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})")


def _sanitize(s):
    return _TOKEN_RE.sub("***REDACTED***", s)


def _translate_git_line(line):
    """把 git 输出里的英文改成中文"""
    import re
    # create mode 100644 xxx
    m = re.match(r"^\s*create mode \d+ (.+)$", line)
    if m:
        return "  新增 " + m.group(1)
    # delete mode 100644 xxx
    m = re.match(r"^\s*delete mode \d+ (.+)$", line)
    if m:
        return "  删除 " + m.group(1)
    # rename xxx => yyy (nn%)
    m = re.match(r"^\s*rename (.+?) => (.+?) \(\d+%\)$", line)
    if m:
        return "  重命名 " + m.group(1) + " → " + m.group(2)
    # X files changed, Y insertions(+), Z deletions(-)
    m = re.match(r"^\s*(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?$", line)
    if m:
        n = m.group(1)
        add = m.group(2) or "0"
        dele = m.group(3) or "0"
        return f"  {n} 个文件变化，新增 {add} 行，删除 {dele} 行"
    # [main abc1234] update v1.0.0
    m = re.match(r"^\[([^\]]+) ([0-9a-f]+)\] (.+)$", line)
    if m:
        return f"提交 {m.group(2)[:7]}（分支 {m.group(1)}）: {m.group(3)}"
    return line


def run_cmd(log, cmd, cwd=None, env=None, check=True):
    cmd_str = cmd if isinstance(cmd, str) else " ".join(cmd)
    log(f"$ {_sanitize(cmd_str)}")
    e = os.environ.copy()
    if env:
        e.update(env)
    p = subprocess.Popen(
        cmd, cwd=cwd, env=e,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1, shell=isinstance(cmd, str),
    )
    if p.stdout:
        for line in p.stdout:
            line = line.rstrip()
            if line:
                log(_translate_git_line(_sanitize(line)))
    p.wait()
    if check and p.returncode != 0:
        raise RuntimeError(f"命令失败 (exit {p.returncode}): {_sanitize(cmd_str)}")
    return p.returncode


def safe_extract_zip(zip_path, dest):
    dest = os.path.realpath(dest)
    with zipfile.ZipFile(zip_path) as z:
        for m in z.namelist():
            target = os.path.realpath(os.path.join(dest, m))
            if not (target == dest or target.startswith(dest + os.sep)):
                raise RuntimeError(f"非法路径: {m}")
        z.extractall(dest)


def safe_extract_tar(tar_path, dest):
    dest = os.path.realpath(dest)
    with tarfile.open(tar_path) as t:
        for m in t.getmembers():
            target = os.path.realpath(os.path.join(dest, m.name))
            if not (target == dest or target.startswith(dest + os.sep)):
                raise RuntimeError(f"非法路径: {m.name}")
        t.extractall(dest)


def extract_archive(archive_path, dest):
    """根据文件名和文件头判断压缩格式，解压到 dest"""
    import os
    archive_path = str(archive_path)
    name = os.path.basename(archive_path).lower()

    # 先看文件头
    with open(archive_path, "rb") as f:
        head = f.read(8)

    is_zip = head.startswith(b"PK\x03\x04") or head.startswith(b"PK\x05\x06")
    is_gz = head.startswith(b"\x1f\x8b")

    if is_zip or name.endswith(".zip"):
        safe_extract_zip(archive_path, dest)
        return
    if is_gz or name.endswith(".tar.gz") or name.endswith(".tgz") or (".tar" in name and ".gz" in name):
        safe_extract_tar(archive_path, dest)
        return
    if name.endswith(".tar"):
        safe_extract_tar(archive_path, dest)
        return
    raise RuntimeError(f"无法识别的压缩格式: {os.path.basename(archive_path)}")

def flatten_if_single_dir(path):
    p = Path(path)
    items = [x for x in p.iterdir() if x.name not in (".DS_Store", "__MACOSX")]
    if len(items) == 1 and items[0].is_dir():
        return items[0]
    return p


def _setup_remote(log, token, owner, name, repo_dir):
    ssh_cmd = ssh_keys.git_ssh_command()
    if ssh_cmd:
        remote_url = ssh_keys.ssh_url(owner, name)
        env_extra = {"GIT_SSH_COMMAND": ssh_cmd}
        log(f"使用 SSH: {remote_url}")
    else:
        remote_url = f"https://x-access-token:{token}@github.com/{owner}/{name}.git"
        env_extra = {}
        log(f"使用 HTTPS: {_sanitize(remote_url)}")
    subprocess.run(["git", "remote", "remove", "origin"],
                   cwd=repo_dir, capture_output=True)
    subprocess.run(["git", "remote", "add", "origin", remote_url],
                   cwd=repo_dir, check=True, capture_output=True)
    return env_extra


def create_repo(log, token, owner, name, visibility="private", description=""):
    env = {"GH_TOKEN": token}
    rc = run_cmd(
        log,
        ["gh", "repo", "view", f"{owner}/{name}", "--json", "name", "-q", ".name"],
        env=env, check=False,
    )
    if rc == 0:
        log(f"仓库已存在: {owner}/{name}")
        return
    cmd = ["gh", "repo", "create", f"{owner}/{name}", f"--{visibility}"]
    if description:
        cmd += ["--description", description]
    run_cmd(log, cmd, env=env)


def push_source(log, token, owner, name, src_dir, branch="main", message="update"):
    src = Path(src_dir)
    if not (src / ".git").exists():
        run_cmd(log, ["git", "init", "-b", branch], cwd=src)
    run_cmd(log, ["git", "config", "user.name", "nas-bot"], cwd=src)
    run_cmd(log, ["git", "config", "user.email", "nas-bot@local"], cwd=src)
    run_cmd(log, ["git", "add", "-A"], cwd=src)
    rc = run_cmd(log, ["git", "diff", "--cached", "--quiet"], cwd=src, check=False)
    if rc != 0:
        run_cmd(log, ["git", "commit", "-m", message], cwd=src)
    else:
        log("无变更需提交")
    env_extra = _setup_remote(log, token, owner, name, src)
    run_cmd(log, ["git", "push", "-u", "origin", branch, "--force"],
            cwd=src, env=env_extra)


def create_release(log, token, owner, name, tag, title, notes, assets=None):
    env = {"GH_TOKEN": token}

    # 检查 tag 是否已存在（用 subprocess.run 直接调，避免和 run_cmd 返回值不一致）
    check = subprocess.run(
        ["gh", "release", "view", tag, "--repo", f"{owner}/{name}",
         "--json", "tagName", "-q", ".tagName"],
        env={**os.environ, **env},
        capture_output=True, text=True,
    )
    if check.returncode == 0:
        log(f"Release {tag} 已存在，先删除旧的 Release 和 Tag")
        dele = subprocess.run(
            ["gh", "release", "delete", tag, "--repo", f"{owner}/{name}",
             "--yes", "--cleanup-tag"],
            env={**os.environ, **env},
            capture_output=True, text=True,
        )
        if dele.returncode == 0:
            log(f"✓ 已删除旧 Release {tag}")
        else:
            # 兜底：单删 tag
            subprocess.run(
                ["gh", "api", "-X", "DELETE",
                 f"/repos/{owner}/{name}/git/refs/tags/{tag}"],
                env={**os.environ, **env},
                capture_output=True, text=True,
            )
            log(f"✓ 已删除旧 Tag {tag}")
        import time
        time.sleep(2)

    cmd = ["gh", "release", "create", tag,
           "--repo", f"{owner}/{name}",
           "--title", title or tag,
           "--notes", notes or f"Release {tag}"]
    if assets:
        cmd += [str(a) for a in assets]
    run_cmd(log, cmd, env=env)


def deploy_pages(log, token, owner, name, src_dir):
    src = Path(src_dir)
    tmp = Path(tempfile.mkdtemp(prefix="pages-"))
    try:
        for item in src.iterdir():
            if item.name == ".git":
                continue
            dst = tmp / item.name
            if item.is_dir():
                shutil.copytree(item, dst)
            else:
                shutil.copy2(item, dst)
        run_cmd(log, ["git", "init", "-b", "gh-pages"], cwd=tmp)
        run_cmd(log, ["git", "config", "user.name", "nas-bot"], cwd=tmp)
        run_cmd(log, ["git", "config", "user.email", "nas-bot@local"], cwd=tmp)
        run_cmd(log, ["git", "add", "-A"], cwd=tmp)
        run_cmd(log, ["git", "commit", "-m", "deploy pages"], cwd=tmp)
        env_extra = _setup_remote(log, token, owner, name, tmp)
        run_cmd(log, ["git", "push", "-u", "origin", "gh-pages", "--force"],
                cwd=tmp, env=env_extra)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    env = {"GH_TOKEN": token}
    rc = run_cmd(
        log,
        ["gh", "api", f"/repos/{owner}/{name}/pages", "-q", ".html_url"],
        env=env, check=False,
    )
    if rc == 0:
        run_cmd(log, ["gh", "api", "-X", "PUT", f"/repos/{owner}/{name}/pages",
                      "-f", "source[branch]=gh-pages", "-f", "source[path]=/"],
                env=env, check=False)
    else:
        run_cmd(log, ["gh", "api", "-X", "POST", f"/repos/{owner}/{name}/pages",
                      "-f", "source[branch]=gh-pages", "-f", "source[path]=/"],
                env=env, check=False)
