<div align="center">

# 🍃 Project Cassia
### *Advanced UI Framework & Modern Applet Suite for the Cinnamon Desktop*

[![Danyp-Lab](https://img.shields.io/badge/Danyp--Lab-Official_Project-00f2fe?style=for-the-badge&logo=github)](https://github.com/Danyp-Lab)
[![Platform](https://img.shields.io/badge/Platform-Cinnamon%20Desktop-orange?style=for-the-badge&logo=linuxmint)](https://linuxmint.com)
[![License](https://img.shields.io/badge/License-GPLv3-blue?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Active%20v1.0.0-success?style=for-the-badge)](#)

<p align="center">
  Engineered with high aesthetic standards and structural stability to provide memory-safe, crash-resistant desktop widgets for Linux Mint & Cinnamon.
</p>

</div>

---(https://img.shields.io/badge/License-GPLv3-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Cinnamon-orange.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

**Project Cassia** is an advanced suite of high-performance JavaScript applets, UI components, and productivity widgets engineered for the Cinnamon Desktop Environment. 

Designed with modern aesthetics and structural stability, this framework provides robust, memory-safe alternatives to standard desktop widgets. 

## 📦 Included Components

### 1. Modern Hijri Shamsi Calendar (`jalalicalendar@daniel-pm`)
A highly optimized, multi-calendar applet that seamlessly integrates with the Cinnamon desktop.

**Key Features:**
*   **Multi-Calendar Engine:** Synchronized support for Gregorian, Jalali (Shamsi), and Hijri (Lunar) dates using precise epoch conversion algorithms.
*   **Modern UI/UX:** Features a glassmorphism design language with seasonal theme borders (Spring, Summer, Autumn, Winter) and an annual progress bar.
*   **Robust Event Handling:** Fully integrated with `gnome-calendar` and Evolution Data Server (EDS). Engineered with strict Clutter layout allocation handling, ensuring zero black-screen panics or window manager crashes during rapid UI rendering.
*   **Advanced Rendering:** Custom logic for parsing spanning events, color-coded categories, and zero-width fallback rendering.

### 2. LiquidGlass Theme (`LiquidGlass`)
A modern glassmorphism Cinnamon theme designed for high-end aesthetics, featuring panel transparency, custom popover styling, and smooth hover state animations.

## 📂 Repository Structure

```text
project-cassia/
├── applets/
│   └── jalalicalendar@daniel-pm/   # Modern Hijri Shamsi Calendar
│       ├── applet.js               # Main loop and UI hooks
│       ├── calendar.js             # Core Clutter UI and layout allocation
│       ├── eventView.js            # EDS data parsing and event rows
│       ├── metadata.json           # Applet registry
│       ├── stylesheet.css          # Glassmorphic and seasonal styling
│       └── modules/
│           └── date-utils.js       # Epoch conversion algorithms
├── themes/
│   └── LiquidGlass/                # Cinnamon shell theme
├── desklets/                       # (Planned) Desktop widgets
├── extensions/                     # (Planned) Window manager enhancements
├── assets/                         # Repository images and social previews
└── README.md                       # Repository documentation
```

## 🚀 Installation

To install the components, you can manually link them to your Cinnamon local share directory.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/DanialPahlavan/Project-Cassia.git
   cd Project-Cassia
   ```

2. **Install the Applet:**
   Copy the applet folder to your local Cinnamon applets directory:
   ```bash
   cp -r applets/jalalicalendar@daniel-pm ~/.local/share/cinnamon/applets/
   ```
   *Alternatively, for local development and testing:*
   ```bash
   ln -s $(pwd)/applets/jalalicalendar@daniel-pm ~/.local/share/cinnamon/applets/
   ```

3. **Install the Theme:**
   Copy the theme to your local themes directory:
   ```bash
   mkdir -p ~/.themes
   cp -r themes/LiquidGlass ~/.themes/
   ```
   *Alternatively, for local development and testing:*
   ```bash
   mkdir -p ~/.themes
   ln -s $(pwd)/themes/LiquidGlass ~/.themes/
   ```

4. **Enable the Components:**
   **Applet:**
   * Right-click your panel and select **Applets**.
   * Navigate to the **Manage** tab, find "Modern Hijri Shamsi Calendar", and click the `+` to add it to your panel.
   
   **Theme:**
   * Open **System Settings** -> **Themes**.
   * Change the Desktop, Controls, or Borders theme to **LiquidGlass**.

## 👨‍💻 Maintainer

**Danial Pahlavan Masouri**  
*PhD Candidate in Computer Science - Artificial Intelligence*

## 📄 License

This project is licensed under the [GNU General Public License v3.0](LICENSE) - see the LICENSE file for details.
