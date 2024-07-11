---
title: Access Google Drive Reliably in Ubuntu

description: Alternative method for accessing google drive in debian desktops.

summary: 
keywords: Debian, Ubuntu, Linux, Bash, PC

image: https://i.imgur.com/qC6ZiJM.png
---
# Convert Bash Scripts Into Named CLI Commands in Linux

When your daily OS is linux, sometimes some terminal commands are so useful you might want to save them.

_For example I had a weird monitor thats output mode was not detected automatically. I used `xrandr` to add mode to set proper resolution._

I used to copy paste this command to terminal. 
> `xrandr --addmode VGA1 "1024x600_60.00"`

It was usually in terminal history so sometimes I used to only hit up arrow key to find that command. 

However it is not ideal to do like this because sometimes I pollute my terminal history with many trials or installing packages and need to find this mode string again.

## Save complex command to single keyword

Maybe there is a simpler way but this is what I have found working for myself.

Open Terminal and paste:

```bash
cd /usr/local/sbin/ && sudo touch [your-command] && sudo chmod +x [your-command] && sudo gedit [your-command]
```

When text editor opens with elevated permissions paste your command here like below and save:

```bash
#!/usr/bin/env bash

[your termial command]
```

If for some reason your command does not work you can try wrapping your command into `eval`.

```bash
#!/usr/bin/env bash

eval "[your termial command]"
``` 

 ### End

 Now you can use your-command in your terminal. Type beginning your command and push tab to see if its recognized.

 You see we are typing your command multiple times process is quite painful but better than copy pasting or having to google it again IMHO.

 Maybe we can write some command that generates these. Hit the comments if you already written such thing.
