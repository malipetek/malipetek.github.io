---
layout: ../../../layouts/BaseLayout.astro
title: How I  Solved Chrome GPU Issue on My Linux Mint
description: Have chrome GPU issues on linux, this is how I solved mine.
summary: Having gpu chrome issues? This is how I solved mine.
keywords: Debian, Ubuntu, Linux, Bash, PC, XFCE
image: https://i.imgur.com/qC6ZiJM.png
---

# How I  Solved Chrome GPU Issue on My Linux Mint

I moved from Cinnamon to XFCE and saw Chrome GPU rendering problems with multiple windows and maximization.

The core issue came down to an X11 configuration mismatch. Creating a `20-intel.conf` file helped:

```ini
Section "Device"
        Identifier  "card0"
        Driver      "intel"
        Option      "Backlight"  "intel_backlight"
        Option      "AccelMethod" "sna"
        Option      "TearFree" "true"
        Option      "DRI" "3"
        BusID       "PCI:0:2:0"
EndSection
```

Place it under `/usr/share/X11/xorg.conf.d/` and reboot.  
GPU acceleration stabilized after this change.
