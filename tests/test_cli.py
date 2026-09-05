import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from agent_kickstart.cli import install, start_command


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


if __name__ == "__main__":
    unittest.main()
