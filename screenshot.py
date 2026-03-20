import sys
import time

# We need to take a screenshot of the X11 display running the bgp-viewer app
# We can use scrot or import something to capture the screen since Playwright is for web apps
# Wait, bgp-viewer is a desktop application built with Ebitengine, not a web app.
# The instructions say to use playwright for frontend, but this is a desktop app (Go/Ebiten) running in Xvfb.
# We should just capture the Xvfb screen.

import subprocess
import os

# Wait for app to start and render something
time.sleep(5)

# Assuming xvfb-run sets DISPLAY=:99
env = os.environ.copy()
env["DISPLAY"] = ":99"

# Install scrot if not present
subprocess.run(["sudo", "apt-get", "install", "-y", "scrot"])

# Take screenshot
subprocess.run(["scrot", "/home/jules/verification/verification.png"], env=env)

print("Screenshot taken.")
