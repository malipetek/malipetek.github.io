---
title: How I  Solved Chrome GPU Issue on My Linux Mint

description: Have chrome GPU issues on linux, this is how I solved mine.

summary: Having gpu chrome issues? This is how I solved mine.
keywords: Debian, Ubuntu, Linux, Bash, PC, XFCE

image: https://i.imgur.com/qC6ZiJM.png
---
# How I  Solved Chrome GPU Issue on My Linux Mint

I was using **Linux Mint** with **Cinnamon** for quite a while. I got tired of cinnamon crashing often and chrome devtools was slow too. I was unable to open lets say 6-8 devtools. It would make my system so slow it bothered me. I remember it was better when I was using windows actually.


First I transitioned to XFCE for desktop environment, hoping it would be better since it is known for its lightweightness.

Then I went ahead and enabled all hardware acceleration flag in **Chrome**. However there was an issue, **Chrome** would not render when it is maximized or sometimes when I opened a second window with maximization.

I have MESA drivers on my system so I should be able to use my intel HD4000 ( Ivy Bridge ) GPU for OPENGL.

First I tought maybe my MESA installation was not correct.

I tried uninstalling existing libdrm package. It actually removed many other packages, **never do it**.

Finally I understood issue was this thing called X11, I dont even know what it is exactly. But it is something like a software bridge between lower gpu libraries and your window manager.

Simply by trial and error and googling everything comes to my mind, I finally found this article.

[https://www.techzim.co.zw/2017/06/tuning-intel-graphics-card-ubuntu-16-04/](https://www.techzim.co.zw/2017/06/tuning-intel-graphics-card-ubuntu-16-04/)


However file contents was not visible.

I went to archive.org and found previous version.
[Previous Version](https://web.archive.org/web/20191019025026/https://www.techzim.co.zw/2017/06/tuning-intel-graphics-card-ubuntu-16-04/)

On my system I did not have `20-intel.conf` in my `/usr/share/X11/xorg.conf.d/` directory. So I created one:

`sudo touch /usr/share/X11/xorg.conf.d/20-intel.conf`

And I opened the file:

`sudo gedit /usr/share/X11/xorg.conf.d/20-intel.conf`

Pasted content saved and rebooted.

```
Section "Device"
        Identifier  "card0"
        Driver      "intel"
        Option      "Backlight"  "intel_backlight"
	Option 	    "AccelMethod" "sna"
	Option      "TearFree" "true"
	Option 	    "DRI" "3"
        BusID       "PCI:0:2:0"
EndSection
```

Just like this now I can run desktop and browser with gpu support(hardware acceleration).

