# Annoying Secondary Display Situation with XFCE and Linux Mint

I was having this aanoying issue after moving to xfce from cinnamon, in which I had to adjust display everytime I reboot.

I had similar issue on cinnamon as well actually, I solved that one with a bash script using `xrandr` but later after I upgraded to linux mint 20, script was not necessary actually.

However after moving to XFCE that script also started throwing errors and was not effective.

While searching on the internet about the issue I came across this X11 conf setups.

[X11 Conf Docs](https://www.x.org/releases/current/doc/man/man5/xorg.conf.5.xhtml#heading12)

[Question Which led me to it](https://superuser.com/questions/438699/adding-dual-monitor-settings-to-xorg-conf-d)

It is basically you can add some settings inside files like this `/etc/X11/xorg.conf.d/xxx.conf`

I saw somewhere they were adding `40-DVI.conf`, I decided to go with `40-vga-monitor.conf` with not much confidence actually. I guess file name is not important as long as you add correct section syntax inside.

For my case the display I wanted to keep at a setup was called `VGA1` sometimes it is called `VGA-1` you can look that up from running this command
```bash
xrandr
```
In the results I have something like this

```
Screen 0: minimum 8 x 8, current 2736 x 928, maximum 32767 x 32767
LVDS1 connected primary 1366x768+0+160 (normal left inverted right x axis y axis) 310mm x 170mm
   1366x768      59.98*+
   1280x720      59.74  
   1024x768      60.00  
   1024x576      60.00    59.90    59.82  
   960x540       60.00    59.63    59.82  
   800x600       60.32    56.25  
   864x486       60.00    59.92    59.57  
   640x480       59.94  
   720x405       59.51    60.00    58.99  
   680x384       60.00  
   640x360       59.84    59.32    60.00  
DP1 disconnected (normal left inverted right x axis y axis)
DP2 disconnected (normal left inverted right x axis y axis)
DP3 disconnected (normal left inverted right x axis y axis)
HDMI1 disconnected (normal left inverted right x axis y axis)
HDMI2 disconnected (normal left inverted right x axis y axis)
HDMI3 disconnected (normal left inverted right x axis y axis)
VGA1 connected 1368x768+1368+0 (normal left inverted right x axis y axis) 0mm x 0mm
   1368x768_60.00  59.88*+
   1368x768      59.88 +
   1024x768      60.00  
   800x600       60.32    56.25  
   848x480       60.00  
   640x480       59.94  
VIRTUAL1 disconnected (normal left inverted right x axis y axis)
```

So following docs I added this lines to `40-vga-monitor.conf` I created at the `/etc/X11/xorg.conf.d/` directory:

```bash
Section "Monitor"
    Identifier  "VGA1"
    Modeline    "1368x768_60.00"   85.25  1368 1440 1576 1784  768 771 781 798
    Option      "PreferredMode" "1368x768_60.00"
    Option      "Position" "1368 -160"
EndSection
```

If you dont know your Modeline you can run 
```bash
cvt 1366 768
```

Copy modeline line and remove `hsync` and `vsync`.

You can reach me if you have similar setup and stuck on minor details.