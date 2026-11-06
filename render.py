"""Render index.html to video frame-by-frame.

  python render.py stills 2 9.5 17.6 ...   -> out/stills/t_XX.png
  python render.py video [--fps 30]        -> out/video_noaudio.mp4 + out/cues.json
"""
import json
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "out"
URL = (ROOT / "index.html").as_uri() + "?render=1"


def open_page(p):
    exe = pathlib.Path.home() / "Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell"
    browser = p.chromium.launch(executable_path=str(exe) if exe.exists() else None)
    page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
    page.on("pageerror", lambda e: print("PAGE ERROR:", e))
    page.on("console", lambda m: m.type == "error" and print("CONSOLE:", m.text))
    page.goto(URL)
    page.wait_for_function("window.__ready === true")
    return browser, page


def stills(times):
    d = OUT / "stills"
    d.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser, page = open_page(p)
        for t in times:
            page.evaluate("t => window.renderAt(t)", float(t))
            path = d / f"t_{float(t):05.2f}.png"
            page.screenshot(path=str(path))
            print(path)
        errs = page.evaluate("window.__errors || []")
        if errs:
            print("errors:", errs)
        browser.close()


def video(fps=30):
    OUT.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser, page = open_page(p)
        dur = page.evaluate("window.DURATION")
        cues = page.evaluate("window.AUDIO_CUES")
        (OUT / "cues.json").write_text(json.dumps(cues, ensure_ascii=False, indent=1))
        n = int(round(dur * fps))
        ff = subprocess.Popen(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(fps), "-c:v", "png", "-i", "-",
             "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
             str(OUT / "video_noaudio.mp4")],
            stdin=subprocess.PIPE,
        )
        t0 = time.time()
        for i in range(n):
            page.evaluate("t => window.renderAt(t)", i / fps)
            ff.stdin.write(page.screenshot(type="png"))
            if i % 150 == 0:
                el = time.time() - t0
                print(f"frame {i}/{n}  {el:.0f}s elapsed", flush=True)
        ff.stdin.close()
        ff.wait()
        browser.close()
        print(f"done {n} frames in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "stills":
        stills(sys.argv[2:])
    else:
        fps = int(sys.argv[sys.argv.index("--fps") + 1]) if "--fps" in sys.argv else 30
        video(fps)
