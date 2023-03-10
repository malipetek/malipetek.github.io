---
title: Access Google Drive Reliably in Ubuntu

description: Alternative method for accessing google drive in debian desktops.

summary: Do you think ubuntu online accounts is taking so much to just load your drive folder. Try this alternative.

keywords: Debian, Ubuntu, Linux, Bash, PC, GoogleDrive

image: https://i.imgur.com/qC6ZiJM.png
---

# Access Google Drive Reliably in Ubuntu
## The Context

Recently I migrated from Win10 to Ubuntu as my main OS. 

I tried migrating before but problems always hold me back from reaping greater benefits it brings.

This time it was better. I installed Cinnamon DE and feeling at home.

## The Problem

For collaboration of some projects and for this blog, I use Google Drive. 
I like to have it in my file manager so I can see my files like local files. 
> Of course it is always possible to access web based UI but I like the feeling of local in file manager and other text editors.

Ubuntu has a "online accounts" section in settings. It is great, it allows me to add google account and turn on "file sync" and my drive folder appears in the locations sidebar of file manager(nautilus).

However when you click it, **it takes around a minute** to load root of Google Drive folder.

Maybe it is downloading all sub directories and stuff, whatever. **It is not usable.**

## The Solution

I've found the solution here: [Google Drive on Ubuntu 18.04 Bionic Beaver Linux
](https://linuxconfig.org/google-drive-on-ubuntu-18-04-bionic-beaver-linux)

Second section of this article mentions
[ocamlfuse](https://github.com/astrada/google-drive-ocamlfuse) as a alternative. This is a much better solution. Opens root directory instantly.

Here is how to set it up:

``` bash
sudo add-apt-repository ppa:alessandro-strada/ppa
```
``` bash
 sudo apt install google-drive-ocamlfuse 
```
``` bash
 mkdir ~/google-drive
```
```bash  
google-drive-ocamlfuse ~/google-drive
```

Then go to "Startup Applications Preferences" and add a new entry, give a name of your choice and paste this to "Command" field:
``` bash 
google-drive-ocamlfuse ~/google-drive
```

 ![startup_ocamlfuse](https://i.loli.net/2019/11/29/gYfVw9zP3BrDxKl.png)

 ## End

 You are done, open file manager and click on "google-drive" folder and see for yourself if it is faster.

 ![filemanager](https://i.loli.net/2019/11/29/DVcmFg9a2T5ejQx.png)
