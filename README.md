# Multinput · 宣传片

Multinput 的概念宣传视频：一个 AI 同时控制多只鼠标并行做事。1920×1080，30fps，58 秒，中文字幕。

BGM 用的是《3 Strikers》（来源：B 站 BV1dBpRzsEsd），从原曲 0:12 开始，最后 2.5 秒淡出；音效是合成的，音高按原曲的 F 大调调过。这首曲子有版权，公开发布可能被平台识别、静音或限流；需要换无版权音乐时，去掉 `--bgm` 参数，就会改用合成配乐。

成品：`out/promo.mp4`

## 分镜

| 时间 | 场景 | 要点 |
|---|---|---|
| 0–6s | 开场 | 鼠标和键盘是给人类设计的。AI 也只能用一只鼠标吗？ |
| 6–14s | 一只鼠标 | 时间轴上依次搜索、等待、填表、等待、下载、等待 |
| 14–19.5s | 揭示 | 光标变成 AI 核心，分出 A/B/C 三只彩色光标 |
| 19.5–33s | 并行演示 | 调度面板加三个浏览器窗口：A 搜索、B 填表、C 导出报表，批量下发、动作日志 |
| 33–43s | 怎么看网页 | 无障碍树和元素编号，`click(ref=14)`，移动路径由执行器生成 |
| 43–52s | 快在哪里 | 串行和并行对比，提速来自等待被重叠（示意，非实测） |
| 52–58s | 结尾 | 一个大脑，多只手 |

## 文件

- `index.html`：整部片子。每一帧都是时间 `t` 的纯函数，用 `renderAt(t)` 渲染。直接用浏览器打开可以预览，空格暂停，左右键跳 2 秒，`?t=25` 从指定秒开始。
- `render.py`：用 Playwright 逐帧截图，再交给 ffmpeg 编码。
- `audio.py`：读取动画导出的 `out/cues.json`，生成和画面同步的音效，再叠上 BGM（不传 `--bgm` 就用合成配乐）。
- `bgm/`：下载的原曲音频，不要提交到公开仓库。

## 重新生成

```bash
python3 render.py stills 10 24 40     # 抽几帧检查，输出到 out/stills/
python3 render.py video --fps 30      # 无声视频和 cues.json
yt-dlp -f bestaudio -o bgm/bgm_src.m4a "https://www.bilibili.com/video/BV1dBpRzsEsd/"
ffmpeg -y -i bgm/bgm_src.m4a -ac 2 -ar 48000 out/bgm_full.wav
python3 audio.py --bgm out/bgm_full.wav --start 12   # out/audio.wav
ffmpeg -y -i out/video_noaudio.mp4 -i out/audio.wav -c:v copy -c:a aac -b:a 192k \
  -af loudnorm=I=-14:TP=-1.5:LRA=11 -ar 48000 -shortest -movflags +faststart out/promo.mp4
```

无头 Chromium 在 Claude Code 的沙箱里启动不了，需要在沙箱外运行。
