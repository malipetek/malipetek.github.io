---
layout: ../../../layouts/BaseLayout.astro
title: Annoying Secondary Display Situation with XFCE and Linux Mint
description:
keywords: Linux, XFCE, X11, Display, Linux Mint
---

# Annoying Secondary Display Situation with XFCE and Linux Mint

After switching to XFCE I had to reconfigure displays every boot. Fix was to persist monitor settings through an X11 config file.

Create a file in `/etc/X11/xorg.conf.d/` (for me `40-vga-monitor.conf`) with:

```bash
Section "Monitor"
    Identifier  "VGA1"
    Modeline    "1368x768_60.00"   85.25  1368 1440 1576 1784  768 771 781 798
    Option      "PreferredMode" "1368x768_60.00"
    Option      "Position" "1368 -160"
EndSection
```

Get modeline with:

```bash
cvt 1366 768
```

Then strip hsync/vsync parts and place the values into `Modeline`.
