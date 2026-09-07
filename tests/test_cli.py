import json
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from agent_kickstart import __version__, cli, evidence
from agent_kickstart.cli import (
    install, main, plan, render_plan, runtime_findings, start_command,
)


def tree(root: Path):
    return sorted(str(path.relative_to(root)) for path in root.rglob("*"))


class StartCommandTests(unittest.TestCase):
    def test_posix_command_quotes_the_target(self):
        command = start_command(Path("/tmp/project with spaces"), platform="darwin")
        self.assertEqual(
            command,
            'cd -- \'/tmp/project with spaces\' && claude "/kickstart"',
        )

    def test_windows_command_uses_powershell_and_escapes_apostrophes(self):
        command = start_command(Path("C:\\Users\\Roli's Project"), platform="win32")
        self.assertEqual(
            command,
            "Set-Location -LiteralPath 'C:\\Users\\Roli''s Project'; claude '/kickstart'",
        )


class RuntimeRequirementTests(unittest.TestCase):
    @patch("agent_kickstart.cli.subprocess.run")
    @patch("agent_kickstart.cli.shutil.which", return_value="/tmp/fake-command")
    def test_installer_rejects_node_older_than_18_before_writing(
        self, _which, run
    ):
        run.return_value.returncode = 0
        run.return_value.stdout = "v16.20.2\n"
        run.return_value.stderr = ""

        with TemporaryDirectory() as directory:
            target = Path(directory)
            with self.assertRaisesRegex(RuntimeError, "Node.js 18 or newer is required"):
                install(target)
            self.assertEqual(list(target.iterdir()), [])


class NodeProbeTests(unittest.TestCase):
    @patch("agent_kickstart.cli.subprocess.run")
    @patch("agent_kickstart.cli.shutil.which", return_value="/tmp/fake-command")
    def test_the_preview_probe_is_bounded_by_a_timeout(self, _which, run):
        run.return_value.returncode = 0
        run.return_value.stdout = "v18.20.2\n"
        run.return_value.stderr = ""

        runtime_findings()

        self.assertEqual(
            run.call_args.kwargs.get("timeout"), cli.NODE_PROBE_TIMEOUT_SECONDS
        )

    @patch("agent_kickstart.cli.shutil.which", return_value="/tmp/fake-command")
    def test_a_hanging_probe_becomes_an_unknown_finding(self, _which):
        expired = subprocess.TimeoutExpired(cmd=["node", "--version"], timeout=5.0)
        with patch("agent_kickstart.cli.subprocess.run", side_effect=expired):
            findings = runtime_findings()

        self.assertEqual([item["id"] for item in findings], ["runtime.node.version"])
        self.assertEqual(findings[0]["severity"], "unknown")

    @patch("agent_kickstart.cli.shutil.which", return_value="/tmp/fake-command")
    def test_an_unrunnable_probe_leaves_the_preview_intact(self, _which):
        with patch("agent_kickstart.cli.subprocess.run", side_effect=OSError("boom")):
            with TemporaryDirectory() as directory:
                result = plan(Path(directory) / "project")

        self.assertEqual(result["mode"], "preview")
        self.assertIn("runtime.node.version", [item["id"] for item in result["findings"]])
        # "unknown" outranks the warn findings but is not a failure.
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["exitCode"], 0)
        # install() would still refuse (require_runtime() raises on an
        # unreadable version), so no command is offered despite the exit code.
        self.assertIsNone(result["data"]["setupCommands"])
        self.assertIsNone(result["data"]["startCommand"])

    def test_a_missing_runtime_withholds_setup_and_start_commands(self):
        with patch("agent_kickstart.cli.shutil.which", return_value=None):
            with TemporaryDirectory() as directory:
                result = plan(Path(directory) / "project")

        self.assertIn("runtime.claude.missing", [item["id"] for item in result["findings"]])
        self.assertEqual(result["exitCode"], 1)
        self.assertIsNone(result["data"]["setupCommands"])
        self.assertIsNone(result["data"]["startCommand"])

    def test_python_path_does_not_require_git(self):
        with patch(
            "agent_kickstart.cli.shutil.which",
            side_effect=lambda name: None if name == "git" else "/tmp/fake-command",
        ):
            findings = runtime_findings("python")

        self.assertNotIn("runtime.git.missing", [item["id"] for item in findings])

    def test_javascript_path_withholds_the_git_clone_command_without_git(self):
        with patch(
            "agent_kickstart.cli.shutil.which",
            side_effect=lambda name: None if name == "git" else "/tmp/fake-command",
        ):
            with TemporaryDirectory() as directory:
                result = plan(Path(directory) / "project", "javascript")

        self.assertIn("runtime.git.missing", [item["id"] for item in result["findings"]])
        self.assertEqual(result["exitCode"], 1)
        self.assertIsNone(result["data"]["setupCommands"])
        self.assertIsNone(result["data"]["startCommand"])


class PlanTests(unittest.TestCase):
    def test_preview_writes_nothing_inside_an_isolated_temp_fixture(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            before = tree(root)
            result = plan(root / "my-first-project")
            self.assertEqual(result["mode"], "preview")
            self.assertEqual(tree(root), before)
            self.assertFalse((root / "my-first-project").exists())

    def test_preview_describes_every_managed_file_as_a_creation(self):
        with TemporaryDirectory() as directory:
            result = plan(Path(directory) / "fresh")
            data = result["data"]
            actions = {row["action"] for row in data["files"]}
            self.assertEqual(actions, {"create"})
            self.assertEqual(data["summary"]["create"], len(data["files"]))
            self.assertIn(".claude/commands/kickstart.md", [row["path"] for row in data["files"]])
            self.assertIn("agent-kickstart/RUNTIME.md", [row["path"] for row in data["files"]])

    def test_python_and_javascript_starter_paths_differ_in_commands_only(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / "project"
            python = plan(target, "python")["data"]
            javascript = plan(target, "javascript")["data"]

            self.assertEqual(python["files"], javascript["files"])
            self.assertEqual(python["startCommand"], javascript["startCommand"])
            self.assertEqual(python["setupCommands"]["posix"][0], "pip install agent-kickstart")
            self.assertIn("git clone", javascript["setupCommands"]["posix"][0])
            self.assertEqual(javascript["setupCommands"]["posix"][-1], "bash install.sh")
            self.assertEqual(javascript["setupCommands"]["windows"][-1], ".\\install.ps1")

    def test_unknown_starter_path_is_refused_before_any_work(self):
        with TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "Unknown starter path"):
                plan(Path(directory), "rust")

    def test_preview_reports_a_conflicting_file_as_a_blocking_finding(self):
        with TemporaryDirectory() as directory:
            target = Path(directory)
            settings = target / ".claude" / "settings.json"
            settings.parent.mkdir(parents=True)
            settings.write_text('{"mine": true}\n')

            result = plan(target)
            actions = {row["path"]: row["action"] for row in result["data"]["files"]}
            self.assertEqual(actions[".claude/settings.json"], "conflict")
            self.assertEqual(result["status"], "fail")
            self.assertEqual(result["exitCode"], 1)
            self.assertIn(
                "target.conflicting-files",
                [item["id"] for item in result["findings"]],
            )

    def test_a_conflicting_plan_offers_no_runnable_command(self):
        with TemporaryDirectory() as directory:
            target = Path(directory)
            settings = target / ".claude" / "settings.json"
            settings.parent.mkdir(parents=True)
            settings.write_text('{"mine": true}\n')

            result = plan(target)

            # The JSON record carries no command an install would refuse.
            self.assertIsNone(result["data"]["setupCommands"])
            self.assertIsNone(result["data"]["startCommand"])
            self.assertNotIn("agent-kickstart install", json.dumps(result))

            # Neither does the human rendering of the same result.
            rendered = render_plan(result)
            self.assertNotIn("pip install agent-kickstart", rendered)
            self.assertNotIn('claude "/kickstart"', rendered)
            self.assertNotIn("$ ", rendered, "no pasteable command line at all")
            self.assertIn("No install command is offered", rendered)

    def test_a_clean_plan_still_offers_its_commands(self):
        with TemporaryDirectory() as directory:
            result = plan(Path(directory) / "fresh")

            self.assertIsNotNone(result["data"]["setupCommands"])
            self.assertIsNotNone(result["data"]["startCommand"])
            self.assertIn("pip install agent-kickstart", render_plan(result))

    def test_input_hash_is_stable_for_the_same_input_and_moves_with_it(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / "project"
            first = plan(target, "python")["inputHash"]
            again = plan(target, "python")["inputHash"]
            other = plan(target, "javascript")["inputHash"]
            self.assertEqual(first, again)
            self.assertNotEqual(first, other)
            self.assertTrue(first.startswith("sha256:"))


class TargetGuardTests(unittest.TestCase):
    def test_a_file_target_fails_readably_instead_of_raising_a_traceback(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / "notes.txt"
            target.write_text("mine\n")

            self.assertEqual(main(["install", "--target", str(target)]), 1)
            self.assertEqual(target.read_text(), "mine\n")

    def test_home_directory_root_is_refused_and_offered_no_command(self):
        result = plan(Path.home())
        identifiers = [item["id"] for item in result["findings"]]
        self.assertIn("target.home-root", identifiers)
        self.assertEqual(result["status"], "fail")
        self.assertTrue(result["data"]["refused"])
        self.assertIsNone(result["data"]["setupCommands"])
        self.assertIsNone(result["data"]["startCommand"])
        self.assertEqual(result["data"]["files"], [])

    def test_system_paths_are_refused(self):
        result = plan(Path("/usr"))
        self.assertIn("target.system-path", [item["id"] for item in result["findings"]])
        self.assertEqual(result["exitCode"], 1)

    def test_a_folder_beneath_a_system_root_is_refused_before_anything_is_written(self):
        # A path that does not exist: refusal comes from the guard, not from
        # anything found on disk, and nothing under /usr is created or read.
        beneath = Path("/usr/local/lib/agent-kickstart-regression")

        result = plan(beneath)

        self.assertIn("target.system-path", [item["id"] for item in result["findings"]])
        self.assertTrue(result["data"]["refused"])
        self.assertEqual(result["data"]["files"], [])
        self.assertIsNone(result["data"]["setupCommands"])
        self.assertIsNone(result["data"]["startCommand"])
        self.assertEqual(result["exitCode"], 1)
        # install() refuses the same target before it opens the asset tree.
        self.assertEqual(main(["install", "--target", str(beneath)]), 1)
        self.assertFalse(beneath.exists())

    def test_posix_roots_match_descendants_and_stay_case_sensitive(self):
        self.assertEqual(cli.protected_root("/usr"), "/usr")
        self.assertEqual(cli.protected_root("/usr/local/lib/kickstart"), "/usr")
        self.assertEqual(cli.protected_root("/Library/Preferences/kickstart"), "/Library")
        # POSIX is case-sensitive, so a folder a person owns is not a root.
        self.assertIsNone(cli.protected_root("/USR/local"))
        # Component-wise comparison: /usrland is not inside /usr.
        self.assertIsNone(cli.protected_root("/usrland/kickstart"))
        # Scratch space is refused as the target itself, allowed beneath it.
        self.assertEqual(cli.protected_root("/tmp"), "/tmp")
        self.assertIsNone(cli.protected_root("/tmp/my-first-project"))

    def test_windows_roots_match_descendants_case_insensitively(self):
        self.assertEqual(cli.protected_root("C:\\Windows"), "C:\\Windows")
        self.assertEqual(
            cli.protected_root("C:\\WINDOWS\\System32\\kickstart"), "C:\\Windows"
        )
        self.assertEqual(
            cli.protected_root("c:/program files/Kickstart"), "C:\\Program Files"
        )
        # The (x86) root is its own folder, not a child of "C:\\Program Files".
        self.assertEqual(
            cli.protected_root("C:\\program files (x86)\\kickstart"),
            "C:\\Program Files (x86)",
        )
        self.assertEqual(cli.protected_root("C:\\"), "C:\\")
        self.assertIsNone(cli.protected_root("C:\\Users\\Roli\\my-first-project"))

    def test_a_symlinked_managed_path_is_reported_as_a_conflict_not_followed(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            outside = root / "outside"
            target.mkdir()
            outside.mkdir()
            (target / ".claude").symlink_to(outside)

            result = plan(target)
            actions = {row["path"]: row["action"] for row in result["data"]["files"]}
            self.assertEqual(actions[".claude/commands/kickstart.md"], "conflict")
            self.assertEqual(result["status"], "fail")

    def test_install_never_writes_through_a_symlinked_managed_path(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            outside = root / "outside"
            target.mkdir()
            outside.mkdir()
            (target / ".claude").symlink_to(outside)

            self.assertEqual(main(["install", "--target", str(target)]), 1)
            self.assertEqual(list(outside.iterdir()), [])

    def test_javascript_route_is_blocked_for_a_nonempty_existing_target(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / "existing-project"
            target.mkdir()
            (target / "app.py").write_text("print('hi')\n")

            result = plan(target, "javascript")
            self.assertIn(
                "target.javascript-clone-nonempty",
                [item["id"] for item in result["findings"]],
            )
            self.assertEqual(result["status"], "fail")
            self.assertIsNone(result["data"]["setupCommands"])
            self.assertIsNone(result["data"]["startCommand"])
            # The Python route still works for the same existing folder.
            python_result = plan(target, "python")
            self.assertIsNotNone(python_result["data"]["setupCommands"])


class EnvelopeTests(unittest.TestCase):
    def test_plan_emits_a_serializable_reliability_lab_envelope(self):
        with TemporaryDirectory() as directory:
            result = plan(Path(directory) / "project")

        self.assertEqual(json.loads(json.dumps(result)), result)
        self.assertEqual(result["envelope"], "hermes.reliability-lab.result/1")
        self.assertEqual(result["tool"], "agent-kickstart")
        self.assertEqual(result["toolVersion"], __version__)
        self.assertEqual(result["command"], "plan")
        self.assertIn(result["status"], ("pass", "warn", "unknown", "fail"))
        self.assertRegex(result["timestamp"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        self.assertIn(type(result["gitSha"]), (str, type(None)))
        for field in ("inputHash", "findings", "exitCode", "mode", "data"):
            self.assertIn(field, result)
        for item in result["findings"]:
            self.assertIn(item["severity"], evidence.STATUS_ORDER)
            self.assertTrue(item["id"] and item["summary"])

    def test_overall_status_is_the_worst_finding_present(self):
        self.assertEqual(evidence.worst_status([]), "pass")
        self.assertEqual(
            evidence.worst_status([
                evidence.finding("a", "pass", "ok"),
                evidence.finding("b", "warn", "hmm"),
            ]),
            "warn",
        )
        self.assertEqual(
            evidence.worst_status([
                evidence.finding("b", "warn", "hmm"),
                evidence.finding("c", "fail", "no"),
                evidence.finding("d", "unknown", "?"),
            ]),
            "fail",
        )

    def test_git_sha_marks_a_tree_whose_commit_does_not_describe_the_code(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertIsNone(evidence.git_sha(root), "a non-repository has no commit")

            def run(*args):
                return subprocess.run(
                    ["git", "-C", str(root), *args], check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
            run("init", "-q")
            run("config", "user.email", "test@example.invalid")
            run("config", "user.name", "Test")
            (root / "a.txt").write_text("one\n")
            run("add", "-A")
            run("commit", "-qm", "first")

            clean = evidence.git_sha(root)
            self.assertRegex(clean, r"^[0-9a-f]{40}$")

            (root / "a.txt").write_text("two\n")
            self.assertEqual(evidence.git_sha(root), f"{clean}-dirty")

    def test_declared_version_matches_the_packaging_metadata(self):
        pyproject = (Path(__file__).resolve().parent.parent / "pyproject.toml").read_text()
        self.assertIn(f'version = "{__version__}"', pyproject)


if __name__ == "__main__":
    unittest.main()
