#!/usr/bin/env python3
"""Native-only protected wg-easy operations. JSON stdin/stdout may contain secrets."""
import fcntl
import http.cookiejar
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

IMAGE = "ghcr.io/wg-easy/wg-easy:15.4.0@sha256:0e7bc9d34e86ddcaa92bc700d4d7dc9b33291dbc07ac8d13382f7c2095f949ec"
BASE = Path("/opt/mobile-ssh-vpn")


class OperationError(Exception):
    pass


def run(argv):
    result = subprocess.run(argv, capture_output=True, timeout=600, check=False)
    if result.returncode:
        # Do not expose subprocess output: it can include environment/config.
        raise OperationError("Command failed: " + argv[0])
    return result.stdout.decode("utf-8", "replace")


def wait_for_cloud_init():
    if not shutil.which("cloud-init"):
        return
    try:
        result = subprocess.run(["cloud-init", "status", "--wait", "--format", "json"],
                                capture_output=True, timeout=180, check=False)
        status = json.loads(result.stdout).get("status")
    except subprocess.TimeoutExpired:
        raise OperationError("Cloud initialization did not finish within three minutes") from None
    except (ValueError, AttributeError):
        raise OperationError("Could not verify cloud initialization status") from None
    # Exit 2 means completed with recoverable errors on cloud-init >=23.4.
    # A degraded result is safe to continue only once its status is actually done.
    if not (status == "done" and result.returncode in (0, 2)
            or status == "disabled" and result.returncode == 0):
        raise OperationError("Cloud initialization did not complete successfully")


def apt(args, timeout):
    deadline = time.monotonic() + timeout
    environment = {**os.environ, "LC_ALL": "C", "DEBIAN_FRONTEND": "noninteractive",
                   "APT_LISTCHANGES_FRONTEND": "none", "NEEDRESTART_MODE": "a"}
    command = ["apt-get", "-o", "DPkg::Lock::Timeout=120", *args]
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise OperationError("Package installation timed out; retry after system updates finish")
        try:
            result = subprocess.run(command, capture_output=True, timeout=remaining,
                                    check=False, env=environment)
        except subprocess.TimeoutExpired:
            raise OperationError("Package installation timed out; retry after system updates finish") from None
        if result.returncode == 0:
            return
        # DPkg's timeout covers the package database lock, but apt update's list
        # lock needs its own bounded retry when apt-daily is running at boot.
        error = result.stderr.decode("utf-8", "replace").lower()
        if not any(message in error for message in ("could not get lock", "unable to acquire", "unable to lock")):
            raise OperationError("Command failed: apt-get")
        time.sleep(min(2, max(0, deadline - time.monotonic())))


def install_docker():
    release = Path("/etc/os-release").read_text()
    if "ID=ubuntu" not in release or not re.search(r'VERSION_ID="?24\.04', release):
        raise OperationError("Automatic installation requires Ubuntu 24.04")
    wait_for_cloud_init()
    apt(["update"], timeout=120)
    apt(["install", "-y", "docker.io", "docker-compose-v2", "iptables"], timeout=300)


def private_json(path, value):
    temporary = path.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(value, handle)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def compose(root, initializing=False):
    service = {
        "image": IMAGE, "container_name": "mobile-ssh-wg-" + root.name,
        "restart": "unless-stopped",
        "environment": {"INSECURE": "true", "HOST": "0.0.0.0", "PORT": "51821"},
        "volumes": [str(root / "wireguard") + ":/etc/wireguard", "/lib/modules:/lib/modules:ro"],
        "ports": ["51820:51820/udp", "127.0.0.1:51821:51821/tcp"],
        "cap_add": ["NET_ADMIN", "SYS_MODULE"],
        "sysctls": {"net.ipv4.ip_forward": 1, "net.ipv4.conf.all.src_valid_mark": 1,
                     "net.ipv6.conf.all.disable_ipv6": 0, "net.ipv6.conf.all.forwarding": 1,
                     "net.ipv6.conf.default.forwarding": 1},
        "networks": {"wg": {"ipv4_address": "10.42.42.42", "ipv6_address": "fdcc:ad94:bacf:61a3::2a"}},
    }
    if initializing:
        service["env_file"] = [str(root / "init.env")]
    return {"services": {"wg-easy": service}, "networks": {"wg": {
        "driver": "bridge", "enable_ipv6": True, "ipam": {"config": [
            {"subnet": "10.42.42.0/24"}, {"subnet": "fdcc:ad94:bacf:61a3::/64"}]}}}}


def compose_run(root, *args):
    return run(["docker", "compose", "--project-name", "mssh-" + root.name,
                "--file", str(root / "compose.json"), *args])


class API:
    def __init__(self, secrets):
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        result = self.request("POST", "/api/auth/password", {**secrets, "remember": False})
        if not isinstance(result, dict) or result.get("status") != "success":
            raise OperationError("wg-easy administrator authentication is incomplete")

    def request(self, method, path, data=None, raw=False):
        payload = None if data is None else json.dumps(data).encode()
        request = urllib.request.Request("http://127.0.0.1:51821" + path, data=payload, method=method,
                                         headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=20) as response:
                body = response.read(2 * 1024 * 1024).decode()
                return body if raw else json.loads(body) if body else {}
        except urllib.error.HTTPError as error:
            raise OperationError("wg-easy rejected request (HTTP %d)" % error.code) from None
        except (OSError, ValueError):
            raise OperationError("wg-easy API is unavailable") from None

    def clients(self):
        value = self.request("GET", "/api/client")
        if not isinstance(value, list):
            raise OperationError("Unexpected wg-easy client response")
        return value


def wait_api(secrets):
    for attempt in range(60):
        try:
            return API(secrets)
        except OperationError:
            if attempt == 59:
                raise
            time.sleep(2)


def create_client(root, api, args, request):
    key = str(args.get("clientKey", request.get("operationId", root.name)))
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,96}", key):
        raise OperationError("Invalid client operation id")
    name = "Mobile SSH " + key
    matches = [item for item in api.clients() if item.get("name") == name]
    if len(matches) > 1:
        raise OperationError("Multiple clients match this operation; review the server")
    if not matches:
        api.request("POST", "/api/client", {"name": name, "expiresAt": None})
        matches = [item for item in api.clients() if item.get("name") == name]
    if len(matches) != 1:
        raise OperationError("Could not reconcile created WireGuard client")
    client_id = str(matches[0]["id"])
    if not client_id.isdigit():
        raise OperationError("Invalid WireGuard client id")
    config = api.request("GET", "/api/client/" + client_id + "/configuration", raw=True)
    if "[Interface]" not in config or "[Peer]" not in config:
        raise OperationError("Invalid WireGuard configuration response")
    return {"clientId": client_id, "config": config}


def bootstrap(root, request, args):
    try:
        endpoint = ipaddress.ip_address(args.get("endpoint", request.get("host", "")))
    except ValueError:
        raise OperationError("A public IPv4 endpoint is required") from None
    if endpoint.version != 4 or not endpoint.is_global:
        raise OperationError("A public IPv4 endpoint is required")
    if args.get("image", IMAGE) != IMAGE or int(args.get("udpPort", 51820)) != 51820:
        raise OperationError("Unsupported wg-easy image or port")
    if not (root / "credentials.json").exists():
        password = args.get("adminPassword", request.get("adminPassword", ""))
        if not isinstance(password, str) or len(password) < 24 or re.search(r"[\r\n\x00]", password):
            raise OperationError("Native executor must supply a strong administrator password")
        if any(BASE.glob("*/credentials.json")):
            raise OperationError("This host already contains another managed VPN deployment")
        private_json(root / "credentials.json", {"username": "mobilessh", "password": password})
    secrets = json.loads((root / "credentials.json").read_text())
    if not shutil.which("docker"):
        install_docker()
    run(["systemctl", "enable", "--now", "docker"])
    # Preserve provider firewall chains, especially OCI iSCSI rules.
    run(["modprobe", "wireguard"])
    initializing = not (root / "initialized").exists()
    if initializing:
        values = {"INIT_ENABLED": "true", "INIT_USERNAME": secrets["username"],
                  "INIT_PASSWORD": secrets["password"], "INIT_HOST": str(endpoint),
                  "INIT_PORT": "51820", "INIT_DNS": "1.1.1.1,1.0.0.1",
                  "INIT_IPV4_CIDR": "10.8.0.0/24", "INIT_IPV6_CIDR": "fd00:8::/64",
                  "INIT_ALLOWED_IPS": "0.0.0.0/0,::/0"}
        fd = os.open(root / "init.env", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write("".join(key + "='" + value.replace("'", "\\'") + "'\n" for key, value in values.items()))
    private_json(root / "compose.json", compose(root, initializing))
    compose_run(root, "pull")
    compose_run(root, "up", "-d")
    api = wait_api(secrets)
    if initializing:
        (root / "initialized").touch(mode=0o600)
        private_json(root / "compose.json", compose(root))
        compose_run(root, "up", "-d", "--force-recreate")
        (root / "init.env").unlink(missing_ok=True)
        api = wait_api(secrets)
    run(["docker", "exec", "mobile-ssh-wg-" + root.name, "wg", "show", "wg0"])
    return {"healthy": True, "image": IMAGE, **create_client(root, api, args, request)}


def operate(request):
    if os.geteuid() != 0:
        raise OperationError("Protected operation requires sudo")
    deployment_id = request.get("deploymentId", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", deployment_id):
        raise OperationError("Invalid deployment id")
    operation, args = request.get("operation"), request.get("args", {})
    root = BASE / deployment_id
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.mkdir(mode=0o700, exist_ok=True)
    os.chmod(root, 0o700)
    with (root / "lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        if operation == "bootstrap":
            return bootstrap(root, request, args)
        if operation == "delete":
            if (root / "compose.json").exists():
                compose_run(root, "down", "--remove-orphans")
            for child in root.iterdir():
                if child.name != "lock":
                    shutil.rmtree(child) if child.is_dir() else child.unlink()
            return {"deleted": True}
        if not (root / "credentials.json").exists():
            raise OperationError("Managed VPN deployment does not exist on this host")
        api = wait_api(json.loads((root / "credentials.json").read_text()))
        if operation == "health":
            run(["docker", "exec", "mobile-ssh-wg-" + root.name, "wg", "show", "wg0"])
            clients = [{key: item.get(key) for key in ("id", "name", "enabled")} for item in api.clients()]
            return {"healthy": True, "clients": clients, "image": IMAGE}
        if operation == "createClient":
            return create_client(root, api, args, request)
        if operation == "revokeClient":
            client_id = str(args.get("clientId", ""))
            if not client_id.isdigit():
                raise OperationError("Invalid WireGuard client id")
            if any(str(item["id"]) == client_id for item in api.clients()):
                api.request("DELETE", "/api/client/" + client_id)
            return {"revoked": True, "clientId": client_id}
        raise OperationError("Unsupported protected operation")


if __name__ == "__main__":
    try:
        os.umask(0o077)
        payload = sys.stdin.read(256 * 1024 + 1)
        if len(payload) > 256 * 1024:
            raise OperationError("Request exceeds size limit")
        print(json.dumps(operate(json.loads(payload)), separators=(",", ":")))
    except Exception as error:
        message = str(error) if isinstance(error, OperationError) else "Protected VPN operation failed"
        print(json.dumps({"error": {"code": "vpn_operation_failed", "message": message}}))
        sys.exit(1)
