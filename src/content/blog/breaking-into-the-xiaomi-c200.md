---
title: "Breaking into the Xiaomi C200: a 16 MB flash chip, a CH341A, and one very stubborn IP camera"
category: hardware
date: 2026-10-16
summary: "I wanted a local camera for my robot, with no cloud. The C200 had other ideas. Dumping, patching and reflashing its SPI flash, and the four bugs that cost me the most time."
---

I have an Eufy RoboVac 35C I am slowly turning into something fully local — ESPHome, no vendor app, no cloud. It needs eyes. I had a Xiaomi C200 (MJSXJ14CM) sitting in a drawer, and it seemed like a free camera.

It is not free. It is a 16 MB flash chip, an Ingenic T31, and a lesson in reading your tools instead of trusting them.

This is the story of getting to a root shell on it, and everything that bit me on the way.

## What is actually inside

Opening it up and reading the silkscreen and markings:

| Part | What it is |
|---|---|
| SoC | **Ingenic T31L**, MIPS32r2 little-endian |
| Sensor | **GC2083** |
| Wi-Fi | **Realtek RTL8188FTV**, attached over **USB** |
| Flash | **Fudan FM25Q128A**, 16 MB SPI NOR, 3.3 V, SOIC-8 |
| Pan/tilt | UTC2803 driver, motors via `/dev/motor` |

Two things there matter enormously.

First, **the USB port is power only.** Two wires. No data. Every plan involving USB Ethernet, USB gadget mode or treating it as a webcam dies right there. Wi-Fi is the only data path this board will ever have.

Second, the flash is a plain **SOIC-8 SPI NOR**. That is the whole opportunity: it is readable and writable with a cheap programmer, off the board, with no vendor cooperation.

## The cheap programmer that can kill your chip

The black CH341A is the default tool for this, and mine had the classic defect. Before touching the camera I measured the socket with nothing in it:

```
3.3V — 3.3 V
CS   — 5 V
MOSI — 4.92 V
CLK  — 4.92 V
```

The socket is 3.3 V but the data lines swing to 5 V, because the CH341A itself runs on 5 V. Feeding that into a 3.3 V flash chip and a 3.3 V SoC is how you turn a working camera into a dead one.

The fix is a small mod: lift the CH341A's pin 28 (VCC) off the 5 V pad and tie it to pin 9 (V3) and the board's 3.3 V rail. After that all four lines read 3.3 V. **Measure before you connect anything.** I would not have known without checking.

## Reading the chip

I tried reading in-circuit with a SOIC-8 clip first. It half-worked, which was worse than failing:

- both dumps started with a valid Ingenic boot header
- and then were **97–99 % `0xFF`**, differently wrong each time

The data line was intermittently failing to pull low. The T31's I/O pins were partly powered through the flash's VCC, sitting in an undefined state, loading the bus, drifting as things warmed up.

The fix was to stop fighting it: **desolder the chip** and read it on the adapter. Three reads came out byte-for-byte identical. That is the whole trick — if two reads differ, you do not have a dump, you have noise.

Then verify it:

```bash
flashrom -p ch341a_spi -r c200-stock-1.bin
flashrom -p ch341a_spi -r c200-stock-2.bin
shasum -a 256 c200-stock-*.bin   # must match
```

Keep that image forever. It holds the unit's MAC and calibration, and it is your only way back.

## What the dump told me

The U-Boot environment gave me the real partition table, and it disagreed with the one in the init scripts:

```
mtdparts=jz_sfc:320k(BOOT),2560k(ROOTFS),1728k(A_KERNEL),4544k(A_USRFS),
1728k(B_KERNEL),4544k(B_USRFS),256k(DATA),640k(SOUND),64k(FACTORY)
```

Nine partitions, summing exactly to 16384k. Two full **A/B firmware slots** — the bootloader falls back to B if A fails. That detail came back to matter later.

Also in there: `console=ttyS1,115200n8`. The serial console is enabled, at 115200 on UART1.

## The serial console I could not use

A serial console would have made everything easier, so I spent a long time hunting for it. The T31's UART is pins 74 (TX) and 73 (RX) at **0.4 mm pitch**. I probed candidate test pads, chased garbage on a baud-rate sweep, soldered a wire to a pin and had it come off, and eventually accepted the truth: without a microscope and proper needle probes, this is not a hand-solderable target.

A useful lesson though: I had assumed garbage output meant wrong baud. It meant **the probe was slipping**. Contact noise reads as junk bytes. Real UART idles at ~3.3 V and produces a steady stream while you hold still.

## Getting a shell in anyway

No UART, no telnet (Xiaomi stripped `telnetd` out, so the stock `S50telnet` script always fails), no SSH, and no local RTSP — video is cloud-only. But I could write the flash, and the filesystems are repackable squashfs.

So: add my own shell.

I wrote a small TCP shell server for the camera. The first version was a normal static glibc binary, and it would have died on boot: `strace` under qemu showed it uses `clone3`, `getrandom`, `rseq` and `newfstatat` — **none of which exist in the camera's 3.10 kernel**. The shipped version is freestanding: raw MIPS o32 syscalls, no libc at all, 2.9 KB.

Installed as `/bin/shellsrv`, started by an init script in the app partition, because rootfs's `/etc/init.d` is a symlink into the app partition — that is where `rcS` actually looks. I put the hook in **both** A and B slots so a fallback does not silently lose it.

## The four bugs worth your time

**1. `SOCK_STREAM` is 1, not 2.** I wrote `2`, which is `SOCK_DGRAM`. So I created a UDP socket and then called `listen()` on it. Every call failed, my accept loop retried, and it forked **about 2,000 shells**. The fix was one character; the lesson is that a retry loop around a syscall that cannot succeed is a fork bomb. It now backs off and never forks on failure.

**2. Do not trust qemu-user for sockets.** My emulator rejected `listen()` with `ENOTSUP` on a perfectly correct TCP socket, and `-strace` even mislabelled `SOCK_STREAM` as `SOCK_DGRAM`. A native x86-64 raw-syscall harness failed identically while Python's `socket.listen()` worked fine on the same machine. I nearly "fixed" a bug that did not exist. Validate with a **libc-linked** test where `errno` is decoded properly.

**3. macOS silently strips setuid when you repack a filesystem.** I built the squashfs on the Mac and `busybox` came out `-rwxr-xr-x` — it should be **`-rwsr-xr-x`**, and 47 files in that rootfs are setuid. Ownership was rewritten to my user, too. The images must be unpacked and repacked **inside Linux**. I only caught it by listing the image and comparing permissions against the original.

**4. `flashrom` will "find" a chip that is not there.** With the adapter unplugged and the bus floating it still printed:

```
Found Fudan flash chip "FM25Q128" (16384 kB, SPI) on ch341a_spi.
```

I built a wrong conclusion on that line before checking `ioreg`. Confirm the programmer is genuinely on USB before believing anything it says about a chip.

## Why the shell never showed up in my testing

After flashing, the camera booted — its setup AP appeared — but I could not reach port 2323. The reason was not the firmware.

The Mac reaches the internet over **Wi-Fi only**, and the camera's setup AP has no internet. Joining it would cut my own connection mid-test. The camera also only comes up in AP mode; it enters station mode only when paired through the vendor app, because `wifi_start.sh` checks `nvm bind_status` first. So the camera and my machine could never be on the same network at the same time.

The fix was embarrassingly simple and took a while to see: **move the Mac to Ethernet.** Free Wi-Fi, no lost session, and I could join the camera directly. If you take one practical thing from this post, take that one.

## The board fought back

The chip data was verified byte-perfect on the chip, and the camera booted it — Wi-Fi up, motors rotating. Then:

- pressing the reset button killed it
- a reflow of the T31 brought it back
- a second camera, given the same known-good chip, showed the same stall

That pattern — works, fails, heat fixes it, fails again after handling — is an **intermittent mechanical fault**, not software. A cracked ball or a hairline trace. Reflowing restores contact because it remelts the joint; it does not repair the weakness underneath, and every cycle risks lifted pads.

I was wrong about this twice along the way: I read a normal boot LED as a stall, and I blamed the board when the real problem was my own machine's Wi-Fi. Keeping the two straight is most of the work.

## What is actually finished

The firmware side is done and verified:

- a **verified stock backup**, three identical reads, checksummed
- a patched image where the only changes are the root and app partitions — kernels and the factory partition (the MAC) are byte-identical to stock
- a 2.9 KB freestanding shell server, proven to boot a C200
- the recovery path, which is one command:

```bash
flashrom -p ch341a_spi -w c200-stock-FM25Q128A-GOOD.bin
```

What is not finished is the board. Whether this particular unit can be revived is a soldering question now, not a software one.

## If you try this yourself

1. **Measure the programmer's lines before connecting a 3.3 V chip.** Cheap CH341A clones will try to kill it.
2. **Read the chip off the board.** In-circuit clips are a coin flip, and you cannot tell a good dump from a bad one without comparing two.
3. **Build filesystems on Linux**, or you will ship a rootfs without setuid and not notice.
4. **Validate embedded binaries against the real kernel's syscall set** — glibc static is not portable backwards.
5. **Do not trust your emulator, your flash tool, or your own diagnosis.** Verify with a second method.
6. **Move your dev machine off the radio you need.** It sounds trivial. It unblocked more than any code change.

The cloud-free camera for the robot will probably end up being an ESP32-CAM, which needs none of this. But the C200 is sitting on my desk with a verified backup and a working patch, waiting for its solder joints to behave.
