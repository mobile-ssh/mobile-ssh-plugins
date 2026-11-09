"""Installer invariants without executing Docker, SSH or any network request."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / "server" / "vpn.py"
spec = importlib.util.spec_from_file_location("vpn_installer", source)
vpn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vpn)


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

    def test_password_login_uses_wg_easy_15_4_auth_contract(self):
        # v15.4.0/src/server/api/auth/password.post.ts replaced POST /api/session.
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

    def test_untrusted_deployment_path_is_rejected_before_filesystem_changes(self):
        with patch.object(vpn.os, "geteuid", return_value=0):
            with self.assertRaises(vpn.OperationError):
                vpn.operate({"deploymentId": "../../etc", "operation": "delete"})


if __name__ == "__main__":
    unittest.main()
