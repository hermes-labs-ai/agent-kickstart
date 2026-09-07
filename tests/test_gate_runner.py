"""Path selection in the repository-local Hermes Gate runner.

A deleted file is a real change. The runner must still hand it to Git-aware
checks while withholding it from tools that open the files themselves.
"""

import importlib.util
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

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


if __name__ == "__main__":
    unittest.main()
