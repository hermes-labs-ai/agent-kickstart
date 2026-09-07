"""Path selection in the repository-local Hermes Gate runner.

A deleted file is a real change. The runner must still hand it to Git-aware
checks while withholding it from tools that open the files themselves.
"""

import importlib.util
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

# The runner reads its profile with tomllib and refuses to import on anything
# older. Agent Kickstart itself still supports Python 3.9, so the product tests
# must keep running there; only this module's subject is unavailable.
if sys.version_info < (3, 11):
    raise unittest.SkipTest("the Hermes Gate runner requires Python 3.11 or newer")

RUNNER = Path(__file__).resolve().parent.parent / ".hermes" / "hermes_gate_runner.py"

PROFILE = """
version = 1

[gate]
fast_budget_seconds = 30.0
exclusions = []

[[fast]]
name = "live-tool"
argv = ["python3", "-c", "raise SystemExit(0)", "{files}"]
timeout_seconds = 10.0
globs = ["**/*.txt"]

[[fast]]
name = "diff-check"
argv = ["python3", "-c", "raise SystemExit(0)", "diff-check", "{files}"]
timeout_seconds = 10.0
globs = ["**/*"]
"""


def load_runner():
    spec = importlib.util.spec_from_file_location("hermes_gate_runner", RUNNER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def profiled_root(directory):
    """A root holding kept.txt on disk; gone.txt is a path that no longer exists."""
    root = Path(directory)
    (root / ".hermes").mkdir()
    (root / ".hermes" / "gate.toml").write_text(PROFILE)
    (root / "kept.txt").write_text("kept\n")
    return root


def checks_by_name(result):
    return {str(check["name"]): check for check in result["checks"]}


class DeletedPathSelectionTests(unittest.TestCase):
    def setUp(self):
        self.runner = load_runner()

    def test_a_deleted_path_still_reaches_the_git_aware_check(self):
        with TemporaryDirectory() as directory:
            root = profiled_root(directory)

            result = self.runner.run("fast", root=root, files=["kept.txt", "gone.txt"])

            self.assertEqual(result["status"], "PASS", result["reason"])
            self.assertIn("gone.txt", checks_by_name(result)["diff-check"]["argv"])

    def test_a_deleted_path_is_withheld_from_tools_that_open_files(self):
        with TemporaryDirectory() as directory:
            root = profiled_root(directory)

            result = self.runner.run("fast", root=root, files=["kept.txt", "gone.txt"])

            live = checks_by_name(result)["live-tool"]["argv"]
            self.assertIn("kept.txt", live)
            self.assertNotIn("gone.txt", live)

    def test_a_deletion_only_change_is_still_gated(self):
        with TemporaryDirectory() as directory:
            root = profiled_root(directory)

            result = self.runner.run("fast", root=root, files=["gone.txt"])

            # Previously every path was dropped before selection, so a
            # deletion-only change reported "no changed files" and ran nothing.
            self.assertEqual(result["status"], "PASS", result["reason"])
            names = checks_by_name(result)
            self.assertIn("diff-check", names)
            self.assertNotIn("live-tool", names)


class GateFailureTests(unittest.TestCase):
    def setUp(self):
        self.runner = load_runner()

    def test_each_failed_git_inventory_command_fails_the_gate(self):
        commands = ("diff", "diff", "ls-files")
        for failed_index, command in enumerate(commands):
            with self.subTest(command=command, occurrence=failed_index):
                responses = [
                    self.runner.subprocess.CompletedProcess([], 0, stdout=b"kept.txt\0", stderr=b"")
                    for _ in range(failed_index)
                ]
                responses.append(
                    self.runner.subprocess.CompletedProcess(
                        [], 128, stdout=b"partial.txt\0", stderr=b"inventory error"
                    )
                )
                with TemporaryDirectory() as directory:
                    root = profiled_root(directory)
                    with patch.object(self.runner.subprocess, "run", side_effect=responses) as run:
                        result = self.runner.run("fast", root=root)

                self.assertEqual(result["status"], "FAIL")
                self.assertEqual(result["checks"], [])
                self.assertIn("changed-file inventory failed", result["reason"])
                self.assertIn("inventory error", result["reason"])
                self.assertEqual(run.call_count, failed_index + 1)

    def test_execute_reports_ordinary_launch_errors_as_structured_failures(self):
        failures = (
            PermissionError(13, "Permission denied"),
            OSError(8, "Exec format error"),
        )
        for failure in failures:
            with self.subTest(error=failure.strerror):
                with patch.object(self.runner.subprocess, "Popen", side_effect=failure):
                    result = self.runner._execute(
                        ["broken-check"], Path("/tmp"), 1.0, "launch-check"
                    )

                self.assertEqual(result["status"], "FAIL")
                self.assertEqual(result["name"], "launch-check")
                self.assertIn("launch-check launch failed", result["reason"])
                self.assertIn(failure.strerror, result["reason"])


if __name__ == "__main__":
    unittest.main()
