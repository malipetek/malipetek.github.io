---
layout: ../../../layouts/BaseLayout.astro
title: Access Google Drive Reliably in Ubuntu
description: Alternative method for accessing google drive in Debian desktops.
summary: Do you think ubuntu online accounts takes too long to load your drive folder? Try this.
keywords: Debian, Ubuntu, Linux, Bash, PC, GoogleDrive
image: https://i.imgur.com/qC6ZiJM.png
---

# Access Google Drive Reliably in Ubuntu

This is a faster method than Ubuntu online accounts by mounting with `google-drive-ocamlfuse`.

## Setup

```bash
sudo add-apt-repository ppa:alessandro-strada/ppa
sudo apt install google-drive-ocamlfuse
mkdir ~/google-drive
google-drive-ocamlfuse ~/google-drive
```

Add to startup:

```bash
google-drive-ocamlfuse ~/google-drive
```

Now the folder opens faster from file manager.
