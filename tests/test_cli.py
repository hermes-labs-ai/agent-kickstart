import unittest
from pathlib import Path

from agent_kickstart.cli import start_command


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


if __name__ == "__main__":
    unittest.main()
