# Raspberry Pi 3B — Local Network File Server

A complete guide to setting up a Samba file share on a Raspberry Pi 3B with a 128 GB USB flash drive, accessible from Windows, macOS, and Linux.

---

## Requirements

- Raspberry Pi 3B running Raspberry Pi OS (Lite or Desktop)
- 128 GB USB flash drive
- Pi connected to your router (Ethernet recommended over Wi-Fi)
- SSH access or a keyboard/monitor attached to the Pi

---

## SSH Access Setup

SSH lets you control the Pi remotely from any device on your network — no keyboard or monitor needed. Complete this section before the main steps if you plan to manage the Pi headlessly.

### Enable SSH on the Pi

**If you have a monitor/keyboard attached:**

```bash
sudo raspi-config
```

Navigate to **Interface Options → SSH → Enable**, then finish and reboot.

Alternatively, enable it directly:

```bash
sudo systemctl enable ssh
sudo systemctl start ssh
```

**If you are setting up a fresh SD card (headless from the start):**

After flashing Raspberry Pi OS, open the `boot` partition (visible on any OS) and create an empty file named `ssh` (no extension) in the root of that partition. The Pi will enable SSH automatically on first boot.

```bash
# On Linux/macOS — run from the boot partition root
touch ssh
```

On Windows, create a new empty text file via Notepad and save it as `ssh` with no `.txt` extension, directly in the boot drive root.

### Find the Pi's IP Address

If you don't know the Pi's IP yet, check your router's admin panel (usually `192.168.1.1` or `192.168.0.1`) for a device named `raspberrypi`, or use a network scanner:

```bash
# On Linux/macOS
arp -a

# Or install nmap and scan your subnet
nmap -sn 192.168.1.0/24
```

### Connect via SSH

**Windows** (PowerShell or Command Prompt — SSH is built in since Windows 10):

```powershell
ssh pi@192.168.1.42
```

**macOS / Linux** (Terminal):

```bash
ssh pi@192.168.1.42
```

Enter the Pi's password when prompted (default is `raspberry` — change it immediately if you haven't).

### Change the Default Password

```bash
passwd
```

### Set Up SSH Key Authentication (Recommended)

Password login is convenient but less secure. Key-based auth means no password is ever sent over the network.

**1. Generate a key pair on your local machine** (skip if you already have one at `~/.ssh/id_ed25519`):

```bash
ssh-keygen -t ed25519 -C "pi-fileserver"
```

Accept the default path and optionally set a passphrase.

**2. Copy the public key to the Pi:**

```bash
# macOS / Linux
ssh-copy-id pi@192.168.1.42

# Windows (PowerShell) — run this instead
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh pi@192.168.1.42 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

**3. Test that key login works:**

```bash
ssh pi@192.168.1.42
```

You should connect without being asked for a password.

**4. Optionally disable password login** once keys are confirmed working:

```bash
sudo nano /etc/ssh/sshd_config
```

Find and set these lines:

```
PasswordAuthentication no
ChallengeResponseAuthentication no
```

Restart SSH:

```bash
sudo systemctl restart ssh
```

> **Warning:** Do not disable password login until you have confirmed key authentication works in a separate terminal session. Locking yourself out requires physical access to the Pi.

### Create an SSH Shortcut (Optional)

On your local machine, add an entry to `~/.ssh/config` (create the file if it doesn't exist):

```
Host pi
    HostName 192.168.1.42
    User pi
    IdentityFile ~/.ssh/id_ed25519
```

You can then connect with just:

```bash
ssh pi
```

---

## Step 1 — Update the System

```bash
sudo apt update && sudo apt upgrade -y
```

---

## Step 2 — Identify the USB Drive

Plug in the flash drive, then run:

```bash
lsblk
```

Expected output:

```
NAME        MAJ:MIN RM   SIZE RO TYPE MOUNTPOINT
sda           8:0    1  119.1G  0 disk
└─sda1        8:1    1  119.1G  0 part
mmcblk0     179:0    0    32G  0 disk
└─mmcblk0p1 ...
```

Your drive will appear as `/dev/sda1`. Confirm the size matches your 128 GB drive before proceeding.

---

## Step 3 — Format the Drive

Format as **ext4** — the best choice for a Linux-hosted server:

```bash
sudo mkfs.ext4 /dev/sda1
```

> **Note:** If you ever need to plug the drive directly into a Windows PC, use exFAT instead:
> ```bash
> sudo apt install exfat-fuse exfatprogs -y
> sudo mkfs.exfat /dev/sda1
> ```
> For a dedicated Pi server, ext4 is more reliable and performant.

---

## Step 4 — Create a Mount Point and Mount the Drive

```bash
sudo mkdir -p /mnt/usbshare
sudo mount /dev/sda1 /mnt/usbshare
```

Verify the drive is mounted:

```bash
df -h | grep sda
```

You should see the 128 GB drive listed under `/mnt/usbshare`.

---

## Step 5 — Auto-Mount on Boot

Get the drive's UUID — more reliable than `/dev/sda1`, which can change between reboots:

```bash
sudo blkid /dev/sda1
```

Copy the UUID value (e.g., `a1b2c3d4-e5f6-...`), then open fstab:

```bash
sudo nano /etc/fstab
```

Add this line at the bottom, replacing `YOUR-UUID` with the actual UUID:

```
UUID=YOUR-UUID  /mnt/usbshare  ext4  defaults,nofail  0  2
```

The `nofail` option prevents the Pi from hanging on boot if the drive isn't plugged in.

Save with `Ctrl+O`, exit with `Ctrl+X`, then test:

```bash
sudo mount -a
```

No output means success.

---

## Step 6 — Set Up the Shared Folder

Create a dedicated folder inside the mount point and assign ownership to the `pi` user:

```bash
sudo mkdir -p /mnt/usbshare/shared
sudo chown -R pi:pi /mnt/usbshare/shared
sudo chmod 775 /mnt/usbshare/shared
```

---

## Step 7 — Install Samba

```bash
sudo apt install samba samba-common-bin -y
```

---

## Step 8 — Configure Samba

Back up the default configuration first:

```bash
sudo cp /etc/samba/smb.conf /etc/samba/smb.conf.bak
```

Open the config file:

```bash
sudo nano /etc/samba/smb.conf
```

Scroll to the very bottom and add:

```ini
[PiShare]
   comment = Raspberry Pi 128GB USB Share
   path = /mnt/usbshare/shared
   browseable = yes
   writeable = yes
   only guest = no
   create mask = 0664
   directory mask = 0775
   valid users = pi
```

Save with `Ctrl+O`, exit with `Ctrl+X`.

---

## Step 9 — Set a Samba Password

Samba uses its own password system, separate from the Linux login:

```bash
sudo smbpasswd -a pi
```

Enter and confirm a password. You will use this when connecting from other devices.

---

## Step 10 — Start and Enable Samba

```bash
sudo systemctl restart smbd
sudo systemctl enable smbd
```

Verify it is running:

```bash
sudo systemctl status smbd
```

---

## Step 11 — Find Your Pi's IP Address

```bash
hostname -I
```

Note the IP address (e.g., `192.168.1.42`). It is strongly recommended to assign a **static IP** to your Pi in your router's DHCP settings so the address never changes.

---

## Connecting from Each OS

### Windows

1. Open **File Explorer**
2. Type in the address bar: `\\192.168.1.42\PiShare`
3. Enter username `pi` and your Samba password when prompted
4. To make it permanent: right-click the share → **Map network drive**

### macOS

1. Open **Finder** → `Go` menu → **Connect to Server** (`⌘K`)
2. Enter: `smb://192.168.1.42/PiShare`
3. Click **Connect** and enter `pi` with your Samba password
4. To reconnect automatically at login: System Settings → General → Login Items → add the mounted share

### Linux (GUI)

| File Manager | Address to enter |
|---|---|
| Nautilus (GNOME) | `smb://192.168.1.42/PiShare` |
| Dolphin (KDE) | `smb://192.168.1.42/PiShare` |
| Thunar (XFCE) | `smb://192.168.1.42/PiShare` |

Press `Ctrl+L` to open the address bar in most file managers.

### Linux (CLI)

```bash
sudo apt install cifs-utils -y
sudo mkdir -p /mnt/piserver
sudo mount -t cifs //192.168.1.42/PiShare /mnt/piserver -o username=pi,password=yourpassword
```

To auto-mount on boot, add to `/etc/fstab`:

```
//192.168.1.42/PiShare  /mnt/piserver  cifs  username=pi,password=yourpassword,iocharset=utf8  0  0
```

---

## Optional Improvements

### Use a Hostname Instead of an IP

On macOS and Linux you can access the share as `smb://raspberrypi.local/PiShare` if your network supports mDNS. On Windows, install [Bonjour Print Services](https://support.apple.com/downloads/bonjour-for-windows) to enable the same.

### Add More Users

```bash
sudo adduser username
sudo smbpasswd -a username
```

Then add the new username to `valid users` in `/etc/samba/smb.conf`:

```ini
valid users = pi, username
```

Restart Samba after any config change: `sudo systemctl restart smbd`

### Read-Only Public Share (No Password)

Add a second share section to `/etc/samba/smb.conf` for a password-free, read-only area:

```ini
[Public]
   comment = Public Read-Only
   path = /mnt/usbshare/public
   browseable = yes
   writeable = no
   guest ok = yes
```

Create the folder and set open permissions:

```bash
sudo mkdir -p /mnt/usbshare/public
sudo chmod 755 /mnt/usbshare/public
```

### Allow Through Firewall (if UFW is enabled)

```bash
sudo ufw allow samba
```

---

## Performance Notes

The Raspberry Pi 3B shares its USB 2.0 bus with the Ethernet controller. Real-world throughput is typically **25–40 MB/s** for reads and **15–25 MB/s** for writes — perfectly adequate for home file sharing, media streaming, and document access, but not suitable for high-throughput workloads.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Cannot see the share on the network | Run `sudo systemctl status smbd` and check for errors; run `sudo ufw allow samba` if the firewall is active |
| "Permission denied" when connecting | Confirm `pi` is listed in `valid users` and you ran `sudo smbpasswd -a pi` |
| Drive not mounting on boot | Double-check the UUID in `/etc/fstab` and ensure `nofail` is present |
| Windows "Network path not found" | Try the IP address directly (`\\192.168.1.42\PiShare`) instead of the hostname |
| Files created on Windows have wrong permissions | Add `force create mode = 0664` and `force directory mode = 0775` to the share config |
| Drive fills up silently | Monitor usage with `df -h /mnt/usbshare` — 128 GB fills faster than expected with media files |
| SSH "Connection refused" | Run `sudo systemctl status ssh` on the Pi; ensure SSH is enabled via `raspi-config` |
| SSH "Permission denied (publickey)" | Check `~/.ssh/authorized_keys` exists on the Pi and has mode `600`; run `chmod 600 ~/.ssh/authorized_keys` |
| SSH connection drops when idle | Add `ServerAliveInterval 60` to your local `~/.ssh/config` to keep the connection alive |
