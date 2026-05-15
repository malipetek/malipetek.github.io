---
layout: ../../../layouts/BaseLayout.astro
title: Convert Bash Scripts Into Named CLI Commands in Linux
description: Alternative method for accessing google drive in debian desktops.
summary:
keywords: Debian, Ubuntu, Linux, Bash, PC
image: https://i.imgur.com/qC6ZiJM.png
---

# Convert Bash Scripts Into Named CLI Commands in Linux

When your daily OS is linux, sometimes some terminal commands are so useful you might want to save them.

For example I had a weird monitor whose output mode was not detected automatically. I used `xrandr` to add mode to set proper resolution.

I used to rely on history and arrow-up retrieval, but that gets noisy fast.

## Save complex command to single keyword

Open Terminal and run:

```bash
cd /usr/local/sbin/ && sudo touch [your-command] && sudo chmod +x [your-command] && sudo gedit [your-command]
```

Then paste in:

```bash
#!/usr/bin/env bash

[your terminal command]
```

If needed, wrap with `eval`:

```bash
#!/usr/bin/env bash

eval "[your terminal command]"
```

Now you can call `your-command` directly from terminal.
