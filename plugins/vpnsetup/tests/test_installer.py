"""Installer invariants without executing Docker, SSH or any network request."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / "server" / "vpn.py"
spec = importlib.util.spec_from_file_location("vpn_installer", source)
vpn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vpn)

OLD = "ghcr.io/wg-easy/wg-easy:15.4.0@sha256:0e7bc9d34e86ddcaa92bc700d4d7dc9b33291dbc07ac8d13382f7c2095f949ec"


class Host:
    """Docker on a deployment host: the container's image, whether it runs, its health and its data directory."""

    def __init__(self, root, running=OLD, broken=(), pull_fails=False):
        self.root, self.running, self.broken, self.pull_fails = root, running, set(broken), pull_fails
        self.started, self.drops, self.crash, self.attempts = running is not None, set(), None, []
        self.calls, self.at_start = [], []
        root.mkdir(mode=0o700)
        (root / "wireguard").mkdir()
        (root / "wireguard" / "wg-easy.db").write_text("schema 15.4.0")
        vpn.private_json(root / "credentials.json", {"username": "mobilessh", "password": "example-password"})
        (root / "initialized").touch()
        vpn.private_json(root / "compose.json", {**vpn.compose(root), "services": {"wg-easy": {
            **vpn.compose(root)["services"]["wg-easy"], "image": running}}})

    def image(self):
        return json.loads((self.root / "compose.json").read_text())["services"]["wg-easy"]["image"]

    def run(self, argv):
        self.calls.append(argv)
        if self.crash and self.crash(argv):
            raise SystemExit("power lost")  # Not an Exception: nothing in vpn.py handles it, as with a reboot.
        if argv[:2] == ["docker", "pull"]:
            if self.pull_fails:
                raise self.pull_fails
            return ""
        if argv[:2] == ["docker", "inspect"]:
            if self.running is None:
                raise vpn.OperationError("Command failed: docker")
            return json.dumps(self.running) + "\n"
        if argv[:2] == ["docker", "exec"]:
            if not self.started or self.running in self.broken:
                raise vpn.OperationError("Command failed: docker")
            return "interface: wg0\n"
        if argv[:2] == ["docker", "compose"]:
            command = argv[6:]
            if command[:1] == ["stop"]:
                self.started = False  # unless-stopped never restarts a container stopped like this
            # Plain `up` leaves a running container of the configured image alone.
            if command[:1] == ["up"] and ("--force-recreate" in command or not self.started or self.running != self.image()):
                self.running, self.started = self.image(), True
                backup = self.root / "wireguard.previous"
                self.at_start.append((self.running, backup.exists() and (backup / "wg-easy.db").read_text(),
                                      backup.exists() and backup.stat().st_mode & 0o777))
                # Starting migrates the database; an older version cannot run on a migrated one.
                database = self.root / "wireguard" / "wg-easy.db"
                schema, version = database.read_text().split()[1], vpn.image_version(self.running)
                if tuple(map(int, version.split("."))) < tuple(map(int, schema.split("."))):
                    self.broken.add(self.running)
                else:
                    database.write_text("schema " + version)
            return ""
        raise AssertionError(argv)

    def wait_api(self, _secrets, attempts=60):
        self.attempts.append(attempts)
        if not self.started or self.running in self.broken:
            raise vpn.OperationError("wg-easy API is unavailable")
        clients = [] if self.running in self.drops else [{"id": 1, "name": "Mobile SSH a", "enabled": True,
                                                          "privateKey": "client-private", "publicKey": "client-public"}]
        return SimpleNamespace(clients=lambda: clients)

    def commands(self):
        return [call[6] if call[:2] == ["docker", "compose"] else call[1] for call in self.calls]

    def files(self):
        return sorted(child.name for child in self.root.iterdir())


class InstallerTests(unittest.TestCase):
    def test_cloud_init_wait_accepts_completed_or_completed_degraded_status(self):
        for returncode in (0, 2):
            with self.subTest(returncode=returncode), \
                    patch.object(vpn.shutil, "which", return_value="/usr/bin/cloud-init"), \
                    patch.object(vpn.subprocess, "run", return_value=SimpleNamespace(
                        returncode=returncode, stdout=b'{"status":"done"}')) as execute:
                vpn.wait_for_cloud_init()
                self.assertEqual(execute.call_args.args[0],
                                 ["cloud-init", "status", "--wait", "--format", "json"])
                self.assertEqual(execute.call_args.kwargs["timeout"], 180)

    def test_fatal_or_still_running_cloud_init_blocks_package_installation(self):
        for status, returncode in (("error", 1), ("done", 1), ("running", 0), ("running", 2)):
            with self.subTest(status=status, returncode=returncode), \
                    patch.object(vpn.Path, "read_text", return_value='ID=ubuntu\nVERSION_ID="24.04"'), \
                    patch.object(vpn.shutil, "which", return_value="/usr/bin/cloud-init"), \
                    patch.object(vpn.subprocess, "run", return_value=SimpleNamespace(
                        returncode=returncode, stdout=json.dumps({"status": status}).encode())), \
                    patch.object(vpn, "apt") as packages:
                with self.assertRaises(vpn.OperationError):
                    vpn.install_docker()
                packages.assert_not_called()

    def test_cloud_init_timeout_blocks_package_installation(self):
        with patch.object(vpn.Path, "read_text", return_value='ID=ubuntu\nVERSION_ID="24.04"'), \
                patch.object(vpn.shutil, "which", return_value="/usr/bin/cloud-init"), \
                patch.object(vpn.subprocess, "run", side_effect=vpn.subprocess.TimeoutExpired("cloud-init", 180)), \
                patch.object(vpn, "apt") as packages:
            with self.assertRaisesRegex(vpn.OperationError, "three minutes"):
                vpn.install_docker()
            packages.assert_not_called()

    def test_apt_list_lock_retries_without_exposing_output(self):
        lock = SimpleNamespace(returncode=100, stderr=b"Could not get lock /var/lib/apt/lists/lock secret")
        success = SimpleNamespace(returncode=0)
        with patch.object(vpn.subprocess, "run", side_effect=[lock, success]) as execute, \
                patch.object(vpn.time, "sleep"):
            vpn.apt(["update"], timeout=120)
        self.assertEqual(execute.call_count, 2)
        self.assertEqual(execute.call_args.args[0], ["apt-get", "-o", "DPkg::Lock::Timeout=120", "update"])
        self.assertEqual(execute.call_args.kwargs["env"]["DEBIAN_FRONTEND"], "noninteractive")

    def test_apt_lock_retry_is_bounded_and_other_failures_do_not_retry(self):
        lock = SimpleNamespace(returncode=100, stderr=b"Unable to acquire the dpkg frontend lock")
        with patch.object(vpn.subprocess, "run", return_value=lock) as execute, \
                patch.object(vpn.time, "monotonic", side_effect=[0, 0, 120, 120]), \
                patch.object(vpn.time, "sleep"):
            with self.assertRaisesRegex(vpn.OperationError, "timed out"):
                vpn.apt(["update"], timeout=120)
            self.assertEqual(execute.call_count, 1)
        with patch.object(vpn.subprocess, "run", return_value=SimpleNamespace(
                returncode=100, stderr=b"secret invalid repository")) as execute:
            with self.assertRaisesRegex(vpn.OperationError, "^Command failed: apt-get$"):
                vpn.apt(["update"], timeout=120)
            self.assertEqual(execute.call_count, 1)

    def test_password_login_uses_wg_easy_15_auth_contract(self):
        # v15.4.0/src/server/api/auth/password.post.ts replaced POST /api/session;
        # v15.5.0 keeps the route and body (it only adds security logging).
        requests = []

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def read(self, _):
                return b'{"status":"success"}'

        class Transport:
            def open(self, request, timeout):
                if request.full_url != "http://127.0.0.1:51821/api/auth/password":
                    raise vpn.urllib.error.HTTPError(request.full_url, 404, "Not found", {}, None)
                requests.append((request.method, json.loads(request.data), timeout))
                return Response()

        with patch.object(vpn.urllib.request, "build_opener", return_value=Transport()):
            vpn.API({"username": "mobilessh", "password": "example-password"})
        self.assertEqual(requests, [("POST", {
            "username": "mobilessh", "password": "example-password", "remember": False
        }, 20)])

    def test_partial_or_unexpected_login_is_not_treated_as_authenticated(self):
        for result in ({"status": "TOTP_REQUIRED"}, {}, {"status": "INVALID_TOTP_CODE"}, []):
            with self.subTest(result=result), patch.object(vpn.API, "request", return_value=result):
                with self.assertRaisesRegex(vpn.OperationError, "authentication is incomplete"):
                    vpn.API({"username": "mobilessh", "password": "example-password"})

    def test_management_port_is_loopback_and_image_is_immutable(self):
        service = vpn.compose(Path("/opt/mobile-ssh-vpn/test"))["services"]["wg-easy"]
        self.assertIn("127.0.0.1:51821:51821/tcp", service["ports"])
        self.assertNotIn("51821:51821/tcp", service["ports"])
        self.assertIn("@sha256:", service["image"])
        self.assertNotIn("env_file", service)

    def test_native_client_operation_reconciles_instead_of_duplicate_creation(self):
        class API:
            def clients(self):
                return [{"id": 7, "name": "Mobile SSH stable-operation"}]

            def request(self, method, path, data=None, raw=False):
                self.assertions.append((method, path))
                return "[Interface]\nPrivateKey = private\n[Peer]\nPublicKey = public\n"

        api = API()
        api.assertions = []
        result = vpn.create_client(Path("/test"), api, {"clientKey": "stable-operation"}, {})
        self.assertEqual(result["clientId"], "7")
        self.assertEqual(api.assertions, [("GET", "/api/client/7/configuration")])

    def test_duplicate_matches_stop_before_returning_any_config(self):
        class API:
            def clients(self):
                return [{"id": 1, "name": "Mobile SSH x"}, {"id": 2, "name": "Mobile SSH x"}]
        with self.assertRaises(vpn.OperationError):
            vpn.create_client(Path("/test"), API(), {"clientKey": "x"}, {})

    def test_credentials_file_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "credentials.json"
            vpn.private_json(path, {"password": "example"})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_subprocess_errors_do_not_expose_output(self):
        class Result:
            returncode = 1
            stdout = b"secret-password"
            stderr = b"private-config"
        with patch.object(vpn.subprocess, "run", return_value=Result()):
            with self.assertRaisesRegex(vpn.OperationError, "^Command failed: docker$"):
                vpn.run(["docker", "compose"])

    def update(self, host, args=None):
        with patch.object(vpn, "run", side_effect=host.run), patch.object(vpn, "wait_api", side_effect=host.wait_api):
            return vpn.update(host.root, {"image": vpn.IMAGE} if args is None else args)

    def test_image_pin_is_a_digest_pinned_wg_easy_release(self):
        self.assertRegex(vpn.IMAGE, r"^ghcr\.io/wg-easy/wg-easy:15\.5\.0@sha256:[0-9a-f]{64}$")
        self.assertEqual(vpn.image_version(vpn.IMAGE), "15.5.0")
        self.assertEqual(vpn.image_version(OLD), "15.4.0")
        self.assertEqual(vpn.image_version("ghcr.io/wg-easy/wg-easy:15.4.0"), "15.4.0")
        for other in ("ghcr.io/wg-easy/wg-easy:latest", "ghcr.io/wg-easy/wg-easy:15", "example.org/wg-easy:15.4.0",
                      "ghcr.io/wg-easy/wg-easy@sha256:" + "0" * 64, "", None):
            self.assertIsNone(vpn.image_version(other), other)

    def test_update_downloads_before_changing_anything(self):
        for failure in (vpn.OperationError("Command failed: docker"), vpn.subprocess.TimeoutExpired("docker", 600)):
            with self.subTest(failure=type(failure).__name__):
                self.download_fails(failure)

    def download_fails(self, failure):
        with tempfile.TemporaryDirectory() as directory:
            host = Host(Path(directory) / "dep", pull_fails=failure)
            before = {name: (host.root / name).read_bytes() for name in ("compose.json", "credentials.json")}
            with self.assertRaisesRegex(vpn.OperationError, "^Could not download the WireGuard update; the VPN was not changed$") as raised:
                self.update(host)
            self.assertEqual(raised.exception.code, "update_not_downloaded")
            self.assertEqual(host.calls, [["docker", "pull", vpn.IMAGE]])
            self.assertEqual({name: (host.root / name).read_bytes() for name in before}, before)
            self.assertEqual((host.root / "wireguard" / "wg-easy.db").read_text(), "schema 15.4.0")
            self.assertEqual(host.files(), ["compose.json", "credentials.json", "initialized", "wireguard"])

    def test_update_replaces_the_image_keeping_data_and_removes_its_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Host(Path(directory) / "dep")
            result = self.update(host)
            self.assertEqual(result, {"healthy": True, "updated": True, "version": "15.5.0", "current": True})
            self.assertEqual(host.commands(), ["pull", "inspect", "stop", "up", "exec"])
            self.assertEqual(host.calls[0], ["docker", "pull", vpn.IMAGE])
            self.assertEqual(host.attempts, [1, 60], "one look at the clients before stopping, then the full wait")
            self.assertEqual(host.calls[3][-3:], ["up", "-d", "--force-recreate"])
            # The copy was complete, root-only and taken from the stopped 15.4.0 data before 15.5.0 started.
            self.assertEqual(host.at_start, [(vpn.IMAGE, "schema 15.4.0", 0o700)])
            service = json.loads((host.root / "compose.json").read_text())["services"]["wg-easy"]
            self.assertEqual(service, vpn.compose(host.root)["services"]["wg-easy"])
            self.assertNotIn("env_file", service)
            self.assertEqual((host.root / "compose.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual((host.root / "wireguard" / "wg-easy.db").read_text(), "schema 15.5.0")
            self.assertEqual(host.files(), ["compose.json", "credentials.json", "initialized", "wireguard"])

    def test_update_of_a_current_deployment_only_verifies_it(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Host(Path(directory) / "dep", running=vpn.IMAGE)
            # A copy left by an interrupted update goes once the running version is verified.
            for name in ("wireguard.previous", "wireguard.previous.tmp", "wireguard.tmp", "wireguard.old"):
                (host.root / name).mkdir()
            vpn.private_json(host.root / "compose.previous.json", {})
            result = self.update(host)
            self.assertEqual(result, {"healthy": True, "updated": False, "version": "15.5.0", "current": True})
            self.assertEqual(host.commands(), ["pull", "inspect", "up", "exec"])
            self.assertEqual(host.calls[2][-2:], ["up", "-d"])
            self.assertEqual(host.at_start, [], "a running current container is neither recreated nor restarted")
            self.assertEqual(host.files(), ["compose.json", "credentials.json", "initialized", "wireguard"])
            host.broken.add(vpn.IMAGE)
            (host.root / "wireguard.previous").mkdir()
            with self.assertRaisesRegex(vpn.OperationError, "API is unavailable"):
                self.update(host)
            self.assertIn("wireguard.previous", host.files(), "an unverified update keeps its copy")

    def test_update_starts_a_current_deployment_left_stopped(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Host(Path(directory) / "dep", running=vpn.IMAGE)
            host.started = False
            self.assertEqual(self.update(host), {"healthy": True, "updated": False, "version": "15.5.0", "current": True})
            self.assertEqual(host.commands(), ["pull", "inspect", "up", "exec"])
            self.assertTrue(host.started)
            self.assertEqual([image for image, _, _ in host.at_start], [vpn.IMAGE])

    def crash_during_forward_step(self, host):
        # Power is lost while compose replaces the stopped 15.4.0 container: compose.json and the copy name the new pin.
        host.crash = lambda argv: argv[6:7] == ["up"] and host.image() == vpn.IMAGE
        with self.assertRaises(SystemExit):
            self.update(host)
        host.crash = None
        self.assertEqual((host.running, host.started, host.image()), (OLD, False, vpn.IMAGE))
        self.assertEqual(json.loads((host.root / "compose.previous.json").read_text())["services"]["wg-easy"]["image"], OLD)

    def test_update_after_an_interrupted_forward_step_keeps_the_copy_of_the_previous_version(self):
        for container in ("stopped", "removed"):
            with self.subTest(container=container), tempfile.TemporaryDirectory() as directory:
                host = Host(Path(directory) / "dep", broken=[vpn.IMAGE])
                self.crash_during_forward_step(host)
                if container == "removed":
                    host.running = None
                host.calls = []
                with self.assertRaisesRegex(vpn.OperationError, "^WireGuard update failed; the previous version was restored$") as raised:
                    self.update(host)
                self.assertEqual(raised.exception.code, "update_rolled_back")
                # The retry neither copied again nor replaced compose.previous.json; 15.4.0 came back on its own data.
                self.assertEqual(host.commands(), ["pull", "inspect", "stop", "up", "stop", "up", "exec"])
                self.assertEqual((host.running, host.started, host.image()), (OLD, True, OLD))
                self.assertEqual((host.root / "wireguard" / "wg-easy.db").read_text(), "schema 15.4.0")
                self.assertEqual(host.files(), ["compose.json", "credentials.json", "initialized", "wireguard"])
        with tempfile.TemporaryDirectory() as directory:
            host = Host(Path(directory) / "dep")
            self.crash_during_forward_step(host)
            self.assertEqual(self.update(host), {"healthy": True, "updated": True, "version": "15.5.0", "current": True})
            self.assertEqual(host.at_start[-1], (vpn.IMAGE, "schema 15.4.0", 0o700))
            self.assertEqual(host.files(), ["compose.json", "credentials.json", "initialized", "wireguard"])

    def test_update_after_an_interrupted_rollback_restores_the_copy(self):
        for recovered in (False, True):
            with self.subTest(recovered=recovered), tempfile.TemporaryDirectory() as directory:
                host = Host(Path(directory) / "dep", broken=[vpn.IMAGE])
                real = vpn.copy_directory

                def copy(source, target):
                    if target.name == "wireguard":
                        raise SystemExit("power lost")  # Rollback stopped 15.5.0, then the VM went down.
                    real(source, target)
                with patch.object(vpn, "copy_directory", side_effect=copy), self.assertRaises(SystemExit):
                    self.update(host)
                self.assertEqual((host.running, host.started, host.image()), (vpn.IMAGE, False, vpn.IMAGE))
                self.assertEqual((host.root / "wireguard" / "wg-easy.db").read_text(), "schema 15.5.0")
                host.calls = []
                if recovered:  # 15.5.0 failed for a passing reason: it now answers and keeps the migrated data.
                    host.broken.clear()
                    self.assertEqual(self.update(host)["updated"], False)
                    self.assertEqual((host.running, host.started), (vpn.IMAGE, True))
                    self.assertEqual(host.commands(), ["pull", "inspect", "up", "exec"])
                else:
                    with self.assertRaisesRegex(vpn.OperationError, "previous version was restored$") as raised:
                        self.update(host)
                    self.assertEqual(raised.exception.code, "update_rolled_back")
                    self.assertEqual(host.commands(), ["pull", "inspect", "up", "stop", "up", "exec"])
                    self.assertEqual((host.running, host.started, host.image()), (OLD, True, OLD))
                    self.assertEqual((host.root / "wireguard" / "wg-easy.db").read_text(), "schema 15.4.0")
                self.assertEqual(host.files(), ["compose.json", "credentials.json", "initialized", "wireguard"])

    def test_update_that_loses_a_client_is_rolled_back(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Host(Path(directory) / "dep")
            host.drops.add(vpn.IMAGE)  # Logs in and brings wg0 up, but its migration lost the client.
            with self.assertRaisesRegex(vpn.OperationError, "previous version was restored$"):
                self.update(host)
            self.assertEqual((host.running, host.image()), (OLD, OLD))
            self.assertEqual((host.root / "wireguard" / "wg-easy.db").read_text(), "schema 15.4.0")
            self.assertEqual(host.files(), ["compose.json", "credentials.json", "initialized", "wireguard"])

    def test_rollback_continues_when_stopping_the_new_version_times_out(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Host(Path(directory) / "dep", broken=[vpn.IMAGE])
            stops = []

            def run(argv):
                if argv[6:7] == ["stop"]:
                    stops.append(argv)
                    if len(stops) == 2:
                        host.calls.append(argv)
                        raise vpn.OperationError("Command timed out: docker")
                return host.run(argv)
            with patch.object(vpn, "run", side_effect=run), patch.object(vpn, "wait_api", side_effect=host.wait_api):
                with self.assertRaisesRegex(vpn.OperationError, "previous version was restored$"):
                    vpn.update(host.root, {"image": vpn.IMAGE})
            self.assertEqual((host.running, host.image()), (OLD, OLD))
            self.assertEqual((host.root / "wireguard" / "wg-easy.db").read_text(), "schema 15.4.0")
        with patch.object(vpn.subprocess, "run", side_effect=vpn.subprocess.TimeoutExpired("docker", 600)):
            with self.assertRaisesRegex(vpn.OperationError, "^Command timed out: docker$"):
                vpn.run(["docker", "compose", "stop"])

    def test_copy_replaces_its_target_without_deleting_it_first(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, text in (("source", "new"), ("target", "old")):
                (root / name).mkdir()
                (root / name / "wg-easy.db").write_text(text)
            renames = []
            real = os.replace

            def replace(source, target):
                renames.append((Path(source).name, Path(target).name, (root / "target").exists()))
                real(source, target)
            with patch.object(vpn.os, "replace", side_effect=replace), patch.object(vpn.shutil, "rmtree", wraps=vpn.shutil.rmtree) as remove:
                vpn.copy_directory(root / "source", root / "target")
            self.assertEqual(renames, [("target", "target.old", True), ("target.tmp", "target", False)])
            self.assertEqual([Path(call.args[0]).name for call in remove.call_args_list], ["target.old"])
            self.assertEqual((root / "target" / "wg-easy.db").read_text(), "new")
            self.assertEqual(sorted(child.name for child in root.iterdir()), ["source", "target"])

    def test_failed_start_restores_previous_data_and_version(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Host(Path(directory) / "dep", broken=[vpn.IMAGE])
            with self.assertRaisesRegex(vpn.OperationError, "^WireGuard update failed; the previous version was restored$"):
                self.update(host)
            self.assertEqual(host.commands(), ["pull", "inspect", "stop", "up", "stop", "up", "exec"])
            self.assertEqual([image for image, _, _ in host.at_start], [vpn.IMAGE, OLD])
            self.assertEqual(host.running, OLD)
            self.assertEqual(host.image(), OLD)
            # 15.4.0 runs on its own copy, not on the database 15.5.0 migrated.
            self.assertEqual((host.root / "wireguard" / "wg-easy.db").read_text(), "schema 15.4.0")
            self.assertEqual(host.files(), ["compose.json", "credentials.json", "initialized", "wireguard"])

    def test_failed_restore_keeps_the_copy_without_exposing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Host(Path(directory) / "dep", broken=[vpn.IMAGE, OLD])
            with self.assertRaisesRegex(vpn.OperationError, "previous version did not restart") as raised:
                self.update(host)
            self.assertNotIn("docker", str(raised.exception))
            self.assertEqual(raised.exception.code, "update_restore_failed")
            self.assertEqual(host.image(), OLD)
            self.assertEqual((host.root / "wireguard.previous" / "wg-easy.db").read_text(), "schema 15.4.0")
            self.assertEqual(json.loads((host.root / "compose.previous.json").read_text())["services"]["wg-easy"]["image"], OLD)

    def test_unexpected_failure_after_stopping_restarts_the_previous_version(self):
        with tempfile.TemporaryDirectory() as directory:
            host = Host(Path(directory) / "dep")
            with patch.object(vpn, "copy_directory", side_effect=[OSError("No space left: secret-path"), None]) as copy:
                with self.assertRaisesRegex(vpn.OperationError, "^WireGuard update failed; the previous version was restored$"):
                    self.update(host)
            copy.assert_called_once()  # Nothing to restore: the data directory was never handed to 15.5.0.
            self.assertEqual(host.commands(), ["pull", "inspect", "stop", "stop", "up", "exec"])
            self.assertEqual(host.running, OLD)
            self.assertEqual((host.root / "wireguard" / "wg-easy.db").read_text(), "schema 15.4.0")

    def test_update_is_refused_before_setup_finishes_or_for_another_image(self):
        for missing in ("credentials.json", "initialized", "compose.json", "wireguard"):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as directory:
                host = Host(Path(directory) / "dep")
                path = host.root / missing
                vpn.shutil.rmtree(path) if path.is_dir() else path.unlink()
                with self.assertRaisesRegex(vpn.OperationError, "^Finish setup before updating$"):
                    self.update(host)
                self.assertEqual(host.calls, [])
        for image in ("ghcr.io/wg-easy/wg-easy:latest", OLD, vpn.IMAGE.split("@")[0]):
            with self.subTest(image=image), tempfile.TemporaryDirectory() as directory:
                host = Host(Path(directory) / "dep")
                with self.assertRaisesRegex(vpn.OperationError, "^Unsupported wg-easy image$"):
                    self.update(host, {"image": image})
                self.assertEqual(host.calls, [])

    def test_update_and_delete_run_under_the_deployment_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / "base"
            base.mkdir(mode=0o700)
            host = Host(base / "dep")
            with patch.object(vpn, "BASE", base), patch.object(vpn.os, "geteuid", return_value=0), \
                    patch.object(vpn, "run", side_effect=host.run), patch.object(vpn, "wait_api", side_effect=host.wait_api):
                # Another invocation holds the real lock file: the update waits for it before touching Docker.
                results = []
                with (host.root / "lock").open("a") as other:
                    fcntl.flock(other.fileno(), fcntl.LOCK_EX)
                    worker = threading.Thread(target=lambda: results.append(vpn.operate(
                        {"deploymentId": "dep", "operation": "update", "args": {"image": vpn.IMAGE}})))
                    worker.start()
                    worker.join(0.5)
                    self.assertTrue(worker.is_alive())
                    self.assertEqual(host.calls, [])
                worker.join(10)
                self.assertTrue(results and results[0]["updated"])
                # Delete still removes everything, including a copy an interrupted update left.
                (host.root / "wireguard.previous").mkdir()
                (host.root / "wireguard.previous.tmp").mkdir()
                vpn.private_json(host.root / "compose.previous.json", {})
                self.assertEqual(vpn.operate({"deploymentId": "dep", "operation": "delete"}), {"deleted": True})
            self.assertEqual(host.calls[-1][6:], ["down", "--remove-orphans"])
            self.assertEqual(host.files(), ["lock"])

    def test_health_reports_the_running_version_and_whether_it_is_pinned(self):
        for running, version in ((OLD, "15.4.0"), (vpn.IMAGE, "15.5.0"), ("example.org/wg:1.2.3", None), (None, None)):
            with self.subTest(running=running), tempfile.TemporaryDirectory() as directory:
                base = Path(directory) / "base"
                base.mkdir(mode=0o700)
                host = Host(base / "dep", running=OLD)
                host.running = running
                with patch.object(vpn, "BASE", base), patch.object(vpn.os, "geteuid", return_value=0), \
                        patch.object(vpn, "run", side_effect=host.run), patch.object(vpn, "wait_api", side_effect=host.wait_api):
                    result = vpn.operate({"deploymentId": "dep", "operation": "health"})
                self.assertIs(result["current"], running == vpn.IMAGE)
                self.assertEqual(result.get("version"), version)
                self.assertEqual("version" in result, version is not None)
                self.assertEqual(result["clients"], [{"id": 1, "name": "Mobile SSH a", "enabled": True}])
                self.assertNotIn("client-private", json.dumps(result))

    @unittest.skipIf(os.geteuid() == 0, "needs a non-root user")
    def test_failures_print_only_a_fixed_code_and_message(self):
        result = subprocess.run([sys.executable, "-I", "-B", str(source)], input=b'{"operation":"update"}',
                                capture_output=True, timeout=60, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout), {"error": {"code": "vpn_operation_failed",
                                                              "message": "Protected operation requires sudo"}})
        self.assertEqual(vpn.OperationError("x", "update_rolled_back").code, "update_rolled_back")

    def test_untrusted_deployment_path_is_rejected_before_filesystem_changes(self):
        with patch.object(vpn.os, "geteuid", return_value=0):
            with self.assertRaises(vpn.OperationError):
                vpn.operate({"deploymentId": "../../etc", "operation": "delete"})


if __name__ == "__main__":
    unittest.main()
